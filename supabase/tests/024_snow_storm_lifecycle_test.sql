\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: company, owner, a plow-only snow worker, a customer.
-- Lines starting EXPECT ERROR are followed by the error the user would get.
alter table auth.users disable trigger all;
alter table public.company_members disable trigger all;
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c');
insert into public.companies(id,name) values ('c0000000-0000-0000-0000-000000000001','Brighton');
insert into public.people(id,user_id,first_name) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','Owner'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','Plower'),
 ('10000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000c','Customer');
insert into public.company_members(company_id,person_id,role,status) values
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','owner','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','worker','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','customer','active');
insert into public.snow_staff(company_id,person_id) values ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b');
insert into public.snow_staff_services(company_id,person_id,service) values ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','plowing');

set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
-- Oak has plowing; Elm has only shoveling; Pine has plowing but is inactive.
insert into snow_properties(id,company_id,name,address,status) values
 ('20000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Oak Plaza','1 Oak St','active'),
 ('20000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','Elm Lot','2 Elm St','active'),
 ('20000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001','Pine Court','3 Pine St','inactive');
insert into snow_property_services(company_id,property_id,service) values
 ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','plowing'),
 ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','shoveling'),
 ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','plowing');

-- CREATE
select 'create plow storm', (r->>'changed'), r->'storm'->>'status', r->'storm'->>'created_by'
  from snow_create_storm('Jan 12 plow','plowing',null,'90000000-0000-0000-0000-000000000001') r;
select 'double tap returns same storm', (r->>'changed'), (select count(*) from snow_storms)
  from snow_create_storm('Jan 12 plow','plowing',null,'90000000-0000-0000-0000-000000000001') r;
select 'create sidewalk storm', (r->>'changed') from snow_create_storm('Jan 12 sidewalks','shoveling') r;
\echo EXPECT ERROR unknown service:
select snow_create_storm('X','hauling');
\echo EXPECT ERROR blank name:
select snow_create_storm('  ','plowing');
\echo EXPECT ERROR create already dispatched:
insert into snow_storms(company_id,name,service,status) values ('c0000000-0000-0000-0000-000000000001','Sneaky','plowing','dispatched');
\echo EXPECT ERROR set status directly:
update snow_storms set status='dispatched' where name='Jan 12 plow';
\echo EXPECT ERROR forge a dispatch time directly:
update snow_storms set dispatched_at=now() where name='Jan 12 plow';
update snow_storms set name='Jan 12 plow (main)', notes='Heavy wet snow' where name='Jan 12 plow';
select 'rename ok', name, notes from snow_storms where client_request_id='90000000-0000-0000-0000-000000000001';
select 'eligible for plow storm', name from snow_storm_eligible_properties((select id from snow_storms where service='plowing'));
select 'eligible for sidewalk storm', name from snow_storm_eligible_properties((select id from snow_storms where service='shoveling'));

-- DISPATCH
\echo EXPECT ERROR dispatch with no routes:
select snow_dispatch_storm((select id from snow_storms where service='plowing'));
insert into snow_routes(id,storm_id,name) values ('40000000-0000-0000-0000-000000000001',(select id from snow_storms where service='plowing'),'Route A');
insert into snow_routes(id,storm_id,name) values ('40000000-0000-0000-0000-000000000009',(select id from snow_storms where service='plowing'),'Empty route');
insert into snow_visits(id,route_id,property_id) values
 ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
\echo EXPECT ERROR dispatch with a route that has no lead:
select snow_dispatch_storm((select id from snow_storms where service='plowing'));
update snow_routes set lead_person_id='10000000-0000-0000-0000-00000000000b' where id='40000000-0000-0000-0000-000000000001';
select 'dispatch', (r->>'changed'), r->'storm'->>'status', r->'storm'->>'dispatched_by', (r->'storm'->>'dispatched_at') is not null, r->'summary'
  from snow_dispatch_storm((select id from snow_storms where service='plowing')) r;
select 'dispatch double tap', (r->>'changed') from snow_dispatch_storm((select id from snow_storms where service='plowing')) r;
-- The sidewalk storm is dispatched too: two storms active at once.
insert into snow_routes(id,storm_id,name,lead_person_id) values ('40000000-0000-0000-0000-000000000002',(select id from snow_storms where service='shoveling'),'Walks','10000000-0000-0000-0000-00000000000a');
insert into snow_visits(route_id,property_id) values ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002');
select snow_dispatch_storm((select id from snow_storms where service='shoveling')) \g /dev/null
select 'active storms', count(*) from snow_storms where status='dispatched';

