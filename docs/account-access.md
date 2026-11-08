# Accounts, admins, deactivation and company closure

All of this is in `supabase/setup.sql`. One company per database, one owner, one account per person; a person's access is their
`company_members` row (role owner, admin, worker or customer; status active, invited or inactive).

* **Joining:** only through a private invite link the owner (or an admin with the invites power) sends (`invite_send`). The link's
  hash is stored, never the link; it works once, can expire or be revoked (`invite_revoke`), and signing up with it joins that exact
  record (`handle_new_user`). Nobody is ever joined by matching an email address.
* **Owner protection:** the owner can't delete their own login while they own the company, can't be deactivated, demoted or deleted
  by anyone, and an app user can't edit `company_members` directly to change roles (`_company_members_guard`).
* **Admins:** only the owner makes or removes an admin (`set_member_role`). Four powers can be switched off with
  `set_admin_permissions` (team, invites, time corrections, pay rates), all on by default, enforced in the database (`admin_can`).
  Admins can never delete the company, change the owner, or make another admin.
* **Deactivate a worker** (`deactivate_member`): refused while they are clocked in; upcoming work is a warning that needs a
  confirmation; removes their push tokens and is written to the team history. **Reactivate** (`reactivate_member`) gives access back,
  never restores admin and never assigns work.
* **Delete an unused team member** (`delete_unused_member`): only someone who never signed in and has no records anywhere; everyone
  else is deactivated instead.
* **Closing a company** (`company_closure_preview`, then `delete_my_company`): owner only, the name typed exactly, refused while someone
  is clocked in, all-or-nothing, logins of people who were only in this company are deleted, every stored file is queued for the
  storage-cleanup function, and a closure record (`company_closure_log`) outlives the company. The delete is PERMANENT and the screen
  says so plainly.
* **Stale sessions:** every table rule checks the membership live on each request, so an old login token of a deactivated person
  reads nothing. Tokens themselves are not revoked.

Tests: `supabase/tests/setup/02_invites_signup`, `03_access_rules`, `05_delete_company` and `10_team` (`npm run test:db`).
