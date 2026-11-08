// Owner Dashboard: maintenance routes count toward workers scheduled / on site / upcoming / properties, without double counting.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

(async () => {
  const { maintenanceToday } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'data', 'maintenanceToday.ts')).href);
  const T = '2026-10-20';
  const stop = (propertyId, status) => ({ propertyId, status });
  const route = (id, crewIds, leadId, stops, o = {}) => ({ id, serviceDate: T, status: 'planned', crewIds, lead: leadId ? { id: leadId } : undefined, stops, ...o });

  let m = maintenanceToday([route('r1', ['a', 'b'], 'a', [stop('p1', 'pending'), stop('p2', 'pending')])], T);
  check('1 a route today with a crew puts the crew and leader on the scheduled list once each', m.scheduled.size === 2 && m.onSite.size === 0 && m.propertyIds.size === 2 && m.routeCount === 1);

  m = maintenanceToday([route('r1', ['a', 'b'], 'a', [stop('p1', 'arrived'), stop('p2', 'pending')])], T);
  check('2 a stop the crew has checked in at puts the whole crew on site', m.onSite.size === 2 && m.scheduled.size === 2);

  m = maintenanceToday([route('r1', ['a', 'b'], 'a', [stop('p1', 'completed'), stop('p2', 'pending')])], T);
  check('3 between stops (one finished, next pending) nobody is on site and nobody is finished', m.onSite.size === 0 && m.finished.size === 0);

  m = maintenanceToday([route('r1', ['a', 'b'], 'a', [stop('p1', 'completed'), stop('p2', 'skipped')])], T);
  check('4 a route with nothing left marks its people finished and does not count the skipped property', m.finished.size === 2 && m.propertyIds.size === 1);

  m = maintenanceToday([route('r1', ['a'], 'a', [stop('p1', 'pending')]), route('r2', ['a', 'c'], 'c', [stop('p1', 'pending'), stop('p3', 'pending')])], T);
  check('5 a person on two routes and a property on two routes are each counted once', m.scheduled.size === 2 && m.propertyIds.size === 2);

  m = maintenanceToday([route('r1', ['a'], 'a', [stop('p1', 'arrived')], { status: 'cancelled' }), route('r2', ['b'], 'b', [stop('p2', 'pending')], { serviceDate: '2026-10-21' })], T);
  check('6 cancelled routes and other days count for nothing', m.scheduled.size === 0 && m.routeCount === 0);

  m = maintenanceToday([route('r1', [], 'x', [stop('p1', 'pending')])], T);
  check('7 a leader who is not in the crew list is still scheduled', m.scheduled.has('x'));

  m = maintenanceToday([route('r1', ['a', 'b'], 'a', [{ propertyId: 'p1', status: 'arrived', arrivedAt: '2026-10-20T13:12:00Z', property: { name: 'Chase Bank' } }, stop('p2', 'pending')], { name: 'Route A' })], T);
  check('9 Crew Today: each maintenance person shows their route, and the property they are at once checked in', m.where.get('a').routeName === 'Route A' && m.where.get('b').atProperty === 'Chase Bank' && !!m.where.get('b').arrivedAt);

  const hook = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'hooks', 'useOwnerDashboard.ts'), 'utf8');
  check('8 the dashboard merges the maintenance sets with the landscaping sets (union, so a person on a job and a route is one)',
    /new Set\(\[\.\.\.jobWorkerIds, \.\.\.maint\.scheduled\]\)/.test(hook) && /new Set\(\[\.\.\.onSiteWorkerIds, \.\.\.maint\.onSite\]\)/.test(hook) && /onSite: allOnSiteIds\.size/.test(hook));

  check('10 Crew Today adds maintenance-only people once and never a second row for someone already on a job', /if \(byWorker\.has\(personId\)\) continue;/.test(hook) && /Maintenance crew who are not on a landscaping job today/.test(hook));
  const home = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(owner)', '(tabs)', 'maintenance', 'index.tsx'), 'utf8');
  check('11 the owner route card counts "clocked in" from the time clock (same source as the dashboard) and says "started the day" only for the older fallback', /clocked in`/.test(home) && /started the day/.test(home) && /useClockedInToday/.test(home));

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
