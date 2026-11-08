# Accounts, admins, deactivation and company closure (update 66)

One company, one owner, one account per person. Each worker's modes are separate permissions on that ONE account:
Landscaping (an active `company_members` row) and Snow (an active `snow_staff` row with services). Snow-only people have no
landscaping row, exactly as before (update 20). **Snow access is explicit per person**: switching Snow Mode on, or joining while it is on,
grants nobody anything (update 66 switches off the automatic grants of update 62; people who already have access keep it). If 62 is ever
re-run, run 66 again after it.

* **Joining:** one "Join a Team" code box. `lookup_any_code` / `join_with_code` work out on the server whether a code is a team
  code or a Snow code and file only that kind of PENDING request. Nothing is granted until the owner (or an admin allowed to) approves.
  A request can only be approved while it is still pending (a declined or cancelled one can't be replayed).
* **Owner protection:** the owner can't delete their account (update 36), can't be deactivated, demoted or deleted by anyone, and an
  app user can no longer edit `company_members` directly to change roles (`_company_members_guard`).
* **Admins:** only the owner makes or removes an admin (`set_member_role`). Five powers can be switched off (team, invitations,
  snow access, time corrections, pay rates), all on by default, enforced in the database (`admin_can`). Admins can never delete the
  company, change the owner, or approve someone as admin.
* **Four different actions:** remove landscaping access, remove snow access (`set_member_modes`), deactivate worker
  (`deactivate_member`: both modes, pending requests, push tokens; refused while clocked in; warnings need a confirmation), delete company.
* **Reactivate** (`reactivate_member`) is an explicit choice of modes. It never restores admin and never assigns work.
* **Closing a company** (`delete_my_company`): owner only, name typed, refused while someone is clocked in or a storm is dispatched,
  codes and pending requests closed first, all-or-nothing, and a closure record (`company_closure_log`) that outlives the company.
  The delete is PERMANENT and intentional (decision recorded): hours, photos, storm history and every company-owned record go with the
  company, the screen says so plainly, and a test proves no table keeps a row of the closed company.
* **Stale sessions:** every table policy and snow function checks the membership live on each request, so an old login token of a
  deactivated person reads nothing. Tokens themselves are not revoked (the login is shared across companies by design).

Tests: `supabase/tests/066_account_access.pglite.mjs` (PGlite on the real schema).
