-- ============================================================================
-- DEMO COMPANY for the App Store reviewers.  Run in Supabase -> SQL Editor with plain "Run" (runs as postgres).
-- NOT a numbered update: it is data, not schema. Safe to run again: each run FIRST removes the previous demo company and the 4 demo
-- logins, then recreates everything fresh (dates are re-based on "now", so re-running also refreshes the dates).
--
-- LOGINS (email + password sign-in, all confirmed):
--     demo-owner@brightonlawn.com      owner
--     demo-worker@brightonlawn.com     landscaping + lawn-maintenance worker
--     demo-snow@brightonlawn.com       worker on the Snow team (plowing / shoveling / salting), leads the demo snow route
--     demo-customer@brightonlawn.com   customer (a project, a lawn property and a snow property)
--     Password for all four: set on the next line (change it there, once).
--
-- WHAT IT TOUCHES (and nothing else): the company named exactly 'Demo Landscaping Co.' (only if its owner is demo-owner@...), the people
-- who belong ONLY to that company, and the 4 auth.users / auth.identities rows above. Real data is never matched.
--
-- Things to know:
--  * The app is built around one company. This script adds the demo company NEXT TO your real one (it uses the same "admin script"
--    switch as reset_all_test_data.sql: app.allow_company_create). Everyone only ever sees their own company's rows, so the real company
--    is not visible to the demo logins and vice versa. The demo team code is switched OFF, so nobody can join the demo company by code.
--  * Photos: SQL cannot upload files. Project and lawn-visit photos point at https://placehold.co/ pictures, which display normally.
--    Snow completion photos are private files that the app opens by their storage key, so the Snow visits have photo ROWS (counts, sent
--    to the customer) whose image files do not exist unless you upload files at those keys to the snow-media bucket
--    ( <company id>/completion/<visit id>/demo-1.jpg ). Without the files the Snow history shows the visits with empty photo tiles.
--  * Snow storm stamps (dispatched / ended) are written by the database at the moment you run this; the stop arrival/completion times
--    are set to about two days ago.
--  * Outgoing mail: the demo customer contact has no email address on purpose, so no email is ever queued to these addresses.
-- ============================================================================

