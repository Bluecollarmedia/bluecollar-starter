\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: owner, plow lead P, shovel lead S, a plow-granted worker N who
-- leads nothing, customer C, and another company's owner X.
-- Lines starting EXPECT ERROR are followed by the error the user would get.
alter table auth.users disable trigger all;
alter table public.company_members disable trigger all;
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d'),('00000000-0000-0000-0000-00000000000e'),('00000000-0000-0000-0000-00000000000f');
insert into public.companies(id,name) values ('c0000000-0000-0000-0000-000000000001','Brighton'),('c0000000-0000-0000-0000-000000000002','Other');
insert into public.people(id,user_id,first_name) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','Owner'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','PlowLead'),
 ('10000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000c','ShovelLead'),
 ('10000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000d','PlowCrew'),
 ('10000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-00000000000e','Customer'),
 ('10000000-0000-0000-0000-00000000000f','00000000-0000-0000-0000-00000000000f','OtherOwner');
insert into public.company_members(company_id,person_id,role,status) values
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','owner','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','worker','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000e','customer','active'),
 ('c0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000f','owner','active');
-- Snow team (update 20). P is dual-mode (also a landscaping worker); S and N are snow-only.
insert into snow_staff(company_id,person_id) values
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d');
insert into snow_staff_services(company_id,person_id,service) values
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','plowing'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','shoveling'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','plowing');
insert into snow_properties(id,company_id,name) values ('20000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Oak Plaza');

-- OWNER sets up the property
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
insert into snow_property_services(id,company_id,property_id,service) values
 ('30000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','plowing'),
 ('30000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','shoveling');
select 'company taken from property (sent wrong one)', company_id from snow_property_services where id='30000000-0000-0000-0000-000000000001';
\echo EXPECT ERROR same service twice:
insert into snow_property_services(company_id,property_id,service) values ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','plowing');
insert into snow_property_contacts(company_id,property_id,name,is_primary) values ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Front desk',true);
insert into snow_property_contacts(company_id,property_id,name,person_id) values ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Manager','10000000-0000-0000-0000-00000000000e');
\echo EXPECT ERROR second primary contact:
insert into snow_property_contacts(company_id,property_id,name,is_primary) values ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Another',true);
\echo EXPECT ERROR linking a worker as a contact:
insert into snow_property_contacts(company_id,property_id,name,person_id) values ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Worker','10000000-0000-0000-0000-00000000000b');
insert into snow_service_instructions(company_id,property_service_id,body) values ('c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Plow v1: push snow to the north island');
insert into snow_service_instructions(company_id,property_service_id,body) values ('c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','Shovel: front walk and ramp');
insert into snow_reference_media(id,company_id,property_service_id,file_key) values ('40000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001/reference/30000000-0000-0000-0000-000000000001/a.jpg');
insert into snow_reference_media(id,company_id,property_service_id,file_key,media_type) values ('40000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001/reference/30000000-0000-0000-0000-000000000002/b.mov','video');
insert into storage.objects(bucket_id,name) values ('snow-media','c0000000-0000-0000-0000-000000000001/reference/30000000-0000-0000-0000-000000000001/a.jpg'),('snow-media','c0000000-0000-0000-0000-000000000001/reference/30000000-0000-0000-0000-000000000002/b.mov');
with x as (update snow_service_instructions set body='rewritten' returning 1) select 'owner edit of saved instructions changes rows:', count(*) from x;
with x as (delete from snow_reference_media returning 1) select 'owner delete of media changes rows:', count(*) from x;
reset role;
\echo EXPECT ERROR editing saved instructions even with full database access:
update snow_service_instructions set body='rewritten';
\echo EXPECT ERROR deleting reference media even with full database access:
delete from snow_reference_media;
set role authenticated;
\echo EXPECT ERROR changing a saved media caption:
update snow_reference_media set caption='new caption' where id='40000000-0000-0000-0000-000000000001';
\echo EXPECT ERROR moving a property service to plowing:
update snow_property_services set service='plowing' where id='30000000-0000-0000-0000-000000000002';
reset role;

-- Two storms (one per service): a plowing route led by P and a shoveling
-- route led by S, both visiting Oak Plaza. Set up and dispatched by the owner.
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
insert into snow_properties(id,company_id,name,notes) values ('20000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','Elm Lot','Gate code 4411');
insert into snow_storms(id,company_id,name,service) values
 ('50000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Jan 12 plow','plowing'),
 ('50000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','Jan 12 walks','shoveling');
insert into snow_routes(id,company_id,storm_id,service,name,lead_person_id) values
 ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','plowing','Plow 1','10000000-0000-0000-0000-00000000000b'),
 ('60000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','shoveling','Walks 1','10000000-0000-0000-0000-00000000000c');
insert into snow_visits(id,company_id,storm_id,route_id,property_id,service,position) values
 ('70000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','plowing',1),
 ('70000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','shoveling',1);
