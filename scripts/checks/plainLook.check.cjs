// Run: node scripts/checks/plainLook.check.cjs
// THE PLAIN LOOK (Step 4): every color the app shows comes from the theme (src/theme) and the ONE brand color in the settings file
// (src/config/brand.js, look.brandColor). This check fails when:
//  - a color code is typed straight into a screen or component (a "#1B3A2D" or "rgba(76, 175, 80, 0.18)" anywhere in app/ or src/
//    outside src/theme and src/config). Use a theme token instead: colors.* from useTheme(), or fixed / tones / swatches /
//    whiteAlpha / blackAlpha / documentColors / mapColors from '@/theme/colors', or the weather palette in '@/theme/weather'.
//  - the theme's main color (primary) no longer comes from look.brandColor,
//  - the green / red / amber status colors are too faint to read as text (contrast under 4.5 : 1 on white and on the gray cards),
//  - the picture files the settings file names are missing.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const { brand, expoConfig } = require('./_brand.cjs');

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// Files that may keep a typed-in color, and why. Keep this list short: almost everything belongs in src/theme.
const ALLOWED = {
  // The home-screen widget runs in its own tiny runtime and cannot import anything; its colors arrive as props from
  // src/lib/widgetData.ts (which reads src/theme/weather.ts), so this file needs no codes of its own. Listed only as a reminder.
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(tsx?|jsx?|cjs|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}
// Comments are blanked out (line breaks kept, so line numbers stay right): a color named in a comment is fine.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const FUNC = /\b(?:rgba?|hsla?)\(\s*\.?\d[^)]*\)?/g;
const NAMED = /\b(?:color|Color|backgroundColor|borderColor|tintColor|shadowColor|fill|stroke)\s*[:=]\s*\{?\s*['"](?:red|green|blue|orange|yellow|purple|pink|teal|lime|navy|maroon|olive|gold|darkgreen|forestgreen|limegreen|seagreen)['"]/g;

const files = [...walk('app'), ...walk('src')].filter((f) => !/^src\/(theme|config)\//.test(f));
const found = [];
for (const f of files) {
  if (ALLOWED[f]) continue;
  const lines = stripComments(read(f)).split('\n');
  lines.forEach((line, i) => {
    const hits = [...(line.match(HEX) || []), ...(line.match(FUNC) || []), ...(line.match(NAMED) || [])];
    if (hits.length) found.push(`${f}:${i + 1}  ${hits.join(' ')}`);
  });
}
check('1 no color codes typed into app/ or src/ outside src/theme and src/config (use the theme tokens)', found.length === 0, `${found.length} found:\n      ${found.slice(0, process.env.ALL ? 9999 : 40).join('\n      ')}`);

// 2. The brand color drives the theme.
const colors = read('src/theme/colors.ts');
check('2 the theme reads the brand color from the settings file (look.brandColor)', /BRAND_COLOR = [^;]*brandSettings\.look\.brandColor/.test(colors));
check('3 primary = the brand color, in the brand palette and the light theme', /primary: BRAND_COLOR,/.test(colors) && /lightTheme = \{[\s\S]*?\n  primary: brand\.primary,/.test(colors));
check('4 the brand color in the settings is a 6-digit color code', /^#[0-9a-f]{6}$/i.test(brand.look.brandColor), brand.look.brandColor);

// 3. The plain palette: white page, light gray cards, near-black text.
const light = /lightTheme = \{([\s\S]*?)\n\} as const;/.exec(colors)?.[1] ?? '';
const tok = (name, block = light) => new RegExp(`\\n\\s*${name}: '(#[0-9A-Fa-f]{6})'`).exec(block)?.[1];
check('5 page white, cards light gray, text near-black', tok('background') === '#FFFFFF' && /^#F[0-9A-F]F[0-9A-F]F[0-9A-F]$/i.test(tok('surface') || '') && tok('surface') !== '#FFFFFF' && /^#1[0-9A-F]1[0-9A-F]1[0-9A-F]$/i.test(tok('textPrimary') || ''), `${tok('background')} ${tok('surface')} ${tok('textPrimary')}`);

// 4. Status colors are readable.
const toRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (h) => toRgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const semantic = /export const semantic = \{([\s\S]*?)\n\} as const;/.exec(colors)?.[1] ?? '';
for (const name of ['success', 'warning', 'error']) {
  const fg = tok(name, semantic);
  const bg = tok(`${name}Light`, semantic);
  const ok = !!fg && contrast(fg, '#FFFFFF') >= 4.5 && contrast(fg, tok('surface')) >= 4.5 && !!bg && contrast(fg, bg) >= 4.5;
  check(`6 ${name} color reads as text on white, on the cards and on its own light pill (4.5 : 1)`, ok, `${fg} on white ${fg && contrast(fg, '#FFFFFF').toFixed(2)}`);
}
check('7 secondary text reads on white and on the cards (4.5 : 1)', contrast(tok('textSecondary'), '#FFFFFF') >= 4.5 && contrast(tok('textSecondary'), tok('surface')) >= 4.5);

// 5. Pictures named in the settings file exist; the old leaf picture is gone.
const look = brand.look;
const pics = [look.logo, look.icon, look.androidIconForeground, look.splashImage].map((p) => p.replace('./', ''));
check('8 the logo, icon and splash pictures named in src/config/brand.js exist', pics.every((p) => fs.existsSync(path.join(root, p))), pics.filter((p) => !fs.existsSync(path.join(root, p))).join(', '));
check('9 the old leaf picture is not used any more (assets/images/logo-mark.png is the plain mark)', !fs.existsSync(path.join(root, 'assets/images/logo-leaf.png')) && fs.existsSync(path.join(root, 'assets/images/logo-mark.png')) && !files.some((f) => /logo-leaf/.test(read(f))));
const app = expoConfig();
const notif = (app.plugins || []).find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
check('10 the Android notification color is the brand color', !!notif && notif[1].color === look.brandColor);
check('11 the PDF logo (src/lib/brandLogo.ts) is the same picture as the logo file', (() => {
  const b64 = /base64,([A-Za-z0-9+/=]{200,})'/.exec(read('src/lib/brandLogo.ts'))?.[1];
  return !!b64 && b64 === fs.readFileSync(path.join(root, look.logo.replace('./', ''))).toString('base64');
})(), 'run: node scripts/make-placeholder-art.cjs (or rebuild brandLogo.ts from your logo)');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
