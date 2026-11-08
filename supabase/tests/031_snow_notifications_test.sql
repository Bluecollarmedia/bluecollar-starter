\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: owner, admin, plow worker W, customer C (app account), another
-- company's owner X. Oak Plaza has two contacts: C (app + email) and a
-- property manager with email only. Elm Lot has a contact with neither.
-- Lines starting EXPECT ERROR are followed by the error the user would get.
alter table auth.users disable trigger all;
alter table public.company_members disable trigger all;
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d'),('00000000-0000-0000-0000-00000000000f');
insert into public.companies(id,name) values ('c0000000-0000-0000-0000-000000000001','Brighton'),('c0000000-0000-0000-0000-000000000002','Other');
insert into public.people(id,user_id,first_name) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','Owner'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','Worker'),
 ('10000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000c','Customer'),
 ('10000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000d','Admin'),
 ('10000000-0000-0000-0000-00000000000f','00000000-0000-0000-0000-00000000000f','OtherOwner');
insert into public.company_members(company_id,person_id,role,status) values
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','owner','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','worker','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','customer','active'),
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','admin','active'),
 ('c0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000f','owner','active');
insert into public.snow_staff(company_id,person_id) values ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b');
insert into public.snow_staff_services(company_id,person_id,service) values ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','plowing');

set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
insert into snow_properties(id,company_id,name,address) values
 ('20000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Oak Plaza','1 Oak St'),
 ('20000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','Elm Lot','2 Elm St');
select 'OWNER: new properties get default prefs (arrival off, completion on)', property_id, notify_on_arrival, notify_on_completion from snow_property_notify_prefs order by property_id;
select 'OWNER: per-stop alerts on by default', owner_stop_alerts from snow_settings;
insert into snow_property_services(company_id,property_id,service) values
 ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','plowing'),
 ('c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','plowing');
insert into snow_property_contacts(id,company_id,property_id,name,email,person_id) values
 ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Cara Customer','Cara@Example.com','10000000-0000-0000-0000-00000000000c'),
 ('60000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Pat Manager','pat@example.com',null),
 ('60000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','No Contact Info',null,null);

-- CUSTOMER turns arrival on for their property; can't touch Elm Lot.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
select 'CUSTOMER sees prefs only for own property', count(*) from snow_property_notify_prefs;
select 'CUSTOMER sets arrival on', notify_on_arrival, notify_on_completion from snow_set_notify_prefs('20000000-0000-0000-0000-000000000001', true, null);
\echo EXPECT ERROR customer changing a property they are not a contact of:
select snow_set_notify_prefs('20000000-0000-0000-0000-000000000002', true, true);
\echo EXPECT ERROR customer writing the table directly:
update snow_property_notify_prefs set notify_on_completion=false;
select 'CUSTOMER direct update changed nothing', notify_on_completion from snow_property_notify_prefs;
select 'CUSTOMER sees no notification records', count(*) from snow_notifications;

