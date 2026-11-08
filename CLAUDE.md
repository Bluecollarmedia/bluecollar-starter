@AGENTS.md

# Starter App (blue-collar starter kit)

A company management app for contractors and trades (owner, workers, customers), built with Expo (React Native + web), Supabase, and Cloudflare R2.
Company name, app name, domain, bundle id and the other client settings are still plain placeholders ("Your Company", "Starter App",
app.yourcompany.com, com.yourcompany.starter); Step 3 moves them into one settings file.

## Stack
- **Framework**: Expo SDK 57, React Native 0.86, expo-router (file-based routing)
- **Platforms**: iOS, Android, Web
- **Auth & DB**: Supabase (auth + Postgres + Row Level Security)
- **Storage**: Cloudflare R2 (S3-compatible, presigned URL pattern)
- **Animation**: react-native-reanimated
- **Icons**: @expo/vector-icons (Feather set)

## Project Structure
- `app/` — expo-router file-based routing
  - `(auth)/` — Login, signup (unauthenticated)
  - `(owner)/` — Owner/admin tab navigation (5 tabs)
  - `(worker)/` — Worker tab navigation (3 tabs, mobile-first)
  - `(customer)/` — Customer tab navigation (3 tabs, polished/simple)
- `src/theme/` — Design system tokens (colors, typography, spacing, shadows)
- `src/components/ui/` — Reusable UI components (Button, Input, Card, etc.)
- `src/components/layout/` — Layout components (ScreenContainer)
- `src/components/branding/` — Logo/splash components
- `src/providers/` — React context providers (Auth, Theme)
- `src/lib/` — Supabase client, Cloudflare R2 storage utilities
- `src/types/` — TypeScript type definitions
- `supabase/migrations/` — Database migration SQL files

## Commands
- `npm start` — Start Expo dev server
- `npm run web` — Start for web
- `npm run ios` — Start for iOS
- `npm run android` — Start for Android

## Branding
- **Company / app name**: placeholders ("Your Company", "Starter App") until a client fills them in.
- **Colors**: `src/theme/colors.ts` still carries the original greens as a placeholder palette (Step 4 makes a plain default).
- **Logos**: `assets/images/logo-full.png` (wordmark) and `logo-leaf.png` (mark) are still the original pictures; Step 4 swaps them for plain placeholders.

## Roles
Three user roles: `owner`, `worker`, `customer`. Auth routing in `app/_layout.tsx` redirects to the correct group based on role.

## Design System
Import from `@/theme`. Brand colors live in `src/theme/colors.ts`.

## Important Notes
- Path alias: `@/` maps to `src/`
- Supabase credentials go in `.env` (see `.env.example`)
- Logo files go in `assets/images/logo-full.png` and `assets/images/logo-icon.png`

## Owner Navigation Architecture
`app/(owner)/_layout.tsx` is a `Stack` (not the tab bar itself). It wraps two things:
- `(tabs)` — a route group holding the actual 5-tab navigator (`index`, `projects/`, `maintenance/`, `workers/`, `more/`). Its `_layout.tsx` has the `Tabs`/`NativeTabs` code.
- A handful of screens presented as **modals**, declared as siblings of `(tabs)`: `worker-new`, `project-new`, `schedule-create`, `search`, `notification-center`.

Why: those 5 screens are opened from multiple tabs (e.g. Dashboard's quick actions, or a project detail's "Schedule worker" button). When a screen lives inside one tab's own folder, navigating to it from a *different* tab switches the selected bottom tab and breaks `Back`. Moving them above the tab navigator as modals means opening/closing them never touches tab-selection state — you always return to whatever tab/screen you were on.

Rule of thumb: if you add a new screen that's reachable from more than one tab and is a "do a thing, then return" flow (not an intentional "go look at this record" navigation like viewing a project), put it here as a sibling modal route, not inside a tab's folder. Detail-view navigation (View Project, View Worker) is intentionally left as normal cross-tab pushes — that's expected to switch tabs.

Customers is no longer a tab: `app/(owner)/customers/` sits above `(tabs)` as a normal push (like `resources`), opened from More and from project / maintenance property records. Its URL (`/(owner)/customers/[id]`) is unchanged.

