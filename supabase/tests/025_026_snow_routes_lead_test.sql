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


set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
insert into snow_properties(id,company_id,name,address) values
 ('20000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Oak Plaza','1 Oak St'),
 ('20000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','Elm Lot','2 Elm St'),
 ('20000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001','Pine Ct','3 Pine St');
insert into snow_property_services(company_id,property_id,service) values
 ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','plowing'),
 ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','plowing'),
 ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','shoveling');
insert into snow_storms(id,company_id,name,service) values ('30000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Jan 12 plow','plowing');
insert into snow_routes(id,company_id,storm_id,name,lead_person_id,media_required,min_media) values
 ('40000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Route A','10000000-0000-0000-0000-00000000000b',true,1);
insert into snow_visits(id,route_id,property_id) values
 ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');

-- 025: reorder, template save/apply
select snow_reorder_route('40000000-0000-0000-0000-000000000001', array['50000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001']::uuid[]);
select 'order after reorder', string_agg(property_name, ',' order by position) from snow_visits where route_id='40000000-0000-0000-0000-000000000001';
\echo EXPECT ERROR reorder with a missing stop:
select snow_reorder_route('40000000-0000-0000-0000-000000000001', array['50000000-0000-0000-0000-000000000002']::uuid[]);
select 'template saved', snow_save_route_template('40000000-0000-0000-0000-000000000001','North loop') is not null;
select 'template stops', count(*) from snow_route_template_stops;
-- Elm Lot stops offering plowing: it's left out when the template is used.
update snow_property_services set is_active=false where property_id='20000000-0000-0000-0000-000000000002';
select 'route from template', snow_apply_route_template('30000000-0000-0000-0000-000000000001',(select id from snow_route_templates limit 1)) is not null;
select 'template route stops (Elm left out)', string_agg(v.property_name, ',' order by v.position)
  from snow_visits v join snow_routes r on r.id=v.route_id where r.name='North loop';
select 'template route lead kept', (select lead_person_id from snow_routes where name='North loop') = '10000000-0000-0000-0000-00000000000b';

-- 026: lead sees nothing before dispatch
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'lead sees routes before dispatch', count(*) from snow_routes;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
select snow_dispatch_storm('30000000-0000-0000-0000-000000000001') \g /dev/null
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'lead sees routes / visits / storms after dispatch', (select count(*) from snow_routes), (select count(*) from snow_visits), (select count(*) from snow_storms);
\echo EXPECT ERROR start the second stop first:
select snow_arrive_visit('50000000-0000-0000-0000-000000000001');
select 'arrive stop 1', (snow_arrive_visit('50000000-0000-0000-0000-000000000002')).status;
select 'double tap arrive', (snow_arrive_visit('50000000-0000-0000-0000-000000000002')).status;
\echo EXPECT ERROR complete without the required photo:
select snow_complete_visit('50000000-0000-0000-0000-000000000002');
\echo EXPECT ERROR media key for another stop:
select snow_add_completion_media('50000000-0000-0000-0000-000000000002','photo','c0000000-0000-0000-0000-000000000001/completion/50000000-0000-0000-0000-000000000001/x.jpg');
select 'photo added', snow_add_completion_media('50000000-0000-0000-0000-000000000002','photo','c0000000-0000-0000-0000-000000000001/completion/50000000-0000-0000-0000-000000000002/x.jpg') is not null;
select 'complete stop 1', (snow_complete_visit('50000000-0000-0000-0000-000000000002','Done, salted walk')).status;
\echo EXPECT ERROR lead updates a visit directly:
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000001';
reset role;
select 'direct update did nothing', status from snow_visits where id='50000000-0000-0000-0000-000000000001';
set role authenticated;

-- Someone who isn't the lead
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false) \g /dev/null
select 'other plower sees routes / visits', (select count(*) from snow_routes), (select count(*) from snow_visits);
\echo EXPECT ERROR other plower arrives at a stop:
select snow_arrive_visit('50000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
select 'customer sees visits', count(*) from snow_visits;
reset role;
