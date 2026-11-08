// Run: node scripts/checks/promisedLeftovers.check.cjs
// The six things promised earlier: Reactivate on a deactivated worker, the "storm ended" note, day strips on Maintenance routes and Snow
// storms, the crew section first on the route builder, drafts kept in the other sheets, and "clock back in" when work is added after clock-out.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const worker = read('app/(owner)/(tabs)/workers/[id].tsx');
check('1 a deactivated worker\'s profile has Reactivate (the database function that never restores admin rights)', /Reactivate Worker/.test(worker) && /team\.reactivate\(p\.id, true,/.test(worker));
check('2 the Snow dashboard no longer lists ended storms (they live on the Storms tab)', !fs.existsSync(path.join(__dirname, '../../src/components/snow/dashboard/EndedStormNote.tsx')) && !/EndedStormNote/.test(read('src/components/snow/dashboard/SnowDashboardScreen.tsx')));
const strip = read('src/components/ui/DateStrip.tsx');
check('3 one day strip: tap a day to pick it, tap again or All to clear', /onSelect\(selected === d \? null : d\)/.test(strip) && /accessibilityState=\{\{ selected: on \}\}/.test(strip));
check('4 Maintenance routes filter by the picked day', /<DateStrip dates=\{days\} selected=\{day\} onSelect=\{setDay\} \/>/.test(read('app/(owner)/(tabs)/maintenance/routes/index.tsx')) && /r\.serviceDate === day/.test(read('app/(owner)/(tabs)/maintenance/routes/index.tsx')));
check('5 Snow storms filter by the picked day', /<DateStrip dates=\{days\}/.test(read('src/components/snow/storms/StormsListScreen.tsx')) && /dayOf\(st\) === day/.test(read('src/components/snow/storms/StormsListScreen.tsx')));
const rb = read('app/(owner)/route-new.tsx');
check('6 the route builder asks for the crew first (before the date and properties)', rb.indexOf('Workers first: who works the route') > 0 && rb.indexOf('Workers first: who works the route') < rb.indexOf('{/* 1. Date */}'));
const sheets = ['src/components/time/SkipRequestSheet.tsx', 'src/components/trucks/TruckDocumentSheet.tsx', 'src/components/trucks/TruckMaintenanceSheet.tsx', 'src/components/maintenance/TimeCorrectionSheet.tsx'];
check('7 the skip request, truck document, truck maintenance and time correction sheets keep their draft', sheets.every((f) => /useKeepDraft\(visible,/.test(read(f)) && /mark(Sent|Saved)\(\)/.test(read(f))));
const wc = read('src/components/time/WorkdayCard.tsx');
check('8 clocked out but work was added (a job or open route stops): a big "Clock back in" button, not just a small link', /const moreWork = todayAssignments\.some/.test(wc) && /You have more work today\. Clock back in/.test(wc) && /Clocked out by mistake\? Clock back in/.test(wc));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
