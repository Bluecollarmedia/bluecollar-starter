# RULEBOOK - Starter App (blue-collar starter kit)

This file is the rulebook for the kit. Two readers:
- **The owner** (not a developer): read the rules and the NEW CLIENT CHECKLIST. Skip the code words you do not need.
- **Claude** (every future session that builds a client app from this kit): follow every rule. They come from three months of
  building the original app; each one cost real time, money or a broken phone build to learn.

Each rule is: **the rule**, then *Why* in one line. `scripts/checks/rulebook.check.cjs` fails if a key rule goes missing from this file.

The app: a company app for contractors and trades (owner, managers, workers, customers). Expo SDK 57 + expo-router (iPhone,
Android, web), Supabase (logins, database, server functions), Cloudflare R2 (photos and files).

**Expo has changed.** Read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing Expo code.
*Why:* older Expo answers from memory are often wrong for SDK 57.

---

## A. HOW WE WORK (owner + Claude)

1. **SQL only when the owner asks. Claude never runs SQL** (no SQL editor, no `psql`, no Supabase dashboard). Write SQL as files,
   keep a running list of what is still owed and in what order, and hand it over as copyable text when the owner says he is ready.
   *Why:* the owner runs every database change himself, at a time he picks (usually build time).
2. **One SQL file per Supabase editor tab**, and check the project's Reference ID first (right project).
   *Why:* a combined batch once rolled back without a clear error, and SQL once went to the wrong project.
3. **Never say a SQL file is live without a check query** the owner ran. *Why:* "I gave it to him" is not "it ran".
4. **No builds, submits or OTA updates unless the owner says so** (`eas build`, `eas submit`, `eas update`). Build and submit are
   separate words: wait for "submit" too. Say "ready to build when you say". *Why:* each build costs build minutes and a TestFlight number.
5. **No merges, deploys or pushes to GitHub without the owner's word** for that run. *Why:* he decides what goes live and when.
6. **Reports to the owner go as a short plain .txt file** (one or two chat lines, the rest in the file). Questions that need an
   answer stay in chat. *Why:* he reads on his phone and copies reports into other tools.
7. **Plain words, small steps.** One small branch + pull request per change; find the cause first; add a check or test per fix.
   *Why:* the owner is not a developer and must be able to follow and undo each change.
8. **Build first, test at the end.** The owner tests each feature himself on a real phone. Say plainly what is
   "not checked on a phone". *Why:* only a real phone proves photos, push, links and sign-in.
9. **Do not fight the browser preview pane** to prove a phone feature. Run the checks and say "unverified on a phone".
   *Why:* the web preview looks and acts nothing like the phone; a two-hour fight with it was wasted.
10. **Long fix lists: wait for "start", do all of it, park questions, ask them ONE AT A TIME at the end.**
    *Why:* the owner sends batches and does not want to be stopped every few minutes.
11. **Be honest about what is unfinished.** List what is half-done or switched off in every report. *Why:* hidden gaps came back as surprises.
12. **When "the app doesn't work", check the live backend first** (deployed function version, secrets, redirect URLs, settings)
    before the app code, and ask for the exact on-screen error. Never call an outside probe proof of a private thing's state.
    *Why:* deployed functions drift from the repo, and a wrong "root cause" once wasted days.
13. **Save tokens:** no swarms of background agents unless asked. *Why:* the owner stopped a costly multi-agent run before.
14. **On Windows, write script files with the file-writing tool, not a Bash heredoc.** *Why:* heredocs there collapse double backslashes.

## B. KEYS AND SECRETS

15. **Never commit keys or secret values.** Only placeholders go in git (`.env.example`). App values (`EXPO_PUBLIC_...`) go in the EAS
    environment; server secrets go in with `supabase secrets set NAME=value`. Never echo a key in chat or a report.
    *Why:* the GitHub repo is public, and a pasted secret has to be replaced everywhere.
16. **`src/config/brand.js` holds no secrets.** *Why:* it is shipped inside the app for anyone to read.

