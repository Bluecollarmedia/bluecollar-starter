// Run: node scripts/checks/snowMoreScreen.check.cjs
// Snow Mode More screen: bundled header, every section/row kept, destinations and actions intact, no placeholder card.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const src = read('app/snow/owner/(tabs)/more.tsx');
const notify = read('src/components/snow/notifications/SnowNotifySettings.tsx');
const modeSrc = read('src/components/snow/ModeSwitchRow.tsx');
let bad = 0;
const check = (name, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const has = (s) => src.includes(s);

check('1 header is the bundled local image and the file exists', has("require('../../../../assets/images/snow-mode-more-header.png')") && fs.existsSync(path.join(__dirname, '../../assets/images/snow-mode-more-header.png')));
check('2 header keeps its aspect ratio (width / ratio height)', has('941 / 500') && has('width / HEADER_RATIO'));
check('3 old placeholder card is gone', !/SnowPlaceholder/.test(src) && !/being designed/i.test(src));
check('4 all section titles', ['Rules', 'Alerts', 'Records', 'Storms', 'You', 'Legal & Support', 'Account'].every((t) => has(`title="${t}"`)));
check('5 settings/records rows, titles and subtitles', [
  'Activity log', 'Everything that happened, by storm, route and person',
  'Snow hours', 'Who clocked in this week, and fix a missed clock-out', 'Photo review', 'See what customers were sent, and withdraw a photo if needed',
].every(has));
check('6 destinations unchanged', ['/snow/owner/activity', '/snow/owner/hours', '/snow/owner/review', '/snow/owner/message-customers', '/snow/owner/manage-storms', '/snow/owner/edit-profile'].every((r) => has(`router.push('${r}'`)) && !has('/snow/owner/settings'));
check('7 one Legal & Support row (opens the Snow Legal & Support page: Privacy Policy, Terms of Use, Help & Support)', has('title="Legal & Support"') && has('/snow/legal-support') && !has('/legal/privacy') && fs.existsSync(path.join(__dirname, '../../app/snow/legal-support/index.tsx')) && fs.existsSync(path.join(__dirname, '../../app/snow/legal-support/[slug].tsx')));
check('8 sign out (which warns first while a clock is running) and delete account kept', has('title="Sign Out"') && has('onPress={guardedSignOut}') && has('<DeleteAccountRow />'));
check('9 alerts use the existing toggle (persistence untouched) with its explanation', has('<OwnerStopAlertsToggle companyId={db.companyId} bare />') && has('<OwnerCustomerMessages />') && has('<StopRuleToggle companyId={db.companyId} />') && /Alert me when a stop is finished/.test(notify) && /Just for you\. Stops are still recorded on the dashboard and activity log when this is off\./.test(notify));
check('10 mode switch uses the existing logic', has('useModeSwitch()') && /export function useModeSwitch/.test(modeSrc) && /Switch to Landscaping Mode|Landscaping/.test(modeSrc));
check('11 bottom padding clears the tab bar', has('useTabBarClearance()') && has('paddingBottom: tabBarClearance'));
check('12 rows have accessibility labels', has('accessibilityRole="button"') && has('accessibilityLabel={subtitle'));
check('13 no new dependencies', !/expo-linear-gradient|expo-blur/.test(src));
const act = require('fs').readFileSync(require('path').join(__dirname, '../../app/(owner)/snow-activity.tsx'), 'utf8');
check('14 the Snow Activity filters start folded up: one period button and one Filters button, and each panel opens only when tapped',
  /setPanel\(panel === 'period' \? null : 'period'\)/.test(act) && /setPanel\(panel === 'filters' \? null : 'filters'\)/.test(act) && /\{panel === 'period' \? \(/.test(act) && /\{panel === 'filters' \? \(/.test(act));
// Nothing is duplicated across the owner's Snow screens: ONE Sign Out, ONE Privacy Policy row, ONE Delete Account.
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.tsx$/.test(e.name)) out.push(p); } return out; };
const ownerSnow = [...walk(path.join(__dirname, '../../app/snow/owner')), ...walk(path.join(__dirname, '../../src/components/snow'))].filter((f) => !/SnowWorkerSettings|SnowNotice/.test(f));
const total = (re) => ownerSnow.reduce((n, f) => n + (fs.readFileSync(f, 'utf8').match(re) || []).length, 0);
check('15 across the owner\'s Snow screens there is exactly one Sign Out, one Legal & Support row (no separate Privacy Policy row) and one Delete Account', total(/title="Sign Out"/g) === 1 && total(/title="Legal & Support"/g) === 1 && total(/title="Privacy Policy"/g) === 0 && total(/<DeleteAccountRow \/>/g) === 1 && total(/<LegalSection/g) === 0, `${total(/title="Sign Out"/g)}/${total(/title="Legal & Support"/g)}/${total(/<DeleteAccountRow \/>/g)}`);
check('16 there is no second Settings screen and nothing still sends people to one', !fs.existsSync(path.join(__dirname, '../../app/snow/owner/settings.tsx')) && total(/snow\/owner\/settings/g) === 0);
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