Quotes & invoices follow the same rule: `document` (view a quote / change order / invoice, a normal card push), `document-new` and `document-edit` (modals) are siblings of `(tabs)`, opened from Owner → More → Quotes & Invoices, a project's More → Financials, or a notification. The customer side has its own `(customer)/document`.

`ScheduleProvider` wraps the whole `Stack` in `(owner)/_layout.tsx` (not inside `(tabs)/_layout.tsx`) so the tabs and the modal screens share the same schedule state.

## Quotes, Change Orders & Invoices
- Tables: `quotes`, `change_orders`, `invoices`, `financial_events` (`supabase/updates/008_quotes_invoices.sql`). Line items live in each document's `line_items` JSON, so a document always re-prints as saved.
- Once a document leaves Draft the database locks its contents (trigger `lock_financial_document`); statuses only move forward. Change a sent document by duplicating it as a new draft (`duplicateAsDraft`).
- Customers see only sent/issued documents of their own project and answer through the `respond_to_financial_document` RPC. Workers can't see financials.
- Logic: `src/data/financials.ts`. Money math in cents: `src/lib/money.ts`.
- PDFs: one HTML template (`src/lib/documentHtml.ts`) drives both the in-app preview (react-native-webview) and the PDF (expo-print → pdf-lib stamps footer/page numbers → expo-sharing). The real logo is embedded from `src/lib/brandLogo.ts` (generated from `assets/images/logo-full.png`).
- Approval links: each quote / change order has a random `share_token`. `app/approve/[token].tsx` is a public web page (no login; `app/_layout.tsx` skips auth redirects for it) that reads the document via `get_shared_document` and answers via `respond_by_link` (typed name required to approve; name, time, IP and browser go into `financial_events.metadata`). Links use `EXPO_PUBLIC_WEB_URL`; without it the app only shares PDFs.
- `metro.config.js` forces tslib's CommonJS build: without it the web app crashes on load (`tslib.default` undefined in Supabase's code). Keep it, the approval page depends on the web build.

## Push Notifications & Email
- Every `app_notifications` row is also pushed to the recipient's phones. Phones register their Expo push token in `push_tokens` (`register_push_token`, after sign-in; `unregister_push_token` on sign-out) via `src/lib/push.ts` / `src/hooks/usePushNotifications.ts`, which also opens the right screen when a push is tapped.
- Trigger `app_notifications_push` (pg_net) calls the `send-notification` Edge Function with only the notification id; the function reads the row, marks `pushed_at` (so each goes out once), sends via the Expo push service, and for `quote_approved` / `quote_declined` also emails the recipient through Resend. Function URL lives in `app_settings.functions_url`.
- To push something new, just insert an in-app notification (`notifyOwners` / `notifyPeople` in `src/data/actions.ts`); no push code needed.
- Deploy: `supabase functions deploy send-notification --no-verify-jwt`; secrets `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM`, `APP_WEB_URL`. iOS push needs an APNs key, which EAS creates during an interactive `eas build` (answer yes when asked about push notifications).

## Worker & Customer Navigation
`app/(worker)/_layout.tsx` and `app/(customer)/_layout.tsx` are also a `Stack` over a `(tabs)` group. Detail screens (worker `task/[id]`, `job/[id]`, `day/[date]`, `edit-profile`, `notifications`; customer `project`) sit beside `(tabs)` in the Stack. Don't move them back into the tab navigator with `href: null`/`hidden`: native tabs can't navigate to routes that aren't tab triggers, so those taps silently do nothing on iOS (works on web, which uses JS tabs).

Scrollable tab screens need `useTabBarClearance()` (`src/hooks/`) as bottom padding so the last item clears the floating Liquid Glass tab bar; `ScreenContainer` already applies it.

## EAS / Build State
- No Expo project is linked yet. Run `eas init` with the client's own Expo account, then put the project id and account name in `app.config.js` (EXPO_PROJECT_ID / EXPO_OWNER).
- Apple Team ID: the client's own. Put it in `public/.well-known/apple-app-site-association` (replace `YOURTEAMID`).
- `eas build`/`eas submit` need interactive Apple sign-in the first time (distribution certificate, provisioning profile, App Store Connect app lookup) — can't be run `--non-interactive` from a fresh environment.
