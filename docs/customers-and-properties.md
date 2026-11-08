# Customers and job sites (properties)

All of this is in `supabase/setup.sql`; the behaviour is tested in `supabase/tests/setup/11_customers_jobs.test.mjs`.

## The records

- A **customer** is a `people` row plus a `company_members` row with role `customer`. The owner (or an admin) adds one with
  `add_customer`: the same email in any capitalisation gives back the same record, no email means a new record, and names are never
  used to guess. A team member's email is refused.
- A **job site** is a `properties` row: company, customer, optional nickname, address fields, lat/lng, notes and `address_key`.
  Owner/admin write; owner/admin/workers read; customers have no direct access (they see their jobs).
- Jobs (`projects`) link to their site with `property_id`. Quotes, change orders and invoices have `project_id` and `customer_id`
  and no address of their own; a sent document freezes company, customer and site in its `snapshot`.

## One place for every job site (`ensure_property`)

- A site is entered once, for one customer. The same customer + the same address, typed any way, gives the same site back; a second
  address makes a second site. New Job and the customer page pick the customer first, then their saved site or a new address.
- Changing a site's address changes it on its jobs too (kept in step, never copied by hand).
- If the database does not have `ensure_property` yet, the forms still save (without the site link); nothing breaks.

## Guards (only for changes made from the app; the database's own functions are exempt)

1. **A customer link stays inside its company.** `customer_id` on jobs, quotes, change orders, invoices and sites must name a customer
   of the same company. Only NEW or CHANGED links are checked, so existing rows are never blocked from other edits.
2. A quote, change order or invoice may only point at a job of its own company; a job may only use a site of its own customer and
   its own company.
3. A customer signing up with their invite link and a different email still lands on the owner-made record
   (`_merge_placeholder_customer`): no duplicate person.

### How addresses are compared (`normalize_address`)

Lower case; punctuation ignored; `#`, `Apt`, `Apartment`, `Suite`, `Ste` become `unit` (unit numbers are KEPT, so unit 3 and unit 4 differ);
street words are shortened (street to st, avenue to ave, road to rd, drive to dr, lane to ln, boulevard to blvd, court to ct, place to pl, circle to cir,
terrace to ter, parkway to pkwy, highway to hwy, trail to trl; north/south/east/west and the diagonals to n/s/e/w/ne/nw/se/sw; building to bldg, floor to fl).
The first five digits of the ZIP decide the town; with no ZIP the city and state do. A blank street gives an empty key and is never compared.
It is deliberately cautious: two spellings it cannot tell apart stay two records rather than being merged wrongly.

## Customer access

The owner turns a customer's app access on or off on the customer's page (`set_customer_portal_access`). Off makes them inactive
(their jobs and records are kept), cancels an unused invite link and leaves them out of Message customers; on brings them back.
