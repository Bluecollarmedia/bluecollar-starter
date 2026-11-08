\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: company with yard, owner, maintenance workers M1 + M2, landscaper.
-- Lines starting EXPECT ERROR are followed by the error the user would get.
alter table auth.users disable trigger all;
alter table public.companies disable trigger all;
alter table public.company_members disable trigger all;
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d');
insert into public.companies(id,name,yard_latitude,yard_longitude) values ('c0000000-0000-0000-0000-000000000001','Brighton',42.0,-71.0);
insert into public.people(id,user_id,first_name) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','Owner'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','M1'),
 ('10000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000c','M2'),
 ('10000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000d','Land');
insert into public.company_members(company_id,person_id,role,status,worker_type) values
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','owner','active','landscaping'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','worker','active','maintenance'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','worker','active','maintenance'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','worker','active','landscaping');

-- OWNER
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
insert into maintenance_properties(id,company_id,name,address,latitude,longitude) values ('20000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Oak Ridge','1 Oak',42.01,-71.01);
insert into maintenance_contracts(id,company_id,property_id) values ('30000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into maintenance_service_rules(id,company_id,contract_id,service_type,label,frequency,season_quantity) values ('40000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','lawn_cut','Lawn cut','weekly',26);
select 'rule property filled', property_id from maintenance_service_rules;
insert into maintenance_routes(id,company_id,service_date) values ('50000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','2026-10-14');
insert into maintenance_route_crew(company_id,route_id,person_id) values ('c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b'),('c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c');
\echo EXPECT ERROR landscaping worker on route:
insert into maintenance_route_crew(company_id,route_id,person_id) values ('c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d');
\echo EXPECT ERROR landscaping lead:
update maintenance_routes set lead_person_id='10000000-0000-0000-0000-00000000000d';
update maintenance_routes set lead_person_id='10000000-0000-0000-0000-00000000000c';
insert into maintenance_stops(id,company_id,route_id,property_id,contract_id,requires_photos,instructions) values ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',true,'Playground edge was missed');
insert into maintenance_stop_services(company_id,route_id,stop_id,property_id,rule_id,service_type,label) values ('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','40000000-0000-0000-0000-000000000001','lawn_cut','Lawn cut');
insert into maintenance_stop_tasks(id,company_id,route_id,stop_id,title) values ('70000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','60000000-0000-0000-0000-000000000001','Trim playground edge');
select 'service route filled', route_id from maintenance_stop_services;

-- LANDSCAPER
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false) \g /dev/null
select 'land sees props', count(*) from maintenance_properties;
select 'land sees routes', count(*) from maintenance_routes;
\echo EXPECT ERROR land arrive:
select status from maintenance_mark_arrived('60000000-0000-0000-0000-000000000001');

-- M1
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'm1 sees props', count(*) from maintenance_properties;
select 'm1 sees routes', count(*) from maintenance_routes;
select 'start1', location_status, distance_m from maintenance_start_day('c0000000-0000-0000-0000-000000000001','2026-10-14',null,null,null,null,'denied');
select 'start2 same', location_status from maintenance_start_day('c0000000-0000-0000-0000-000000000001','2026-10-14',null,42.0,-71.0,5,'ok');
update maintenance_stops set status='completed';
select 'direct update blocked', status from maintenance_stops;
\echo EXPECT ERROR finish before arrival:
select maintenance_finish_stop('60000000-0000-0000-0000-000000000001');
select 'arr1', status, arrival_location_status from maintenance_mark_arrived('60000000-0000-0000-0000-000000000001',42.01,-71.01,10,'ok');
select 'arr1 again', status from maintenance_mark_arrived('60000000-0000-0000-0000-000000000001',42.01,-71.01,10,'ok');
\echo EXPECT ERROR open task:
select maintenance_finish_stop('60000000-0000-0000-0000-000000000001');
select 'task', completed_at is not null from maintenance_set_task_done('70000000-0000-0000-0000-000000000001', true);
\echo EXPECT ERROR photos:
select maintenance_finish_stop('60000000-0000-0000-0000-000000000001');
\echo EXPECT ERROR customer visible photo by worker:
insert into maintenance_photos(company_id,route_id,stop_id,property_id,uploaded_by,file_url,is_customer_visible) values ('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-00000000000b','x',true);
insert into maintenance_photos(company_id,route_id,stop_id,property_id,uploaded_by,file_url) values ('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-00000000000b','x');
-- M2 arrives (unverified, far away), then finishes
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
select 'arr2', status from maintenance_mark_arrived('60000000-0000-0000-0000-000000000001',43,-72,10,'ok');
select 'finish', status, completion_location_status from maintenance_finish_stop('60000000-0000-0000-0000-000000000001','done',null,null,null,'unavailable');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'finish again (m1)', status, completed_by from maintenance_finish_stop('60000000-0000-0000-0000-000000000001');
select 'events', event_type, location_status, count(*) from maintenance_events group by 1,2,3 order by 1,2;
select 'services', completed from maintenance_stop_services;
select 'route', status from maintenance_routes;
select 'm1 attendance rows', count(*) from maintenance_day_attendance;
-- OWNER
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
select 'owner sees attendance', count(*) from maintenance_day_attendance;
select 'correct', started_at, original_started_at is not null from maintenance_correct_attendance('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','2026-10-14','2026-10-14 11:00+00','Was at yard at 7');
select 'correct missing m2', source from maintenance_correct_attendance('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','2026-10-14','2026-10-14 11:05+00','Forgot to tap');
\echo EXPECT ERROR delete route with history:
delete from maintenance_routes;
\echo EXPECT ERROR delete property with history:
delete from maintenance_properties;
\echo EXPECT 0 owner event delete:
delete from maintenance_events;
select 'events left', count(*) from maintenance_events;
