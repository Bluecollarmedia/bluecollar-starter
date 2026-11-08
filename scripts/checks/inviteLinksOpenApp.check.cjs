// Run: node scripts/checks/inviteLinksOpenApp.check.cjs
// A private invite link opens the app when it is installed (iPhone "universal links"): the app claims the website addresses, and the website
// serves Apple's link file for those addresses, naming this app by Apple Team ID + bundle id.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

// The final Expo config: app.json put through app.config.js (which fills in the settings file's values).
const app = require('./_brand.cjs').expoConfig();
let aasa = null;
try { aasa = JSON.parse(read('public/.well-known/apple-app-site-association')); } catch (e) { /* reported below */ }
const detail = aasa && aasa.applinks && aasa.applinks.details && aasa.applinks.details[0];
// The web address the invite links use: the EAS value if one is written in eas.json, else the domain the app claims (from app.webUrl in src/config/brand.js).
const claimed = (app.ios.associatedDomains || []).map((d) => d.replace(/^applinks:/, ''));
const web = (require(path.join(root, 'eas.json')).build['live-test'].env || {}).EXPO_PUBLIC_WEB_URL || (claimed[0] ? `https://${claimed[0]}` : '');
// The Apple Team ID is a placeholder ("YOURTEAMID") until a client fills in theirs; the bundle id must be this app's.
const appId = detail && detail.appIDs && detail.appIDs[0];

check('1 the link file exists and is valid JSON', !!aasa);
check('2 it names THIS app: an Apple Team ID plus the app\'s bundle id', !!appId && /^[A-Z0-9]+\./.test(appId) && appId.slice(appId.indexOf('.') + 1) === app.ios.bundleIdentifier, JSON.stringify(detail && detail.appIDs));
check('3 it covers invite links only (/invite/...), so no other page is taken from the browser', !!detail && detail.components.length === 1 && detail.components[0]['/'] === '/invite/*');
const host = web ? new URL(web).host : '(none)';
check('4 the app claims the address the app builds invite links from (' + host + ')', (app.ios.associatedDomains || []).includes(`applinks:${host}`));
check('5 the app claims at least one web address, and only addresses written as applinks:<host>', claimed.length > 0 && (app.ios.associatedDomains || []).every((d) => /^applinks:[a-z0-9.-]+$/i.test(d)), JSON.stringify(app.ios.associatedDomains));
const headers = read('public/_headers');
check('6 the website serves the file as JSON (Apple requires it, with no redirect)', /\/\.well-known\/apple-app-site-association\s*\n\s*Content-Type: application\/json/.test(headers));
check('7 the website\'s catch-all rewrite cannot swallow it (it is a real file, and the rewrite is not forced)', /^\/\*\s+\/index\.html\s+200\s*$/m.test(read('public/_redirects')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
