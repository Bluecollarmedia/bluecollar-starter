# NEW CLIENT PLAYBOOK - turning the starter kit into one company's app

Read this together with `CLAUDE.md` (the rules). CLAUDE.md says WHAT must always be true; this file says HOW to go from
"I have a new client" to a finished app that is fully theirs, with nothing left over from the kit or from another client.

**Who reads this:** the owner (plain parts) and Claude (every step). When the owner says something like
*"New app for Smith Paving, they do asphalt"*, Claude follows this file from Phase 0 to Phase 9, in order, and does not skip the
interview: a three-week build only stays three weeks if the decisions are made before the code.

---

## WHAT THE KIT IS (so the questions make sense)

The kit is the finished landscaping app with the landscaping-only parts taken out and everything client-specific moved into
ONE settings file, `src/config/brand.js`. It already does, for any trade:

| Kit part | What it does | Kit word (changeable) |
|---|---|---|
| Company | One business per database. The owner taps "Create a Company" once. | - |
| Roles | Owner, Manager (database role `admin`), Worker, Customer | "Manager" = `wording.leaderRoleLabel` |
| Joining | Workers and customers join ONLY with a private invite link | - |
| Jobs | One piece of work for a customer: tasks, schedule, photos, notes, crew, status, history | "Job" = `wording.job` |
| Job sites | The place the work happens (address, map, photos, history) | "Job site" = `wording.place` |
| Crews | Teams of workers assigned to jobs; Task Lead per job | "Crew" = `wording.crew` |
| Time clock | Clock in/out, breaks, hours, payroll review, labor reports, far-from-yard alerts | switch `timeClock`, `clockInAlerts` |
| Quotes / invoices | Quotes, change orders, invoices, PDFs with the logo, customer approval link | switch `financials` |
| Materials | Lists of what to order/pick up per job | switch `materials` |
| Trucks | Trucks/equipment, service log, documents, reminders | switch `trucks` |
| Requests | Customers ask for new work ("Request a service") | switch `requests`, list `wording.serviceTypes` |
| Issues | Workers report problems on a job | switch `issues` |
| Messages / announcements | Company-customer chat, owner announcements to staff | switches `messages`, `announcements` |
| Customer portal | Customers log in to see their job sites, jobs, documents, messages | switch `customerPortal` |
| Weather | Local forecast (US only), optional public visitor area and widgets | switches `weather`, `publicVisitorArea`, `widgets` |
| Spanish | Worker and customer screens in Spanish (owner screens stay English) | switch `spanish` |

What was **taken out** of the original landscaping app (still in the read-only `landscape-app` repo, if a client needs it -
see Phase 6): Snow (plowing/salting dispatch), lawn-maintenance visits (recurring service stops), crew daily routes, and the
"Our Work" photo portfolio.

---

## PHASE 0 - START A NEW CLIENT APP (never build inside the kit)

1. Each client gets **its own copy and its own repo**: export the kit's `main` into a new folder (for example
   `C:\smith-paving-app`), no git history, no `node_modules`, no `.env`; `git init`; new GitHub repo the owner created
   (ask for its name - never create repos unasked). The kit itself stays generic.
2. Fixes found while building a client app that are NOT client-specific (a bug, a security fix, a better check) go back
   into the kit too, in their own pull request on the kit repo.
3. Start a reports folder outside the repo for the `.txt` reports (CLAUDE.md: reports as `.txt`).

---

## PHASE 1 - INTERVIEW THE OWNER (ask, don't guess)

Ask these in plain words, a few at a time. Write the answers into `client-brief.txt` in the reports folder. Every answer
maps to a setting; the right-hand column says which.

**The business**
| Ask | Sets |
|---|---|
| Company name as customers see it, and the legal name (LLC/Inc)? | `company.name`, `company.legalName`, `legal.businessName` |
| Phone, support email, mailing address, website? | `company.phone`, `company.supportEmail`, `company.addressLines`, `company.website` |
| Which state, which time zone? Where is the yard/shop? | `company.state`, `company.timezone`, `legal.state`, `weather.defaultPlace` |
| The domain they own (e.g. smithpaving.com)? The app's web address will be `app.<their domain>` from DAY ONE. | `app.webUrl` (CLAUDE.md: business domain from day one) |
| App name on the home screen (short, about 12 letters)? | `app.name`, `app.slug`, `app.scheme` |
| Logo files (best: a square mark + a wide logo, PNG or SVG, transparent background), main brand color? | Phase 4 pictures, `look.brandColor` |

