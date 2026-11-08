# Customers and properties: phase 1

This is the first, additive step toward one customer record with its properties reused everywhere. Nothing here changes existing data or
screens. Updates 75 and 76 are written but NOT run; nothing in the app uses the new table yet.

## What exists today (verified in the code)

- A **customer** is a `people` row plus a `company_members` row with role `customer` (no separate table, no company name, no edit screen).
- A landscaping **property** is only the address columns on the `projects` row. Quotes, change orders and invoices have `project_id` and
  `customer_id` and no address of their own; a sent document freezes company, customer and property in its `snapshot`.
- **Maintenance** has `maintenance_properties` (own address, optional `customer_id`, `source_project_id` for a copied address).
- **Snow** has `snow_properties` (own address, no customer column; its customer is a linked contact in `snow_property_contacts`).
- Addresses are copied between these, never linked, and nothing keeps the copies in step.

## Update 75: integrity guards and an empty properties table

1. **A customer link stays inside its company.** Changes made from the app to `customer_id` on projects, maintenance properties, quotes,
   change orders, invoices and properties must name a customer of the same company. Only NEW or CHANGED links are checked, so existing
   rows are never blocked from other edits. A maintenance property can only point at a project of its own company; a quote, change order or
   invoice only at a project of its own company.
2. **A deactivated customer loses access.** Maintenance (`maintenance_my_properties`, `maintenance_customer_updates`, the shared-photo check)
   and Snow (`snow_is_property_contact`) now also require the customer to be active or invited, not deactivated. The link itself is kept, so
   reactivating them restores access without re-linking.
3. **A project-code claim merges the owner-created record**, like a maintenance-code claim already does (update 70): no duplicate person.
4. **`properties`** table (empty): company, customer, optional nickname, address fields, lat/lng, notes, `address_key`. The same place cannot be saved
   twice for the same customer (even typed "123 Main St." and "123 main street"). Owner/admin write; owner/admin/workers read; customers have no
   direct access. Nullable `property_id` is added to projects, maintenance properties and snow properties; a project/maintenance property may only
   point at a property of its own company and its own customer.

### How addresses are compared (`normalize_address`)

Lower case; punctuation ignored; `#`, `Apt`, `Apartment`, `Suite`, `Ste` become `unit` (unit numbers are KEPT, so unit 3 and unit 4 differ);
street words are shortened (street to st, avenue to ave, road to rd, drive to dr, lane to ln, boulevard to blvd, court to ct, place to pl, circle to cir,
terrace to ter, parkway to pkwy, highway to hwy, trail to trl; north/south/east/west and the diagonals to n/s/e/w/ne/nw/se/sw; building to bldg, floor to fl).
The first five digits of the ZIP decide the town; with no ZIP the city and state do. A blank street gives an empty key and is never compared.
It is deliberately cautious: two spellings it cannot tell apart stay two records (a duplicate the owner can merge later) rather than being merged wrongly.

## Update 76: the backfill (a report first)

`select public.backfill_properties();` is a DRY RUN: it returns a report and changes nothing. `select public.backfill_properties(true);` applies it
(company owner only). The rules:

1. It looks only at the owner's company: projects, maintenance properties and snow properties. A snow property's customer is its one linked
   customer contact; with none or several it is not linked.
2. Records are the SAME place only when they have the same customer AND the same normalized address. Names are never used.
3. Never linked automatically (listed in the report under `needsDecision`): the same address under two different customers; a record with no
   customer; a record with no address; a snow property with several customer contacts; a record whose "customer" is not a customer of the company.
4. For each (customer, place) group it creates one property, or reuses an existing one, then fills `property_id` on the matching records that
   have none. The property's name and address come from the best record: a maintenance property first, then a snow property, then the newest project.
5. It NEVER changes an address, name, customer, project, quote, invoice or visit and never deletes anything. Running it again does nothing new.

## Not in phase 1 (deliberately left for later phases or your decision)

- The customer profile, the customer company name, the quote Customer then Property selector with the inline + button, and using properties in the other modules.
- Linking a sign-up to an owner-created record by email alone is unchanged (`handle_new_user`); making it safe depends on email confirmation and
  needs testing against real sign-ups.
- Prospect projects can still be read by workers at the database level.

## Update 79: one place for every property (built on phase 1)

- A property is entered once, for one customer (`ensure_property`). The same customer + the same address, typed any way, gives the same property back.
- New Project, Maintenance property, Snow property and the customer page all pick the customer first, then their saved property or a new address.
  The record they save links to it (`property_id`); its address is kept in step (change it once, it changes everywhere).
- Snow Properties and the Maintenance list show every property; one tap turns Snow (`snow_enable_for_property`, which also links the customer as the
  Snow contact) or Maintenance on. A customer is never typed twice: forms pick from the one customer list or add them once.
- Before SQL 75, 76 and 79 are run, the forms still save as they did (no property link); nothing breaks.
- Existing records get linked by the phase 1 backfill (preview first).
