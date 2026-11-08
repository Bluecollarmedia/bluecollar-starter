// Run: node scripts/checks/brandContrast.check.cjs [path to typescript package]
// LIGHT BRAND COLOR: the owner may pick ANY brand color (look.brandColor), light or dark. Everything drawn ON the brand color must pick
// dark or light text by itself, and the brand color used AS text on the white page must stay readable (WCAG AA, 4.5 : 1).
//  Part 1 builds the theme (src/theme/colors.ts and src/theme/weather.ts) with several brand colors - charcoal, white, yellow, cyan,
//         blue, red, black - and measures every pair that matters.
//  Part 2 scans app/ and src/ (file text, kept simple and honest): it catches white text or icons placed right under a brand-color
//         background, the plain brand color used as a text / icon color, and pressed states / gradients that do not use the
//         readable shades. It cannot see every possible layout; it guards the patterns the app actually uses.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

// ── Part 1: the theme, built with each brand color ──
const compile = (rel, req) => {
  const m = { exports: {} };
  const out = ts.transpileModule(read(rel), { compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true } }).outputText;
  new Function('module', 'exports', 'require', out)(m, m.exports, req);
  return m.exports;
};
const themeFor = (brandColor) => {
  const fakeBrand = { brand: { look: { brandColor } } };
  const colors = compile('src/theme/colors.ts', (n) => (n === '@/config/brand' ? fakeBrand : require(n)));
  const weather = compile('src/theme/weather.ts', (n) => (n === '@/theme/colors' ? colors : n === '@/config/brand' ? fakeBrand : require(n)));
  return { colors, weather };
};
const BRANDS = ['#2B2B2B', '#FFFFFF', '#FFEB3B', '#00BCD4', '#1E88E5', '#E53935', '#000000'];
const AA = 4.5;
for (const b of BRANDS) {
  const { colors: C, weather: W } = themeFor(b);
  const L = C.lightTheme;
  const cr = C.contrastRatio;
  const fails = [];
  const need = (label, fg, bg) => { const r = cr(fg, bg); if (!(r >= AA)) fails.push(`${label} ${fg} on ${bg} = ${r.toFixed(2)}`); };
  need('textOnPrimary on primary', L.textOnPrimary, L.primary);
  need('textOnPrimary on the pressed / gradient shade', L.textOnPrimary, L.primaryPressed);
  need('primaryOnWhite on white', L.primaryOnWhite, '#FFFFFF');
  need('primaryOnWhite on the gray cards', L.primaryOnWhite, L.surface);
  need('primaryOnWhite on the brand tint (selected chips)', L.primaryOnWhite, L.primarySurface);
  need('primaryDark on white', L.primaryDark, '#FFFFFF');
  need('white on primaryDark (badges, pills)', '#FFFFFF', L.primaryDark);
  need('accent (headings) on white', C.brand.accent, '#FFFFFF');
  need('tones.brand text on its pill', C.tones.brand.fg, C.tones.brand.bg);
  need('document heading on the white page', C.documentColors.heading, '#FFFFFF');
  for (const s of C.swatches) need(`avatar / crew initials on swatch ${s}`, C.onColor(s), s);
  for (const s of C.swatches) need(`crew name in its color on its tint ${s}`, C.readableOnLight(s), C.mixColor(s, '#FFFFFF', 0.88));
  const wx = Object.values(W).find((v) => v && typeof v === 'object' && 'deepText' in v);
  if (!wx) fails.push('weather palette has no deepText');
  else { need('weather: brand text on white (deepText)', wx.deepText, '#FFFFFF'); need('weather: brand text on its cards', wx.deepText, wx.card); need('weather: onDeep on the brand color', wx.onDeep, wx.deep); }
  const widget = W.widgetColors;
  if (widget) need('widget accent on its white page', widget.accent, widget.page);
  check(`1 brand color ${b}: text on the brand color, the brand color as text, and every derived shade read at 4.5 : 1`, fails.length === 0, fails.join(' | '));
}
{
  const { colors: C } = themeFor('#2B2B2B');
  check('2 the default charcoal keeps its look: white text on it, and primary text is the brand color itself', C.lightTheme.textOnPrimary === '#FFFFFF' && C.lightTheme.primaryOnWhite === '#2B2B2B' && C.lightTheme.primary === '#2B2B2B');
  const Y = themeFor('#FFEB3B').colors;
  check('3 a light brand color (yellow) gets dark text on its buttons and a darker shade of itself for text on white', Y.lightTheme.textOnPrimary !== '#FFFFFF' && Y.lightTheme.primary === '#FFEB3B' && Y.lightTheme.primaryOnWhite !== '#FFEB3B');
}

