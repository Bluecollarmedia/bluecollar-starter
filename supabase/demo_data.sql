-- ============================================================================
-- demo_data.sql  -  a FAKE "Demo Company" to try the app or show it to someone (or to an App Store reviewer).
-- ============================================================================
--
-- !!! NOT FOR A CLIENT'S REAL LAUNCH !!!
--   The app holds ONE company per database. This script makes that one company the fake "Demo Company". Run it only on a
--   demo or test project, never on the database a real business will use.
--
-- RUN IT
--   1. AFTER supabase/setup.sql, on a project with no company yet (or one that only has this Demo Company: running the
--      script again removes the old Demo Company and its logins and makes everything fresh, with dates moved to today).
--   2. CHANGE THE PASSWORD: find   demo_password text := 'CHANGE-ME';   a few lines below and put your own password
--      between the quotes (at least 8 characters). The script refuses to run while it still says CHANGE-ME.
--      Every demo login below uses that one password. Do not save your real password in this file in git.
--   3. Supabase -> SQL Editor -> paste this whole file -> Run.
--
-- DEMO LOGINS (email + password; all are confirmed, all are made-up people)
--   demo-owner@example.com       Olivia Grant     owner
--   demo-manager@example.com     Marcus Reed      admin (office manager)
--   demo-worker1@example.com     Dana Brooks      worker (crew A)
--   demo-worker2@example.com     Luis Ortega      worker (crew A)
--   demo-worker3@example.com     Sam Patel        worker (crew B)
--   demo-customer1@example.com   Emily Carter     customer
--   demo-customer2@example.com   Robert Hayes     customer
--   demo-customer3@example.com   Grace Liu        customer (Northside Dental)
--   Plus one invited worker with no login yet (Jordan Kim), to show the "waiting for invite" state.
--
-- WHAT YOU GET
--   5 job sites, 7 jobs (active, on hold, a lead, finished, archived) with tasks, 2 crews, 2 trucks, a supplier and materials,
--   an approved quote, a sent quote, an issued invoice, a week of clock-in/clock-out time for the three workers, the schedule
--   for today and the next days, an announcement, a message to customers and a short chat with a customer.
--   Photos: SQL cannot upload files, so the demo has no photos.
--
-- REMOVE THE DEMO LOGINS BEFORE ANY REAL USE (separate step, NOT run by this file). Copy the line below, take out the "-- "
-- and run it on its own. The people stay as records without a login; to remove the whole Demo Company instead, sign in as
-- the demo owner and use Settings -> Delete company (or run admin_reset_all_data.sql on a test project).
--   -- delete from auth.users where email in ('demo-owner@example.com','demo-manager@example.com','demo-worker1@example.com','demo-worker2@example.com','demo-worker3@example.com','demo-customer1@example.com','demo-customer2@example.com','demo-customer3@example.com');
-- ============================================================================

do $demo$
declare
  demo_password text := 'CHANGE-ME';   -- <<< CHANGE THIS (one password for every demo login, at least 8 characters)

  v_company constant text := 'Demo Company';
  v_owner_email constant text := 'demo-owner@example.com';
  v_emails constant text[] := array['demo-owner@example.com', 'demo-manager@example.com', 'demo-worker1@example.com', 'demo-worker2@example.com',
                                    'demo-worker3@example.com', 'demo-customer1@example.com', 'demo-customer2@example.com', 'demo-customer3@example.com'];
  v_now timestamptz := now();
  v_today date := current_date;
  r record;
  v_uid uuid;
  v_uids uuid[];
  v_cids uuid[];
  v_pids uuid[];
  t text;
  -- people
  p_owner uuid; p_mgr uuid; p_w1 uuid; p_w2 uuid; p_w3 uuid; p_w4 uuid; p_c1 uuid; p_c2 uuid; p_c3 uuid;
  v_co uuid;
  -- things
  tr1 uuid; tr2 uuid; crew_a uuid; crew_b uuid; vend uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid;
  j1 uuid; j2 uuid; j3 uuid; j4 uuid; j5 uuid; j6 uuid; j7 uuid;
  q1 uuid; ann uuid;
  d int; v_day date; v_wd uuid; v_tv uuid; w record;
  v_in timestamptz; v_out timestamptz;
