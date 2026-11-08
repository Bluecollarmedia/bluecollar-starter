// Run: node scripts/checks/inviteLinksOpenApp.check.cjs
// A private invite link opens the app when it is installed (iPhone "universal links"): the app claims the website addresses, and the website
// serves Apple's link file for those addresses, naming this app by Apple Team ID + bundle id.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const app = JSON.parse(read('app.json')).expo;
let aasa = null;
try { aasa = JSON.parse(read('public/.well-known/apple-app-site-association')); } catch (e) { /* reported below */ }
const detail = aasa && aasa.applinks && aasa.applinks.details && aasa.applinks.details[0];
const web = (require(path.join(root, 'eas.json')).build['live-test'].env || {}).EXPO_PUBLIC_WEB_URL || 'https://app.brightonlawn.com'; // live values now come from the EAS environment

check('1 the link file exists and is valid JSON', !!aasa);
check('2 it names THIS app: the Apple Team ID plus the app\'s bundle id', !!detail && detail.appIDs.includes(`93LDR9MQMF.${app.ios.bundleIdentifier}`), JSON.stringify(detail && detail.appIDs));
check('3 it covers invite links only (/invite/...), so no other page is taken from the browser', !!detail && detail.components.length === 1 && detail.components[0]['/'] === '/invite/*');
const host = new URL(web).host;
check('4 the app claims the address the app builds invite links from (' + host + ')', (app.ios.associatedDomains || []).includes(`applinks:${host}`));
check('5 and the production address too', (app.ios.associatedDomains || []).includes('applinks:app.brightonlawn.com'));
const headers = read('public/_headers');
check('6 the website serves the file as JSON (Apple requires it, with no redirect)', /\/\.well-known\/apple-app-site-association\s*\n\s*Content-Type: application\/json/.test(headers));
check('7 the website\'s catch-all rewrite cannot swallow it (it is a real file, and the rewrite is not forced)', /^\/\*\s+\/index\.html\s+200\s*$/m.test(read('public/_redirects')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
