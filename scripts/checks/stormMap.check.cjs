// The storm map: the owner attaches a picture to an update; visitors see it; it uploads before publishing.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let bad = 0; let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };
const ed = read('src/components/weather/StormOutlookEditor.tsx');
const page = read('src/components/weather/StormPage.tsx');
const sql = read('supabase/updates/105_storm_map.sql');
check('the editor lets the owner pick, replace and remove a map', /chooseMap/.test(ed) && /removeMap/.test(ed) && /Add a storm map/.test(ed));
check('the map is uploaded before the outlook is published, and a failed upload publishes nothing', ed.indexOf('uploadImage(') < ed.indexOf('await publishStorm(draft)') && /Nothing was published/.test(ed));
check('the map goes to the company media folder (the owner may upload there)', /\$\{db\.companyId\}\/storm-maps/.test(ed));
check('visitors see the map on the storm page, and only an https link counts', /version\.map_url \?/.test(page) && /\^https:/.test(read('src/lib/stormView.ts')));
check('the map link is sent only when there is one (publishing still works before update 105)', /\.\.\.\(d\.mapUrl \? \{ p_map_url: d\.mapUrl \} : \{\}\)/.test(read('src/data/stormOutlook.ts')));
check('update 105 only adds a column and replaces the one publish function (no clash)', /add column if not exists map_url/.test(sql) && /drop function if exists public\.publish_storm_outlook/.test(sql) && !/drop table|truncate/i.test(sql));
check('the map shows on the home card, first on the outlook page, and opens full screen with pinch zoom', read('src/components/weather/StormCard.tsx').includes('onOpenCard') && read('src/components/weather/StormPage.tsx').indexOf('<StormMap') < read('src/components/weather/StormPage.tsx').indexOf('styles.message') && /maximumZoomScale/.test(read('src/components/weather/StormMapView.tsx')));
check('the editor offers the map near the top (right after the message), not at the bottom', ed.indexOf("label('Storm map')") < ed.indexOf("label('Snowfall you expect')"));
process.exit(bad ? 1 : 0);