## C. ACCOUNTS, JOINING, SIGN-IN

17. **One company per database.** "Create a Company" shows only while no company exists. Every client gets its own new Supabase project.
    *Why:* the whole database and its security rules are built around one company.
18. **Workers and customers join ONLY through a private invite link** (Add Worker / Add Customer = name + phone, then text or copy
    the link). No join codes, never matching people by email. *Why:* matching by email let a stranger take over a record (R5).
19. **Email confirmation uses a 6-digit code typed in the app, not a link.** *Why:* the confirm link was broken in the original app.
20. **Turn "Confirm email" ON for every client - in this order:** (1) set the Supabase "Confirm signup" email template to show the
    6-digit code, (2) deploy `invite-signup` from the repo (login check OFF), (3) test one worker invite sign-up on a phone,
    (4) THEN turn Confirm email on. *Why:* on too early breaks invite sign-ups; left off, "Add customer by email" can link a stranger (R6, R7).
21. **Add the auth redirect URL `<scheme>://auth-callback`** in Supabase > Authentication > URL Configuration (scheme = `app.scheme`
    in brand.js), then **test confirm AND password reset on a real phone before launch.** *Why:* without it email links never come back into the app.
22. **Password reset needs a real email sender:** the client's own domain verified in Resend, set as Supabase custom SMTP.
    *Why:* Supabase's built-in email only reaches the project's own team.
23. **Invite sign-up goes through the `invite-signup` function**, which makes the login already confirmed for a valid, unused link.
    *Why:* no second confirmation email for invited people.
24. **Assignment means access:** a worker put on a job sees that job, whatever his worker type. Every picker lists ALL active
    workers / customers; only deactivated people are hidden. One shared list of people. *Why:* hidden people caused "where is my job?" calls.
25. **A customer is linked to the app ONE time;** putting that customer on any job links it automatically. *Why:* per-job access setup angered the owner.
26. **Deleting people:** no history = real delete (and the invite is revoked); has history = deactivate (keeps payroll and records;
    Reactivate is offered). The owner cannot delete his own login. Company delete is owner-only, needs the typed name, and is permanent.
    *Why:* payroll and records must survive; a company wipe must never happen by accident.

## D. SETTINGS (`src/config/brand.js`)

27. **Everything client-specific lives in `src/config/brand.js`** (company, contact, app name, bundle id, scheme, Expo ids, web
    address, Apple Team ID, colors, pictures, wording, feature switches, legal facts, weather towns). The app reads it through
    `src/config/brand.ts` (`@/config/brand`); `app.config.js`, the legal pages and the Apple link file read it too.
    *Why:* one file per client; nothing to hunt for. (Check: `brandSettings`.)
28. **Screens never type a client name, word or color.** *Why:* the next client would see the last client's name.
29. **Wording: write screen text with Job / Jobs / Job site / Job sites / Crew / Crews** (never "Project" or "Property").
    `t()` / `tr()` swap in the client's words by themselves; an English-only screen wraps text in `w('New Job')` from `@/config/brand`.
    *Why:* one change in brand.js renames every screen, in English and Spanish. (Checks: `wordingNoProjectProperty`, `wordingFromSettings`.)
30. **Colors only through the theme** (`@/theme`; the brand color is `look.brandColor`). Green / amber / red only mean done / warning / error.
    *Why:* one brand color restyles the app. (Check: `plainLook` fails on a typed-in color.)
31. **Feature switches:** `brand.js` `features`. Hide entry points with `isFeatureOn('x')` and list the feature's screens in
    `src/config/featureRoutes.ts` (they show "Not available" when off). Switches marked "build" need a new phone build.
    *Why:* each client gets only what it paid for, without deleting code.
32. **After changing `company` or `legal`, run `node scripts/build-legal-pages.cjs`.** After swapping the logo, rebuild
    `src/lib/brandLogo.ts` (see the note in that file). *Why:* the legal web pages and the PDF logo are made from these, not read live.
