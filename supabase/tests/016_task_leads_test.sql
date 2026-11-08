\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: owner (a), plow lead (b), another plower (d), shoveler (e), customer (c).
alter table auth.users disable trigger all;
alter table public.company_members disable trigger all;
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d'),('00000000-0000-0000-0000-00000000000e');
insert into public.companies(id,name) values ('c0000000-0000-0000-0000-000000000001','Brighton');
insert into public.people(id,user_id,first_name) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','Owner'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','Lead'),
 ('10000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000c','Customer'),
 ('10000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000d','Plower'),
 ('10000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-00000000000e','Shoveler');
insert into public.company_members(company_id,person_id,role,status) values
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','owner','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','worker','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','customer','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','worker','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000e','worker','active');
insert into public.snow_staff(company_id,person_id) values
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000e');
insert into public.snow_staff_services(company_id,person_id,service) values
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','plowing'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','plowing'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000e','shoveling');

insert into public.projects(id, company_id, name) values ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Smith patio');
insert into public.project_tasks(id, company_id, project_id, title) values
 ('70000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','Dig'),
 ('70000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','Pour');
set role authenticated;
-- Worker (b) with no Task Lead picked
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
\echo EXPECT ERROR no Task Lead yet:
update project_tasks set status='completed' where id='70000000-0000-0000-0000-000000000001';
-- Owner picks b
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
\echo EXPECT ERROR customer as Task Lead:
update projects set task_lead_id='10000000-0000-0000-0000-00000000000c' where id='60000000-0000-0000-0000-000000000001';
update projects set task_lead_id='10000000-0000-0000-0000-00000000000b' where id='60000000-0000-0000-0000-000000000001';
-- Another worker (d) can't
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false) \g /dev/null
\echo EXPECT ERROR not the Task Lead:
update project_tasks set status='completed' where id='70000000-0000-0000-0000-000000000001';
-- Lead (b) can, and the database stamps who/when
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
update project_tasks set status='completed', completed_by='10000000-0000-0000-0000-00000000000d' where id='70000000-0000-0000-0000-000000000001';
\echo EXPECT ERROR lead renames a task:
update project_tasks set title='Dig deeper' where id='70000000-0000-0000-0000-000000000002';
reset role;
select 'completed by the lead (not the faked id)', status, completed_by = '10000000-0000-0000-0000-00000000000b', completed_at is not null from project_tasks where id='70000000-0000-0000-0000-000000000001';