-- WORKER and OTHER COMPANY can't read or set prefs.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'WORKER sees prefs', count(*) from snow_property_notify_prefs;
\echo EXPECT ERROR worker setting prefs:
select snow_set_notify_prefs('20000000-0000-0000-0000-000000000001', false, false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000f',false) \g /dev/null
\echo EXPECT ERROR other company setting prefs:
select snow_set_notify_prefs('20000000-0000-0000-0000-000000000001', false, false);
\echo EXPECT ERROR app calling the sender-only functions:
select snow_record_delivery(gen_random_uuid(), 'email', 'accepted');

-- OWNER sees the customer's choice and the log entry; storm with Oak twice + Elm.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
select 'OWNER sees customer prefs', notify_on_arrival, notify_on_completion, updated_by from snow_property_notify_prefs where property_id='20000000-0000-0000-0000-000000000001';
select 'OWNER log: prefs change', action, note, after from snow_activity_events where action='notification.prefs_changed';
insert into snow_storms(id,company_id,name,service) values ('30000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Jan 12','plowing');
insert into snow_routes(id,company_id,storm_id,name,lead_person_id,media_required) values
 ('40000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','North','10000000-0000-0000-0000-00000000000b',false);
insert into snow_visits(id,route_id,property_id) values
 ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'),
 ('50000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
select current_setting('request.jwt.claim.sub') as prev_sub \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
select snow_dispatch_storm('30000000-0000-0000-0000-000000000001') \g /dev/null
select set_config('request.jwt.claim.sub', :'prev_sub', false) \g /dev/null

-- Arrival at Oak (pass 1): arrival is on, so both Oak contacts are told. No owner alert for arrivals.
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000001';
select 'ARRIVED pass 1', category, recipient_name, recipient_email, title, body from snow_notifications order by recipient_name;
-- No sender in this test database (no pg_net): pending push/email are marked
-- unavailable instead of left looking like they went out.
select 'ARRIVED deliveries', n.recipient_name, d.channel, d.status, d.provider, (d.detail like 'Sender not set up%') from snow_notification_deliveries d join snow_notifications n on n.id=d.notification_id order by 2,3;
reset role;
select 'ARRIVED in-app copy for the app-account contact only', recipient_id, event_type, linked_entity_type, linked_entity_id, pushed_at is not null from app_notifications;
set role authenticated;

-- Arrival at Elm: arrival is off there, nothing.
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000002';
select 'ELM arrival with arrival pref off', count(*) from snow_notifications where property_id='20000000-0000-0000-0000-000000000002';

-- Completing Oak pass 1: both contacts + owner + admin.
update snow_visits set status='completed' where id='50000000-0000-0000-0000-000000000001';
select 'COMPLETED pass 1', category, coalesce(recipient_name, recipient_person_id::text), title, body from snow_notifications where event='visit.completed' order by 2,3;
-- Double tap / retry: same status again changes nothing.
update snow_visits set status='completed' where id='50000000-0000-0000-0000-000000000001';
select 'COMPLETED again: still', count(*) from snow_notifications where visit_id='50000000-0000-0000-0000-000000000001';

-- Elm completed: its contact has no email and no app account.
update snow_visits set status='completed' where id='50000000-0000-0000-0000-000000000002';
select 'ELM no-destination contact', d.channel, d.status, d.detail from snow_notification_deliveries d join snow_notifications n on n.id=d.notification_id where n.recipient_contact_id='60000000-0000-0000-0000-000000000003';

-- Owner turns per-stop alerts off. Customer notices are not affected.
update snow_settings set owner_stop_alerts=false;
select 'OWNER log: toggle change', action, before, after from snow_activity_events where action='settings.changed';
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000003';
update snow_visits set status='completed' where id='50000000-0000-0000-0000-000000000003';
select 'PASS 2 with alerts off: owner alerts', count(*) from snow_notifications where visit_id='50000000-0000-0000-0000-000000000003' and category='owner_alert';
select 'PASS 2 with alerts off: customer notices still', count(*) from snow_notifications where visit_id='50000000-0000-0000-0000-000000000003' and category='customer';
select 'PASS 2 still completed and logged', v.status, exists(select 1 from snow_activity_events e where e.visit_id=v.id and e.action='visit.completed') from snow_visits v where v.id='50000000-0000-0000-0000-000000000003';

-- End and reopen (through update 024's lifecycle functions): nothing is re-sent; a new pass is a new visit and notifies once.
select count(*) as before_reopen from snow_notifications \gset
select current_setting('request.jwt.claim.sub') as prev_sub \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
select snow_end_storm('30000000-0000-0000-0000-000000000001') \g /dev/null
select set_config('request.jwt.claim.sub', :'prev_sub', false) \g /dev/null
select current_setting('request.jwt.claim.sub') as prev_sub \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
select snow_reopen_storm('30000000-0000-0000-0000-000000000001') \g /dev/null
select set_config('request.jwt.claim.sub', :'prev_sub', false) \g /dev/null
select 'REOPEN re-sent nothing', count(*) = :before_reopen from snow_notifications;
insert into snow_visits(id,route_id,property_id) values ('50000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000004';
update snow_visits set status='completed' where id='50000000-0000-0000-0000-000000000004';
select 'REOPEN new pass notices (customers only, alerts off)', category, count(*) from snow_notifications where visit_id='50000000-0000-0000-0000-000000000004' group by 2;

-- Customer turns completion off: no more completion notices at Oak.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
select 'CUSTOMER turns completion off', notify_on_completion from snow_set_notify_prefs('20000000-0000-0000-0000-000000000001', null, false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
insert into snow_visits(id,route_id,property_id) values ('50000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000005';
update snow_visits set status='completed' where id='50000000-0000-0000-0000-000000000005';
select 'COMPLETION OFF: visit 5 notices by event', event, count(*) from snow_notifications where visit_id='50000000-0000-0000-0000-000000000005' group by 2;
select 'OWNER log: customer notices are logged', count(*) > 0 from snow_activity_events where action='notification.created';
\echo EXPECT ERROR owner writing records directly:
insert into snow_notifications(company_id,category,event,title,dedupe_key) values ('c0000000-0000-0000-0000-000000000001','customer','visit.completed','fake','x');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000f',false) \g /dev/null
select 'OTHER COMPANY sees records', (select count(*) from snow_notifications), (select count(*) from snow_notification_deliveries), (select count(*) from snow_property_notify_prefs);

-- SENDER (service role) with pg_net present: rows stay pending until the
-- sender reports; it can claim once and record each channel once.
reset role;
create schema if not exists net;
create table net.calls(url text, body jsonb);
create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as $$ insert into net.calls values (url, body); select 1::bigint $$;
insert into app_settings(key,value) values ('functions_url','https://example.supabase.co/functions/v1') on conflict (key) do update set value=excluded.value;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
select 'CUSTOMER turns completion back on', notify_on_completion from snow_set_notify_prefs('20000000-0000-0000-0000-000000000001', null, true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
update snow_settings set owner_stop_alerts=true;
insert into snow_visits(id,route_id,property_id) values ('50000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000006';
update snow_visits set status='completed' where id='50000000-0000-0000-0000-000000000006';
reset role;
select 'SENDER asked once per notification', count(*), count(distinct body->>'id'), min(url) from net.calls;
select 'PENDING before the sender answers', d.channel, d.status, count(*) from snow_notification_deliveries d join snow_notifications n on n.id=d.notification_id where n.visit_id='50000000-0000-0000-0000-000000000006' group by 2,3 order by 2,3;
set role service_role;
select n.id as pat_id from snow_notifications n where n.visit_id='50000000-0000-0000-0000-000000000006' and n.recipient_contact_id='60000000-0000-0000-0000-000000000002' and n.event='visit.completed' \gset
select 'SENDER claim 1', count(*) from snow_claim_notification(:'pat_id');
select 'SENDER claim 2 (retry)', count(*) from snow_claim_notification(:'pat_id');
select snow_record_delivery(:'pat_id', 'email', 'accepted', 'resend-msg-123', null) \g /dev/null
select snow_record_delivery(:'pat_id', 'email', 'failed', null, 'late duplicate') \g /dev/null
select 'SENDER recorded once', channel, status, provider_ref, detail from snow_notification_deliveries where notification_id=:'pat_id';
reset role;
select 'SENDER result logged', action, after->>'channel' from snow_activity_events where entity_id=:'pat_id' and action like 'notification.%' order by occurred_at;
