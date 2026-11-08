\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: company, owner Joey, workers Marcus + Tyler, one active job
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','joey@x.com'),
 ('00000000-0000-0000-0000-00000000000b','marcus@x.com'),
 ('00000000-0000-0000-0000-00000000000c','tyler@x.com');
update public.people set first_name = split_part(email,'@',1);
insert into public.companies(id,name) values ('10000000-0000-0000-0000-000000000001','Brighton');
insert into public.company_members(company_id,person_id,role,status)
 select '10000000-0000-0000-0000-000000000001', id, case when email like 'joey%' then 'owner' else 'worker' end, 'active' from public.people;
insert into public.projects(id,company_id,name,status) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Maintenance - Oak St','active');
create function pg_temp.pid(n text) returns uuid language sql as $$ select id from public.people where first_name = n $$;
\set C '10000000-0000-0000-0000-000000000001'
\set J '40000000-0000-0000-0000-000000000001'
\set S '50000000-0000-0000-0000-000000000001'

\echo '--- 1. Owner: Marcus every 2 weeks from Mon Oct 12 2026, 7-3, open-ended'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
insert into public.schedule_series(id,company_id,project_id,person_id,frequency,start_date,start_time,end_time)
 values (:'S',:'C',:'J',pg_temp.pid('marcus'),'biweekly','2026-10-12','07:00','15:00');
-- Marcus is already on this job Oct 26 (by hand), so that day is skipped.
insert into public.assignments(company_id,project_id,person_id,scheduled_date,is_full_day)
 values (:'C',:'J',pg_temp.pid('marcus'),'2026-10-26',true);
select 'added=' || public.extend_schedule_series(:'S','2026-10-13',56);
select 'day ' || scheduled_date || ' ' || coalesce(start_time,'full') || ' series=' || (series_id is not null) || ' ' || confirmation_state
 from public.assignments order by scheduled_date;
select 'changes logged=' || count(*) from public.schedule_changes;

\echo '--- 2. Running it again adds nothing'
select 'added again=' || public.extend_schedule_series(null,'2026-10-13',56);

\echo '--- 3. Owner cancels Nov 9; a later top-up does not bring it back'
update public.assignments set status='cancelled' where series_id = :'S' and scheduled_date = '2026-11-09';
select 'added after cancel=' || public.extend_schedule_series(null,'2026-10-20',56);
select 'nov 9 rows=' || count(*) || ' status=' || string_agg(status, ',') from public.assignments where scheduled_date='2026-11-09';

\echo '--- 4. Time passes: a week later the horizon moves and Dec 21 is added'
select 'added later=' || public.extend_schedule_series(null,'2026-10-27',56);
select 'last day=' || max(scheduled_date) from public.assignments where series_id = :'S';

\echo '--- 5. Monthly from Jan 31 lands on the last day of short months'
insert into public.schedule_series(id,company_id,project_id,person_id,frequency,start_date,end_date,is_full_day)
 values ('50000000-0000-0000-0000-000000000002',:'C',:'J',pg_temp.pid('tyler'),'monthly','2027-01-31','2027-04-30',true);
select 'monthly added=' || public.extend_schedule_series('50000000-0000-0000-0000-000000000002','2027-01-01',365);
select 'tyler ' || scheduled_date from public.assignments where person_id = pg_temp.pid('tyler') order by 1;

\echo '--- 6. Stopped repeat is not topped up'
update public.schedule_series set stopped_at = now() where id = :'S';
select 'added after stop=' || public.extend_schedule_series(null,'2026-12-01',56);
reset role;

\echo '--- 7. Worker cannot create a repeat or fill one in'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
insert into public.schedule_series(company_id,project_id,person_id,frequency,start_date)
 values (:'C',:'J',pg_temp.pid('marcus'),'weekly','2026-10-13');
update public.schedule_series set stopped_at = null where id = :'S';
select 'worker sees series=' || count(*) from public.schedule_series;
select 'worker extend added=' || public.extend_schedule_series(null,'2026-10-13',56);
reset role;
select 'stopped still=' || (stopped_at is not null) from public.schedule_series where id = :'S';

\echo '--- 8. Custom every 10 days, scheduled 4 weeks ahead (its own window)'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
insert into public.schedule_series(id,company_id,project_id,person_id,frequency,interval_days,horizon_days,start_date,is_full_day)
 values ('50000000-0000-0000-0000-000000000003',:'C',:'J',pg_temp.pid('tyler'),'custom',10,28,'2026-10-13',true);
select 'custom added=' || public.extend_schedule_series('50000000-0000-0000-0000-000000000003','2026-10-13');
select 'custom ' || scheduled_date from public.assignments where series_id = '50000000-0000-0000-0000-000000000003' order by 1;
\echo 'custom without a day count (expect error):'
insert into public.schedule_series(company_id,project_id,person_id,frequency,start_date)
 values (:'C',:'J',pg_temp.pid('tyler'),'custom','2026-10-13');
reset role;
