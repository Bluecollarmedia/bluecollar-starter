// Run: node scripts/checks/ownerLayoutFixes.check.cjs
// Owner screens: Create Quote/Invoice pinned above the tab bar, Snow Team clears the tab bar, Dashboard returns to the top, Trucks has no bounce.
const fs = require('fs'); const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0; const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
const fin = read('app/(owner)/(tabs)/more/financials.tsx'), hook = read('src/hooks/useFixedBottomOffset.ts');
check('1 the shared bottom-offset hook still measures from the window bottom (used by the screens that keep a floating button)', /measureInWindow/.test(hook) && /windowHeight - \(y \+ h\)/.test(hook));
check('2 Quotes & Invoices no longer floats buttons over the tab bar (a + in the header replaces them), so its list needs no extra bottom room', !/useFixedBottomOffset/.test(fin) && !/bottom: fab\.bottom/.test(fin) && /paddingBottom: clearance \+ spacing\['3xl'\] \}\}/.test(fin));
const st = read('app/(owner)/(tabs)/more/snow-team.tsx');
check('3 Snow Team always clears the tab bar (Show past requests reachable)', /contentContainerStyle=\{\[styles\.content, \{ paddingBottom: tabBarClearance \+ spacing\.lg \}\]\}/.test(st) && !/asTab && \{ paddingBottom/.test(st));
const dash = read('app/(owner)/(tabs)/index.tsx');
check('4 Dashboard scrolls to the top whenever it is focused and when its tab is tapped again', /useFocusEffect\(toTop\)/.test(dash) && /addListener\('tabPress'/.test(dash) && /<ScrollView( bounces=\{false\})? ref=\{scrollRef\}/.test(dash));
const tr = read('app/(owner)/(tabs)/more/trucks/index.tsx');
check('5 Trucks has no entrance bounce', !/FadeInItem/.test(tr));
const aw = read('app/(owner)/worker-new.tsx');
check('6 the Add Worker link card appears with no bounce', !/ZoomIn/.test(aw) && !/entering=/.test(aw));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
