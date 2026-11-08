# Database tests

`006_company_resources_test.sql` runs the Company Resources acceptance
scenarios (grant, reveal, revoke, deactivate, guessed ids, card guard, audit
log) against a plain local Postgres with small Supabase stand-ins.

```sh
createdb t
psql -d t -f supabase/tests/supabase_stubs.sql     # auth, storage, vault, roles
psql -d t -f supabase/schema.sql
grep -v supabase_vault supabase/updates/006_company_resources.sql | psql -d t
psql -d t -f supabase/tests/006_company_resources_test.sql
```

The Vault stand-in stores codes in plain text; real Supabase Vault encrypts
them. Read the output: each step prints what the user could see or the error
they got.

`012_recurring_schedules_test.sql` checks repeating schedules: days filled in
8 weeks ahead, a day the worker is already on the job is skipped, re-running
adds nothing, a cancelled day stays cancelled, monthly repeats on the 31st land
on the last day of short months, and workers can't create or change repeats.

```sh
psql -d t -f supabase/updates/012_recurring_schedules.sql
psql -d t -f supabase/tests/012_recurring_schedules_test.sql
```

`014_crews_test.sql` checks crews: names are unique per company, a worker is
in at most one crew, deleting a crew frees its members, and workers can see
but not change crews.

```sh
psql -d t -f supabase/updates/014_crews.sql
psql -d t -f supabase/tests/014_crews_test.sql
```

`018_maintenance_test.sql` checks Maintenance: landscaping workers can't be
put on a route or made its lead and can't see maintenance data, crew members
can't change stops directly, start day is recorded once and never blocked by
GPS, a worker can't finish before I'm Here, open checklist items and missing
photos block finishing, crew photos stay internal, a second worker's arrival
is logged separately, finishing twice records one completion, owner
attendance corrections keep the original time, and worked routes/properties
can't be deleted.

```sh
psql -d t -f supabase/updates/018_maintenance.sql
psql -d t -f supabase/tests/018_maintenance_test.sql
```

