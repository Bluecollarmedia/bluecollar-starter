// Run: node scripts/checks/customerSnow.check.cjs
// The customer's Snow screens: the timeline grouping, "this season" numbers, "right now" wording, and that the screens are wired the way
// the owner asked (Snow separate from projects, strip only during a storm, swipe between properties, notification switches in Account).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('node:url');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'lib', 'customerSnow.ts')).href);
  // Local noon times so the day never shifts with the time zone.
  const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).toISOString();
  const now = new Date(2026, 9, 22, 9, 0); // Oct 22, 2026
  const E = (id, svc, iso, extra = {}) => ({ visitId: id, propertyId: 'p1', propertyName: "David's Home", service: svc, completedAt: iso, media: [], ...extra });
  const entries = [
    E('a', 'plowing', at(2026, 10, 21, 5, 40), { stormName: 'Oct 21 Plowing', media: [{ id: 'm1', kind: 'photo', url: 'u1' }, { id: 'm2', kind: 'photo', url: 'u2' }] }),
    E('b', 'salting', at(2026, 10, 21, 6, 10), { stormName: 'Oct 21 Plowing', media: [{ id: 'm3', kind: 'photo', url: 'u3' }, { id: 'm4', kind: 'video', url: 'u4' }] }),
    E('c', 'plowing', at(2026, 10, 22, 4, 30), { stormName: 'Oct 22 Plowing' }),
    E('d', 'plowing', at(2025, 1, 5, 7, 0), { stormName: 'Last winter' }),
  ];

  const groups = m.groupTimeline(entries, now);
  check('1 the timeline is grouped by day, newest day first', groups.map((g) => g.key).join() === '2026-10-22,2026-10-21,2025-01-05', groups.map((g) => g.key).join());
  check('2 day labels: Today, Yesterday, then the weekday and date (year only when not this year)', groups[0].label === 'Today' && groups[1].label === 'Yesterday' && /Jan 5, 2025/.test(groups[2].label) && /Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday/.test(groups[2].label), JSON.stringify(groups.map((g) => g.label)));
  check('3 plowing and salting (different crews) are SEPARATE entries on the same day, newest first', groups[1].entries.map((e) => e.service).join() === 'salting,plowing');
  check('4 the storm name rides with the day', groups[1].stormNames.join() === 'Oct 21 Plowing' && groups[0].stormNames.join() === 'Oct 22 Plowing');

  check('5 the season starts October 1 (before October it is last year\'s)', m.seasonStart(now).getMonth() === 9 && m.seasonStart(now).getFullYear() === 2026 && m.seasonStart(new Date(2026, 2, 1)).getFullYear() === 2025);
  const stats = m.seasonStats(entries, now);
  check('6 this season counts real services, the last one, and photos (not last winter\'s, not videos)', stats.services === 3 && stats.photos === 3 && stats.lastServiceAt === at(2026, 10, 22, 4, 30), JSON.stringify(stats));
  check('7 no entries gives zero, not made-up numbers', m.seasonStats([], now).services === 0 && m.seasonStats([], now).photos === 0 && m.seasonStats([], now).lastServiceAt === undefined);

  const onSite = m.statusView({ propertyId: 'p1', state: 'on_site', since: at(2026, 10, 22, 4, 12) }, '205 Cathy Ln, Lakewood');
  check('8 "Right now" on site: "Crew on site since 4:12 AM" with the address', onSite.tone === 'active' && onSite.headline === 'Crew on site since 4:12 AM' && onSite.detail === '205 Cathy Ln, Lakewood', JSON.stringify(onSite));
  const sched = m.statusView({ propertyId: 'p1', state: 'scheduled', stormName: 'Oct 22 Plowing' });
  check('9 "Right now" scheduled: a storm is being handled, crew assigned, with the storm name', sched.tone === 'scheduled' && /storm is being handled/.test(sched.headline) && /Oct 22 Plowing/.test(sched.detail), JSON.stringify(sched));
  check('10 no storm, no status: nothing is shown (no "all clear" strip)', m.statusView(undefined) === null && m.homeStrip([], [{ id: 'p1', address: 'x' }]) === null);
  const strip = m.homeStrip([{ propertyId: 'p2', state: 'scheduled' }, { propertyId: 'p1', state: 'on_site', since: at(2026, 10, 22, 4, 12) }], [{ id: 'p1', address: '205 Cathy Ln' }, { id: 'p2', address: '9 Oak' }]);
  check('11 the Home strip prefers a property with the crew on site', strip && strip.propertyId === 'p1' && strip.tone === 'active' && /4:12 AM/.test(strip.headline), JSON.stringify(strip));

  check('12 service words: Plowed / Shoveled / Salted and chips in a steady order', m.SERVICE_VERB.plowing === 'Plowed' && m.SERVICE_VERB.shoveling === 'Shoveled' && m.SERVICE_VERB.salting === 'Salted' && m.sortServices(['salting', 'plowing', 'plowing']).join() === 'plowing,salting');
  check('13 older days are folded behind "Show earlier" after 5 days', m.daysToShow(Array.from({ length: 8 }, (_, i) => ({ key: String(i) })), false).length === 5 && m.daysToShow(Array.from({ length: 8 }, (_, i) => ({ key: String(i) })), true).length === 8);
  check('14 page numbers stay inside the list', m.clampPage(-1, 3) === 0 && m.clampPage(9, 3) === 2 && m.clampPage(1.4, 3) === 1);

  // Wiring
  const home = read('app/(customer)/(tabs)/index.tsx');
  const ph = read('src/components/customerHome/PropertyHome.tsx');
  check('15 Home: Snow is its own tab, separate from Project and Lawn; the live "Right now" card only exists while a storm involves the property', /<SnowPane/.test(ph) && /<ProjectPane/.test(ph) && /<LawnPane/.test(ph) && /\{sv \? \(/.test(ph) && !/All clear/.test(ph));
  check('16 Home: a property with only one kind of service gets no switch', /group\.services\.length > 1/.test(ph));
  check('17 Home: "See all visits" opens the history for Snow', /history\?service=snow/.test(ph));
  const screen = read('src/components/snow/customer/CustomerSnowScreen.tsx');
  check('18 the Snow screen swipes between properties (one page each, with dots) and has no tab switcher', /pagingEnabled/.test(screen) && /properties\.map\(\(p\) => \(\s*<View key=\{p\.id\} style=\{\{ width \}\}>/.test(screen) && /styles\.dots/.test(screen) && !/Maple/.test(screen));
  check('19 the Snow screen has the Right now card, This season tiles, Included services, the Timeline, and the friendly empty state', /RIGHT NOW/.test(screen) && /THIS SEASON/.test(screen) && /INCLUDED AT YOUR PROPERTY/.test(screen) && /TIMELINE/.test(screen) && /HOW IT WORKS/.test(screen) && /No service yet this season/.test(screen));
  check('20 photos open in the full-screen viewer, and the screen has NO notification switches', /TaskMediaViewer/.test(screen) && !/<Switch/.test(screen) && !/Notification settings/.test(screen));
  check('21 the route opens the new screen', /CustomerSnowScreen/.test(read('app/(customer)/snow-updates.tsx')));
  const acct = read('app/(customer)/(tabs)/account.tsx');
  check('22 Account has the Snow notification switches; its duplicate "Snow updates" and "Maintenance updates" rows are gone (Home is the one way in)', /<SnowNotifyChoices \/>/.test(acct) && !/title="Snow updates"/.test(acct) && !/title="Maintenance updates"/.test(acct) && /history\?service=lawn/.test(ph));
  const sw = read('src/components/snow/customer/SnowNotifyChoices.tsx');
  check('23 the switches are Crew arrives and Service finished, save at once, and go back if saving fails', /Crew arrives/.test(sw) && /Service finished/.test(sw) && /saveNotifyChoices\(/.test(sw) && /setChoices\(before\)/.test(sw));
  check('24 the project card and Past work are kept on Home (they open the existing project screen)', /ProjectCard/.test(ph) && /PastRow/.test(ph) && /\/\(customer\)\/project\?id=/.test(ph));
  const noSpin = screen + read('src/hooks/useSnowHome.ts') + read('src/components/snow/customer/SnowNotifyChoices.tsx');
  check('25 the customer Snow screen has NO spinner: no LoadingSpinner or ActivityIndicator, anywhere', !/LoadingSpinner|ActivityIndicator|Spinner/.test(noSpin));
  check('26 while loading it shows quiet placeholder blocks in the shape of the page, not a spinner', /function Placeholder\(\)/.test(screen) && /waiting \? \(\s*<Placeholder \/>/.test(screen));
  check('27 it opens with the last data that loaded (properties and timeline are remembered for the session)', /let remembered: MySnowProperty\[\] \| null = null/.test(read('src/hooks/useHasSnow.ts')) && /peekTimeline\(\)/.test(screen));
  check('28 a customer with no Snow property sees a plain message, not a spinner that never ends', /loaded && properties\.length === 0/.test(screen) && /No Snow service is linked to your account yet/.test(screen));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
