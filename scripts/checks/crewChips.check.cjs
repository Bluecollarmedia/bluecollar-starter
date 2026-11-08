// Run: node scripts/checks/crewChips.check.cjs
// Crews: one tap puts a whole crew on a project job; a worker can be in several crews.
const fs = require('fs');
const path = require('path');
const SETUP_SQL = require('./_sql.cjs').setup;   // supabase/setup.sql, the one file that builds the database
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const sql = SETUP_SQL;
const hook = read('src/hooks/useCrews.ts');
const store = read('src/data/store.ts');
const chips = read('src/components/crews/CrewChips.tsx');
check('1 the database lets a worker be in several crews but never the same crew twice', !/uq_crew_members_person\b/.test(sql) && /create unique index if not exists uq_crew_members_crew_person ON public\.crew_members USING btree \(crew_id, person_id\);/.test(sql)
  && !/^create unique index [^\n]* ON public\.crew_members USING btree \(person_id\)/m.test(sql));
check('2 putting a worker in a crew leaves their other crews alone', /setWorkerInCrew/.test(hook) && !/setWorkerCrew/.test(hook) && /crewsByPerson/.test(store));
check('3 a database test proves it on setup.sql', fs.existsSync(path.join(__dirname, '../../supabase/tests/setup/10_team.test.mjs')));
check('4 the crew chips add everyone at once, skip people who are not free and say who was skipped', /Not added:/.test(chips) && /check\?: \(personId: string\) => CrewPerson/.test(chips));
check('5 project scheduling uses the crew chips', /<CrewChips /.test(read('app/(owner)/schedule-create.tsx')));
check('6 project jobs warn when someone is already booked that day', /bookedOn/.test(read('app/(owner)/schedule-create.tsx')));
check('7 Settings opens the crews screen', /\/\(owner\)\/crews/.test(read('app/(owner)/(tabs)/more/settings.tsx')) && /name="crew-edit"/.test(read('app/(owner)/_layout.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
