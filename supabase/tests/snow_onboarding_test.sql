\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: company Brighton, owner Joey, landscaping worker Marcus.
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','joey@x.com'),
 ('00000000-0000-0000-0000-00000000000b','marcus@x.com');
update public.people set first_name = split_part(email,'@',1);
insert into public.companies(id,name) values ('10000000-0000-0000-0000-000000000001','Brighton');
insert into public.company_members(company_id,person_id,role,status)
 select '10000000-0000-0000-0000-000000000001', id, case when email like 'joey%' then 'owner' else 'worker' end, 'active' from public.people;
create function pg_temp.pid(n text) returns uuid language sql as $$ select id from public.people where first_name = n $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
\set JOEY '00000000-0000-0000-0000-00000000000a'
\set MARCUS '00000000-0000-0000-0000-00000000000b'
\set SAM '00000000-0000-0000-0000-00000000000c'
select id as "MARCUS_PID" from public.people where email='marcus@x.com' \gset
\set RAY '00000000-0000-0000-0000-00000000000d'

\echo '--- 1. Owner makes a Snow code; a worker cannot'
set role authenticated; select pg_temp.as_user(:'JOEY');
select public.regenerate_snow_signup_code() as code \gset
select 'code looks right: ' || (:'code' like 'SNOW-______');
select pg_temp.as_user(:'MARCUS');
\echo 'worker regenerates (expect error):'
select public.regenerate_snow_signup_code();
\echo 'worker reads codes table (expect 0):'
select count(*) from public.snow_signup_codes;
reset role;

\echo '--- 2. Snow-only applicant Sam signs up with the code'
insert into auth.users(id,email,raw_user_meta_data) values (:'SAM','sam@x.com', jsonb_build_object('first_name','sam','snow_code', lower(:'code')));
set role authenticated; select pg_temp.as_user(:'SAM');
select 'status: ' || (public.get_my_snow_status()->'request'->>'status');
select 'sam memberships: ' || jsonb_array_length(public.get_my_context()->'memberships');
select 'sees company: ' || count(*) from public.companies;
select 'sees codes: ' || count(*) from public.snow_signup_codes;
select 'sees own request rows: ' || count(*) from public.snow_access_requests;
\echo 'sam writes own request to approved (expect 0 rows / error):'
update public.snow_access_requests set status = 'approved';
\echo 'sam approves himself (expect error):'
select public.approve_snow_access_request((select id from public.snow_access_requests limit 1), array['plowing']);
\echo 'repeat request is idempotent:'
select (public.request_snow_access(:'code')->>'request_id') = (public.get_my_snow_status()->'request'->>'id');
reset role;

\echo '--- 3. Code is regenerated: old code stops, Sam''s pending request stays'
set role authenticated; select pg_temp.as_user(:'JOEY');
select public.regenerate_snow_signup_code() as code2 \gset
select 'lookup old: ' || (public.lookup_snow_code(:'code')->>'valid') || ', new: ' || (public.lookup_snow_code(:'code2')->>'valid');
select 'pending requests: ' || count(*) from jsonb_array_elements(public.list_snow_access_requests()) e where e->>'status' = 'pending';
reset role;
insert into auth.users(id,email,raw_user_meta_data) values (:'RAY','ray@x.com', jsonb_build_object('first_name','ray','snow_code', :'code'));
select 'ray (old code) request rows: ' || count(*) from public.snow_access_requests where person_id = pg_temp.pid('ray');

\echo '--- 4. Marcus (landscaping worker) asks for snow with the same account'
set role authenticated; select pg_temp.as_user(:'MARCUS');
select public.request_snow_access(:'code2')->>'success';
select pg_temp.as_user(:'JOEY');
select 'marcus shows landscaping role: ' || (select e->>'landscaping_role' from jsonb_array_elements(public.list_snow_access_requests()) e where e->>'first_name' = 'marcus');

\echo '--- 5. Owner approves Sam for plowing, declines Marcus'
reset role;
select r.id as sam_req, r.person_id as sam_id from public.snow_access_requests r join public.people p on p.id = r.person_id where p.email = 'sam@x.com' \gset
select id as marcus_req from public.snow_access_requests where person_id = pg_temp.pid('marcus') \gset
set role authenticated; select pg_temp.as_user(:'JOEY');
\echo 'approve with no services (expect error):'
select public.approve_snow_access_request(:'sam_req', '{}');
select public.approve_snow_access_request(:'sam_req', array['plowing']);
select public.approve_snow_access_request(:'sam_req', array['plowing']);
select public.decline_snow_access_request(:'marcus_req', 'Full this season');
select 'members: ' || (select string_agg((e->>'first_name') || '=' || (e->>'status') || (e->>'services'), ', ') from jsonb_array_elements(public.list_snow_members()) e);
select pg_temp.as_user(:'SAM');
select 'sam status: ' || (public.get_my_snow_status()->'member'->>'status') || ' ' || (public.get_my_snow_status()->'member'->>'services');
select 'sam still no landscaping membership: ' || jsonb_array_length(public.get_my_context()->'memberships');
select pg_temp.as_user(:'MARCUS');
select 'marcus: ' || (public.get_my_snow_status()->'request'->>'status') || ' / ' || (public.get_my_snow_status()->'request'->>'decline_reason') || '; landscaping still ' || (public.get_my_context()->'memberships'->0->>'status');

\echo '--- 6. Owner changes Sam to shoveling+salting, then revokes'
select pg_temp.as_user(:'JOEY');
select public.set_snow_member_services(:'sam_id', array['salting','shoveling']);
select 'sam services: ' || (select e->>'services' from jsonb_array_elements(public.list_snow_members()) e where e->>'first_name'='sam');
select public.revoke_snow_access(:'sam_id');
select 'sam after revoke: ' || (select e->>'status' from jsonb_array_elements(public.list_snow_members()) e where e->>'first_name'='sam');

\echo '--- 7. Turning the code off; removing a pending request'
select public.disable_snow_signup_code();
select 'lookup after off: ' || (public.lookup_snow_code(:'code2')->>'valid');
reset role;
insert into public.snow_signup_codes(company_id, code) values ('10000000-0000-0000-0000-000000000001','SNOW-TEST01');
set role authenticated; select pg_temp.as_user(:'MARCUS');
select public.request_snow_access('SNOW-TEST01')->>'success';
select pg_temp.as_user(:'JOEY');
select public.remove_snow_access_request((select id from public.snow_access_requests where person_id = :'MARCUS_PID' and status='pending'));
select 'marcus requests: ' || (select string_agg(status, ',' order by created_at) from public.snow_access_requests where person_id = :'MARCUS_PID');
select 'audit: ' || string_agg(event_type, ',' order by created_at) from public.membership_audit_log where event_type like 'snow%';
reset role;