-- Work the first Oak pass, with a photo and a customer notification.
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000001';
insert into snow_completion_media(visit_id,kind,file_key) values ('50000000-0000-0000-0000-000000000001','photo','snow/oak1.jpg');
update snow_visits set status='completed' where id='50000000-0000-0000-0000-000000000001';
reset role;
insert into app_notifications(company_id,recipient_id,event_type,title) values ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','snow_visit_completed','Plowing completed');
set role authenticated;

-- WORKER can't run the lifecycle or touch storms.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
\echo EXPECT ERROR worker creates a storm:
select snow_create_storm('Mine','plowing');
\echo EXPECT ERROR worker ends a storm:
select snow_end_storm((select id from snow_storms limit 1));
\echo EXPECT ERROR worker ends a storm by id:
select snow_end_storm('00000000-0000-0000-0000-000000000000');
select 'worker sees storms', count(*) from snow_storms;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
\echo EXPECT ERROR customer previews ending:
select snow_storm_end_preview((select id from snow_storms limit 1));
select 'customer sees storms', count(*) from snow_storms;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null

-- END
\echo EXPECT ERROR end a draft:
select snow_create_storm('Not yet','salting') \g /dev/null
select snow_end_storm((select id from snow_storms where service='salting'));
select 'end preview', r->'summary' from snow_storm_end_preview((select id from snow_storms where service='plowing')) r;
select 'still dispatched after preview', status from snow_storms where service='plowing';
select 'end', (r->>'changed'), r->'storm'->>'status', r->'storm'->>'ended_by', (r->'storm'->>'ended_at') is not null
  from snow_end_storm((select id from snow_storms where service='plowing')) r;
select 'end double tap', (r->>'changed') from snow_end_storm((select id from snow_storms where service='plowing')) r;
select 'pending pass stays pending, not completed', status from snow_visits where id='50000000-0000-0000-0000-000000000002';
\echo EXPECT ERROR dispatch an ended storm:
select snow_dispatch_storm((select id from snow_storms where service='plowing'));
\echo EXPECT ERROR work on an ended storm:
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000002';
\echo EXPECT ERROR add a visit to an ended storm:
insert into snow_visits(route_id,property_id) values ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
\echo EXPECT ERROR delete an ended storm:
delete from snow_storms where service='plowing';
select 'other storm still active', status from snow_storms where service='shoveling';

-- REOPEN
reset role;
select 'before reopen: notifications, media', (select count(*) from app_notifications), (select count(*) from snow_completion_media);
set role authenticated;
select 'reopen', (r->>'changed'), r->'storm'->>'status', r->'storm'->>'reopened_count', r->'storm'->>'last_reopened_by', (r->'storm'->>'ended_at') is not null
  from snow_reopen_storm((select id from snow_storms where service='plowing')) r;
select 'reopen double tap', (r->>'changed'), r->'storm'->>'reopened_count' from snow_reopen_storm((select id from snow_storms where service='plowing')) r;
reset role;
select 'after reopen: notifications, media (unchanged)', (select count(*) from app_notifications), (select count(*) from snow_completion_media);
set role authenticated;
select 'first pass still completed', status, completed_at is not null from snow_visits where id='50000000-0000-0000-0000-000000000001';
insert into snow_visits(id,route_id,property_id) values ('50000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
select 'extra pass is a new visit', status, position, added_after_dispatch from snow_visits where id='50000000-0000-0000-0000-000000000003';
\echo EXPECT ERROR reopen a draft:
select snow_reopen_storm((select id from snow_storms where service='salting'));
select 'end and reopen again', (select r->'storm'->>'status' from snow_end_storm((select id from snow_storms where service='plowing')) r),
  (select r->'storm'->>'reopened_count' from snow_reopen_storm((select id from snow_storms where service='plowing')) r);

-- The guard holds even for the database admin (no going back to draft).
reset role;
\echo EXPECT ERROR back to draft:
update snow_storms set status='draft' where service='plowing';
\echo EXPECT ERROR change service:
update snow_storms set service='salting' where service='shoveling';
\echo EXPECT ERROR draft straight to ended:
update snow_storms set status='ended' where service='salting';

select 'activity', action, count(*) from snow_activity_events where entity_type='storm' group by action order by action;
select 'reopen event actor', actor_id from snow_activity_events where action='storm.reopened' limit 1;
