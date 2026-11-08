// Lists the code-era / request-era leftovers in the full schema and who still refers to them. Run: node inventory.mjs C:/lw-build
import { buildFullSchema } from './fullSchema.mjs';
const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
console.log('schema failures:', failures.length);
const q = async (sql, p) => (await db.query(sql, p)).rows;

const tables = await q(`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relkind = 'r' and (c.relname ~* '(code|request|join)') order by 1`);
console.log('\nTABLES:', tables.map((t) => t.name).join(', '));

const funcs = await q(`select p.proname as name, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where p.proname ~* '(code|request|join|claim)' order by 1`);
console.log('\nFUNCTIONS:\n' + funcs.map((f) => `  ${f.name}(${f.args})`).join('\n'));

const cols = await q(`select c.relname as t, a.attname as col from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and a.attname ~* '(code|join_request|join_method)' order by 1, 2`);
console.log('\nCOLUMNS:\n' + cols.map((c) => `  ${c.t}.${c.col}`).join('\n'));

// Which functions mention each candidate table?
for (const t of tables) {
  const users = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public' where p.prosrc ~* $1 order by 1`, [`\\m${t.name}\\M`]);
  const fks = await q(`select conrelid::regclass::text as from_table from pg_constraint where confrelid = ('public.' || $1)::regclass and contype = 'f'`, [t.name]);
  const rows = (await q(`select count(*)::int c from public."${t.name}"`))[0].c;
  console.log(`\n${t.name}  rows=${rows}  used by functions: ${users.map((u) => u.proname).join(', ') || '(none)'}  referenced by tables: ${fks.map((f) => f.from_table).join(', ') || '(none)'}`);
}
