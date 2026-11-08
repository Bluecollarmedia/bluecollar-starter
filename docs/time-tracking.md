# Workday, property-visit and labor tracking

Database updates 063, 064 and 065 (run in that order, after 062). The app works exactly as before until they are run: every new
screen and button checks that the database answers and falls back to the older check-in screens when it does not.

## What it does

* **Workday** (`time_workdays`): one row per employee workday, clock-in at the yard to clock-out. The server stamps the times
  (`now()`); the phone only sends its local calendar date. One open workday per person, enforced by a unique index, even from two phones.
  Breaks (`time_breaks`) exist only when the owner turns break tracking on.
* **Property visit** (`time_visits`): one row per real visit: a maintenance stop, or a landscaping project on one date.
  A recurring property has many visits; a multi-day project has one visit per day worked.
* **Each employee's own time** (`time_intervals`): start and end at a visit. Crew labor = the sum of these. The visit's elapsed time
  (first start to last finish) is a different number and is always labelled differently.
* **Rates**: `time_workday_rates` and `time_interval_rates` hold the hourly rate in force when the work happened (owner-only tables), so a
  raise never rewrites past costs. `time_set_hourly_rate` ends the old rate and adds a new effective-dated one.
* **Route order, skips, photos, one-property-at-a-time, no break mid-visit** are enforced in the database functions
  (`time_start_visit`, `time_complete_visit`, `time_request_skip`, `time_decide_skip`), not only on screen.
* **Corrections** (`time_staff_*`) need a reason, never overwrite silently, and write the old and new value, the person and the time to
  `time_audit` (append-only). Changing an approved day reopens it for approval again.
* Typed-in corrections are checked for typos: a workday the owner enters or edits can't be longer than 24 hours and must start on (about)
  the date it is filed under. The employee's own server-stamped clock-out is never refused for being long (the owner then corrects it).
  A visit whose every time was removed becomes "void" and drops out of the history lists; a "still clocked in" alert closes itself once
  the workday has a clock-out; the owner starting a stop out of order is allowed but written to the history.
* **Approval** (`time_approve_workday` / `time_reopen_workday`): only a clocked-out day with nothing running can be approved.
* **Alerts** (`time_alerts`): over target, daily alert hours (approaching / reached), a workday left open, an unusually long visit and
  skip requests. Each is saved once (unique key) so it never repeats. There is no background scheduler: alerts are worked out when a
  worker acts or has the app open (`time_my_day`) and when the owner opens Hours & Labor.

## Who can see what

Workers have no direct access to any `time_*` table. They call functions that return only their own day (no rates, targets, averages,
costs or other people's hours). Owners/admins read their own company's rows through row-level security. Customers and other
companies get nothing. All owner-only decisions are checked in the database, not by hiding buttons.

## Definitions (also in `src/lib/timeCalc.ts`, used by every screen and export)

* Gross workday time = clock-out − clock-in (or now while open). Never an invented end.
* Recorded break time = union of the day's breaks (overlaps counted once). Deducted break time = the unpaid part. Net payable = gross − deducted.
  Nothing is deducted for a break nobody recorded.
* Property labor = one employee's own interval. Crew labor = sum of intervals. Property elapsed = earliest start to latest end.
* Labor cost = interval hours × the rate saved with the interval. Payable cost = net hours × the day's saved rate (+ overtime premium in the weekly view).
* Weeks run Monday to Sunday. Times are real timestamps; hours show to 2 places and money to cents only at display time.
* Averages count completed visits only (not in-progress, voided or skipped). A skip has no time at all and is never "completed".
* Overtime is a calculation from the owner's own settings (Payroll terms), shown with its basis. It is not a legal payroll determination.

## How the older Hours / Payroll Estimate and this system fit together

Both stay. They measure different things, so their totals are expected to differ. This is where they can disagree:

| Question | Older Hours / Payroll Estimate | Hours & Labor (this system) |
|---|---|---|
| What is counted | Each landscaping job check-in to check-out (`work_sessions`) | The whole workday, clock-in to clock-out, minus unpaid breaks |
| Yard, loading and driving time | Not counted | Counted (it is inside the workday) |
| Maintenance routes | Not part of `work_sessions` | Workday and each stop's time are recorded |
| Overtime | Weekly threshold on job hours, each day priced at the rate for that date | Weekly threshold on net workday hours, each day priced at the rate **saved with that day** |
| Pay rate | Looked up live from `worker_hourly_rates` | Saved when the work was recorded; a later raise never rewrites it |

How they are kept from double counting: a landscaping job started through the new Start button writes ONE `work_sessions` row
(linked from its `time_intervals` row), so the older screens still show it once. Nothing in the new reports reads `work_sessions`, so the
two are never added together.

Where totals can still differ, and what to do:

* A job time the owner **adds by hand** (Add property time) exists only in the new system. The older Hours screen will not show it.
* A job time the owner **edits** updates the matching older session too. One the owner **removes** zeroes the older session (original times
  are kept in its correction note), so both agree.
* A workday the owner **adds by hand** (employee forgot to clock in) exists only in the new system.
* A pay rate changed on the older Payroll Estimate screen changes the live rate it uses; it does not change rates already saved with recorded
  work. The first time a rate is set in Hours & Labor, time already recorded with a blank rate is filled in (unapproved days, from the rate's
  start date); a saved rate is never changed.
* A maintenance stop finished by an older app build (before the update) has no property time; its workday still counts.
* Anyone can still call the older maintenance functions directly from an older build. Skips are owner-only there already; arrival and finish
  are not timed. Once every phone has the new build, a small hardening update can make those direct calls refuse crew members (not done yet, so older builds in the field keep working).

## Midnight, time zones and shifts that run past midnight

* The server stamps every time as an exact moment (UTC internally). Elapsed time, breaks and overtime are differences between moments, so
  a shift across midnight or a clock change (daylight saving) is exactly as long as it really was (tested: 23:00 to 07:00 across the US spring
  change = 8 elapsed hours).
* A workday belongs to the date the employee's phone says it **started** (`work_date`). A shift that starts Sunday night counts in Sunday's
  week, even if it ends Monday. Weeks run Monday to Sunday.
* The phone may only send today's date, yesterday's or tomorrow's; the server's own clock decides the actual times.
* Times are shown on each person's own phone in that phone's time zone. **CSV files write times in UTC** (the column names say so), so
  they read the same on every computer; the "Work date" column is the local date.
* A workday still open from an earlier day is shown to the worker with its start day, and to the owner as a warning on Hours & Labor, and
  it is never added to another day's totals. The owner sets the real clock-out (kept in the history).

## Not built / honest limits

* No offline queue (as requested): an action that cannot reach the database says so and is not saved.
* No "missed clock-in" alert: the app has no reliable company timezone or schedule start to judge it against.
* Existing Hours / Payroll Estimate screens still read the older `work_sessions` (written alongside, so they stay right). The new weekly summary
  reads workdays. They are different measures: job check-in time vs whole-workday time.
* Gaps between visits are labelled "Between visits" / "Before the first visit", never "travel": the app cannot know what the gap was.
* Push delivery uses the existing notification trigger; nothing here proves a push reached a phone.