begin;

  -- The one shared password (change it here).
  set local demo.password = 'BrightonDemo2026!';
  -- Same escape hatches the repo's admin scripts use (the one-company rule, and the company delete lock). Both last for this transaction only.
  set local app.allow_company_delete = 'on';
  set local app.allow_company_create = 'on';

  -- ══ 1. Remove the previous demo company and logins (only ever the demo ones) ═══════════════════════════════════════════════════
  do $cleanup$
  declare
    v_name   constant text   := 'Demo Landscaping Co.';
    v_emails constant text[] := array['demo-owner@brightonlawn.com', 'demo-worker@brightonlawn.com', 'demo-snow@brightonlawn.com', 'demo-customer@brightonlawn.com'];
    v_cids uuid[]; v_uids uuid[]; v_pids uuid[]; t text;
  begin
    -- A company with the demo name that is not the demo owner's is somebody else's: stop instead of touching it.
    if exists (
      select 1 from public.companies c
       where c.name = v_name
         and not exists (select 1 from public.company_members m join public.people p on p.id = m.person_id
                          where m.company_id = c.id and m.role = 'owner' and lower(p.email) = v_emails[1])
    ) then
      raise exception 'A company named "%" exists that is not the demo company (its owner is not %). Nothing was changed.', v_name, v_emails[1];
    end if;

    select coalesce(array_agg(c.id), '{}') into v_cids from public.companies c where c.name = v_name;
    select coalesce(array_agg(u.id), '{}') into v_uids from auth.users u where lower(u.email) = any (v_emails);

    -- The people to remove: the demo logins' people and anyone who belongs to the demo company, but never someone who is also in another company.
    select coalesce(array_agg(distinct p.id), '{}') into v_pids
      from public.people p
     where (lower(p.email) = any (v_emails) or p.user_id = any (v_uids)
            or exists (select 1 from public.company_members m where m.person_id = p.id and m.company_id = any (v_cids)))
       and not exists (select 1 from public.company_members m2 where m2.person_id = p.id and not (m2.company_id = any (v_cids)));

    if cardinality(v_cids) > 0 then
      -- Same approach as delete_my_company(): the "user" triggers on the company's tables (Snow's keep-history guards, activity log,
      -- file-cleanup queue) are switched off for this one transaction while the company's rows cascade away, and switched back on after.
      for t in
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
         where c.relkind = 'r' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
      loop
        execute format('alter table public.%I disable trigger user', t);
      end loop;

      delete from public.companies where id = any (v_cids);

      for t in
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
         where c.relkind = 'r' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
      loop
        execute format('alter table public.%I enable trigger user', t);
      end loop;

      if exists (select 1 from public.companies where id = any (v_cids)) then
        raise exception 'The previous demo company could not be removed.';
      end if;
    end if;

    delete from public.people where id = any (v_pids);
    delete from auth.identities where user_id = any (v_uids);
    delete from auth.users where id = any (v_uids);

    perform set_config('app.allow_company_delete', 'off', true);   -- the delete lock is back on for the rest of this script
  end
  $cleanup$;

  -- ══ 2. Create the demo company, logins and data ═════════════════════════════════════════════════════════════════════════════════
  do $demo$
  declare
    v_pw text := current_setting('demo.password');
    v_now timestamptz := now();
    v_today date := current_date;
    r record;
    v_uid uuid;
    -- people
    p_owner uuid; p_worker uuid; p_snow uuid; p_cust uuid; p_luis uuid;
    u_owner uuid; u_worker uuid; u_snow uuid; u_cust uuid;
    v_co uuid;
    v_t1 uuid; v_t2 uuid;
    v_prop uuid;
    pj1 uuid; pj2 uuid; pj3 uuid;
    v_task uuid; v_photo uuid; v_photo2 uuid; v_ids text[];
    d int;
    v_wd uuid; v_tv uuid;
    -- lawn
    mp uuid; mc uuid; rule1 uuid; rule2 uuid; rt uuid; stp uuid; tk uuid; tk2 uuid;
    -- snow
    sp1 uuid; sp2 uuid; sp3 uuid; storm1 uuid; storm2 uuid; route1 uuid; route2 uuid;
    vis record; v_base timestamptz; i int; ph text;
  begin
    -- ── 2a. The 4 logins. The signup trigger on auth.users (handle_new_user) makes each person from the name in raw_user_meta_data. ──
    for r in
      select * from (values
        (1, 'demo-owner@brightonlawn.com',    'Daniel',  'Whitaker', '7325550142'),
        (2, 'demo-worker@brightonlawn.com',   'Marcus',  'Bell',     '7325550143'),
        (3, 'demo-snow@brightonlawn.com',     'Tony',    'Alvarez',  '7325550144'),
        (4, 'demo-customer@brightonlawn.com', 'Sarah',   'Mitchell', '7325550145')
      ) as x(n, email, first_name, last_name, phone)
    loop
      v_uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
        phone_change, phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', r.email,
        crypt(v_pw, gen_salt('bf')), v_now - interval '30 days',
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('first_name', r.first_name, 'last_name', r.last_name, 'phone', r.phone, 'email_verified', true),
        v_now - interval '30 days', v_now,
        '', '', '', '', '', '', '', ''
      );
      insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_uid::text, v_uid,
              jsonb_build_object('sub', v_uid::text, 'email', r.email, 'email_verified', true, 'phone_verified', false),
              'email', null, v_now - interval '30 days', v_now);
      if r.n = 1 then u_owner := v_uid; elsif r.n = 2 then u_worker := v_uid; elsif r.n = 3 then u_snow := v_uid; else u_cust := v_uid; end if;
    end loop;
    select id into p_owner  from public.people where user_id = u_owner;
    select id into p_worker from public.people where user_id = u_worker;
    select id into p_snow   from public.people where user_id = u_snow;
    select id into p_cust   from public.people where user_id = u_cust;
    if p_owner is null or p_worker is null or p_snow is null or p_cust is null then
      raise exception 'The signup trigger did not create all four people.';
    end if;
    -- One more crew member who has no login (so the team lists have more than one worker).
    insert into public.people (email, first_name, last_name, phone) values ('', 'Luis', 'Ortega', '7325550146') returning id into p_luis;

    -- ── 2b. The company (same function the app's "Create a Company" uses), finished setting up ──
    v_co := public._create_company(p_owner, jsonb_build_object(
      'company_name', 'Demo Landscaping Co.', 'company_phone', '(732) 555-0142', 'company_email', 'demo-owner@brightonlawn.com',
      'company_address', '120 Maple Street', 'company_city', 'Pine Hollow', 'company_state', 'NJ', 'company_zip', '08999'));
    update public.companies set
      yard_address = '120 Maple Street', yard_city = 'Pine Hollow', yard_state = 'NJ', yard_zip = '08999',
      yard_latitude = 40.2206, yard_longitude = -74.0121,
      setup_state = jsonb_build_object('done', true, 'completed', true, 'demo', true),
      setup_completed_at = v_now - interval '30 days',
      created_at = v_now - interval '30 days'
    where id = v_co;
    -- Nobody can join the demo company with a team code.
    update public.team_codes set is_active = false, deactivated_at = v_now where company_id = v_co;
    update public.company_join_settings set join_by_code_enabled = false where company_id = v_co;
    insert into public.time_settings (company_id) values (v_co) on conflict do nothing;

    -- ── 2c. Team: workers, snow worker, customer ──
    insert into public.company_members (company_id, person_id, role, status, join_method, approved_by, approved_at, works_landscaping, works_maintenance) values
      (v_co, p_worker, 'worker',   'active', 'team_code',       p_owner, v_now - interval '28 days', true,  true),
      (v_co, p_snow,   'worker',   'active', 'team_code',       p_owner, v_now - interval '28 days', true,  false),
      (v_co, p_luis,   'worker',   'active', 'team_code',       p_owner, v_now - interval '28 days', true,  false),
      (v_co, p_cust,   'customer', 'active', 'invitation_link', p_owner, v_now - interval '20 days', true,  false);
    -- New workers are put on the Snow team automatically (update 113). Only the snow worker keeps that: the others are plain landscaping workers.
    delete from public.snow_staff_services where company_id = v_co and person_id in (p_worker, p_luis);
    delete from public.snow_staff where company_id = v_co and person_id in (p_worker, p_luis);
    update public.snow_staff set granted_by = p_owner where company_id = v_co and person_id = p_snow;

    -- ── 2d. Trucks ──
    insert into public.trucks (company_id, name, make, model, year, license_plate, color, status, assigned_to, notes)
    values (v_co, 'Truck 1', 'Ford', 'F-250', 2021, 'DEMO-101', 'White', 'assigned', p_worker, 'Crew truck. Dump trailer hitch.') returning id into v_t1;
    insert into public.trucks (company_id, name, make, model, year, license_plate, color, status, notes)
    values (v_co, 'Truck 2 (plow)', 'Chevrolet', 'Silverado 2500', 2020, 'DEMO-102', 'Blue', 'available', 'Has the plow mount.') returning id into v_t2;

    -- ── 2e. The customer's property (one place shared by the project, the lawn service and snow) ──
    insert into public.properties (company_id, customer_id, name, address, city, state, zip, latitude, longitude, created_by)
    values (v_co, p_cust, 'Mitchell Residence', '48 Willow Lane', 'Pine Hollow', 'NJ', '08999', 40.2251, -74.0074, p_owner) returning id into v_prop;

    -- ── 2f. Projects ──
    -- 1) Active job for the customer: tasks partly done, a Task Lead, a crew.
    insert into public.projects (company_id, customer_id, property_id, name, address, city, state, zip, latitude, longitude, status, start_date, estimated_end_date,
                                 notes, cover_photo_url, customer_claimed_by, customer_claimed_at, task_lead_id, created_at)
    values (v_co, p_cust, v_prop, 'Mitchell Backyard Patio & Planting', '48 Willow Lane', 'Pine Hollow', 'NJ', '08999', 40.2251, -74.0074, 'active',
            v_today - 12, v_today + 9,
            'New 16x14 paver patio with seat wall, shrub and perennial beds along the back fence. Customer wants a gas line stub for a future fire pit.',
            'https://placehold.co/1200x700/7CB342/FFFFFF/png?text=Mitchell+Patio',
            p_cust, v_now - interval '12 days', p_worker, v_now - interval '14 days')
    returning id into pj1;
    -- 2) Finished job (no customer account).
    insert into public.projects (company_id, name, address, city, state, zip, latitude, longitude, status, progress, start_date, estimated_end_date, completed_at, notes,
                                 cover_photo_url, created_at)
    values (v_co, 'Oak Ridge Drainage & Regrade', '9 Oak Ridge Road', 'Pine Hollow', 'NJ', '08999', 40.2301, -74.0201, 'completed', 100, v_today - 40, v_today - 25, v_now - interval '24 days',
            'French drain along the north side and regrade to keep water away from the foundation.',
            'https://placehold.co/1200x700/1B3A2D/FFFFFF/png?text=Oak+Ridge+Drainage', v_now - interval '45 days')
    returning id into pj2;
    -- 3) A job on hold.
    insert into public.projects (company_id, name, address, city, state, zip, latitude, longitude, status, start_date, estimated_end_date, notes, cover_photo_url, created_at)
    values (v_co, 'Walker Retaining Wall', '17 Cedar Court', 'Pine Hollow', 'NJ', '08999', 40.2188, -74.0155, 'on_hold', v_today + 21, v_today + 35,
            'Waiting on the permit and the customer''s final block choice.',
            'https://placehold.co/1200x700/8D6E63/FFFFFF/png?text=Walker+Wall', v_now - interval '10 days')
    returning id into pj3;

    insert into public.project_settings (company_id, project_id, customer_interaction_enabled, customer_can_request, customer_can_view_photos, customer_can_comment)
    select v_co, x, true, true, true, true from unnest(array[pj1, pj2, pj3]) x;

    insert into public.project_team (company_id, project_id, person_id, added_at) values
      (v_co, pj1, p_worker, v_now - interval '12 days'), (v_co, pj1, p_luis, v_now - interval '12 days'),
      (v_co, pj2, p_worker, v_now - interval '40 days');

    -- Tasks, project 1 (status order: done, done, working, then waiting). The database stamps completed_at/by itself.
    insert into public.project_tasks (company_id, project_id, title, description, status, sort_order, assigned_to, created_at) values
      (v_co, pj1, 'Site layout and excavation',      'Mark the patio footprint, call 811, dig 8 inches.',                     'completed',   1, p_worker, v_now - interval '14 days'),
      (v_co, pj1, 'Install compacted gravel base',   '4 inches of crushed stone, compacted in two lifts.',                    'completed',   2, p_worker, v_now - interval '14 days'),
      (v_co, pj1, 'Lay patio pavers',                'Running bond pattern, cut around the downspout.',                       'in_progress', 3, p_worker, v_now - interval '14 days'),
      (v_co, pj1, 'Build seat wall',                 'Two courses of wall block with cap.',                                    'pending',     4, p_luis,   v_now - interval '14 days'),
      (v_co, pj1, 'Plant shrubs and perennials',     'Back fence bed: hydrangea, boxwood, coneflower.',                       'pending',     5, p_luis,   v_now - interval '14 days'),
      (v_co, pj1, 'Mulch and final cleanup',         'Three inches of hardwood mulch, blow off the patio, walkthrough.',      'pending',     6, p_worker, v_now - interval '14 days');
    insert into public.project_tasks (company_id, project_id, title, status, sort_order, assigned_to, created_at) values
      (v_co, pj2, 'Trench and lay perforated pipe', 'completed', 1, p_worker, v_now - interval '44 days'),
      (v_co, pj2, 'Backfill with drainage stone',   'completed', 2, p_worker, v_now - interval '44 days'),
      (v_co, pj2, 'Regrade and seed',               'completed', 3, p_worker, v_now - interval '44 days');
    insert into public.project_tasks (company_id, project_id, title, status, sort_order, created_at) values
      (v_co, pj3, 'Pull permit',                 'pending', 1, v_now - interval '10 days'),
      (v_co, pj3, 'Confirm block color with customer', 'pending', 2, v_now - interval '10 days');
    update public.projects set progress = 100 where id = pj2;   -- the progress trigger leaves finished projects alone, but be explicit

    -- Photos (placehold.co stand-ins, see the note at the top). Shared = visible to the customer; internal = staff only.
    insert into public.project_photos (company_id, project_id, uploaded_by, file_url, caption, customer_description, is_customer_visible, shared_by, shared_at, photo_type, taken_at)
    values
      (v_co, pj1, p_worker, 'https://placehold.co/800x600/8D6E63/FFFFFF/png?text=Before+-+Backyard', 'Before', 'The backyard before we started.', true,  p_owner, v_now - interval '12 days', 'before',   v_now - interval '12 days'),
      (v_co, pj1, p_worker, 'https://placehold.co/800x600/9E9E9E/FFFFFF/png?text=Gravel+Base',       'Base compacted', 'Gravel base is down and compacted.', true,  p_owner, v_now - interval '9 days', 'progress', v_now - interval '9 days'),
      (v_co, pj1, p_worker, 'https://placehold.co/800x600/7CB342/FFFFFF/png?text=Pavers+Going+Down', 'First pavers', 'Pavers going down in a running bond.',  true,  p_owner, v_now - interval '2 days', 'progress', v_now - interval '2 days'),
      (v_co, pj1, p_luis,   'https://placehold.co/800x600/E53935/FFFFFF/png?text=Gas+Line+Marked',   'Gas line marked - keep clear of the trench', null, false, null, null, 'issue', v_now - interval '11 days'),
      (v_co, pj1, p_worker, 'https://placehold.co/800x600/607D8B/FFFFFF/png?text=Material+Delivery', 'Pallets of pavers delivered', null, false, null, null, 'general', v_now - interval '8 days'),
      (v_co, pj2, p_worker, 'https://placehold.co/800x600/8D6E63/FFFFFF/png?text=Before+-+Wet+Yard', 'Before', 'Standing water along the north side.', true, p_owner, v_now - interval '40 days', 'before', v_now - interval '40 days'),
      (v_co, pj2, p_worker, 'https://placehold.co/800x600/7CB342/FFFFFF/png?text=After+-+Regraded',  'After',  'Regraded and seeded.', true, p_owner, v_now - interval '24 days', 'after',  v_now - interval '24 days');

    select array_agg(id::text order by taken_at) into v_ids from public.project_photos where project_id = pj1 and is_customer_visible;
    insert into public.project_updates (company_id, project_id, created_by, title, body, is_customer_visible, photo_ids, created_at) values
      (v_co, pj1, p_owner, 'Excavation and base are done',  'The footprint is dug and the gravel base is down and compacted. Pavers start tomorrow.', true, v_ids[1:2], v_now - interval '9 days'),
      (v_co, pj1, p_owner, 'Pavers are going down',         'The crew started laying the pavers today. We expect to finish the patio surface by the end of the week.', true, v_ids[3:3], v_now - interval '2 days'),
      (v_co, pj1, p_owner, 'Internal: order wall block',    'Order seat-wall block by Thursday so it arrives before the patio is done.', false, '{}', v_now - interval '1 day');

    insert into public.customer_timeline (company_id, project_id, event_type, title, description, photo_url, "timestamp") values
      (v_co, pj1, 'project_started',   'Your project is confirmed', 'Work begins on your backyard patio.', null, v_now - interval '12 days'),
      (v_co, pj1, 'photo_shared',      'New photos from the crew',  'Gravel base is down and compacted.', 'https://placehold.co/800x600/9E9E9E/FFFFFF/png?text=Gravel+Base', v_now - interval '9 days'),
      (v_co, pj1, 'progress_updated',  'Progress is at 42%',        'Excavation and base are complete; pavers are next.', null, v_now - interval '5 days'),
      (v_co, pj1, 'update_shared',     'Pavers are going down',     'The crew started laying the pavers today.', null, v_now - interval '2 days'),
      (v_co, pj2, 'project_completed', 'Project completed',         'Drainage and regrade are finished.', null, v_now - interval '24 days');

    insert into public.project_history (company_id, project_id, actor_id, event_type, description, created_at) values
      (v_co, pj1, p_owner,  'project_created',  'Project created', v_now - interval '14 days'),
      (v_co, pj1, p_worker, 'task_completed',   'Completed: Site layout and excavation', v_now - interval '10 days'),
      (v_co, pj1, p_worker, 'task_completed',   'Completed: Install compacted gravel base', v_now - interval '9 days'),
      (v_co, pj1, p_worker, 'task_started',     'Started: Lay patio pavers', v_now - interval '2 days');

    insert into public.project_messages (company_id, project_id, sender_id, body, created_at) values
      (v_co, pj1, p_cust,  'Hi Daniel, the crew has been great. Is it okay if the pavers are a little lighter than the sample?', v_now - interval '6 days'),
      (v_co, pj1, p_owner, 'Hi Sarah, thanks! The pavers are a touch lighter when dry; they darken a bit once sealed. I will send a photo tomorrow.', v_now - interval '6 days' + interval '2 hours'),
      (v_co, pj1, p_cust,  'Perfect, thank you. Also, can we add a stub for a gas fire pit later?', v_now - interval '5 days'),
      (v_co, pj1, p_owner, 'Yes, we marked the line and left a sleeve under the patio so it is easy to add later.', v_now - interval '5 days' + interval '1 hour');

    insert into public.project_requests (company_id, project_id, requested_by, title, description, category, status, created_at)
    values (v_co, pj1, p_cust, 'Add a lighting circuit', 'Could we add low-voltage lights along the seat wall?', 'additional_work', 'pending', v_now - interval '3 days');

    insert into public.announcements (company_id, created_by, title, body, audience, priority, created_at) values
      (v_co, p_owner, 'Safety reminder', 'Hi-vis vests on at every job site, and call 811 before any digging. Thanks, team.', 'all_workers', 'normal', v_now - interval '4 days'),
      (v_co, p_owner, 'Fall cleanup scheduling', 'We are booking leaf cleanups for the next few weeks. Reply to your crew lead with any date you prefer.', 'customers_all', 'normal', v_now - interval '2 days');

    -- ── 2g. Schedule: finished days, today, and later this week ──
    for d in 1..3 loop
      insert into public.assignments (company_id, project_id, person_id, scheduled_date, start_time, end_time, status, confirmation_state, truck_id, sort_order, notes)
      values (v_co, pj1, p_worker, v_today - d, '07:00', '15:00', 'completed', 'confirmed', v_t1, 1, 'Mitchell patio'),
             (v_co, pj1, p_luis,   v_today - d, '07:00', '15:00', 'completed', 'confirmed', v_t1, 2, 'Mitchell patio');
    end loop;
    insert into public.assignments (company_id, project_id, person_id, scheduled_date, start_time, end_time, status, confirmation_state, truck_id, sort_order, notes) values
      (v_co, pj1, p_worker, v_today,     '07:00', '15:00', 'scheduled', 'confirmed', v_t1, 1, 'Finish laying pavers on the east half.'),
      (v_co, pj1, p_luis,   v_today,     '07:00', '15:00', 'scheduled', 'confirmed', v_t1, 2, 'Finish laying pavers on the east half.'),
      (v_co, pj1, p_worker, v_today + 1, '07:00', '15:00', 'scheduled', 'awaiting',  v_t1, 1, 'Start the seat wall.'),
      (v_co, pj1, p_luis,   v_today + 1, '07:00', '15:00', 'scheduled', 'awaiting',  v_t1, 2, 'Start the seat wall.'),
      (v_co, pj1, p_snow,   v_today + 2, '08:00', '14:00', 'scheduled', 'awaiting',  v_t1, 1, 'Plant the back fence bed.'),
      (v_co, pj1, p_worker, v_today + 2, '07:00', '15:00', 'scheduled', 'awaiting',  v_t1, 2, 'Plant the back fence bed.'),
      (v_co, pj1, p_worker, v_today + 3, '07:00', '12:00', 'scheduled', 'not_sent',  v_t1, 1, 'Mulch and final cleanup.');

    -- ── 2h. Time clock history for the worker (the last three workdays) ──
    for d in 1..3 loop
      insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status, truck_id, truck_source)
      values (v_co, p_worker, v_today - d, (v_today - d)::timestamptz + interval '7 hours' + interval '2 minutes', (v_today - d)::timestamptz + interval '15 hours' + interval '9 minutes', 'closed', v_t1, 'owner')
      returning id into v_wd;
      insert into public.time_visits (company_id, source, project_id, visit_date, label, status, started_at, ended_at, billable)
      values (v_co, 'project_day', pj1, v_today - d, 'Mitchell Backyard Patio & Planting', 'completed',
              (v_today - d)::timestamptz + interval '7 hours' + interval '20 minutes', (v_today - d)::timestamptz + interval '14 hours' + interval '40 minutes', true)
      returning id into v_tv;
      insert into public.time_intervals (company_id, visit_id, workday_id, person_id, started_at, ended_at, billable)
      values (v_co, v_tv, v_wd, p_worker, (v_today - d)::timestamptz + interval '7 hours' + interval '20 minutes', (v_today - d)::timestamptz + interval '14 hours' + interval '40 minutes', true);
    end loop;

    -- ── 2i. Lawn maintenance for the customer (the chain: property -> contract -> service rules -> routes -> stops) ──
    insert into public.maintenance_properties (company_id, name, customer_id, property_id, address, city, state, zip, latitude, longitude, checkin_radius_m, access_notes, notes, created_by)
    values (v_co, 'Mitchell Residence', p_cust, v_prop, '48 Willow Lane', 'Pine Hollow', 'NJ', '08999', 40.2251, -74.0074, 150,
            'Side gate is unlocked. Dog in the backyard: knock first.', 'Cut at 3 inches. Customer likes clean edges along the driveway.', p_owner)
    returning id into mp;
    insert into public.maintenance_contracts (company_id, property_id, name, status, season_start, season_end, created_by)
    values (v_co, mp, 'Season contract', 'active', make_date(extract(year from v_today)::int, 4, 1), make_date(extract(year from v_today)::int, 11, 30), p_owner)
    returning id into mc;
    insert into public.maintenance_service_rules (company_id, contract_id, property_id, service_type, label, frequency, starts_on, season_quantity, prior_completed_count, last_completed_on,
                                                  requires_photos, min_photos, default_checklist, instructions, sort_order)
    values (v_co, mc, mp, 'lawn_cut', 'Lawn cut', 'weekly', v_today - 90, 30, 28, v_today - 7, true, 2,
            '["Blow off driveway and walks", "Trim edges"]'::jsonb, 'Mow, trim and blow off hard surfaces.', 1)
    returning id into rule1;
    insert into public.maintenance_service_rules (company_id, contract_id, property_id, service_type, label, frequency, interval_days, starts_on, prior_completed_count, requires_photos, min_photos,
                                                  default_checklist, sort_order)
    values (v_co, mc, mp, 'leaf_cleanup', 'Leaf cleanup', 'every_n_days', 14, v_today - 14, 1, false, 1, '["Bag leaves from the beds"]'::jsonb, 2)
    returning id into rule2;

    -- Two finished visits (7 and 14 days ago) with photos the owner shared, plus the next planned visit.
    foreach d in array array[14, 7] loop
      insert into public.maintenance_routes (company_id, service_date, name, lead_person_id, status, created_by, truck_id)
      values (v_co, v_today - d, 'Lawn route', p_worker, 'completed', p_owner, v_t1) returning id into rt;
      insert into public.maintenance_route_crew (company_id, route_id, person_id, added_by) values (v_co, rt, p_worker, p_owner);
      insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order, status, requires_photos, min_photos, arrived_at, arrived_by, arrival_location_status,
                                            completed_at, completed_by, completion_location_status, completion_note)
      values (v_co, rt, mp, mc, 1, 'completed', true, 2,
              (v_today - d)::timestamptz + interval '9 hours', p_worker, 'verified',
              (v_today - d)::timestamptz + interval '9 hours 50 minutes', p_worker, 'verified', 'All done. Edges are sharp.')
      returning id into stp;
      insert into public.maintenance_stop_services (company_id, route_id, stop_id, property_id, rule_id, service_type, label, completed, completed_at)
      values (v_co, rt, stp, mp, rule1, 'lawn_cut', 'Lawn cut', true, (v_today - d)::timestamptz + interval '9 hours 50 minutes');
      insert into public.maintenance_stop_tasks (company_id, route_id, stop_id, title, is_required, sort_order, completed_at, completed_by)
      values (v_co, rt, stp, 'Blow off driveway and walks', true, 1, (v_today - d)::timestamptz + interval '9 hours 45 minutes', p_worker) returning id into tk;
      insert into public.maintenance_stop_tasks (company_id, route_id, stop_id, title, is_required, sort_order, completed_at, completed_by)
      values (v_co, rt, stp, 'Trim edges', true, 2, (v_today - d)::timestamptz + interval '9 hours 40 minutes', p_worker) returning id into tk2;
      insert into public.maintenance_photos (company_id, route_id, stop_id, property_id, uploaded_by, file_url, file_key, caption, is_customer_visible, shared_by, shared_at, taken_at, time_phase, task_id)
      values (v_co, rt, stp, mp, p_worker, 'https://placehold.co/800x600/8D6E63/FFFFFF/png?text=Lawn+Before', '', 'Before', true, p_owner, (v_today - d)::timestamptz + interval '11 hours', (v_today - d)::timestamptz + interval '9 hours 2 minutes', 'start', null),
             (v_co, rt, stp, mp, p_worker, 'https://placehold.co/800x600/7CB342/FFFFFF/png?text=Lawn+After',  '', 'After',  true, p_owner, (v_today - d)::timestamptz + interval '11 hours', (v_today - d)::timestamptz + interval '9 hours 48 minutes', 'complete', null),
             (v_co, rt, stp, mp, p_worker, 'https://placehold.co/800x600/558B2F/FFFFFF/png?text=Edges+Trimmed', '', 'Edges', true, p_owner, (v_today - d)::timestamptz + interval '11 hours', (v_today - d)::timestamptz + interval '9 hours 42 minutes', null, tk2),
             (v_co, rt, stp, mp, p_worker, 'https://placehold.co/800x600/607D8B/FFFFFF/png?text=Internal+Gate+Note', '', 'Gate latch is loose (staff only)', false, null, null, (v_today - d)::timestamptz + interval '9 hours 5 minutes', null, null);
      insert into public.maintenance_events (company_id, route_id, stop_id, person_id, event_type, occurred_at, location_status, distance_m)
      values (v_co, rt, stp, p_worker, 'arrived',   (v_today - d)::timestamptz + interval '9 hours', 'verified', 12),
             (v_co, rt, stp, p_worker, 'completed', (v_today - d)::timestamptz + interval '9 hours 50 minutes', 'verified', 9);
    end loop;
    -- Next planned visit (a few days out; this is what the customer's "Next visit" shows).
    insert into public.maintenance_routes (company_id, service_date, name, lead_person_id, status, created_by, truck_id)
    values (v_co, v_today + 4, 'Lawn route', p_worker, 'planned', p_owner, v_t1) returning id into rt;
    insert into public.maintenance_route_crew (company_id, route_id, person_id, added_by) values (v_co, rt, p_worker, p_owner);
    insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order, status, requires_photos, min_photos)
    values (v_co, rt, mp, mc, 1, 'pending', true, 2) returning id into stp;
    insert into public.maintenance_stop_services (company_id, route_id, stop_id, property_id, rule_id, service_type, label) values (v_co, rt, stp, mp, rule1, 'lawn_cut', 'Lawn cut');
    insert into public.maintenance_stop_tasks (company_id, route_id, stop_id, title, is_required, sort_order) values (v_co, rt, stp, 'Blow off driveway and walks', true, 1), (v_co, rt, stp, 'Trim edges', true, 2);

    -- ── 2j. Snow: properties, services, contacts ──
    insert into public.snow_properties (company_id, name, address, city, state, zip, latitude, longitude, notes, property_id, created_by)
    values (v_co, 'Mitchell Residence', '48 Willow Lane', 'Pine Hollow', 'NJ', '08999', 40.2251, -74.0074, 'Long driveway. Pile snow on the right side by the fence.', v_prop, p_owner)
    returning id into sp1;
    insert into public.snow_properties (company_id, name, address, city, state, zip, latitude, longitude, notes, created_by)
    values (v_co, 'Pine Hollow Dental Office', '210 Main Street', 'Pine Hollow', 'NJ', '08999', 40.2290, -74.0100, 'Clear the lot before 7 AM. Salt the front steps.', p_owner) returning id into sp2;
    insert into public.snow_properties (company_id, name, address, city, state, zip, latitude, longitude, notes, created_by)
    values (v_co, 'Harbor Glen Library', '5 Library Plaza', 'Pine Hollow', 'NJ', '08999', 40.2320, -74.0140, 'Do not pile snow on the book-drop side.', p_owner) returning id into sp3;
    insert into public.snow_property_services (company_id, property_id, service, is_active, created_by) values
      (v_co, sp1, 'plowing', true, p_owner), (v_co, sp1, 'salting', true, p_owner),
      (v_co, sp2, 'plowing', true, p_owner), (v_co, sp2, 'salting', true, p_owner),
      (v_co, sp3, 'plowing', true, p_owner);
    -- The customer is the contact for their Snow property (this is what gives them the Snow tab). No email address on purpose, see the top.
    insert into public.snow_property_contacts (company_id, property_id, name, phone, person_id, is_primary, created_by)
    values (v_co, sp1, 'Sarah Mitchell', '7325550145', p_cust, true, p_owner);
    insert into public.snow_property_contacts (company_id, property_id, name, title, phone, is_primary, created_by) values
      (v_co, sp2, 'Front Desk', 'Office manager', '7325550150', true, p_owner),
      (v_co, sp3, 'Facilities', 'Building supervisor', '7325550151', true, p_owner);

    -- ── 2k. Snow: a finished storm (a route with three completed stops, photos sent to the customers) ──
    insert into public.snow_storms (company_id, name, service, services, status, notes, created_by, created_at)
    values (v_co, 'Winter Storm Atlas', 'plowing', array['plowing'], 'draft', '6-8 inches overnight. Plow once the snow stops.', p_owner, v_now - interval '3 days')
    returning id into storm1;
    insert into public.snow_routes (company_id, storm_id, service, name, position, lead_person_id, media_required, min_media, created_by)
    values (v_co, storm1, 'plowing', 'Route A - Downtown', 1, p_snow, true, 1, p_owner) returning id into route1;
    insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, position, status, created_by) values
      (v_co, storm1, route1, sp1, 'plowing', 1, 'pending', p_owner),
      (v_co, storm1, route1, sp2, 'plowing', 2, 'pending', p_owner),
      (v_co, storm1, route1, sp3, 'plowing', 3, 'pending', p_owner);

    -- Upcoming (not dispatched yet) storm for the owner's Snow screen: a draft with a route and two stops.
    insert into public.snow_storms (company_id, name, service, services, status, notes, created_by, created_at)
    values (v_co, 'Nor''easter Watch', 'plowing', array['plowing'], 'draft', 'Forecast is still moving. Dispatch if it hits 4+ inches.', p_owner, v_now - interval '2 hours')
    returning id into storm2;
    insert into public.snow_routes (company_id, storm_id, service, name, position, lead_person_id, media_required, min_media, created_by)
    values (v_co, storm2, 'plowing', 'Route A - Downtown', 1, p_snow, true, 1, p_owner) returning id into route2;
    insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, position, status, created_by) values
      (v_co, storm2, route2, sp1, 'plowing', 1, 'pending', p_owner),
      (v_co, storm2, route2, sp2, 'plowing', 2, 'pending', p_owner);

    -- Dispatch the first storm, then record the crew's work on its stops the same way the app does: arrive, add photos, complete.
    -- The database sends each completed stop's photos to the customer by itself (automatic sharing is on by default).
    update public.snow_storms set status = 'dispatched' where id = storm1;
    v_base := v_now - interval '2 days 4 hours';
    insert into public.snow_shifts (company_id, person_id, clock_in_at, clock_out_at, storm_id)
    values (v_co, p_snow, v_base - interval '15 minutes', v_base + interval '2 hours', storm1);
    i := 0;
    for vis in select v.id, v.property_id, v.position from public.snow_visits v where v.route_id = route1 order by v.position loop
      i := i + 1;
      update public.snow_visits set status = 'arrived', arrived_at = v_base + ((vis.position - 1) * interval '40 minutes') where id = vis.id;
      for ph in select unnest(array['demo-1.jpg', 'demo-2.jpg']) loop
        insert into public.snow_completion_media (visit_id, kind, file_key, size_bytes, uploaded_by, captured_at, company_id, storm_id, route_id, property_id, service)
        select vis.id, 'photo', v_co::text || '/completion/' || vis.id::text || '/' || ph, 240000, p_snow,
               v_base + ((vis.position - 1) * interval '40 minutes') + interval '15 minutes', v_co, storm1, route1, vis.property_id, 'plowing';
      end loop;
      update public.snow_visits set status = 'completed',
             completed_at = v_base + ((vis.position - 1) * interval '40 minutes') + interval '25 minutes',
             completion_note = case vis.position when 1 then 'Driveway and walk cleared, snow piled by the fence.' when 2 then 'Lot plowed, steps salted.' else 'Plowed. Kept the book-drop side clear.' end
       where id = vis.id;
    end loop;
    -- (When the last stop was completed the database ended the storm by itself.)
  end
  $demo$;

commit;

select 'Demo company ready. Log in with demo-owner@ / demo-worker@ / demo-snow@ / demo-customer@brightonlawn.com and the password at the top of this script.' as result;
