\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: company, owner Joey, workers Marcus + Tyler
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','joey@x.com'),
 ('00000000-0000-0000-0000-00000000000b','marcus@x.com'),
 ('00000000-0000-0000-0000-00000000000c','tyler@x.com');
update public.people set first_name = split_part(email,'@',1);
insert into public.companies(id,name) values ('10000000-0000-0000-0000-000000000001','Brighton');
insert into public.company_members(company_id,person_id,role,status)
 select '10000000-0000-0000-0000-000000000001', id, case when email like 'joey%' then 'owner' else 'worker' end, 'active' from public.people;
create function pg_temp.pid(n text) returns uuid language sql as $$ select id from public.people where first_name = n $$;
\set C '10000000-0000-0000-0000-000000000001'
\set M '60000000-0000-0000-0000-000000000001'
\set I '60000000-0000-0000-0000-000000000002'

\echo '--- 1. Owner makes Maintenance and Install crews, puts Marcus in Maintenance'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
insert into public.crews(id,company_id,name,color) values (:'M',:'C','Maintenance Crew','#7CB342'), (:'I',:'C','Install Crew','#1E88E5');
insert into public.crew_members(company_id,crew_id,person_id) values (:'C',:'M',pg_temp.pid('marcus'));
select 'crews=' || count(*) from public.crews;
\echo 'same name twice (expect error):'
insert into public.crews(company_id,name) values (:'C','maintenance crew ');
\echo 'Marcus in a second crew (expect error):'
insert into public.crew_members(company_id,crew_id,person_id) values (:'C',:'I',pg_temp.pid('marcus'));
\echo '--- 2. Deleting a crew frees its members'
delete from public.crews where id = :'M';
select 'members left=' || count(*) from public.crew_members;
reset role;

\echo '--- 3. Worker sees crews but cannot change them'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select 'worker sees crews=' || count(*) from public.crews;
insert into public.crews(company_id,name) values (:'C','Hackers');
update public.crews set name = 'x' where id = :'I';
reset role;
select 'install name=' || name from public.crews where id = :'I';