**How the work flows** (this decides the words and the switches)
| Ask | Why |
|---|---|
| "Walk me through one job, from the customer's first call to getting paid." | Shows if the Job / quote / invoice flow fits as is. |
| What do you call one piece of work? (job, project, work order, ticket...) And the place? (job site, property, lot, address, location...) And a team? (crew, team, truck...) | `wording.job/jobs`, `wording.place/places`, `wording.crew/crews` (+ `wording.es`) |
| Is most work one-off (a new driveway) or repeating (sealcoat every 2 years, monthly service)? | One-off fits Jobs. Repeating may need `repeatJobs` ON, or Phase 6 (maintenance visits from the landscape app). |
| Do workers go out in crews? Who leads the crew on site? Does anyone in the office need extra rights (a manager)? | Crews, Task Lead, `wording.leaderRoleLabel` |
| Do workers need to clock in/out in the app? Are hours used for payroll? Should the owner be alerted when someone clocks in far from the yard? | `timeClock`, `clockInAlerts` |
| Do you send quotes and invoices from the app, or from QuickBooks / another tool? | `financials` (OFF if they invoice elsewhere) |
| What units do you price and order in? (sq ft, sq yd, tons, cu yd, ln ft, gallons, loads, hours...) | `wording.units`, `wording.materialUnits` |
| What do you buy for jobs? (asphalt tons, sealer, stone, concrete...) | `materials`, `wording.materialCategories` |
| Trucks and heavy equipment to track (service dates, registrations, insurance papers)? | `trucks` |
| Should customers have their own login (see their jobs, approve quotes, message you)? Or is it staff-only? | `customerPortal`, `messages`, `requests` |
| What services can a customer ask for? (list of 4-8) | `wording.serviceTypes` AND the same words in `supabase/setup.sql` (`submit_service_request`) |
| Do workers speak Spanish? | `spanish` |
| Does weather change your work (rain, temperature, wind)? Should the public see weather without logging in? Home-screen widget? | `weather`, `publicVisitorArea`, `widgets` |
| Do you collect workers' shirt sizes or driver-license photos? | `uniformSize` (+ `wording.uniformSizeLabel`), `workerIdPhoto` |
| Anything the app MUST do that you haven't seen in it? (e.g. measure an area on a map, a pour schedule, a plow route) | Phase 6 (new work - estimate it separately) |

---

## PHASE 2 - TRANSLATE THEIR BUSINESS INTO THE KIT