\echo EXPECT ERROR visit for a service the property does not get:
insert into snow_visits(company_id,storm_id,route_id,property_id,service,position) values ('c0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','plowing',2);
update snow_storms set status='dispatched', dispatched_at=now();
reset role;

-- PLOW LEAD
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'plow lead sees services:', string_agg(service, ',' order by service) from snow_property_services;
select 'plow lead sees instructions:', string_agg(body, ' | ') from snow_service_instructions;
select 'plow lead sees media:', count(*) from snow_reference_media;
select 'plow lead can open files:', string_agg(name, ',') from storage.objects;
select 'plow lead sees contacts:', count(*) from snow_property_contacts;
\echo EXPECT ERROR (or 0 rows) lead adds instructions:
insert into snow_service_instructions(company_id,property_service_id,body) values ('c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','lead edit');

-- SHOVEL LEAD
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
select 'shovel lead sees instructions:', string_agg(body, ' | ') from snow_service_instructions;
select 'shovel lead can open files:', string_agg(name, ',') from storage.objects;

-- PLOW CREW (has plowing, leads nothing)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false) \g /dev/null
select 'non-lead crew sees instructions:', count(*) from snow_service_instructions;
select 'non-lead crew can open files:', count(*) from storage.objects;

-- CUSTOMER
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000e',false) \g /dev/null
select 'customer reads snow_properties directly:', count(*) from snow_properties;
select 'customer property list (name, address):', string_agg(name, ',') from snow_my_properties();
select 'customer sees services:', string_agg(service, ',' order by service) from snow_property_services;
select 'customer sees instructions/media/files:', (select count(*) from snow_service_instructions), (select count(*) from snow_reference_media), (select count(*) from storage.objects);
select 'customer sees contacts (own only):', string_agg(name, ',') from snow_property_contacts;

-- OTHER COMPANY OWNER
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000f',false) \g /dev/null
select 'other company sees:', (select count(*) from snow_property_services), (select count(*) from snow_reference_media), (select count(*) from storage.objects);
\echo EXPECT ERROR other company adds instructions to our service:
insert into snow_service_instructions(company_id,property_service_id,body) values ('c0000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','hijack');
\echo EXPECT ERROR other company uploads into our folder:
insert into storage.objects(bucket_id,name) values ('snow-media','c0000000-0000-0000-0000-000000000001/reference/x/evil.jpg');

-- History: owner saves v2 and swaps the photo after the plow visit was completed.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
update snow_visits set status='arrived' where id='70000000-0000-0000-0000-000000000001';
update snow_visits set status='completed' where id='70000000-0000-0000-0000-000000000001';
select 'plow visit:', status from snow_visits where id='70000000-0000-0000-0000-000000000001';
select pg_sleep(0.01) \g /dev/null
insert into snow_service_instructions(company_id,property_service_id,body) values ('c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Plow v2: push snow to the south lot');
update snow_reference_media set retired_at = now() where id='40000000-0000-0000-0000-000000000001';
insert into snow_reference_media(company_id,property_service_id,file_key) values ('c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001/reference/30000000-0000-0000-0000-000000000001/c.jpg');
\echo EXPECT ERROR retiring twice:
update snow_reference_media set retired_at = now() where id='40000000-0000-0000-0000-000000000001';
select 'versions:', string_agg(version || '=' || body, ' | ' order by version) from snow_service_instructions where property_service_id='30000000-0000-0000-0000-000000000001';
select 'as of the completed visit:', i.version, (select string_agg(right(file_key, 5), ',') from snow_reference_media_as_of('30000000-0000-0000-0000-000000000001', v.completed_at))
  from snow_visits v, snow_instructions_as_of('30000000-0000-0000-0000-000000000001', v.completed_at) i where v.id='70000000-0000-0000-0000-000000000001';
select 'current:', i.version, (select string_agg(right(file_key, 5), ',') from snow_reference_media_as_of('30000000-0000-0000-0000-000000000001'))
  from snow_instructions_as_of('30000000-0000-0000-0000-000000000001') i;

-- Plow lead no longer sees the retired photo; storm ended → sees nothing.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'plow lead media after swap:', string_agg(right(file_key, 5), ',') from snow_reference_media;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
update snow_storms set status='ended', ended_at=now() where id='50000000-0000-0000-0000-000000000001';
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'plow lead after storm ended:', (select count(*) from snow_service_instructions), (select count(*) from snow_reference_media);
reset role;
-- Plow lead loses plowing permission mid-storm → sees nothing.
update snow_storms set status='dispatched', reopened_count=reopened_count+1 where id='50000000-0000-0000-0000-000000000001';
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'plow lead after reopen:', (select count(*) from snow_service_instructions), (select count(*) from snow_reference_media);
reset role;
delete from snow_staff_services where person_id='10000000-0000-0000-0000-00000000000b';
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'plow lead after plowing revoked:', (select count(*) from snow_service_instructions), (select count(*) from snow_reference_media);
reset role;