33. **Server functions cannot read brand.js:** give them the same values as Supabase secrets (`COMPANY_NAME`, `APP_NAME`,
    `APP_WEB_URL`, `SUPPORT_EMAIL`, `NOTIFY_EMAIL_FROM`, `BRAND_COLOR`, `COMPANY_TIMEZONE`, `WEATHER_ENABLED`; see `.env.example`).
    *Why:* otherwise emails show the kit's placeholder name.

## E. SCREENS AND NAVIGATION

34. **Every Back button needs a fallback:** `router.canGoBack() ? router.back() : router.replace(<home or a known screen>)`.
    *Why:* when the app opens straight on a screen there is no history, and a plain `router.back()` does nothing.
35. **The root Slot gotcha.** `app/_layout.tsx` shows ONE root area at a time (a `<Slot />`). Opening a screen that sits at the
    ROOT level (straight under `app/`) closes the whole signed-in area: Back lands on the first tab and typed text is lost.
    So push new screens INSIDE the area's own Stack, like the legal-support pattern: `app/(owner)/legal-support/*`,
    `app/(worker)/legal-support/*`, `app/(customer)/legal-support/*`. Signed-out extras use a Modal. Public pages
    (`app/legal/*`, `app/approve/*`, `app/invite/*`) stay at the root on purpose. *Why:* this bug cost lost forms and a day of hunting.
36. **Screens opened from more than one tab ("do a thing, then return") are siblings of `(tabs)` in the area Stack** (as modals),
    not inside one tab's folder. Detail screens also sit beside `(tabs)`; never hide them as `href: null` tabs.
    *Why:* otherwise Back switches tabs, and on iPhone native tabs silently ignore taps to hidden tab routes.
37. **Scrollable tab screens use `useTabBarClearance()` bottom padding** (`ScreenContainer` already does). *Why:* the floating tab bar covers the last row.
38. **Every alert with buttons uses `confirmAction` / `showMessage`** (`src/components/financials/ActionSheet.tsx`), never
    `Alert.alert` with buttons or browser `alert()`. *Why:* `Alert.alert` buttons do nothing on the web. (Check: `webDialogs`.)
39. **No React hook after an early return or after `&&` / `||` / `?`.** All hooks go at the top, before any `if (...) return`.
    *Why:* a changing hook order crashes the screen, and this took hours to find before.
40. **Never open a sheet on top of a sheet:** close the first, then open the next. *Why:* iPhone cannot show two native sheets; it froze the app.
41. **Bottom sheets close with a swipe down, no "Discard?" prompt; a typed draft is kept while the page is open (`useKeepDraft`).** *Why:* owner's choice.
42. **Every step change in a multi-step form scrolls back to the top.** *Why:* the next step otherwise opens half-way down.
43. **Header "+" actions sit top-right on every tab.** *Why:* one place to look.
44. **Never push a screen with video players over a screen that still has mounted players;** take the lower ones down first.
    *Why:* the app dies with no error message.

## F. PHOTOS AND FILES

45. **Cloudflare R2 photo storage is required, including `R2_PRIVATE_BUCKET_NAME`** (a second bucket with NO public address, for
    worker ID photos). Without R2 uploads fail with "Photo storage is not set up"; without the private bucket ID photos are refused.
    *Why:* there is no quiet fallback to an open bucket any more (R17, R19).
46. **All uploads go through the one shared path** (`src/lib/media.ts` -> the `media` server function). *Why:* one place for rules, retries and clean-up.
47. **Copy a picked photo/video with `expo-file-system/legacy` `copyAsync` BEFORE uploading** (`src/lib/keepPickedFile.ts`), and
    upload with the legacy upload task. *Why:* the new File API cannot read picker files on iPhone; this was the real cure for "photo not saved".
48. **Uploads retry on dropped connections; tapping a failed photo shows the real error.** *Why:* job sites have bad signal.
49. **Video: let the iPhone picker encode once at 720p (`VIDEO_PICK_OPTIONS`) and pass the real width/height to the resizer.**
    *Why:* a guessed size made blurry, squashed videos.
