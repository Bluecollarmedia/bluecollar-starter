\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: company, owner Joey, workers Marcus + Tyler + Carlos, a truck
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','joey@x.com'),
 ('00000000-0000-0000-0000-00000000000b','marcus@x.com'),
 ('00000000-0000-0000-0000-00000000000c','tyler@x.com'),
 ('00000000-0000-0000-0000-00000000000d','carlos@x.com');
update public.people set first_name = split_part(email,'@',1);
insert into public.companies(id,name) values ('10000000-0000-0000-0000-000000000001','Brighton');
insert into public.company_members(company_id,person_id,role,status)
 select '10000000-0000-0000-0000-000000000001', id, case when email like 'joey%' then 'owner' else 'worker' end, 'active' from public.people;
insert into public.trucks(id,company_id,name) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Truck #1');
create function pg_temp.pid(n text) returns uuid language sql as $$ select id from public.people where first_name = n $$;
\set C '10000000-0000-0000-0000-000000000001'
\set R '30000000-0000-0000-0000-000000000001'

\echo '--- 1. Owner creates truck access-code resource, grants Marcus only'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
insert into public.company_resources(id,company_id,category,name,description,truck_id)
 values (:'R',:'C','vehicle','Truck #1 lockbox','Key is in the lockbox on the hitch','20000000-0000-0000-0000-000000000001');
select public.set_resource_secret(:'R','4821');
select 'has_secret=' || has_secret from public.company_resources where id = :'R';
\echo '--- 6. New resource: no worker access by default'
select 'access rows=' || count(*) from public.resource_access where resource_id = :'R';
insert into public.resource_access(company_id,resource_id,person_id) values (:'C',:'R',pg_temp.pid('marcus'));
select 'owner reveal=' || public.reveal_resource_secret(:'R');
reset role;

\echo '--- 2. Marcus sees + reveals; Tyler cannot find or open it'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select 'marcus sees: ' || name from public.company_resources;
select 'marcus reveal=' || public.reveal_resource_secret(:'R');
select 'marcus access rows visible=' || count(*) from public.resource_access;
select 'marcus can read secrets table? ' || count(*) from public.resource_secrets;
select 'marcus audit visible=' || count(*) from public.resource_audit_log;
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select 'tyler sees count=' || count(*) from public.company_resources;
select 'tyler search=' || count(*) from public.company_resources where name ilike '%lock%';
select public.reveal_resource_secret(:'R');
select public.reveal_resource_secret('99999999-0000-0000-0000-000000000000');
\echo 'tyler tries to grant himself:'
insert into public.resource_access(company_id,resource_id,person_id) values (:'C',:'R',pg_temp.pid('tyler'));
\echo 'tyler tries to edit / set code / flip has_secret / read vault:'
update public.company_resources set name = 'hacked' where id = :'R';
select 'rows updated? name=' || name from public.company_resources where id = :'R';
select public.set_resource_secret(:'R','0000');
select count(*) from vault.decrypted_secrets;
reset role;

\echo '--- 3. Owner grants Tyler'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
insert into public.resource_access(company_id,resource_id,person_id) values (:'C',:'R',pg_temp.pid('tyler'));
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select 'tyler now sees: ' || name from public.company_resources;
select 'tyler reveal=' || public.reveal_resource_secret(:'R');
select 'tyler sees access rows (own only)=' || count(*) from public.resource_access;
reset role;

\echo '--- 4. Owner revokes Marcus; Marcus blocked on direct API'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
delete from public.resource_access where resource_id = :'R' and person_id = pg_temp.pid('marcus');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select 'marcus sees count=' || count(*) from public.company_resources;
select public.reveal_resource_secret(:'R');
reset role;

\echo '--- 7. Deactivate Tyler -> access gone'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
update public.company_members set status = 'inactive' where person_id = pg_temp.pid('tyler');
select 'tyler access rows after deactivation=' || count(*) from public.resource_access where person_id = pg_temp.pid('tyler');
\echo 'grant to inactive tyler:'
insert into public.resource_access(company_id,resource_id,person_id) values (:'C',:'R',pg_temp.pid('tyler'));
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select 'inactive tyler sees=' || count(*) from public.company_resources;
select public.reveal_resource_secret(:'R');
reset role;

\echo '--- 10. Card guard'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
insert into public.company_resources(company_id,category,name,card_last_four,card_holder_id) values (:'C','company_card','Fuel card','1234',pg_temp.pid('carlos'));
select 'card ok: ' || name || ' ' || card_last_four from public.company_resources where category = 'company_card';
select public.set_resource_secret((select id from public.company_resources where category='company_card'),'9876');
insert into public.company_resources(company_id,category,name,description) values (:'C','company_info','Card','4111 1111 1111 1111');
insert into public.company_resources(company_id,category,name,description) values (:'C','company_info','Card','CVV 123');
insert into public.company_resources(company_id,category,name,description) values (:'C','company_card','Fuel','PIN 4455');
select public.set_resource_secret(:'R','4111-1111-1111-1111');
insert into public.company_resources(company_id,category,name,card_last_four) values (:'C','company_card','Bad','12345');
\echo 'gate code with 4 digits still fine:'
insert into public.company_resources(company_id,category,name,description) values (:'C','access_code','Yard gate','Gate on Pine St, code 2580 then #') returning 'ok ' || name;
reset role;

\echo '--- audit log (owner view), no secrets'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select event_type || ' ' || coalesce(resource_name,'') || ' ' || coalesce((select first_name from public.people where id = target_person_id),'') || ' ' || coalesce(metadata::text,'') from public.resource_audit_log order by created_at, event_type;
select 'audit mentions 4821? ' || count(*) from public.resource_audit_log where resource_audit_log::text like '%4821%';
\echo '--- delete resource removes vault secret'
delete from public.company_resources where id = :'R';
reset role;
select 'vault rows left=' || count(*) from vault.secrets;
