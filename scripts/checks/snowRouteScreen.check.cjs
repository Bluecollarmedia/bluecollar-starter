// Run: node scripts/checks/snowRouteScreen.check.cjs
// The Snow worker's Route screen: header + thin progress bar, the Next Stop card with its two-step button, and the numbered All Stops list.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('node:url');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

(async () => {
  const v = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'lib', 'snowRouteView.ts')).href);

  check('1 header is "Route name · Service" with no storm name repeated', v.routeHeaderLine('Main Route', ['Plowing']) === 'Main Route · Plowing' && v.routeHeaderLine('North', ['Plowing', 'Salting']) === 'North · Plowing + Salting');
  const p = v.routeProgress(['completed', 'completed', 'pending', 'pending', 'pending', 'pending', 'pending']);
  check('2 progress counts real completed stops: "2 of 7 stops completed", 29 %', p.text === '2 of 7 stops completed' && p.percent === 29 && p.total === 7, JSON.stringify(p));
  check('3 progress for one stop, none, and all done', v.routeProgress(['pending']).text === '0 of 1 stop completed' && v.routeProgress([]).percent === 0 && v.routeProgress(['completed', 'completed']).percent === 100);
  check('4 a skipped stop is not called completed, but is noted and moves the bar', v.routeProgress(['completed', 'skipped', 'pending']).text === '1 of 3 stops completed · 1 skipped' && v.routeProgress(['completed', 'skipped', 'pending']).percent === 67);
  check('5 address split: name big, street, then city/state/zip', JSON.stringify(v.splitAddress('Oak Plaza', '1 Oak St, Lakewood, NJ 08701')) === JSON.stringify({ street: '1 Oak St', place: 'Lakewood, NJ 08701' }));
  check('6 when the name is the street, the street is not shown twice', JSON.stringify(v.splitAddress('205 Cathy Ln', '205 Cathy Ln, Lakewood, NJ 08701')) === JSON.stringify({ street: undefined, place: 'Lakewood, NJ 08701' }) && JSON.stringify(v.splitAddress('x', '')) === '{}');
  check('7 two-step button: I\'m Here before arriving, Complete Stop after, never both, nothing once closed', v.primaryActionFor('pending') === 'arrive' && v.primaryActionFor('arrived') === 'complete' && v.primaryActionFor('completed') === null && v.primaryActionFor('skipped') === null);
  check('8 All Stops words: Completed / Arrived / Skipped / Next / Upcoming', v.stopStatusWord('completed', false) === 'Completed' && v.stopStatusWord('arrived', true) === 'Arrived' && v.stopStatusWord('skipped', false) === 'Skipped' && v.stopStatusWord('pending', true) === 'Next' && v.stopStatusWord('pending', false) === 'Upcoming');
  check('9 card status words', v.cardStatusWord('pending') === 'NOT STARTED' && v.cardStatusWord('arrived') === 'ARRIVED');

  const s = read('src/components/snow/routes/MyRouteScreen.tsx');
  check('10 the screen uses the helpers and the thin progress bar', /routeHeaderLine\(route\.name/.test(s) && /<ProgressBar progress=\{progress\.percent\} height=\{5\}/.test(s) && /routeProgress\(groups\.map\(groupStatus\)\)/.test(s));
  check('11 buttons are squared-off (not pills) and large', (s.match(/style=\{styles\.squared\}/g) || []).length >= 4 && /squared: \{ borderRadius: radius\.md \}/.test(s));
  check('12 the primary button: I\'m Here, then Complete Stop; Finish Stop wording is gone', /title=\{t\("I'm Here"\)\}/.test(s) && /title=\{t\('Complete Stop'\)\}/.test(s) && !/Finish Stop/.test(s));
  check('13 arrive and complete still call the existing database actions, and complete waits for the real answer (act reloads after)', /arriveAtStop\(v\.id\)/.test(s) && /finishStop\(v\.id/.test(s) && /async function act/.test(s) && /loading=\{busy\}/.test(s));
  check('14 Directions and Can\'t do this stop are kept', /title=\{t\('Directions'\)\}/.test(s) && /<LeadSkipPanel/.test(s));
  check('15 every stop has a stable number from its place in the route, and Completed shows as a word with a check', /\{i \+ 1\}/.test(s) && /t\('Stop \{n\}', \{ n: i \+ 1 \}\)/.test(s) && /\{t\('Completed'\)\}<\/Text>/.test(s) && /numberMarker/.test(s));
  check('16 the Next Stop card shows property name, street, then the smaller city line', /\{street \?/.test(s) && /\{place \?/.test(s) && /splitAddress\(current\.propertyName, current\.propertyAddress\)/.test(s));
  check('17 the crew view, instructions card, past work and bottom clearance are kept', /You're on this route's crew/.test(s) && /SnowServiceReferenceCard/.test(s) && /PAST WORK/.test(s) && /tabBarClearance/.test(s));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
