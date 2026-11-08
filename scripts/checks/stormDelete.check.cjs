// The owner can delete a storm update or a whole storm (for everyone, Storm History included). File-text checks; the database rules are proved by
// supabase/tests/106_storm_delete.pglite.mjs. Not covered here: how the delete buttons look and behave on a phone.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };
const sql = read('supabase/updates/106_storm_delete.sql');
const ed = read('src/components/weather/StormOutlookEditor.tsx');
const data = read('src/data/stormOutlook.ts');
check('only the exact owner can delete (the owner role check is in both delete functions and the history function)', (sql.match(/m\.role = 'owner' and m\.status = 'active'/g) || []).length >= 3);
check('the delete functions are not granted to anon', /revoke all on function public\.delete_storm_update\(uuid\) from public, anon/.test(sql) && /revoke all on function public\.delete_storm_outlook\(uuid\) from public, anon/.test(sql));
check('the permanence rule only gives way while the owner delete functions run', /app\.storm_owner_delete/.test(sql) && /tg_op = 'DELETE'/.test(sql) && /app\.storm_owner_delete/.test(read('supabase/updates/104_storm_outlooks.sql')));
check('the app asks before deleting, says it is for everyone including Storm History, and that it cannot be undone', /disappears for everyone, including Storm History/.test(ed) && /cannot be undone/.test(ed) && /confirmAction\(/.test(ed));
check('after a delete the saved copies on the phone are cleared and the screen reloads', /save\(CURRENT_KEY, null\)/.test(data) && /await reload\(\)/.test(ed));
check('the owner sees every posted storm in the editor, whether or not public Weather is on', /fetchOwnerStormHistory/.test(ed) && /owner_storm_history/.test(data));
process.exit(bad ? 1 : 0);
