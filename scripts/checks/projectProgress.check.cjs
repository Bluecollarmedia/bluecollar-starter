// Run: node scripts/checks/projectProgress.check.cjs <path to typescript package>
// Project progress is estimated from tasks (like the database does, update 121) and the owner can switch to by-hand; customers see finished tasks.
const fs = require('fs');
const path = require('path');
const ts = require(process.argv[2] || 'typescript');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };
const mod = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/projectProgress.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(mod, mod.exports, require);
const { estimateProgress } = mod.exports;
check('1 four tasks, one done: 25', estimateProgress({ total: 4, completed: 1, inProgress: 0 }) === 25);
check('2 an in-progress task counts half (1 done + 1 working of 4 = 38)', estimateProgress({ total: 4, completed: 1, inProgress: 1 }) === 38);
check('3 all done is capped at 99 (only completing the project sets 100)', estimateProgress({ total: 3, completed: 3, inProgress: 0 }) === 99);
check('4 no tasks gives no estimate, so the number is left alone', estimateProgress({ total: 0, completed: 0, inProgress: 0 }) === null);
const sql = read('supabase/updates/121_customer_sees_completed_tasks.sql');
check('5 update 121: same formula in the database (done + half of in-progress, capped 99), off switch respected, a completed project untouched', /least\(99, round\(100\.0 \* \(done \+ 0\.5 \* working\) \/ total\)/.test(sql) && /if not auto then return/.test(sql) && /st in \('completed', 'cancelled'\)/.test(sql));
check('6 update 121: a customer reads only COMPLETED tasks of their own project; the general read rule is crew-only', /project_tasks_select on public\.project_tasks for select using \(public\.is_crew\(company_id\)\)/.test(sql) && /status = 'completed' and public\.is_project_customer\(project_id\)/.test(sql));
const owner = read('app/(owner)/(tabs)/projects/[id].tsx');
check('7 the owner can switch progress between estimated and by hand (with -5 / +5 buttons by hand), and switching to estimate applies it right away', /Estimate from tasks/.test(owner) && /updateSettings\(\{ autoProgress: v \}\)/.test(owner) && /estimateProgress\(taskStats\)/.test(owner) && /progress: Math\.max\(0, p\.progress - 5\)/.test(owner));
check('8 the customer project screen lists "Work completed": finished tasks with the photos shared for each', /t\('Work completed'\)/.test(read('app/(customer)/project.tsx')) && /ph\.taskId === tk\.id/.test(read('app/(customer)/project.tsx')));
console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