begin
  if demo_password is null or demo_password = 'CHANGE-ME' or length(demo_password) < 8 then
    raise exception 'Change demo_password at the top of demo_data.sql first (at least 8 characters). Nothing was changed.';
  end if;
  if to_regclass('public.companies') is null then
    raise exception 'Run supabase/setup.sql first. Nothing was changed.';
  end if;

  -- ── 1. One company per database: only an empty database, or one that holds only the previous Demo Company ──────────────
  if exists (
    select 1 from public.companies c
     where not (c.name = v_company
                and exists (select 1 from public.company_members m join public.people p on p.id = m.person_id
                             where m.company_id = c.id and m.role = 'owner' and lower(p.email) = v_owner_email))
  ) then
    raise exception 'This database already has a real company. demo_data.sql only runs on an empty database (or one with only the Demo Company). Nothing was changed.';
  end if;

  -- Remove the previous Demo Company and the demo logins (only ever these).
  select coalesce(array_agg(c.id), '{}') into v_cids from public.companies c where c.name = v_company;
  select coalesce(array_agg(u.id), '{}') into v_uids from auth.users u where lower(u.email) = any (v_emails);
  select coalesce(array_agg(distinct p.id), '{}') into v_pids
    from public.people p
   where p.user_id = any (v_uids)
      or exists (select 1 from public.company_members m where m.person_id = p.id and m.company_id = any (v_cids));
  if cardinality(v_cids) > 0 then
    -- Same approach as delete_my_company(): switch the company tables' own triggers off for this one step.
    for t in
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relkind = 'r' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
    loop
      execute format('alter table public.%I disable trigger user', t);
    end loop;
    perform set_config('app.allow_company_delete', 'on', true);
    delete from public.companies where id = any (v_cids);
    perform set_config('app.allow_company_delete', 'off', true);
    for t in
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relkind = 'r' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
    loop
      execute format('alter table public.%I enable trigger user', t);
    end loop;
  end if;
  delete from public.people where id = any (v_pids);
  delete from auth.identities where user_id = any (v_uids);
  delete from auth.users where id = any (v_uids);

  -- ── 2. The demo logins. The sign-up trigger (handle_new_user) makes each person from the name in raw_user_meta_data. ──────
  for r in
    select * from (values
      (1, 'demo-owner@example.com',     'Olivia', 'Grant',  '5550100101'),
      (2, 'demo-manager@example.com',   'Marcus', 'Reed',   '5550100102'),
      (3, 'demo-worker1@example.com',   'Dana',   'Brooks', '5550100103'),
      (4, 'demo-worker2@example.com',   'Luis',   'Ortega', '5550100104'),
      (5, 'demo-worker3@example.com',   'Sam',    'Patel',  '5550100105'),
      (6, 'demo-customer1@example.com', 'Emily',  'Carter', '5550100106'),
      (7, 'demo-customer2@example.com', 'Robert', 'Hayes',  '5550100107'),
      (8, 'demo-customer3@example.com', 'Grace',  'Liu',    '5550100108')
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
      extensions.crypt(demo_password, extensions.gen_salt('bf')), v_now - interval '30 days',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('first_name', r.first_name, 'last_name', r.last_name, 'phone', r.phone, 'email_verified', true),
      v_now - interval '30 days', v_now,
      '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid::text, v_uid,
            jsonb_build_object('sub', v_uid::text, 'email', r.email, 'email_verified', true, 'phone_verified', false),
            'email', null, v_now - interval '30 days', v_now);
  end loop;
  select p.id into p_owner from public.people p join auth.users u on u.id = p.user_id where u.email = 'demo-owner@example.com';
  select p.id into p_mgr   from public.people p join auth.users u on u.id = p.user_id where u.email = 'demo-manager@example.com';
  select p.id into p_w1    from public.people p join auth.users u on u.id = p.user_id where u.email = 'demo-worker1@example.com';
  select p.id into p_w2    from public.people p join auth.users u on u.id = p.user_id where u.email = 'demo-worker2@example.com';
  select p.id into p_w3    from public.people p join auth.users u on u.id = p.user_id where u.email = 'demo-worker3@example.com';
  select p.id into p_c1    from public.people p join auth.users u on u.id = p.user_id where u.email = 'demo-customer1@example.com';
  select p.id into p_c2    from public.people p join auth.users u on u.id = p.user_id where u.email = 'demo-customer2@example.com';
  select p.id into p_c3    from public.people p join auth.users u on u.id = p.user_id where u.email = 'demo-customer3@example.com';
  if p_owner is null or p_mgr is null or p_w1 is null or p_w2 is null or p_w3 is null or p_c1 is null or p_c2 is null or p_c3 is null then
    raise exception 'The sign-up trigger did not create every demo person. Is setup.sql installed?';
  end if;
  -- One invited worker with no login yet.
  insert into public.people (email, first_name, last_name, phone) values ('', 'Jordan', 'Kim', '5550100109') returning id into p_w4;

  -- ── 3. The company (same function "Create a Company" uses), already set up ──────────────────────────────────────────────
  v_co := public._create_company(p_owner, jsonb_build_object(
    'company_name', v_company, 'company_phone', '(555) 010-0100', 'company_email', 'demo-owner@example.com',
    'company_address', '100 Demo Street', 'company_city', 'Anytown', 'company_state', 'OH', 'company_zip', '43000'));
  update public.companies set
    yard_address = '100 Demo Street', yard_city = 'Anytown', yard_state = 'OH', yard_zip = '43000',
    yard_latitude = 40.0000, yard_longitude = -83.0000,
    setup_state = jsonb_build_object('done', true, 'completed', true, 'demo', true),
    setup_completed_at = v_now - interval '30 days', created_at = v_now - interval '30 days'
  where id = v_co;
  insert into public.time_settings (company_id) values (v_co) on conflict (company_id) do nothing;
  insert into public.financial_settings (company_id, default_tax_rate, default_terms, default_payment_instructions)
  values (v_co, 7, 'Payment due within 30 days of the invoice date.', 'Pay by check to Demo Company, or by card over the phone.')
  on conflict (company_id) do nothing;

  -- ── 4. The team ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  insert into public.company_members (company_id, person_id, role, status, join_method, approved_by, approved_at) values
    (v_co, p_mgr, 'admin',    'active',  'invitation_link', p_owner, v_now - interval '29 days'),
    (v_co, p_w1,  'worker',   'active',  'invitation_link', p_owner, v_now - interval '28 days'),
    (v_co, p_w2,  'worker',   'active',  'invitation_link', p_owner, v_now - interval '28 days'),
    (v_co, p_w3,  'worker',   'active',  'invitation_link', p_owner, v_now - interval '27 days'),
    (v_co, p_w4,  'worker',   'invited', 'invitation_link', p_owner, null),
    (v_co, p_c1,  'customer', 'active',  'invitation_link', p_owner, v_now - interval '20 days'),
    (v_co, p_c2,  'customer', 'active',  'invitation_link', p_owner, v_now - interval '18 days'),
    (v_co, p_c3,  'customer', 'active',  'invitation_link', p_owner, v_now - interval '15 days');
  insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date, set_by) values
    (v_co, p_w1, 28.00, v_today - 60, p_owner), (v_co, p_w2, 24.00, v_today - 60, p_owner), (v_co, p_w3, 22.50, v_today - 60, p_owner);

  -- ── 5. Trucks and crews ──────────────────────────────────────────────────────────────────────────────────────────────────
  insert into public.trucks (company_id, name, make, model, year, license_plate, color, status, assigned_to, notes)
  values (v_co, 'Truck 1', 'Ford', 'F-350', 2021, 'DEMO-101', 'White', 'assigned', p_w1, 'Crew A truck. Trailer hitch.') returning id into tr1;
  insert into public.trucks (company_id, name, make, model, year, license_plate, color, status, notes)
  values (v_co, 'Truck 2', 'Chevrolet', 'Silverado 2500', 2019, 'DEMO-102', 'Gray', 'available', 'Crew B truck.') returning id into tr2;
  insert into public.truck_maintenance (company_id, truck_id, title, serviced_on, due_on, notes, created_by)
  values (v_co, tr1, 'Oil change', v_today - 40, v_today + 50, 'Synthetic, 5,000 mile interval.', p_owner);

  insert into public.crews (company_id, name) values (v_co, 'Crew A') returning id into crew_a;
  insert into public.crews (company_id, name, color) values (v_co, 'Crew B', '#5A5A5A') returning id into crew_b;
  insert into public.crew_members (company_id, crew_id, person_id) values
    (v_co, crew_a, p_w1), (v_co, crew_a, p_w2), (v_co, crew_b, p_w3), (v_co, crew_b, p_w4);

  -- ── 6. Job sites (fake addresses) ────────────────────────────────────────────────────────────────────────────────────────
  insert into public.properties (company_id, customer_id, name, address, city, state, zip, latitude, longitude, created_by)
  values (v_co, p_c1, 'Carter Home', '12 Oak Street', 'Anytown', 'OH', '43001', 40.0101, -83.0102, p_owner) returning id into s1;
  insert into public.properties (company_id, customer_id, name, address, city, state, zip, latitude, longitude, created_by)
  values (v_co, p_c2, 'Hayes Residence', '48 Maple Avenue', 'Anytown', 'OH', '43002', 40.0203, -83.0204, p_owner) returning id into s2;
  insert into public.properties (company_id, customer_id, name, address, city, state, zip, latitude, longitude, created_by, notes)
  values (v_co, p_c3, 'Northside Dental Office', '300 Main Street', 'Anytown', 'OH', '43003', 40.0305, -83.0306, p_owner,
          'Work only after 5 PM on weekdays; the lot is full during office hours.') returning id into s3;
  insert into public.properties (company_id, customer_id, name, address, city, state, zip, latitude, longitude, created_by)
  values (v_co, p_c2, 'Hayes Rental', '7 Pine Court', 'Anytown', 'OH', '43004', 40.0407, -83.0408, p_owner) returning id into s4;
  insert into public.properties (company_id, customer_id, name, address, city, state, zip, latitude, longitude, created_by)
  values (v_co, p_c1, 'Carter Lake Cabin', '22 Elm Road', 'Lakeside', 'OH', '43005', 40.0509, -83.0510, p_owner) returning id into s5;

  -- ── 7. Jobs, in different states, with tasks ─────────────────────────────────────────────────────────────────────────────
  insert into public.projects (company_id, customer_id, property_id, name, address, city, state, zip, latitude, longitude, status, start_date, estimated_end_date, notes, task_lead_id, created_at)
  values (v_co, p_c1, s1, 'Carter Driveway Replacement', '12 Oak Street', 'Anytown', 'OH', '43001', 40.0101, -83.0102, 'active', v_today - 6, v_today + 4,
          'Remove the old driveway, regrade, new base and surface.', p_w1, v_now - interval '10 days') returning id into j1;
  insert into public.projects (company_id, customer_id, property_id, name, address, city, state, zip, latitude, longitude, status, start_date, estimated_end_date, notes, created_at)
  values (v_co, p_c2, s2, 'Hayes Patio Repair', '48 Maple Avenue', 'Anytown', 'OH', '43002', 40.0203, -83.0204, 'active', v_today - 3, v_today + 2,
          'Reset sunken pavers by the back door and replace the cracked step.', v_now - interval '7 days') returning id into j2;
  insert into public.projects (company_id, customer_id, property_id, name, address, city, state, zip, latitude, longitude, status, start_date, estimated_end_date, notes, created_at)
  values (v_co, p_c3, s3, 'Northside Dental Parking Lot', '300 Main Street', 'Anytown', 'OH', '43003', 40.0305, -83.0306, 'active', v_today - 2, v_today + 5,
          'Crack repair, sealcoat and new line striping. Evenings only.', v_now - interval '9 days') returning id into j3;
  insert into public.projects (company_id, customer_id, property_id, name, address, city, state, zip, latitude, longitude, status, progress, start_date, estimated_end_date, completed_at, notes, created_at)
  values (v_co, p_c2, s4, 'Hayes Rental Walkway', '7 Pine Court', 'Anytown', 'OH', '43004', 40.0407, -83.0408, 'completed', 100, v_today - 25, v_today - 20, v_now - interval '20 days',
          'New front walkway and two steps.', v_now - interval '30 days') returning id into j4;
  insert into public.projects (company_id, customer_id, property_id, name, address, city, state, zip, latitude, longitude, status, start_date, estimated_end_date, notes, created_at)
  values (v_co, p_c1, s5, 'Carter Cabin Retaining Wall', '22 Elm Road', 'Lakeside', 'OH', '43005', 40.0509, -83.0510, 'on_hold', v_today + 20, v_today + 30,
          'Waiting for the permit.', v_now - interval '12 days') returning id into j5;
  insert into public.projects (company_id, customer_id, property_id, name, address, city, state, zip, latitude, longitude, status, notes, created_at)
  values (v_co, p_c3, s3, 'Northside Dental Curb Repair', '300 Main Street', 'Anytown', 'OH', '43003', 40.0305, -83.0306, 'prospect',
          'Customer asked for a price on the broken curb by the entrance.', v_now - interval '3 days') returning id into j6;
  insert into public.projects (company_id, customer_id, property_id, name, address, city, state, zip, latitude, longitude, status, progress, start_date, estimated_end_date, completed_at, notes, created_at)
  values (v_co, p_c1, s1, 'Carter Front Steps', '12 Oak Street', 'Anytown', 'OH', '43001', 40.0101, -83.0102, 'archived', 100, v_today - 90, v_today - 85, v_now - interval '85 days',
          'Rebuilt the front steps last season.', v_now - interval '95 days') returning id into j7;

  insert into public.project_settings (company_id, project_id, customer_interaction_enabled, customer_can_request, customer_can_view_photos, customer_can_comment)
  select v_co, x, true, true, true, true from unnest(array[j1, j2, j3, j4, j5, j6, j7]) x;
  insert into public.project_team (company_id, project_id, person_id, added_at) values
    (v_co, j1, p_w1, v_now - interval '6 days'), (v_co, j1, p_w2, v_now - interval '6 days'),
    (v_co, j2, p_w3, v_now - interval '3 days'), (v_co, j3, p_w1, v_now - interval '2 days'), (v_co, j3, p_w3, v_now - interval '2 days'),
    (v_co, j4, p_w2, v_now - interval '25 days');

  insert into public.project_tasks (company_id, project_id, title, description, status, sort_order, assigned_to, created_at) values
    (v_co, j1, 'Remove old driveway',      'Break up and haul away the old surface.', 'completed',   1, p_w1, v_now - interval '10 days'),
    (v_co, j1, 'Regrade and compact base', '6 inches of crushed stone, compacted.',   'completed',   2, p_w2, v_now - interval '10 days'),
    (v_co, j1, 'Set forms and edges',      null,                                       'in_progress', 3, p_w1, v_now - interval '10 days'),
    (v_co, j1, 'Pour / lay the surface',   null,                                       'pending',     4, p_w1, v_now - interval '10 days'),
    (v_co, j1, 'Clean up and walkthrough', 'Walk the job with the customer.',          'pending',     5, p_w2, v_now - interval '10 days'),
    (v_co, j2, 'Lift and reset sunken pavers', null, 'in_progress', 1, p_w3, v_now - interval '7 days'),
    (v_co, j2, 'Replace cracked step',         null, 'pending',     2, p_w3, v_now - interval '7 days'),
    (v_co, j3, 'Fill cracks',                  null, 'completed',   1, p_w1, v_now - interval '9 days'),
    (v_co, j3, 'Sealcoat the lot',             null, 'pending',     2, p_w3, v_now - interval '9 days'),
    (v_co, j3, 'Stripe parking spaces',        null, 'pending',     3, p_w1, v_now - interval '9 days'),
    (v_co, j4, 'Dig out old walkway',          null, 'completed',   1, p_w2, v_now - interval '30 days'),
    (v_co, j4, 'Build new walkway and steps',  null, 'completed',   2, p_w2, v_now - interval '30 days'),
    (v_co, j5, 'Get the permit',               null, 'pending',     1, null, v_now - interval '12 days'),
    (v_co, j6, 'Measure and price the curb',   null, 'pending',     1, null, v_now - interval '3 days'),
    (v_co, j7, 'Rebuild front steps',          null, 'completed',   1, p_w1, v_now - interval '95 days');

  update public.projects set progress = 100 where id in (j4, j7);   -- finished jobs show 100%

  insert into public.project_history (company_id, project_id, actor_id, event_type, description, created_at) values
    (v_co, j1, p_owner, 'project_created', 'Job created', v_now - interval '10 days'),
    (v_co, j1, p_w1,    'task_completed',  'Completed: Remove old driveway', v_now - interval '5 days'),
    (v_co, j1, p_w2,    'task_completed',  'Completed: Regrade and compact base', v_now - interval '3 days');
  insert into public.customer_timeline (company_id, project_id, event_type, title, description, "timestamp") values
    (v_co, j1, 'project_started',   'Your job has started', 'The crew started removing the old driveway.', v_now - interval '6 days'),
    (v_co, j4, 'project_completed', 'Job completed',        'Your new walkway is finished.',               v_now - interval '20 days');

  -- ── 8. Materials and a supplier ──────────────────────────────────────────────────────────────────────────────────────────
  insert into public.material_vendors (company_id, name, contact_name, phone, email, address, pickup_instructions)
  values (v_co, 'Anytown Building Supply', 'Front counter', '5550100200', 'orders@example.com', '5 Supply Road, Anytown, OH', 'Pick up at gate 2.')
  returning id into vend;
  insert into public.project_materials (company_id, project_id, name, quantity, unit, status, vendor_id, sort_order, created_by) values
    (v_co, j1, 'Crushed stone base', 12, 'ton', 'picked_up', vend, 1, p_owner),
    (v_co, j1, 'Edge forms',          8, 'ea',  'ready',     vend, 2, p_owner),
    (v_co, j3, 'Sealcoat',           10, 'pail', 'ordered',  vend, 1, p_owner),
    (v_co, j3, 'Striping paint',      4, 'can',  'to_order', vend, 2, p_owner);

  -- ── 9. Quotes and an invoice ─────────────────────────────────────────────────────────────────────────────────────────────
  insert into public.quotes (company_id, project_id, customer_id, number, title, status, line_items, tax_rate, subtotal, tax_amount, total, terms, issue_date, valid_until,
                             sent_at, approved_at, approved_by, approved_name, created_by, created_at)
  values (v_co, j1, p_c1, 'Q-1001', 'Driveway replacement', 'approved',
          '[{"id":"l1","category":"labor","description":"Remove and haul old driveway","quantity":1,"unit":"job","unitPrice":1800,"total":1800},
            {"id":"l2","category":"materials","description":"Crushed stone base","quantity":12,"unit":"ton","unitPrice":45,"total":540},
            {"id":"l3","category":"labor","description":"New driveway surface","quantity":600,"unit":"sq ft","unitPrice":9,"total":5400}]'::jsonb,
          7, 7740, 541.80, 8281.80, 'Half up front, half on completion.', v_today - 12, v_today + 18,
          v_now - interval '12 days', v_now - interval '11 days', p_c1, 'Emily Carter', p_owner, v_now - interval '12 days')
  returning id into q1;
  insert into public.quotes (company_id, project_id, customer_id, number, title, status, line_items, tax_rate, subtotal, tax_amount, total, issue_date, valid_until, sent_at, created_by, created_at)
  values (v_co, j6, p_c3, 'Q-1002', 'Curb repair', 'sent',
          '[{"id":"l1","category":"labor","description":"Cut out and re-pour 20 ft of curb","quantity":20,"unit":"ft","unitPrice":55,"total":1100}]'::jsonb,
          7, 1100, 77, 1177, v_today - 2, v_today + 28, v_now - interval '2 days', p_owner, v_now - interval '2 days');
  insert into public.invoices (company_id, project_id, customer_id, number, title, status, line_items, tax_rate, subtotal, tax_amount, total, invoice_date, due_date, issued_at,
                               payment_instructions, created_by, created_at)
  values (v_co, j4, p_c2, 'INV-1001', 'Walkway and steps', 'issued',
          '[{"id":"l1","category":"labor","description":"New walkway and two steps","quantity":1,"unit":"job","unitPrice":3200,"total":3200}]'::jsonb,
          7, 3200, 224, 3424, v_today - 19, v_today + 11, v_now - interval '19 days',
          'Pay by check to Demo Company, or by card over the phone.', p_owner, v_now - interval '19 days');

  -- ── 10. Schedule: the last week (done), today and the next days ──────────────────────────────────────────────────────────
  for d in 1..6 loop
    v_day := v_today - d;
    if extract(isodow from v_day) >= 6 then continue; end if;   -- no weekend work
    insert into public.assignments (company_id, project_id, person_id, scheduled_date, start_time, end_time, status, confirmation_state, truck_id, sort_order, notes) values
      (v_co, j1, p_w1, v_day, '07:00', '15:30', 'completed', 'confirmed', tr1, 1, 'Driveway'),
      (v_co, j1, p_w2, v_day, '07:00', '15:30', 'completed', 'confirmed', tr1, 2, 'Driveway'),
      (v_co, j2, p_w3, v_day, '08:00', '16:00', 'completed', 'confirmed', tr2, 1, 'Patio repair');
  end loop;
  insert into public.assignments (company_id, project_id, person_id, scheduled_date, start_time, end_time, status, confirmation_state, truck_id, sort_order, notes) values
    (v_co, j1, p_w1, v_today,     '07:00', '15:30', 'scheduled', 'confirmed', tr1, 1, 'Set the forms.'),
    (v_co, j1, p_w2, v_today,     '07:00', '15:30', 'scheduled', 'confirmed', tr1, 2, 'Set the forms.'),
    (v_co, j3, p_w3, v_today,     '17:00', '21:00', 'scheduled', 'awaiting',  tr2, 1, 'Fill cracks before sealcoat.'),
    (v_co, j1, p_w1, v_today + 1, '07:00', '15:30', 'scheduled', 'awaiting',  tr1, 1, 'Surface.'),
    (v_co, j1, p_w2, v_today + 1, '07:00', '15:30', 'scheduled', 'awaiting',  tr1, 2, 'Surface.'),
    (v_co, j2, p_w3, v_today + 1, '08:00', '12:00', 'scheduled', 'not_sent',  tr2, 1, 'Replace the step.');

  -- ── 11. Time clock: a workday per worker per (week)day, with the time spent at the job ──────────────────────────────────
  for d in 1..6 loop
    v_day := v_today - d;
    if extract(isodow from v_day) >= 6 then continue; end if;
    for w in select * from (values (p_w1, j1, 'Carter Driveway Replacement', tr1, 0), (p_w2, j1, 'Carter Driveway Replacement', tr1, 5), (p_w3, j2, 'Hayes Patio Repair', tr2, 60)) as x(pid, job, label, truck, late_min) loop
      -- Times are 7:00 / 15:30 in the company's time zone (America/New_York unless changed).
      v_in  := ((v_day::timestamp + interval '7 hours' + make_interval(mins => w.late_min)) at time zone 'America/New_York');
      v_out := ((v_day::timestamp + interval '15 hours 30 minutes' + make_interval(mins => w.late_min)) at time zone 'America/New_York');
      insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status, truck_id, truck_source, approved_by, approved_at)
      values (v_co, w.pid, v_day, v_in, v_out, case when d > 2 then 'approved' else 'closed' end, w.truck, 'owner',
              case when d > 2 then p_owner end, case when d > 2 then v_out + interval '1 day' end)
      returning id into v_wd;
      insert into public.time_workday_rates (workday_id, company_id, hourly_rate)
      select v_wd, v_co, hourly_rate from public.worker_hourly_rates where person_id = w.pid and company_id = v_co;
      insert into public.time_visits (company_id, source, project_id, visit_date, label, status, started_at, ended_at, billable)
      values (v_co, 'project_day', w.job, v_day, w.label, 'completed', v_in + interval '15 minutes', v_out - interval '20 minutes', true)
      on conflict do nothing;
      select id into v_tv from public.time_visits where company_id = v_co and project_id = w.job and visit_date = v_day and source = 'project_day';
      insert into public.time_intervals (company_id, visit_id, workday_id, person_id, started_at, ended_at, status, billable)
      values (v_co, v_tv, v_wd, w.pid, v_in + interval '15 minutes', v_out - interval '20 minutes', 'completed', true);
    end loop;
  end loop;

  -- ── 12. Announcements, a message to customers, and a chat with a customer ────────────────────────────────────────────────
  insert into public.announcements (company_id, created_by, title, body, audience, priority, created_at)
  values (v_co, p_owner, 'Safety first', 'Safety glasses and vests on at every job site. Thanks, everyone.', 'all_workers', 'normal', v_now - interval '3 days')
  returning id into ann;
  insert into public.announcement_reads (company_id, announcement_id, person_id, read_at) values (v_co, ann, p_w1, v_now - interval '2 days');
  insert into public.announcements (company_id, created_by, title, body, audience, priority, created_at)
  values (v_co, p_owner, 'Holiday hours', 'Our office is closed next Monday. Crews are working as scheduled.', 'customers_all', 'normal', v_now - interval '1 day');

  insert into public.project_messages (company_id, project_id, sender_id, body, created_at) values
    (v_co, j1, p_c1,    'Hi Olivia, will the driveway be usable this weekend?', v_now - interval '2 days'),
    (v_co, j1, p_owner, 'Hi Emily, not yet. It needs a few days to cure. We will let you know when it is ready.', v_now - interval '2 days' + interval '1 hour'),
    (v_co, j1, p_c1,    'Great, thank you!', v_now - interval '2 days' + interval '2 hours');
  insert into public.project_requests (company_id, project_id, requested_by, title, description, category, status, created_at)
  values (v_co, j1, p_c1, 'Extra parking pad', 'Could you add a small parking pad next to the driveway?', 'additional_work', 'pending', v_now - interval '1 day');

  raise notice 'Demo Company is ready. % demo logins were made (see the top of demo_data.sql).', cardinality(v_emails);
end
$demo$;