50. **Accepted file types live in `src/lib/mediaFormats.ts` and must match the `media` function's list;** change both, then redeploy `media`.
    *Why:* a mismatch refuses uploads the app offers.
51. **Deleting a row with a file also queues the file for the storage clean-up.** *Why:* otherwise R2 fills with orphaned files.

## G. DATABASE

52. **`supabase/setup.sql` is the single source of the database.** A new client = run setup.sql on a NEW empty Supabase project
    (the owner runs it). *Why:* the old 125 update files were folded into this one file.
53. **Changing the database for a client = edit setup.sql AND, for a database that is ALREADY live, write a small numbered
    change file** that the owner runs. *Why:* setup.sql is for new projects; a live database needs only the difference.
54. **Keep `supabase/tests/setup` green** (`npm run test:db`), and add a test for every database change. *Why:* the tests are the only proof before a real project.
55. **Service types in `brand.js` (`wording.serviceTypes`) must match setup.sql (`submit_service_request`) exactly.** *Why:* any other word is refused.
56. **`supabase/demo_data.sql` only on a TEST/demo project** (change the password line first). **`admin_reset_all_data.sql` deletes
    everything;** never paste it with setup.sql. *Why:* one company per database, so demo data in a live database IS the client's company.

## H. SERVER FUNCTIONS

57. **Deploy server functions from the repo with the Supabase CLI** (`supabase functions deploy`), so `supabase/config.toml` applies.
    Never paste them into the website editor. *Why:* pasted versions drift from the repo and nobody can see what is live.
58. **Four functions must have the login check OFF:** `send-notification`, `notify-request`, `invite-signup`, `weather`. Every
    other function keeps it ON. *Why:* they are called without a login; a plain deploy turns the check on and silently stops
    pushes, request emails, invite sign-ups and public weather. (Check: `functionsConfig`.)
59. **Fill in `functions_url` (the FILL IN line at the top of setup.sql)** with the project's functions address. *Why:* without it no push or owner email is sent.
60. **Push: just insert an `app_notifications` row** (`notifyOwners` / `notifyPeople` in `src/data/actions.ts`); the trigger and
    `send-notification` push it. *Why:* no new push code needed.
61. **Spanish push text is translated only by event type or exact system wording, never on people's own words** (announcements,
    chat). *Why:* blanket word rules turned "meeting at the shop" into half-Spanish.

## I. BUILDS, OTA, APP STORE

62. **`EXPO_PUBLIC_` values come from the EAS environment** (one for every build profile), not from `eas.json` and not from `.env`
    in builds. The web site (Netlify or other) needs its own copies. A release build with missing values shows **"App not set up"**
    on purpose (no demo mode). *Why:* values are baked in at build/OTA time; missing ones once made a build quietly run demo data.
63. **Use the client's business domain from day one** for the web address (`app.webUrl` / `EXPO_PUBLIC_WEB_URL`): invite links,
    approval links, universal links, emails. *Why:* changing the domain later breaks links people already have.
64. **Phones need TWO cold launches to show an OTA update:** the first launch downloads it, the second shows it. JS-only fixes can
    go by OTA; native changes (brand.js `app`, permissions, icons, "build" switches) need a new build. *Why:* testers think the update failed.
65. **Publish an OTA only from a fresh copy of main** (`git fetch` first). *Why:* a stale copy once broke a publish.
66. **One Apple push key can serve several apps; revoking it breaks push for ALL of them.** Prefer one push key per client
    Apple account. *Why:* the original key is shared with another app.
67. **Keep the App Store demo account (and its data) until Apple approves the app;** remove demo logins after. *Why:* reviewers sign in with it.
68. **The privacy policy must list every outside service that gets data** (`src/legal/legalContent.ts`). *Why:* the App Store and customers hold the company to it.
69. **The first `eas build` / `eas submit` and `eas credentials` need the owner at the keyboard** (Apple sign-in, menus).
    *Why:* Claude cannot drive those interactive prompts.
