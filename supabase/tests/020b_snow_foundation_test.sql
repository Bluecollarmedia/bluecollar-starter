\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: company, owner, a landscaping worker, a customer.
-- Lines starting EXPECT ERROR are followed by the error the user would get.
alter table auth.users disable trigger all;
alter table public.company_members disable trigger all;
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c');
insert into public.companies(id,name) values ('c0000000-0000-0000-0000-000000000001','Brighton');
insert into public.people(id,user_id,first_name) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','Owner'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','Worker'),
 ('10000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000c','Customer');
insert into public.company_members(company_id,person_id,role,status) values
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','owner','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','worker','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','customer','active');
-- Worker is on the snow team for plowing only (update 20).
insert into public.snow_staff(company_id,person_id) values ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b');
insert into public.snow_staff_services(company_id,person_id,service) values ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','plowing');
select 'settings row for company', count(*) from snow_settings;

-- OWNER sets up two properties, a storm with two routes, and a repeat pass.
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
insert into snow_properties(id,company_id,name,address,city) values
 ('20000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Oak Plaza','1 Oak St','Brighton'),
 ('20000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','Elm Lot','2 Elm St','Brighton');
insert into snow_storms(id,company_id,name,service) values
 ('30000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Jan 12 plow','plowing'),
 ('30000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','Jan 12 sidewalks','shoveling');
insert into snow_routes(id,company_id,storm_id,service,name,lead_person_id,media_required,min_media) values
 ('40000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','salting','Route A','10000000-0000-0000-0000-00000000000b',true,2),
 ('40000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','plowing','Route B','10000000-0000-0000-0000-00000000000b',false,1);
select 'route service taken from storm', service from snow_routes where id='40000000-0000-0000-0000-000000000001';
select 'same lead on two routes', count(*) from snow_route_lead_assignments where person_id='10000000-0000-0000-0000-00000000000b' and ended_at is null;
-- Oak twice on Route A (two passes) and once on Route B; Elm once on A.
insert into snow_visits(id,company_id,storm_id,route_id,service,property_id,position) values
 ('50000000-0000-0000-0000-000000000001',null,null,'40000000-0000-0000-0000-000000000001',null,'20000000-0000-0000-0000-000000000001',null),
 ('50000000-0000-0000-0000-000000000002',null,null,'40000000-0000-0000-0000-000000000001',null,'20000000-0000-0000-0000-000000000002',null),
 ('50000000-0000-0000-0000-000000000003',null,null,'40000000-0000-0000-0000-000000000001',null,'20000000-0000-0000-0000-000000000001',null),
 ('50000000-0000-0000-0000-000000000004',null,null,'40000000-0000-0000-0000-000000000002',null,'20000000-0000-0000-0000-000000000001',null);
select 'visit', position, property_name, property_address, status from snow_visits where route_id='40000000-0000-0000-0000-000000000001' order by position;
\echo EXPECT ERROR customer (not on the snow team) as lead:
update snow_routes set lead_person_id='10000000-0000-0000-0000-00000000000c' where id='40000000-0000-0000-0000-000000000001';
\echo EXPECT ERROR arrive before dispatch:
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000001';
-- Retrying a create with the same client_request_id doesn't make a second visit.
insert into snow_visits(route_id,property_id,client_request_id) values ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','99999999-0000-0000-0000-000000000001') on conflict (client_request_id) do nothing;
insert into snow_visits(route_id,property_id,client_request_id) values ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','99999999-0000-0000-0000-000000000001') on conflict (client_request_id) do nothing;
select 'route B visits after retry', count(*) from snow_visits where route_id='40000000-0000-0000-0000-000000000002';

-- Dispatch (the lifecycle update will do this through a function).
update snow_storms set status='dispatched', dispatched_at=now() where id='30000000-0000-0000-0000-000000000001';
-- Reassign Route B's lead to the owner: history keeps both.
update snow_routes set lead_person_id='10000000-0000-0000-0000-00000000000a' where id='40000000-0000-0000-0000-000000000002';
select 'route B lead history', person_id, ended_at is not null from snow_route_lead_assignments where route_id='40000000-0000-0000-0000-000000000002' order by assigned_at, ended_at nulls last;
\echo BLOCKED (0 rows) lead history edit:
update snow_route_lead_assignments set person_id='10000000-0000-0000-0000-00000000000a';

-- First pass at Oak: arrive, add media, complete. The second pass stays pending.
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000001';
insert into snow_completion_media(company_id,storm_id,route_id,visit_id,property_id,service,kind,file_key) values (null,null,null,'50000000-0000-0000-0000-000000000001',null,null,'photo','snow/1.jpg');
select 'media filled from visit', route_id, property_id, service, uploaded_by from snow_completion_media;
\echo EXPECT ERROR same file twice on a visit:
insert into snow_completion_media(visit_id,kind,file_key) values ('50000000-0000-0000-0000-000000000001','photo','snow/1.jpg');
\echo EXPECT ERROR route A needs 2 photos, has 1:
update snow_visits set status='completed' where id='50000000-0000-0000-0000-000000000001';
insert into snow_completion_media(visit_id,kind,file_key) values ('50000000-0000-0000-0000-000000000001','video','snow/2.mp4');
update snow_visits set status='completed', completion_note='Cleared' where id='50000000-0000-0000-0000-000000000001';
\echo EXPECT ERROR complete without arriving (setting on):
update snow_visits set status='completed' where id='50000000-0000-0000-0000-000000000004';
select 'pass 1', status, arrived_at is not null, completed_at is not null, completed_by from snow_visits where id='50000000-0000-0000-0000-000000000001';
select 'pass 2 untouched', status from snow_visits where id='50000000-0000-0000-0000-000000000003';
\echo EXPECT ERROR reopen a completed visit:
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000001';
update snow_visits set completed_at='2000-01-01' where id='50000000-0000-0000-0000-000000000001';
select 'completed time kept', completed_at > '2020-01-01' from snow_visits where id='50000000-0000-0000-0000-000000000001';
\echo EXPECT ERROR replace uploaded media:
update snow_completion_media set file_key='other.jpg';
\echo EXPECT ERROR delete media:
delete from snow_completion_media;
\echo EXPECT ERROR delete worked visit:
delete from snow_visits where id='50000000-0000-0000-0000-000000000001';