Fill this table in `client-brief.txt` and show it to the owner in plain words ("In your app, a Job is one paving job for one
customer; the place is called a Lot...").

| Kit concept | This client's word / answer |
|---|---|
| Job / Jobs | |
| Job site / Job sites | |
| Crew / Crews | |
| Manager (admin role label) | |
| Units | |
| Service types (exact words, also in setup.sql) | |
| Material groups | |
| Switches ON | |
| Switches OFF | |
| New things the kit doesn't do (Phase 6) | |

**Trade cheat sheets** (starting points - the owner's answers always win):

- **Asphalt / paving / sealcoating:** Job + "Job site" (or "Property" for homeowners, "Lot" for parking lots); crews by truck.
  Units: sq ft, sq yd, ton, ln ft (crack fill, striping), gal (sealer), load. Services: New paving, Resurfacing / overlay,
  Sealcoating, Crack filling, Patching / pothole repair, Line striping, Estimate request, Other. Materials: Asphalt & Sealcoat,
  Stone & Gravel, Paint & Striping (already in the kit list). Weather matters a lot (no paving or sealcoating in rain or cold):
  keep `weather` ON. Sealcoating is repeat work every 2-3 years -> ask about `repeatJobs` / Phase 6 maintenance plans. Many paving
  companies plow snow in winter -> ask; Snow can come back from the landscape app (Phase 6).
- **Concrete / masonry:** Job + Job site. Units: cu yd, sq ft, ln ft, ea, hr. Services: Driveway, Patio, Sidewalk, Foundation,
  Repair, Estimate request, Other. Materials: Concrete & Masonry, Stone & Gravel, Block & Brick. Weather matters (pours).
- **Roofing / siding / gutters:** "Job" or "Project"; place "Property". Units: sq (roofing square), ln ft, ea. Services: Roof
  replacement, Repair, Inspection, Gutters, Estimate request, Other. Weather matters.
- **Fencing / decks:** Job + Property; units ln ft, ea, sq ft; materials Lumber, Hardware, Concrete.
- **Plumbing / HVAC / electrical:** "Job" or "Work order" / "Service call"; place "Address" or "Location"; often one tech per
  job (crews may be off or named "Team"); units ea, hr; quotes + invoices usually ON; weather usually OFF.
- **Cleaning / pressure washing / pools:** mostly repeating work -> `repeatJobs` ON or maintenance plans (Phase 6).
- **Landscaping:** that is the original app - consider copying the landscape app instead of the kit.

---

## PHASE 3 - ONE PAGE + MOCKUPS, APPROVED BEFORE CODE

1. Write `feature-list.txt` (one page): what the app does for the owner, the workers and the customers; every switch ON/OFF;
   the words; anything new from Phase 6 with a rough size.
2. Make mockups of the screens that will look different (home screens for each role, a job screen, any new feature) with
   the client's logo, color and words. Send them to the owner.
3. **No code until the owner approves the page and the mockups.** (CLAUDE.md rule.)

---

## PHASE 4 - PUT THE CLIENT EVERYWHERE (the "goes all over" map)

The kit is built so each thing is set ONCE and shows up everywhere. This table is the complete list of where each thing
shows and what to do. Do every row. Then Phase 7 proves nothing was missed.

### Logo and pictures
Replace the FILES (keep the same names and paths; `brand.js` `look` points at them):

| File | Where it shows | Size / notes |
|---|---|---|
| `assets/images/logo-full.png` | Sign-in screen, welcome screen, first-run setup screen, invite page, in-app splash (`SplashScreen`), native splash (`look.splashImage`), and EVERY quote / change order / invoice PDF (through `src/lib/brandLogo.ts`) | Wide logo on transparent background, about 1200 x 350 |
| `src/lib/brandLogo.ts` | The logo inside quote / invoice PDFs (the PDF printer cannot load the file, so it is stored as text) | REBUILD after changing logo-full.png: update width/height and the base64 text (instructions at the top of the file). `plainLook.check` fails until they match. |
| `assets/images/logo-mark.png` | Small mark: welcome overlay, the cover shown when a job/job site has no photo (`BrandCover`), the weather screen header, the home-screen widget | Square, 512 x 512, transparent; it is tinted in places, so a simple solid shape works best |
| `assets/images/icon.png` | App icon (iPhone home screen, App Store) | 1024 x 1024, NO transparency, no rounded corners (Apple rounds it) |
| `assets/images/icon-foreground.png` + `look.androidIconBackground` | Android icon (front layer on a background color) | 1024 x 1024, mark inside the middle 66% |
| `assets/android-icon-*.png`, `assets/favicon.png`, `assets/splash-icon.png`, `assets/icon.png` | Android template icons, the web site's browser-tab icon, Expo template copies | Same artwork, matching sizes |
| `assets/images/weather-hero.png` | Background at the top of the Weather screen | Plain is fine; keep the size |
| Company logo the owner uploads in the app (Settings) | Stored per company in the database (`logo_url`) | Nothing to do in code; tell the owner they can upload it |

`node scripts/make-placeholder-art.cjs` makes plain placeholders in the brand color if the client has no logo yet.

### Name, contact, links (`brand.js` -> everywhere)
| Setting | Shows in | Also do |
|---|---|---|
| `company.*` | Fallback company name, invite texts, contact screen, support page, quote email reply address | Supabase function secrets `COMPANY_NAME`, `SUPPORT_EMAIL`, `COMPANY_TIMEZONE` (server code can't read brand.js) |
| `app.name`, `slug`, `bundleId`, `androidPackage`, `scheme` | Home screen name, App Store, permission messages ("Allow <name> to use the camera"), deep links | Needs a NEW build. Bundle id can never change after the App Store. Supabase redirect URL `<scheme>://auth-callback`. Secret `APP_NAME`. |
| `app.webUrl` | Invite links, quote approval links, password reset, legal pages, Apple invite-link file | EAS `EXPO_PUBLIC_WEB_URL`, Netlify site + custom domain, secret `APP_WEB_URL`, `node scripts/build-legal-pages.cjs` (also rewrites `public/.well-known/apple-app-site-association`) |
| `app.expoProjectId`, `expoOwner`, `appleTeamId` | Build and OTA updates, invite-link file | From `eas init` and Apple Developer; then rebuild legal pages |
| `legal.*` | Privacy, Terms, Support pages in the app and on the web | `node scripts/build-legal-pages.cjs` |
| Emails from the server (quotes, requests, clock-in alerts) | Sender name and address | Secret `NOTIFY_EMAIL_FROM` = "Company <noreply@their-domain>", Resend domain verified |

### Colors
| Setting | Shows in |
|---|---|
| `look.brandColor` | Main buttons, selected tabs, links, highlights, notification color, PDF headings, server email accents (secret `BRAND_COLOR`) |
| Everything else | Comes from `src/theme/colors.ts` (white / light gray / near-black; green-amber-red only for done-warning-error). Text on the brand color flips dark/light by itself. Never type a color into a screen (`plainLook.check` fails). |

### Words
| Setting | Shows in |
|---|---|
| `wording.job/jobs/place/places/crew/crews` (+ `wording.es` Spanish) | Every screen sentence (the `w()` helper and the translator swap them), tabs, menus, titles. Server emails say "job" / "job site" in plain words - edit those few lines in `supabase/functions` if the client's word is very different. |
| `wording.leaderRoleLabel` | Everywhere the admin role is shown. Database errors in `setup.sql` may still say "admin" - fine, or edit them. |
| `wording.units`, `materialUnits`, `materialCategories` | Quote/invoice line units, material suggestions, materials list groups |
| `wording.serviceTypes` | "Request a service" choices - **change `submit_service_request` in `supabase/setup.sql` to the exact same words** (`serviceRequests.check` compares them) |
| `wording.uniformSizeLabel` | The worker clothing-size question |
| Demo and sample text | `supabase/demo_data.sql` and `src/data/mock*.ts` (dev only): reword to the client's trade so demos look right |

### Weather
`weather.defaultPlace` and `weather.nearbyTowns`: the client's town and 5-8 nearby towns with lat/lon. This is the only list.

---

## PHASE 5 - SWITCH OFF WHAT THEY DON'T NEED

1. Set each switch in `brand.js` `features` from the approved page. OFF hides the tabs, menu rows, home cards and screens;
   a link to a switched-off screen shows "Not available". Data is never deleted.
2. **Prefer OFF over deleting code.** Switches keep the client's app on the same code as the kit, so kit fixes can be
   copied in later. Delete a feature's code only if the owner asks AND it will never come back; then follow the dependency
   map (what uses it, what breaks), remove its SQL from `setup.sql`, its checks and its tests, and run the full verify.
3. Switches marked "build" in brand.js (widgets, otaUpdates, anything under `app`) need a new phone build to change.
4. If `customerPortal` is OFF, also think about `messages`, `requests` and the invite flow for customers.

---

## PHASE 6 - THINGS THE KIT DOESN'T DO (new work)

1. **Was it in the landscaping app?** Snow plowing/salting dispatch, recurring maintenance visits, crew daily routes, Our Work
   portfolio. Copy it from the `landscape-app` repo (read only - never change that repo or its live database). Bring its
   screens, data code, SQL (fold into `setup.sql`), tests and checks; rename landscaping words; run the full verify.
   Budget real time: these pieces were wired into many files.
2. **Brand-new feature** (e.g. measuring an area on a map for a paving quote): write it up in the feature page with a rough
   size, mockup first, owner approval, then build it on its own branch with its own checks and database tests.
3. Never squeeze a new feature in by reusing a kit part for something it wasn't made for, without telling the owner.

---

## PHASE 7 - LEFTOVER SWEEP (prove nothing old is left)

Run these and make every one clean. Do not mark the brand step done until they are.

1. Search the whole repo (not `node_modules`, `.git`) - every hit must be fixed or explained:
   - kit placeholders: `Starter App`, `starter-app`, `com.yourcompany`, `yourcompany`, `Your Company`, `YOUR-`, `(555) 555`,
     `123 Main St`, `Your Town`, `Your State`, `EXAMPLE - REPLACE`, `CHANGE-ME` (allowed only in demo_data.sql)
   - the example weather towns (Lakewood NJ and the 7 others)
   - the original landscaping client's names, domains and ids, and ANY previous client's name, domain, bundle id or logo
   - trade words that don't fit this client (lawn, mulch, mow, landscap, snow...) in shown text
2. `npm run verify` (type check + every check + database tests) and `npx expo export` - exit codes 0. These checks enforce
   the "everywhere" rules: `brandSettings` (no names typed outside brand.js), `plainLook` (no typed colors, logo PDF copy
   matches), `brandContrast` (any brand color readable), `wordingNoProjectProperty` / `wordingFromSettings` (words come from
   settings), `serviceRequests` (app and database service lists match), `legal` (legal pages match), `inviteLinksOpenApp`.
3. Look at every main screen once with the client's settings (web preview is fine) and at one PDF quote: logo, name, color,
   words.

---

## PHASE 8 - DATABASE, ACCOUNTS, BUILD

Follow the NEW CLIENT CHECKLIST in `CLAUDE.md` steps 3-7: new Supabase project, `setup.sql` (the owner runs it), function
secrets + deploy with the CLI, email code template and Confirm email ON, Cloudflare R2 buckets, Expo project + EAS
environment values for every build profile, own Apple push key, App Store listing, legal pages on the client's domain,
web site values. No SQL and no builds unless the owner says so.

---

## PHASE 9 - HAND-OFF TEST ON A REAL PHONE

Before calling it done, with the owner, on a real iPhone: sign-up with the 6-digit code, an invite link for a worker and a
customer, password reset, a photo upload, a push notification, an OTA update (two cold launches), a quote PDF with the logo,
the customer approval link, and one switched-off feature really hidden. Keep the App Store demo account until Apple
approves the app. Send the owner the final `.txt` report.
