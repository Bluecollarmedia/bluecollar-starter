// Truck maintenance log rules: what can be saved, how a due date reads, and which records get a morning reminder. No phone, no network.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'lib', 'truckMaintenance.ts')).href);

  check('1 a record needs a title and a date serviced', m.maintenanceProblem({ title: '', servicedOn: '2026-10-01' }) !== '' && m.maintenanceProblem({ title: 'Oil change', servicedOn: '' }) !== '' && m.maintenanceProblem({ title: 'Oil change', servicedOn: '2026-10-01' }) === '');
  check('2 the next-due date is optional, must be a real date, and cannot be before the service date', m.maintenanceProblem({ title: 'x', servicedOn: '2026-10-01', dueOn: '2027-04-01' }) === '' && m.maintenanceProblem({ title: 'x', servicedOn: '2026-10-01', dueOn: '2026-09-30' }) !== '' && m.maintenanceProblem({ title: 'x', servicedOn: '2026-10-01', dueOn: '2026-13-45' }) !== '');
  check('3 titles and notes have sensible length limits', m.maintenanceProblem({ title: 'x'.repeat(121), servicedOn: '2026-10-01' }) !== '' && m.maintenanceProblem({ title: 'x', servicedOn: '2026-10-01', notes: 'n'.repeat(2001) }) !== '');

  const today = '2026-10-20';
  check('4 a due date reads: overdue / due today / due soon (within 14 days) / later / none',
    m.dueInfo('2026-10-19', today).state === 'overdue' && m.dueInfo('2026-10-20', today).state === 'today' && m.dueInfo('2026-11-03', today).state === 'soon' && m.dueInfo('2026-11-04', today).state === 'ok' && m.dueInfo(undefined, today).state === 'none');
  check('4b the labels say it plainly', /Overdue since/.test(m.dueInfo('2026-10-01', today).label) && m.dueInfo('2026-10-20', today).label === 'Due today' && /Due in 3 days/.test(m.dueInfo('2026-10-23', today).label));

  const at = m.reminderTime('2026-12-05');
  check('5 the reminder fires at 8:00 AM on the due date (phone time)', at.getFullYear() === 2026 && at.getMonth() === 11 && at.getDate() === 5 && at.getHours() === 8 && at.getMinutes() === 0);

  const recs = [
    { id: 'a', truckId: 't1', truckName: 'Truck 1', title: 'Oil', dueOn: '2026-12-05' },
    { id: 'b', truckId: 't1', truckName: 'Truck 1', title: 'Tires', dueOn: '2026-10-25' },
    { id: 'c', truckId: 't2', truckName: 'Truck 2', title: 'Past due', dueOn: '2026-09-01' },
    { id: 'd', truckId: 't2', truckName: 'Truck 2', title: 'No date', dueOn: undefined },
    { id: 'e', truckId: 't2', truckName: 'Truck 2', title: 'Today but after 8', dueOn: '2026-10-20' },
  ];
  const now = new Date(2026, 9, 20, 9, 30);   // Oct 20, 9:30 AM
  const out = m.remindersToSchedule(recs, now);
  check('6 only records with a due date whose reminder time is still ahead are scheduled, soonest first (past, undated, and already-passed-today are skipped)', out.map((r) => r.id).join(',') === 'b,a', out.map((r) => r.id).join(','));
  check('6b at most the limit are scheduled (the rest are scheduled the next time the app opens)', m.remindersToSchedule(Array.from({ length: 60 }, (_, i) => ({ id: String(i), truckId: 't', truckName: 'T', title: 'x', dueOn: `2027-01-${String((i % 28) + 1).padStart(2, '0')}` })), now, 40).length === 40);

  const rem = read('src/lib/truckReminders.ts'), hook = read('src/hooks/useTruckReminders.ts'), lay = read('app/(owner)/_layout.tsx'), auth = read('src/providers/AuthProvider.tsx'), tgt = read('src/lib/notificationTarget.ts');
  check('7 the phone keeps its reminders in step with the saved records: it cancels its earlier truck reminders, then schedules the current ones', /cancelScheduledNotificationAsync/.test(rem) && /remindersToSchedule\(records/.test(rem));
  check('8 reminders are set up for the owner only, started once for the owner screens, and cleared when someone signs out', /db\.role !== 'owner'/.test(hook) && /useTruckReminders\(true\)/.test(lay) && /syncTruckReminders\(\[\]\)/.test(auth));
  check('9 tapping a reminder opens that truck', /type === 'truck'\) return `\/\(owner\)\/more\/trucks\/\$\{id\}`/.test(tgt));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
