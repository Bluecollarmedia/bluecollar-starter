# Database tests

## The setup.sql tests (use these)

```sh
npm run test:db          # all of them; exit code 0 = every check passed
node supabase/tests/run-setup-tests.mjs 04   # only the files whose name contains "04"
```

`run-setup-tests.mjs` runs every `setup/*.test.mjs`. Each file gets a fresh in-process Postgres
([PGlite](https://pglite.dev), a dev dependency, nothing to install or start) with small Supabase stand-ins
(`helpers/supabase_setup_stubs.sql`: the API roles, `auth.users`/`auth.identities`, `auth.uid()`, a storage schema,
a Vault stand-in, a pg_net stand-in that records calls, the Realtime publication), then loads `supabase/setup.sql`
(and `supabase/demo_data.sql` where needed) and checks what people can and cannot do:

| File | What it checks |
| --- | --- |
| `01_load` | setup.sql runs on a new database and again on top of itself; nothing Snow / lawn maintenance / route / Our Work / storm is left; every table has row level security; internal helpers and trigger functions cannot be called from the app; signed-out visitors can call only the public functions; FILL IN placeholder; private `media` bucket; Realtime list; every function body checks out |
| `02_invites_signup` | Create a Company, one company per database, worker and customer invite links (used once, revocable), and R5: signing up with someone else's email never takes over their record |
| `03_access_rules` | companies are separate, customer limits, pay rates, R4 (no direct `people` inserts), R21 (who may send which notice to whom), R3 (old media bucket), admin powers, Team access, deactivate / reactivate |
| `04_time_clock` | clock in, job time, clock out, double taps, approval, skip requests and alerts, owner corrections, and B15: the workday date is read in the company's time zone |
| `05_delete_company` | delete_my_company (owner only, typed name, not while clocked in, logins removed, closure record, storage clean-up list) and deleting an unused team member |
| `06_features` | request form choices = `src/config/brand.js` `wording.serviceTypes`, crews, announcements and customer messages, job chat, public weather switch (starts OFF), push trigger using `functions_url` |
| `07_demo_data_and_reset` | demo_data.sql (refuses CHANGE-ME, bcrypt logins, identities, the demo content, re-run, refuses a database with a real company, the "remove demo logins" line) and admin_reset_all_data.sql |
| `08_time_tracking` | time tracking in depth: request ids and one open day, trucks at clock-in, breaks, job order, required photos, rate snapshots, owner corrections and approval with history, alerts, skip requests, the owner clocking a worker in and out by hand, companies kept apart, no writes around the functions |
| `09_clock_rules` | check-in distance (radius, GPS accuracy, Anywhere), clocking in with or without scheduled work, forgotten (stale) workdays, the day closing itself after the last job, the midnight rule, settling a day with no hours, clock-out ending open work, yard clock-in alerts |
| `10_team` | one-company rule in depth, birthday / shirt size / language / worker ID photo, invite links in depth, owner protection, admin powers, deactivate / reactivate, deleting unused members, Remind, Task Leads, crews, a company delete that fails half way |
| `11_customers_jobs` | Add customer, customer access on/off, Message customers reach, one customer record + one link, job sites (`ensure_property`, `normalize_address`, link guards), quote approval with a signature, invoice links, problem reports, what customers see of tasks, automatic progress, repeating schedules |
| `12_records_files` | content reports, clearing a job's activity, the owner's private truck and job records, the truck service log, Company Resources (Vault codes, access per worker), the public weather switch in detail, the storage clean-up queue, the old code / join-request functions staying gone |

What PGlite cannot prove (check these once on a real, empty Supabase test project): the real login service (that the
demo logins can actually sign in), Supabase Storage itself, the Vault's encryption, pg_net really calling the Edge
Function, Realtime, and the exact Postgres version Supabase runs.

The old per-update test files (and the numbered update files they tested) were removed in Step 6; every generic case
they had is in the files above.
