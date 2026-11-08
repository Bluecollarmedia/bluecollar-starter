// Run: node scripts/build-legal-pages.cjs <path to typescript package>
// Makes the public web pages public/legal/privacy.html, terms.html and support.html from src/legal/legalContent.ts, and Apple's
// link file public/.well-known/apple-app-site-association from src/config/brand.js (app.appleTeamId + app.bundleId).
// They are copied into the web build, so they open at https://<your site>/legal/privacy.html etc.: those are the
// addresses to give App Store Connect (Privacy Policy URL, Support URL). Re-run after changing the text.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/legal/legalContent.ts'), 'utf8');
// The legal text reads the settings file (src/config/brand.js) through src/config/brand.ts.
const { brand, brandModule } = require('./checks/_brand.cjs');
const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, (n) => (n === '@/config/brand' ? brandModule(ts) : require(n)));
const { BUSINESS, LEGAL_DOCS } = m.exports;
const LINK_COLOR = /^#[0-9a-f]{6}$/i.test(brand.look.brandColor) ? brand.look.brandColor : '#2B2B2B';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '<a href="mailto:$1">$1</a>');

function render(doc) {
  const nav = Object.values(LEGAL_DOCS).map((d) => `<a href="/legal/${d.slug}.html">${esc(d.title)}</a>`).join(' &middot; ');
  const body = doc.sections.map((s) => [
    `<h2>${esc(s.heading)}</h2>`,
    ...(s.paragraphs ?? []).map((p) => `<p>${linkify(p)}</p>`),
    s.bullets ? `<ul>${s.bullets.map((b) => `<li>${linkify(b)}</li>`).join('')}</ul>` : '',
  ].join('\n')).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)} - ${esc(BUSINESS.appName)}</title>
<style>
  body { margin: 0; background: #ffffff; color: #1c1c1e; font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 20px 64px; }
  h1 { font-size: 30px; margin: 8px 0 8px; }
  h2 { font-size: 19px; margin: 28px 0 6px; }
  p, li { color: #3a3a3c; }
  ul { padding-left: 22px; }
  a { color: ${LINK_COLOR}; }
  nav { font-size: 14px; color: #6b6b70; margin-bottom: 8px; }
  footer { margin-top: 40px; font-size: 14px; color: #6b6b70; }
</style>
</head>
<body>
<main>
<nav>${esc(BUSINESS.appName)} &middot; ${nav}</nav>
<h1>${esc(doc.title)}</h1>
<p>${linkify(doc.intro)}</p>
${body}
<footer>${esc(BUSINESS.name)} &middot; ${esc(BUSINESS.addressLines.join(', '))} &middot; ${linkify(BUSINESS.email)} &middot; ${esc(BUSINESS.phone)}</footer>
</main>
</body>
</html>
`;
}

const out = {};
for (const doc of Object.values(LEGAL_DOCS)) out[`public/legal/${doc.slug}.html`] = render(doc);

// Apple's link file (lets invite links open the installed app): the Apple Team ID and bundle id from the settings file.
// Until app.appleTeamId is filled in (it still starts with "YOUR-") a plain placeholder team id is written.
const teamId = /^YOUR-/.test(brand.app.appleTeamId) || !brand.app.appleTeamId ? 'YOURTEAMID' : brand.app.appleTeamId;
out['public/.well-known/apple-app-site-association'] = `${JSON.stringify({
  applinks: {
    details: [
      {
        appIDs: [`${teamId}.${brand.app.bundleId}`],
        components: [{ '/': '/invite/*', comment: 'Private invite links open the app when it is installed' }],
      },
    ],
  },
}, null, 2)}
`;

if (process.argv.includes('--check')) {
  let stale = [];
  for (const [file, html] of Object.entries(out)) {
    const p = path.join(root, file);
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') !== html) stale.push(file);
  }
  if (stale.length) { console.log('STALE: ' + stale.join(', ')); process.exit(1); }
  console.log('web pages are up to date');
} else {
  fs.mkdirSync(path.join(root, 'public/legal'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public/.well-known'), { recursive: true });
  for (const [file, html] of Object.entries(out)) fs.writeFileSync(path.join(root, file), html);
  console.log('wrote ' + Object.keys(out).join(', '));
}
