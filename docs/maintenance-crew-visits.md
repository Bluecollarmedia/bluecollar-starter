# Maintenance: crew visits, leader check-in and estimated labor-hours (update 68)

Three separate records, never mixed up:

1. **Employee workday** (`time_workdays`): each person clocks in and out for their own day (updates 63 and 67). Payroll comes from here.
2. **Property visit** (`time_visits`, `crew_level`): ONE per maintenance stop. The route's crew leader taps I'M HERE (saves the arrival time) and
   FINISH STOP (saves the completion time). Elapsed time = completion - arrival, both stamped by the server.
3. **Estimated labor-hours** (derived, never stored): for each worker assigned to the route (crew + leader), the minutes their own workday
   overlapped the visit, added up. Someone who clocks out half way contributes only the part before their clock-out. Three people for 40
   minutes = 40 minutes elapsed and 120 minutes (2.0 labor-hours) estimated; if one leaves at minute 20 it is 100 minutes.

Rules (enforced by the database):
* Every route needs ONE explicitly named leader (`maintenance_routes.lead_person_id`); nobody becomes leader implicitly, not even a lone
  crew member. Only that leader (or an owner/admin) checks the crew in and finishes a stop. A route with no leader blocks check-in and
  completion for every worker, with a plain message, until the owner chooses one (`maintenance_set_route_leader`; the leader must be on the
  route's crew and an approved maintenance worker). Owner > Maintenance lists the routes still without a leader; nothing is assigned for
  you. A direct edit cannot remove a leader. Other crew members see the status instead of a button.
* The leader must be clocked in to check a crew in. The stop order is the owner's (owner may work out of order; it is written to the history).
* Workers do not start per-person property timers any more for maintenance (the older functions refuse). Landscaping jobs are unchanged.
* A crew visit is never recomputed from intervals and never gets per-person intervals; the owner can correct its arrival/completion time
  (old value, new value and reason are kept).
* A skip request is withdrawn when the crew arrives, and cannot be approved while the crew is at the property.

The owner reads it under Maintenance > a property > Service History: time on site, estimated labor-hours (with who contributed how many minutes),
and a "longer than usual" pointer when a visit is at least 25% and 15 minutes longer than the average of the property's previous five timed
visits. Visits recorded before this update use the stop's own arrival/completion times.

Estimated labor-hours are a trend tool, not payroll, and are labelled that way.

## Company deletion and stored files

Deleting a company removes its rows in one all-or-nothing database step, and in the same step lists every stored photo/document key in
`storage_cleanup_queue`. The files themselves live in the media storage (R2), which a database transaction cannot touch, so **database
deletion and file deletion are not atomic**. The files are removed afterwards by the `storage-cleanup` Edge Function, which claims items
(`storage_cleanup_claim`, locked 10 minutes, `skip locked`), deletes them (a file already missing counts as gone), and records the result
(`storage_cleanup_finish`). A failure is retried after 2^attempts minutes (max 6 hours) and marked `failed` after 8 attempts;
`storage_cleanup_status()` reports pending / done / failed so nobody is told the files are gone while any remain. The function needs the
`CLEANUP_SECRET` secret, the existing R2 secrets, a deploy and a schedule (for example every 15 minutes); none of that has been done.

Deleting a company also deletes the accounts (person record and sign-in login) of everyone who belonged only to it, the owner included, in the
same all-or-nothing step; anyone who also belongs to, or has Snow access in, another company keeps their account. The count is kept in the
closure record (`accounts_deleted`). Customer-portal logins are not members and are not covered.

## Linking an owner-created customer to the customer's login (SQL 70)

The owner's "Add customer" makes a person with no login. The customer connects by entering the property's code (possession of the code is the
proof; names and email addresses are never matched). When the property was linked to the owner-created record, the claim moves everything
of that company that pointed at it (projects, quotes, invoices, the property) to the customer's own person and removes the empty record, so
there is no duplicate. A record that already has a login, or belongs to another company, is never merged. Caveat: signing up with an email
that matches an owner-created record still links by email in `handle_new_user`; that is only as trustworthy as the sign-up email, which
is not verified while email confirmation is off in Supabase. Turning email confirmation on is the fix for that, and is not done here.

## Private maintenance photos (SQL 71, not wired up)

Photos are stored in R2 and the app saves each photo's public address, so the internal/shared switch controls what the app SHOWS; it cannot
protect a file whose address is public. `maintenance_photos_i_can_open(keys)` and the media function action `maint-sign` are the permission
check and signer for private access (owner/admin, crew on the route, or the linked customer for a shared photo on a finished stop). Still
needed, each needing approval: make the maintenance file path private in R2 (a Cloudflare rule on the public address, or a private bucket),
deploy the function, and switch the screens to ask `maint-sign` for photo links. Until then nothing changes.

## Adding a customer (SQL 72)

"Add customer" now runs in the database (`add_customer`, owner/admin only): no email = a new record; the same email in this company = the same
person returned; an email that has a login elsewhere = that same person added here as an invited customer (no duplicate); a team member's email
and a customer the owner removed are refused. Names are never matched. Caveat: an email is only as trustworthy as the sign-up behind it
while email confirmation is off in Supabase. Owners can learn that an email has an account (and see that person's name once added); accepted for now.

## Deleting a company removes everything stored for it (SQL 74)

Besides the per-file list (update 68), the deletion queues whole folders: `{companyId}/` (everything the company stored), and `ids/{personId}/`
and `avatars/{personId}/` for the people whose accounts are deleted with it. The `storage-cleanup` function empties them in the public
bucket, the private bucket and the Snow stand-in bucket, batch by batch, and a folder is marked done only when it is really empty. The app
calls it right after the delete succeeds (it needs no secret and cannot be told what to delete); it can also be called by hand. Deleting from
the database and from storage can still not be one atomic step: if storage is unreachable the folders stay queued and are retried.
