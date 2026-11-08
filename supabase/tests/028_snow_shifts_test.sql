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


set role authenticated;
-- PLOWER (d)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false) \g /dev/null
select 'clock in', (snow_clock_in('99999999-0000-0000-0000-000000000001')).clock_out_at is null;
select 'retry and second tap give one shift', (snow_clock_in('99999999-0000-0000-0000-000000000001')).id = (snow_clock_in()).id;
select 'my shifts', count(*) from snow_shifts;
\echo EXPECT ERROR worker writes a shift directly:
insert into snow_shifts(company_id, person_id) values ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d');
\echo EXPECT ERROR worker corrects own shift:
select snow_correct_shift((select id from snow_shifts limit 1), now() - interval '9 hours', now(), 'more hours');
select 'clock out', (snow_clock_out()).clock_out_at is not null;
select 'double tap clock out', (snow_clock_out()).clock_out_at is not null;
-- SHOVELER (e) sees nobody else's shifts
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000e',false) \g /dev/null
select 'shoveler sees others shifts', count(*) from snow_shifts;
-- CUSTOMER (c)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
\echo EXPECT ERROR customer clocks in:
select snow_clock_in();
-- OWNER (a)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
select 'owner sees shifts', count(*) from snow_shifts;
\echo EXPECT ERROR correction without a reason:
select snow_correct_shift((select id from snow_shifts limit 1), now() - interval '3 hours', now(), '  ');
select 'corrected', snow_correct_shift((select id from snow_shifts limit 1), now() - interval '3 hours', now(), 'Forgot to clock in') is not null;
\echo owner edits a correction (no rows change):
update snow_shift_corrections set reason = 'x';
reset role;
select 'original shift unchanged, corrections', (select count(*) from snow_shift_corrections);
select 'activity events', string_agg(action, ',' order by occurred_at) from snow_activity_events where action like 'shift.%';
