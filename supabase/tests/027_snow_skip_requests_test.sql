\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Fixture: owner (a), plow lead (b), another plower who isn't the lead (d),
-- a shoveler (e), a customer (c). One dispatched plowing storm, one route led
-- by b with three stops. Lines starting EXPECT ERROR are followed by the
-- error the user would get.
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
 ('20000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','Elm Lot','2 Elm St');
insert into snow_storms(id,company_id,name,service) values ('30000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Jan 12 plow','plowing');
insert into snow_routes(id,company_id,storm_id,name,lead_person_id,media_required) values
 ('40000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Route A','10000000-0000-0000-0000-00000000000b',false);
insert into snow_visits(id,route_id,property_id) values
 ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'),
 ('50000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
\echo EXPECT ERROR skip request before dispatch:
select request_snow_skip('50000000-0000-0000-0000-000000000001','Gate locked');
update snow_storms set status='dispatched', dispatched_at=now() where id='30000000-0000-0000-0000-000000000001';

-- LEAD (b)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
\echo EXPECT ERROR skip ahead (stop 2 while stop 1 is open):
select request_snow_skip('50000000-0000-0000-0000-000000000002','Car in the lot');
\echo EXPECT ERROR no reason:
select request_snow_skip('50000000-0000-0000-0000-000000000001','   ');
select 'request 1 created', request_snow_skip('50000000-0000-0000-0000-000000000001','Gate locked','99999999-0000-0000-0000-000000000001') is not null;
-- Double tap / retry: same request back, still only one row.
select request_snow_skip('50000000-0000-0000-0000-000000000001','Gate locked','99999999-0000-0000-0000-000000000001') \g /dev/null
select request_snow_skip('50000000-0000-0000-0000-000000000001','Gate locked again') \g /dev/null
select 'requests on stop 1 after retries', count(*) from snow_skip_requests where visit_id='50000000-0000-0000-0000-000000000001';
reset role;
select 'stop 1 still pending while reviewed', status from snow_visits where id='50000000-0000-0000-0000-000000000001';
set role authenticated;
select 'lead sees own request', count(*), min(status) from snow_skip_requests;
\echo EXPECT ERROR still cannot skip ahead while stop 1 is under review:
select request_snow_skip('50000000-0000-0000-0000-000000000002','Car in the lot');
\echo EXPECT ERROR lead decides own request:
select decide_snow_skip((select id from snow_skip_requests limit 1), true);
\echo EXPECT ERROR lead writes the table directly:
insert into snow_skip_requests(visit_id,reason) values ('50000000-0000-0000-0000-000000000002','direct');
update snow_skip_requests set status='approved';
reset role;
select 'direct lead update did nothing', status from snow_skip_requests where visit_id='50000000-0000-0000-0000-000000000001';
set role authenticated;

-- OTHER PLOWER (d, not the lead) and SHOVELER (e) and CUSTOMER (c)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false) \g /dev/null
\echo EXPECT ERROR non-lead requests a skip:
select request_snow_skip('50000000-0000-0000-0000-000000000001','x');
select 'non-lead plower sees requests', count(*) from snow_skip_requests;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000e',false) \g /dev/null
select 'shoveler sees requests', count(*) from snow_skip_requests;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
select 'customer sees requests', count(*) from snow_skip_requests;
\echo EXPECT ERROR customer decides:
select decide_snow_skip((select id from snow_skip_requests where visit_id='50000000-0000-0000-0000-000000000001' limit 1), true);

-- OWNER denies stop 1 with instructions; stop stays open.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
select 'deny', decide_snow_skip((select id from snow_skip_requests where visit_id='50000000-0000-0000-0000-000000000001'), false, 'Call the manager for the gate code');
select 'deny again (double tap)', decide_snow_skip((select id from snow_skip_requests where visit_id='50000000-0000-0000-0000-000000000001'), false);
\echo EXPECT ERROR approve after deny:
select decide_snow_skip((select id from snow_skip_requests where visit_id='50000000-0000-0000-0000-000000000001'), true);
select 'after deny', status from snow_visits where id='50000000-0000-0000-0000-000000000001';

-- LEAD asks again for stop 1; owner approves → skipped, not completed.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'lead sees denial note', decision_note from snow_skip_requests where status='denied';
select request_snow_skip('50000000-0000-0000-0000-000000000001','Manager not answering') \g /dev/null
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
select 'approve', decide_snow_skip((select id from snow_skip_requests where visit_id='50000000-0000-0000-0000-000000000001' and status='pending'), true);
select 'after approve', status, skipped_at is not null, completed_at is null from snow_visits where id='50000000-0000-0000-0000-000000000001';
select 'completed count excludes skipped', count(*) from snow_visits where status='completed';
select 'stop 3 (same property, later pass) untouched', status from snow_visits where id='50000000-0000-0000-0000-000000000003';

-- LEAD: route moves on to stop 2. Request, then withdraw it.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'withdraw', withdraw_snow_skip(request_snow_skip('50000000-0000-0000-0000-000000000002','Car in the lot'));
-- Request again, then finish the stop anyway: request withdrawn automatically.
select request_snow_skip('50000000-0000-0000-0000-000000000002','Car still there') \g /dev/null
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000002';
reset role;
-- (arrive/complete RPCs belong to update 26; done as admin here.)
update snow_visits set status='arrived' where id='50000000-0000-0000-0000-000000000002';
update snow_visits set status='completed' where id='50000000-0000-0000-0000-000000000002';
select 'request after stop completed', status, decision_note from snow_skip_requests where visit_id='50000000-0000-0000-0000-000000000002' order by created_at desc limit 1;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
\echo EXPECT ERROR skip a completed stop:
select request_snow_skip('50000000-0000-0000-0000-000000000002','late');

-- Reassigning the route: the old lead loses sight of its requests.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
update snow_routes set lead_person_id='10000000-0000-0000-0000-00000000000d' where id='40000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
select 'old lead sees requests', count(*) from snow_skip_requests;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false) \g /dev/null
select 'new lead sees requests', count(*) from snow_skip_requests;
reset role;

select 'history', s.status, s.reason, coalesce(s.decision_note,'-'), p.first_name as requested_by, coalesce(d.first_name,'-') as decided_by
  from snow_skip_requests s left join people p on p.id=s.requested_by left join people d on d.id=s.decided_by order by s.created_at;
select 'activity', action, count(*) from snow_activity_events where action like 'skip.%' or action='visit.skipped' group by action order by action;