-- Skip flow at Elm: can't skip without an approved request; denied stays pending.
\echo EXPECT ERROR skip without approval:
update snow_visits set status='skipped' where id='50000000-0000-0000-0000-000000000002';
insert into snow_skip_requests(id,visit_id,reason) values ('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','Car parked in lot');
\echo EXPECT ERROR second open request:
insert into snow_skip_requests(visit_id,reason) values ('50000000-0000-0000-0000-000000000002','again');
update snow_skip_requests set status='denied', decision_note='Come back later' where id='60000000-0000-0000-0000-000000000001';
select 'after deny', status from snow_visits where id='50000000-0000-0000-0000-000000000002';
\echo EXPECT ERROR change a decision:
update snow_skip_requests set status='approved' where id='60000000-0000-0000-0000-000000000001';
insert into snow_skip_requests(id,visit_id,reason) values ('60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','Still blocked');
update snow_skip_requests set status='approved' where id='60000000-0000-0000-0000-000000000002';
select 'after approve', status, skipped_at is not null, completed_at is null from snow_visits where id='50000000-0000-0000-0000-000000000002';

-- Route media rule change mid-storm is logged.
update snow_routes set media_required=false where id='40000000-0000-0000-0000-000000000001';

-- Property edit doesn't rewrite the visit's copy.
update snow_properties set name='Oak Plaza (new name)' where id='20000000-0000-0000-0000-000000000001';
select 'visit keeps old name', property_name from snow_visits where id='50000000-0000-0000-0000-000000000001';
\echo EXPECT ERROR delete property with visits:
delete from snow_properties where id='20000000-0000-0000-0000-000000000001';

-- End the storm: no new visits until reopened; reopen allows a new pass.
update snow_storms set status='ended', ended_at=now() where id='30000000-0000-0000-0000-000000000001';
\echo EXPECT ERROR add visit to ended storm:
insert into snow_visits(route_id,property_id) values ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
\echo EXPECT ERROR delete dispatched storm:
delete from snow_storms where id='30000000-0000-0000-0000-000000000001';
update snow_storms set status='dispatched', reopened_count=reopened_count+1 where id='30000000-0000-0000-0000-000000000001';
insert into snow_visits(id,route_id,property_id) values ('50000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
select 'new pass after reopen', position, added_after_dispatch from snow_visits where id='50000000-0000-0000-0000-000000000005';
select 'pass 1 still completed', status from snow_visits where id='50000000-0000-0000-0000-000000000001';

\echo EXPECT ERROR plow-only worker leading a shoveling route:
insert into snow_routes(storm_id,name,lead_person_id) values ('30000000-0000-0000-0000-000000000002','Walks','10000000-0000-0000-0000-00000000000b');
-- Draft storm can be deleted whole.
insert into snow_routes(id,storm_id,name) values ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','Walks');
insert into snow_visits(route_id,property_id) values ('40000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001');
delete from snow_storms where id='30000000-0000-0000-0000-000000000002';
select 'draft storm deleted', count(*) from snow_storms where id='30000000-0000-0000-0000-000000000002';

-- Reorder inside one statement (unique position is checked at commit).
update snow_visits set position = case position when 1 then 3 when 3 then 1 else position end where route_id='40000000-0000-0000-0000-000000000001';
select 'reordered', id, position from snow_visits where route_id='40000000-0000-0000-0000-000000000001' order by position;

select 'activity', action, count(*) from snow_activity_events group by action order by action;
\echo BLOCKED (0 rows) edit activity log:
update snow_activity_events set note='x';
\echo BLOCKED (0 rows) delete activity log:
delete from snow_activity_events;
\echo EXPECT ERROR app calls snow_log_event directly:
select snow_log_event('c0000000-0000-0000-0000-000000000001','storm.created','storm',null);
reset role;
\echo EXPECT ERROR even the database admin cannot edit the log:
update snow_activity_events set note='x';
set role authenticated;

-- WORKER and CUSTOMER: nothing in this update is visible to them.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'worker sees', (select count(*) from snow_properties), (select count(*) from snow_storms), (select count(*) from snow_routes), (select count(*) from snow_visits), (select count(*) from snow_completion_media), (select count(*) from snow_activity_events);
update snow_visits set status='completed';
select 'worker update did nothing', count(*) from snow_visits where status='completed';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
select 'customer sees', (select count(*) from snow_properties), (select count(*) from snow_visits), (select count(*) from snow_completion_media), (select count(*) from snow_skip_requests);
reset role;
select 'completed visits (as admin)', count(*) from snow_visits where status='completed';
