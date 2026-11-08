\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: company, owner Joey, regular worker Marcus, applicants Ana + Ben
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','joey@x.com'),
 ('00000000-0000-0000-0000-00000000000b','marcus@x.com'),
 ('00000000-0000-0000-0000-00000000000c','ana@x.com'),
 ('00000000-0000-0000-0000-00000000000d','ben@x.com');
update public.people set first_name = split_part(email,'@',1);
insert into public.companies(id,name) values ('10000000-0000-0000-0000-000000000001','Brighton');
insert into public.company_members(company_id,person_id,role,status)
 select '10000000-0000-0000-0000-000000000001', id, case when email like 'joey%' then 'owner' else 'worker' end, 'active'
 from public.people where first_name in ('joey','marcus');
create function pg_temp.pid(n text) returns uuid language sql as $$ select id from public.people where first_name = n $$;
\set C '10000000-0000-0000-0000-000000000001'
\set M '60000000-0000-0000-0000-000000000001'
insert into public.team_codes(company_id,code,worker_type) values (:'C','BRIGHTON-AAAA','landscaping'), (:'C','BRIGHTON-MAINT-BBBB','maintenance');

\echo '--- 1. Existing workers are regular'
select 'marcus type=' || worker_type from public.company_members where person_id = pg_temp.pid('marcus');

\echo '--- 2. Maintenance code lookup says maintenance; the project-code lookup does not know it'
select public.lookup_team_code('brighton-maint-bbbb')->>'worker_type';
select public.lookup_project_code('BRIGHTON-MAINT-BBBB')->>'valid';

\echo '--- 3. Ana joins with the maintenance code: pending, no membership, sees nothing'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select public.request_join('BRIGHTON-MAINT-BBBB')->>'success';
select 'ana sees members=' || count(*) from public.company_members;
select 'ana is maintenance worker=' || public.person_is_maintenance_worker(:'C', pg_temp.pid('ana'));
\echo 'ana tries to change what she applied as (kept):'
update public.join_requests set requested_worker_type = 'landscaping' where person_id = pg_temp.pid('ana');
\echo 'ana tries to approve herself (expect error):'
select public.approve_join_request((select id from public.join_requests where person_id = pg_temp.pid('ana')), 'worker', 'maintenance');
reset role;
select 'ana request=' || status || '/' || requested_worker_type from public.join_requests where person_id = pg_temp.pid('ana');
select 'ana members=' || count(*) from public.company_members where person_id = pg_temp.pid('ana');

\echo '--- 4. Ben joins with the regular code'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
select public.request_join('BRIGHTON-AAAA')->>'success';
reset role;
select 'ben request=' || requested_worker_type from public.join_requests where person_id = pg_temp.pid('ben');

\echo '--- 5. Owner makes a Maintenance Crew, approves Ana as applied, Ben as regular'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
insert into public.crews(id,company_id,name,is_maintenance) values (:'M',:'C','Maintenance Crew',true);
\echo 'second maintenance crew (expect error):'
insert into public.crews(company_id,name,is_maintenance) values (:'C','Other',true);
select public.approve_join_request((select id from public.join_requests where person_id = pg_temp.pid('ana')), 'worker');
select public.approve_join_request((select id from public.join_requests where person_id = pg_temp.pid('ben')), 'worker', 'landscaping');
select 'ana type=' || worker_type from public.company_members where person_id = pg_temp.pid('ana');
select 'ben type=' || worker_type from public.company_members where person_id = pg_temp.pid('ben');
select 'crew=' || string_agg(p.first_name, ',' order by p.first_name) from public.crew_members cm join public.people p on p.id = cm.person_id where cm.crew_id = :'M';
select 'eligible: ana=' || public.person_is_maintenance_worker(:'C', pg_temp.pid('ana')) || ' marcus=' || public.person_is_maintenance_worker(:'C', pg_temp.pid('marcus'));

\echo '--- 6. Regular worker can not be put in the Maintenance Crew (expect error)'
insert into public.crew_members(company_id,crew_id,person_id) values (:'C',:'M',pg_temp.pid('marcus'));

\echo '--- 7. A plain update can not reclassify (type kept)'
update public.company_members set worker_type = 'maintenance' where person_id = pg_temp.pid('marcus');
select 'marcus type=' || worker_type from public.company_members where person_id = pg_temp.pid('marcus');

\echo '--- 8. Owner reclassifies Marcus explicitly, then Ana back to regular (leaves crew)'
select public.set_worker_type(pg_temp.pid('marcus'), 'maintenance');
select 'marcus type=' || worker_type from public.company_members where person_id = pg_temp.pid('marcus');
select public.set_worker_type(pg_temp.pid('ana'), 'landscaping');
select 'crew=' || coalesce(string_agg(p.first_name, ','), '(empty)') from public.crew_members cm join public.people p on p.id = cm.person_id where cm.crew_id = :'M';
select 'audit=' || string_agg(metadata->>'from' || '->' || (metadata->>'to'), ',' order by created_at) from public.membership_audit_log where event_type = 'worker_type_changed';
reset role;

\echo '--- 9. A worker can not reclassify anyone (expect error)'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
select public.set_worker_type(pg_temp.pid('ben'), 'maintenance');
reset role;
select 'ben type=' || worker_type from public.company_members where person_id = pg_temp.pid('ben');

\echo '--- 10. A crew with a regular worker can not become the Maintenance Crew (expect error)'
update public.crews set is_maintenance = false where id = :'M';
insert into public.crews(id,company_id,name) values ('60000000-0000-0000-0000-000000000002',:'C','Install');
insert into public.crew_members(company_id,crew_id,person_id) values (:'C','60000000-0000-0000-0000-000000000002',pg_temp.pid('ben'));
update public.crews set is_maintenance = true where id = '60000000-0000-0000-0000-000000000002';