`019_maintenance_workers_test.sql` checks maintenance sign-up: a maintenance
team code only files a pending request (no access, can't self-approve), the
owner picks the type when approving, maintenance workers join the
Maintenance Crew, landscaping workers can't be put in it, a plain update can't
reclassify anyone, and set_worker_type is owner-only and audit-logged. Run
after update 018.

```sh
psql -d t -f supabase/updates/018_maintenance.sql
psql -d t -f supabase/updates/019_maintenance_workers.sql
psql -d t -f supabase/tests/019_maintenance_workers_test.sql
```

`020b_snow_foundation_test.sql` checks the Snow Mode base tables (run 020
first): the same property twice on one route and on another route as separate
visits, a lead must hold the route's service and can lead several routes, lead
reassignment keeps history, no work before dispatch, required photos and
arrival-first block completion, completing one pass leaves the other pending,
completed visits can't be reopened, media can't be replaced or deleted, a
visit is skipped only after its request is approved (denied stays pending),
property edits don't rewrite old visits, ended storms take no new visits until
reopened, draft storms delete cleanly, the activity log is append-only, and
workers/customers see nothing from these tables.

```sh
psql -d t -f supabase/updates/020_snow_access.sql
psql -d t -f supabase/updates/020b_snow_foundation.sql
psql -d t -f supabase/tests/020b_snow_foundation_test.sql
```

`022_snow_property_details_test.sql` checks snow property details (run 020,
020b and 022 first; the stubs need a `storage.foldername` stand-in and storage
grants): company ids come from the parent record, one main contact per
property, only customer accounts can be linked, saved instructions and
reference media can't be edited or deleted (even by the owner), a plow lead
sees only plowing instructions/media and files and a shovel lead only
shoveling, crew who lead nothing see none, customers see their property's
name/address and services but no notes, instructions or media, another
company sees nothing, a visit needs the service set up on the property, a
completed visit still shows the instructions version and photos it was done
with after the owner changes them, and an ended storm or revoked service
cuts the lead off.

```sh
psql -d t -f supabase/updates/022_snow_property_details.sql
psql -d t -f supabase/tests/022_snow_property_details_test.sql
```

`027_snow_skip_requests_test.sql` checks skipped-stop requests (run 020 and
020b first): no request before dispatch, a reason is required, the lead can't
skip ahead or decide their own request, a double tap makes one request, the
stop stays pending while reviewed, other plowers/shovelers/customers see
nothing, a denial keeps the stop open with the owner's note, an approval skips
it without counting it completed (a later pass at the same property is
untouched), withdraw and auto-withdraw on completion, a reassigned lead loses
sight of the route's requests, and the history and activity log are kept.

```sh
psql -d t -f supabase/updates/027_snow_skip_requests.sql
psql -d t -f supabase/tests/027_snow_skip_requests_test.sql
```

`024_snow_storm_lifecycle_test.sql` checks the storm lifecycle (run 020, 020b,
022 and 024 first): creating a draft per service (a repeated create makes one
storm), only properties with the storm's service are offered, status and
stamps can't be set directly, dispatch needs a route with stops and a lead,
two storms can be active at once, workers and customers can't run any of it,
ending keeps unfinished stops unfinished and blocks new work, reopening keeps
completed work and creates no notifications or media, extra passes are new
visits, repeated taps change nothing, and no storm goes back to draft.

```sh
psql -d t -f supabase/updates/024_snow_storm_lifecycle.sql
psql -d t -f supabase/tests/024_snow_storm_lifecycle_test.sql
```

`020_snow_access_test.sql` checks Snow Mode access: snow-only employees (and
pending or revoked ones) see zero rows in every landscaping table, a
dual-mode worker keeps landscaping, plowing / shoveling / salting are
separate, only the owner can grant or revoke, switching the company to Snow
Mode grants nothing, and grants and revokes are logged once. Run it after all
the other updates so the landscaping sweep covers every table.

```sh
for f in supabase/updates/0*.sql; do grep -v supabase_vault "$f" | psql -d t; done
psql -d t -f supabase/tests/020_snow_access_test.sql
```

`021_snow_mode_switch_test.sql` checks the Landscaping/Snow switch: companies
start in Landscaping, a worker can't switch, the owner can (who and when are
stamped and can't be forged), unknown modes are refused, and switching touches
no other data.

```sh
psql -d t -f supabase/updates/021_snow_mode_switch.sql
psql -d t -f supabase/tests/021_snow_mode_switch_test.sql
```

`snow_onboarding_test.sql` checks the separate Snow signup code: regenerate
and turn off, a pending applicant sees nothing, an old code stops working
while waiting requests stay, an existing landscaping worker asks with the same
account, approve with services, decline, remove, change services and revoke
(landscaping access untouched). Run after update 020 (Snow access, PR #22) or
the small stand-in here:

```sh
psql -d t -f supabase/tests/snow_roles_standin.sql   # or 020_snow_access.sql
psql -d t -f supabase/updates/023_snow_onboarding.sql
psql -d t -f supabase/tests/snow_onboarding_test.sql
```

`025_026_snow_routes_lead_test.sql` checks route building and lead work (run
020 through 026 first): reorder needs every stop listed once, a saved template
keeps stop order and lead, using it leaves out properties that no longer offer
the service, a lead sees nothing before dispatch and only their own routes
after, stops are worked in order one at a time, a double tap changes nothing,
the photo minimum blocks Finish Stop, media keys must belong to the stop, a lead
can't update visits directly, and other plowers and customers see nothing.

```sh
psql -d t -f supabase/updates/025_snow_routes_templates.sql
psql -d t -f supabase/updates/026_snow_lead_execution.sql
psql -d t -f supabase/tests/025_026_snow_routes_lead_test.sql
```

`028_snow_shifts_test.sql` checks the snow time clock (run 020 through 028
first): clock in/out are double-tap safe, workers can't write or correct
shifts and see only their own, customers can't clock in, corrections need a
reason, can't be edited, and the clock in/out/correction are logged.

```sh
psql -d t -f supabase/updates/028_snow_shifts.sql
psql -d t -f supabase/tests/028_snow_shifts_test.sql
```

`030_snow_media_review_test.sql` checks media review and customer updates (run
020 through 030 first; it runs the 025/026 test for its fixture): new media
waits for review, a stop can't be sent until every photo is approved or
hidden, sharing happens once per photo, sent photos can't be hidden,
leads can't review, and customers see only their own completed stops with
shared media.

```sh
psql -d t -f supabase/updates/030_snow_media_review.sql
(cd supabase/tests && psql -d t -f 030_snow_media_review_test.sql)
```

`016_task_leads_test.sql` checks Task Lead (run update 016 first): with no
lead picked no worker can change tasks, only an active worker can be the lead,
another worker can't change tasks, the lead can change status but not edit
tasks, and the database stamps who completed a task and when.

```sh
psql -d t -f supabase/updates/016_task_leads.sql
psql -d t -f supabase/tests/016_task_leads_test.sql
```

`031_snow_notifications_test.sql` checks snow notifications (run 008, 020,
020b, 022 and 031 first): new properties start with arrival off and
completion on, a linked customer can change only their own property's
preferences and owner sees who changed them, arrival and completion notify
each contact per those preferences, owner and admins get one alert per
completed stop only while the toggle is on, the toggle never touches customer
notices or the visit, a double tap or a reopened storm sends nothing twice
while a new pass notifies once, a contact with no email or app account is
recorded as not sent, nothing is shown as sent when no sender is set up, and
with a sender the result is recorded once per channel.

```sh
psql -d t -f supabase/updates/031_snow_notifications.sql
psql -d t -f supabase/tests/031_snow_notifications_test.sql
```