// ── Part 2: the screens and components ──
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
const files = [...walk('app'), ...walk('src')].filter((f) => !/^src\/(theme|config|i18n)\//.test(f));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
// A brand-color BACKGROUND: colors.primary / primaryPressed (not the Surface / OnWhite / Dark / Light shades), brand.primary, BRAND_COLOR, WX.deep.
const BRAND_BG = /(backgroundColor:[^,}\]\n]*|colors=\{\[[^\]]*\]|bg = [^;\n]*|tintColor=\{[^}]*\})/;
const IS_BRAND = /colors\.primary(?:Pressed)?(?![A-Za-z])|brand\.primary(?![A-Za-z])|BRAND_COLOR|WX\.deep(?![A-Za-z])/;
const WHITE_FG = /\b(color|activeFontStyle)\b[^\n]*?(fixed\.white|neutral\.white|colors\.textInverse|whiteAlpha\(|WX\.white|'#fff(?:fff)?')/i;
const whiteOnBrand = [];
const plainPrimaryText = [];
const oldShades = [];
for (const f of files) {
  const lines = stripComments(read(f)).split('\n');
  lines.forEach((line, i) => {
    // white text / icon with a brand-color background set just above it (same element or its parent)
    // (A line that already picks its color with textOnPrimary / onColor() is fine; the look-back stops where an element above closes.)
    if (WHITE_FG.test(line) && !/textOnPrimary|onColor\(|onDeep/.test(line)) {
      for (let j = i; j >= Math.max(0, i - 10); j--) {
        if (j < i && /<\/(View|Pressable|LinearGradient|TouchableOpacity)>/.test(lines[j])) break;
        const m = lines[j].match(BRAND_BG);
        if (m) { if (IS_BRAND.test(m[1])) whiteOnBrand.push(`${f}:${i + 1}`); break; }
      }
    }
    // the plain brand color as a text / icon color (use colors.primaryOnWhite)
    const fg = line.match(/(?<![A-Za-z])(color|iconColor|textColor|tabBarActiveTintColor|accentColor|placeholderTextColor|selectionColor)\s*[:=]\s*\{?([^,}\n]*)/g) || [];
    if (fg.some((x) => /colors\.primary(?![A-Za-z])|brand\.primary(?![A-Za-z])|WX\.deep(?![A-Za-z])/.test(x))) plainPrimaryText.push(`${f}:${i + 1}`);
    // pressed state / second gradient color must be the readable pressed shade
    if (/colors\.primary\s*,\s*colors\.primaryDark\]|pressed \? colors\.primaryDark : colors\.primary\b/.test(line)) oldShades.push(`${f}:${i + 1}`);
  });
}
check('4 no white text or icon is drawn straight on a brand-color background (use colors.textOnPrimary / onColor())', whiteOnBrand.length === 0, whiteOnBrand.join(', '));
check('5 the plain brand color is never a text / icon color (use colors.primaryOnWhite, readable on white for any brand color)', plainPrimaryText.length === 0, plainPrimaryText.slice(0, 20).join(', '));
check('6 pressed brand buttons and brand gradients use colors.primaryPressed (still readable with textOnPrimary), not primaryDark', oldShades.length === 0, oldShades.join(', '));
const button = read('src/components/ui/Button.tsx');
check('7 the shared Button: brand buttons take textOnPrimary; secondary / ghost buttons take primaryOnWhite', /bg = pressed \? colors\.primaryPressed : colors\.primary;\s*textColor = colors\.textOnPrimary;/.test(button) && (button.match(/textColor = colors\.primaryOnWhite;/g) || []).length === 2);
check('8 avatars and crew colors choose their text color from the background (onColor / readableOnLight)', /color: onColor\(bg\)/.test(read('src/components/ui/Avatar.tsx')) && /readableOnLight\(color\)/.test(read('src/components/ui/CrewLabel.tsx')));
check('9 the brand backdrop (no photo yet) gets a dark veil under white words when the brand color is light', /LIGHT_BRAND = brand\.onPrimary !== fixed\.white/.test(read('src/components/branding/BrandCover.tsx')) && /LIGHT_BRAND \? <View/.test(read('src/components/branding/BrandCover.tsx')));

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
