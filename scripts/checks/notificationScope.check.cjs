// Run: node scripts/checks/notificationScope.check.cjs
// Snow alerts (plowing done, storm dispatched, crew and customer snow updates) never appear in the landscaping notification center,
// its bell number, or a customer's banner; clearing / marking read on the landscaping side leaves Snow alerts alone.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('node:url');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'lib', 'notificationScope.ts')).href);
  const snowDone = { eventType: 'snow_stop_completed', linkedEntityType: 'snow_visit', title: 'Oak Plaza: plowing done' };
  const snowDispatch = { eventType: 'snow_storm_dispatched', linkedEntityType: 'snow_route' };
  const snowCustomer = { eventType: 'snow_service_completed', linkedEntityType: 'snow_property' };
  const byMeta = { eventType: 'something_else', metadata: { snow_notification_id: 'x' } };
  const land = [{ eventType: 'announcement_posted' }, { eventType: 'invoice_sent', linkedEntityType: 'invoice' }, { eventType: 'time_skip_requested', linkedEntityType: 'time_skip' }];

  check('1 every Snow alert is recognised (by event, by linked thing, or by its Snow record)', [snowDone, snowDispatch, snowCustomer, byMeta].every(m.isSnowNotification));
  check('2 landscaping alerts are never mistaken for Snow ones', land.every((n) => !m.isSnowNotification(n)) && !m.isSnowNotification(null) && !m.isSnowNotification({}));
  const mixed = [...land, snowDone, snowDispatch, snowCustomer, byMeta];
  check('3 the landscaping list keeps only landscaping alerts, in order', JSON.stringify(m.landscapingNotifications(mixed)) === JSON.stringify(land));

  const ops = read('src/hooks/useOperations.ts');
  const hook = ops.slice(ops.indexOf('export function useNotifications'), ops.indexOf('const getCompanyDefault'));
  check('4 the notification hook (center, bell number, banner) reads only the landscaping list', /landscapingNotifications\(db\.notifications\)/.test(hook) && !/useMemo<AppNotification\[\]>\(\(\) => db\.notifications/.test(hook));
  check('5 mark-all-read and clear-all touch only landscaping alerts (Snow ones are left alone)', (hook.match(/landscapingNotifications\(db\.notifications\)/g) || []).length === 3 && !/for \(const n of \[?\.{0,3}db\.notifications/.test(hook));
  check('6 the bell number and the customer banner both go through that hook', /useNotifications/.test(read('src/components/ui/UnreadBadge.tsx')) && /useNotifications/.test(read('src/components/customer/AnnouncementBanner.tsx')) && /useNotifications/.test(read('app/(owner)/notification-center.tsx')));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