70. **Keep `metro.config.js`'s tslib fix.** *Why:* without it the web app (and the public quote-approval page) crashes on load.

## J. FEATURE RULES WORTH KNOWING

71. **Time clock: `src/lib/clockSession.ts` is the ONE rule for every clock.** A forgotten open workday is flagged at zero length,
    never closed at "now"; it counts zero hours until the owner accepts an end time. Clock-out shows success only when the server confirms.
    *Why:* guessed hours become wrong paychecks.
72. **Quotes / change orders / invoices lock once they leave Draft;** change them by duplicating as a new draft. Money math in cents
    (`src/lib/money.ts`). One HTML template drives the preview and the PDF. *Why:* a sent document must re-print exactly as sent.
73. **Spanish: one translation per phrase** (check: `i18nNoDuplicates`). Worker and customer screens are translated; owner screens
    are English only (owner's choice). *Why:* duplicate phrases made later files overwrite the right words.
74. **The Google Places key is restricted to the app's bundle id** (requests send it). *Why:* a different bundle id gets every suggestion refused.

## K. VERIFY BEFORE MERGE

75. **Fresh route types first:** delete `.expo/types`, start Expo briefly (`npx expo start`, then stop it) so it rewrites the route list.
    *Why:* a stale list hides links to deleted or renamed screens.
76. **`npm run verify`** = typecheck + every check (`npm run check`) + database tests (`npm run test:db`). All must pass.
77. **`npx expo export`** too. *Why:* the typecheck never sees broken `require()` picture paths; only bundling does.
78. **Judge by EXIT CODES, not printed words.** *Why:* a check with a syntax error crashes without printing FAIL.
79. **Each change on its own branch + pull request** (never straight to main). *Why:* small, reviewable, easy to undo.

---

## NEW CLIENT CHECKLIST

1. **Agree what to build first:** a one-page feature list + approved mockups BEFORE any code. Decide every switch in
   `brand.js` `features` (on/off).
2. **Fill in `src/config/brand.js`:** company and contact, app name, bundle id / Android package, scheme, web address on the
   client's own domain, colors, pictures (logo, icon, splash, Android icon), wording (Job / Job site / Crew words, Manager label,
   units, service types), switches, legal facts, weather town and nearby towns. Change the weather server function's town list
   (`supabase/functions/weather/index.ts`, TOWNS) to match. Run `node scripts/build-legal-pages.cjs` and rebuild `src/lib/brandLogo.ts`.
3. **New Supabase project** (one per client): turn on the extensions (pg_net, supabase_vault), edit the FILL IN line, and the owner
   runs `supabase/setup.sql`. Set the function secrets from `.env.example` (`supabase secrets set`). Deploy the functions with the
   CLI (`supabase functions deploy`). Set the auth email templates to the 6-digit code, add the redirect URL
   `<scheme>://auth-callback`, set up custom SMTP (Resend, client's domain), THEN turn Confirm email on (rule 20 order).
4. **Cloudflare R2:** a public bucket and a private bucket (no public address); set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_PRIVATE_BUCKET_NAME` as Supabase secrets.
5. **Store and build setup:** new bundle id; new Expo project (put its id and owner in brand.js); EAS environment variables for
   EVERY build profile (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_R2_PUBLIC_URL`,
   `EXPO_PUBLIC_WEB_URL`, `EXPO_PUBLIC_GOOGLE_PLACES_KEY`); a new Apple push key on the client's Apple account; a new App Store
   listing; legal pages hosted on the client's domain (`node scripts/build-legal-pages.cjs`); the web site (Netlify or other)
   with its own `EXPO_PUBLIC_` values and the custom domain; `apple-app-site-association` with the real Apple Team ID
   (fill `app.appleTeamId`, then re-run the legal-pages script).
6. **Optional demo:** run `supabase/demo_data.sql` on a TEST project only (change the password line). Remove demo logins before
   launch. Keep the App Store review demo account until Apple approves.
