\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: company, owner Joey, worker Marcus
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','joey@x.com'),
 ('00000000-0000-0000-0000-00000000000b','marcus@x.com');
update public.people set first_name = split_part(email,'@',1);
insert into public.companies(id,name) values ('10000000-0000-0000-0000-000000000001','Brighton');
insert into public.company_members(company_id,person_id,role,status)
 select '10000000-0000-0000-0000-000000000001', id, case when email like 'joey%' then 'owner' else 'worker' end, 'active' from public.people;
\set C '10000000-0000-0000-0000-000000000001'

\echo '--- 1. New and existing companies start in Landscaping Mode'
select 'mode=' || active_mode from public.companies;

\echo '--- 2. Worker cannot switch the mode'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
update public.companies set active_mode = 'snow' where id = :'C';
reset role;
select 'mode after worker=' || active_mode from public.companies;

\echo '--- 3. Owner switches to Snow; who and when are stamped'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
update public.companies set active_mode = 'snow' where id = :'C';
reset role;
select 'mode=' || active_mode || ' by=' || (select first_name from public.people where id = active_mode_changed_by) || ' stamped=' || (active_mode_changed_at is not null) from public.companies;

\echo '--- 4. Stamp cannot be forged by an unrelated edit'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
update public.companies set name = 'Brighton Lawn', active_mode_changed_by = null, active_mode_changed_at = '2000-01-01' where id = :'C';
reset role;
select 'still stamped by=' || (select first_name from public.people where id = active_mode_changed_by) || ' year=' || extract(year from active_mode_changed_at) from public.companies;

\echo '--- 5. Unknown mode is refused (expect error)'
update public.companies set active_mode = 'winter' where id = :'C';

\echo '--- 6. Switching back to Landscaping leaves company data untouched'
select 'members before=' || count(*) from public.company_members;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
update public.companies set active_mode = 'landscaping' where id = :'C';
reset role;
select 'mode=' || active_mode || ' members after=' || (select count(*) from public.company_members) from public.companies;
