-- Runs the route/lead test first for its fixture (a completed stop at Elm Lot
-- with one photo), then checks review, sharing and what the customer sees.
\ir 025_026_snow_routes_lead_test.sql
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
insert into snow_property_contacts(company_id,property_id,name,person_id) values
 ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Pat Customer','10000000-0000-0000-0000-00000000000c');
select 'new media starts to review', review_status from snow_completion_media;
\echo EXPECT ERROR send before reviewing:
select snow_send_customer_update('50000000-0000-0000-0000-000000000002');
select snow_review_media((select id from snow_completion_media limit 1), 'approved');
select 'photos shared', snow_send_customer_update('50000000-0000-0000-0000-000000000002');
select 'sending again shares nothing new', snow_send_customer_update('50000000-0000-0000-0000-000000000002');
\echo EXPECT ERROR hide a photo already sent:
select snow_review_media((select id from snow_completion_media limit 1), 'hidden');
\echo EXPECT ERROR send a stop that is not completed:
select snow_send_customer_update('50000000-0000-0000-0000-000000000001');
-- LEAD can't review or send
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
\echo EXPECT ERROR lead reviews media:
select snow_review_media((select id from snow_completion_media limit 1), 'hidden');
-- CUSTOMER
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
select 'customer updates', property_name, service, jsonb_array_length(media) from snow_customer_updates();
-- The "done" message comes from update 031 at completion; this contact was linked afterwards, so none here.
select 'customer bell after sharing', count(*) from app_notifications;
select 'customer reads media table directly', count(*) from snow_completion_media;
-- Another plower isn't a contact: no updates
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false) \g /dev/null
select 'non-contact updates', count(*) from snow_customer_updates();
reset role;