7. **Verify:** fresh route types, `npm run verify`, `npx expo export`. The first build only when the owner says. Then test on a
   real phone: sign-in code, invite link (worker and customer), password reset, photo upload (incl. a task photo), push, and an
   OTA update (two cold launches).

---

## WHAT'S IN THE KIT

- `app/` - screens (expo-router: the folder layout IS the navigation)
  - `_layout.tsx` - the root: picks the area by role (the Slot, rule 35)
  - `(auth)/` - welcome, login, verify-email (6-digit code), forgot-password, create-company
  - `(owner)/` - owner and managers: Stack over `(tabs)` (home, jobs, workers, more) + modal and detail screens beside it
  - `(worker)/` - workers: Stack over `(tabs)` (today, jobs, clock, activity, settings)
  - `(customer)/` - customers: Stack over `(tabs)` (home, messages, account)
  - `(onboarding)/`, `invite/` (invite links), `approve/` (public quote approval), `legal/` (public legal pages),
    `auth-callback.tsx`, `reset-password.tsx`, `weather/` (signed-out visitor area)
- `src/config/brand.js` - THE settings file (`brand.ts` types it; `featureRoutes.ts` lists screens per switch)
- `src/theme/` - colors, type, spacing (all colors come from here)
- `src/components/`, `src/hooks/`, `src/providers/` (Auth, Theme, Worker), `src/data/` (database calls), `src/lib/` (helpers:
  `media.ts`, `clockSession.ts`, `money.ts`, `invite.ts`, `keepPickedFile.ts`...), `src/i18n/` (Spanish), `src/legal/` (legal text)
- `supabase/setup.sql` - the whole database; `demo_data.sql` - fake Demo Company; `admin_reset_all_data.sql` - wipe (danger)
- `supabase/config.toml` - login-check setting per server function
- `supabase/functions/` - server functions (media, invite-signup, send-notification, notify-request, weather, storage-cleanup,
  clock-in-alert, send-document-email, ...)
- `supabase/tests/` - database tests (`npm run test:db`, runs in PGlite, nothing to install; see its README)
- `scripts/checks/*.check.cjs` - the checks (`npm run check`); `scripts/build-legal-pages.cjs`; `scripts/make-placeholder-art.cjs`
- `docs/` - design notes: accounts, customers and job sites, photo pipeline, time tracking
- `app.config.js` (reads brand.js), `app.json`, `eas.json` (no keys in it), `.env.example` (placeholders only), `public/` (web extras)

Roles in the database: `owner`, `admin` (shown as "Manager", `wording.leaderRoleLabel`), `worker`, `customer`.
Path alias: `@/` = `src/`.

## KNOWN ROUGH EDGES

- **R6 - Add customer by email:** an existing login with that email is linked to the customer. Safe once Confirm email is ON
  (rule 20); until then prefer the invite link.
- **Customer access off:** a customer whose access is turned off can still READ his own old job rows (a 1-line fix in setup.sql,
  not made yet - owner's call).
- **TRUNCATE grants:** a low-risk database permission is granted too widely; the app cannot use it, but removing it is good hardening (not done).
- **Light brand color:** with a LIGHT `look.brandColor` some buttons keep white text. Fine with charcoal or any dark color.
- **Not seen on a real phone yet:** the glass bars on white, gray cards next to white sheets, the new home-screen icon, and hiding
  the worker Clock tab / customer Messages tab when switched off.
- **Weather towns live in 2 places:** brand.js and `supabase/functions/weather/index.ts` (a check keeps them equal). The kit
  ships example New Jersey towns - replace both.
- **To test on a phone (from the original app):** B2 - email confirm / reset links (add the redirect URL first);
  B3 - task photo upload on a real iPhone.
- **Notice switches:** the worker "Push Notifications" switch is saved but the server ignores it, and a few notice types offered
  as switches are never sent (H16).
- **No offline mode:** the app needs a signal. Very large companies: each list loads at most 5,000 rows.
- **Server emails** were restyled; redeploy the functions per client for that to show.
