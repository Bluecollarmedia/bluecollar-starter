/**
 * ============================================================================================================================
 *  YOUR APP'S SETTINGS  -  the ONE file a new client fills in.
 * ============================================================================================================================
 *
 *  Everything a customer of this kit would want to change lives here: the company's name and contact details, the app's name
 *  and store ids, the brand color, what things are called ("Job" or "Project"), and on/off switches for every feature.
 *  The app's screens, the build settings (app.config.js) and the public legal pages all read this file, so a value is
 *  typed ONCE, here.
 *
 *  HOW TO EDIT
 *  - Change only the text between the quotes, the numbers, and true / false. Keep every comma and bracket.
 *  - true = on, false = off.
 *  - After changing anything under "legal" or "company", run:  node scripts/build-legal-pages.cjs
 *    (it remakes the public Privacy / Terms / Support web pages from these values).
 *  - Changes to "app" (name, bundle id, scheme, icon...) need a NEW phone build (eas build), not just an update.
 *  - Check your work with:  node scripts/checks/brandSettings.check.cjs
 *
 *  This is a plain JavaScript file on purpose: the build tools (app.config.js) run it directly with Node.
 *  The app reads it through src/config/brand.ts, which adds the types. Do not put secrets or keys in this file:
 *  it is shipped inside the app. Keys go in the EAS / Supabase environment (see .env.example).
 *
 *  The Supabase server functions cannot read this file. Where they need the same value (company name, web address,
 *  email sender) set the matching Supabase secret: COMPANY_NAME, APP_NAME, APP_WEB_URL, SUPPORT_EMAIL, NOTIFY_EMAIL_FROM,
 *  BRAND_COLOR, COMPANY_TIMEZONE (listed in .env.example).
 */
module.exports = {
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // COMPANY  -  who the business is
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  company: {
    /** The business name people see (used until the owner types the company name in the app, and in invite texts). */
    name: 'Your Company',
    /** The full legal name, e.g. "Smith Paving LLC". Shown on the Privacy Policy and Terms. */
    legalName: 'Your Company LLC',
    phone: {
      /** The phone number as people should read it. */
      display: '(555) 555-0100',
      /** The same number for the "tap to call" button: "tel:" then digits only (add +1 for the US if you like). */
      tel: 'tel:5555550100',
    },
    /** Where customers write for help. Also the reply address on emailed quotes when the company has no email set. */
    supportEmail: 'support@yourcompany.com',
    /** The mailing address, one line per entry. Shown on the legal and support pages. */
    addressLines: ['123 Main St', 'Your Town, ST 00000'],
    /** The company's normal website (not the app's web address; that is app.webUrl below). */
    website: 'https://yourcompany.com',
    /** The state the business is in (2 letters). Used as the example on address forms. */
    state: 'ST',
    /** The company's local time zone (a name from the IANA list, e.g. America/Chicago, America/Denver, America/Los_Angeles). */
    timezone: 'America/New_York',
  },

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // APP  -  store, build and link settings (changes here need a new phone build)
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  app: {
    /** The app's name on the home screen, in the App Store and in permission messages ("Allow <name> to use the camera"). */
    name: 'Starter App',
    /** A short id for Expo: lowercase letters, numbers and dashes only. */
    slug: 'starter-app',
    /** The iPhone bundle id, reverse-domain style (com.yourbusiness.app). Cannot change after the app is in the App Store. */
    bundleId: 'com.yourcompany.starter',
    /** The Android package name. Usually the same as the bundle id. */
    androidPackage: 'com.yourcompany.starter',
    /** The app's own link start, e.g. "starter" makes links like starter://auth-callback. Lowercase letters only.
     *  Supabase > Authentication > URL Configuration must list "<scheme>://auth-callback". */
    scheme: 'starter',
    /** Filled in after running `eas init` with your own Expo account. Leave the "YOUR-" text until then. */
    expoProjectId: 'YOUR-EXPO-PROJECT-ID',
    /** Your Expo account or organisation name. Leave the "YOUR-" text until then. */
    expoOwner: 'YOUR-EXPO-ACCOUNT',
    /** The web address of the web app (invite links, quote approval links, password reset and legal pages live here).
     *  No slash at the end. The EAS value EXPO_PUBLIC_WEB_URL, when set, wins over this. */
    webUrl: 'https://app.yourcompany.com',
    /** Your Apple Developer Team ID (10 letters/numbers, Apple Developer > Membership). Used for the invite-link file. */
    appleTeamId: 'YOUR-APPLE-TEAM-ID',
  },

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // LOOK  -  colors and pictures
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  look: {
    /** The ONE brand color, as a 6-digit hex code: main buttons, selected tabs, links and small highlights. */
    brandColor: '#2B2B2B',
    /** Picture files (swap the files themselves to change them; keep these paths). */
    logo: './assets/images/logo-full.png',
    icon: './assets/images/icon.png',
    androidIconForeground: './assets/images/icon-foreground.png',
    androidIconBackground: '#FFFFFF',
    splashImage: './assets/images/logo-full.png',
    splashBackground: '#FFFFFF',
  },

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // WORDING  -  what things are called in the app
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  wording: {
    /** One piece of work for a customer, e.g. "Job" / "Jobs" or "Project" / "Projects". */
    job: 'Job',
    jobs: 'Jobs',
    /** The place where the work is done, e.g. "Job site" / "Job sites" or "Property" / "Properties". */
    place: 'Job site',
    places: 'Job sites',
    /** A team of workers. */
    crew: 'Crew',
    crews: 'Crews',
    /** What the app calls a helper with extra rights (the "admin" role inside the database stays 'admin'). */
    leaderRoleLabel: 'Manager',
    /** What the optional clothing-size question is called (features.uniformSize). */
    uniformSizeLabel: 'Shirt size',
    /** The quick unit choices when adding a line to a quote or invoice. */
    units: ['ea', 'hr', 'day', 'sq ft', 'sq yd', 'ln ft', 'ton', 'cu yd', 'gal', 'load', 'lot'],
    /** Units that mean "this quote line is a material" (they suggest the materials list from an approved quote).
     *  Written in lowercase, without the plural "s". */
    materialUnits: ['ton', 'yd', 'cu yd', 'cuyd', 'cy', 'yard', 'cubic yard', 'bag', 'pallet', 'roll', 'gal', 'gallon',
      'bundle', 'piece', 'pc', 'stone', 'block', 'paver', 'lb', 'sq yd', 'load', 'sheet'],
    /** The services a customer can ask for on "Request a service".
     *  IMPORTANT: the database (setup.sql, function submit_service_request) accepts ONLY these exact words.
     *  Change both together, or every request will be refused. */
    serviceTypes: ['New installation', 'Repair', 'Maintenance', 'Inspection', 'Estimate request', 'Other'],
    /** The groups the owner's notes are sorted into on a materials list (first match wins, top to bottom).
     *  Each group: a name, and the words that put a note line in it (lowercase; a plural "s" is matched too, and a space
     *  also matches no space, so "top soil" finds "topsoil"). Lines that match nothing go under "Other notes". */
    materialCategories: [
      { name: 'Asphalt & Sealcoat', words: ['asphalt', 'blacktop', 'hot mix', 'cold patch', 'sealcoat', 'sealcoating', 'sealer', 'crack fill', 'crack filler', 'tack coat', 'emulsion'] },
      { name: 'Concrete & Masonry', words: ['concrete', 'cement', 'mortar', 'polymeric', 'rebar', 'footing', 'grout'] },
      { name: 'Stone & Gravel', words: ['stone', 'gravel', 'rock', 'boulder', 'flagstone', 'belgian', 'rip rap', 'crushed', 'pea gravel', 'screenings', 'rubble', 'stone dust', 'aggregate'] },
      { name: 'Block & Brick', words: ['paver', 'retaining wall', 'wall block', 'block', 'brick', 'cap stone', 'capstone', 'coping', 'step'] },
      { name: 'Soil & Sand', words: ['top soil', 'soil', 'dirt', 'fill', 'sand', 'loam'] },
      { name: 'Lumber', words: ['lumber', 'plywood', 'osb', 'board', 'stud', 'joist', 'beam', 'post', 'timber', '2x4', '2x6', '2x8', '2x10', '2x12', '4x4', '6x6'] },
      { name: 'Paint & Striping', words: ['paint', 'primer', 'stain', 'striping', 'line paint', 'stencil', 'caulk'] },
      { name: 'Fabric & Liner', words: ['fabric', 'geotextile', 'liner', 'tarp', 'plastic', 'vapor barrier'] },
      { name: 'Drainage & Pipe', words: ['pipe', 'drain', 'drainage', 'valve', 'corrugated', 'pvc', 'catch basin', 'downspout', 'culvert'] },
      { name: 'Lighting & Electrical', words: ['light', 'lighting', 'wire', 'wiring', 'transformer', 'fixture'] },
      { name: 'Hardware', words: ['screw', 'nail', 'spike', 'stake', 'fastener', 'bracket', 'anchor', 'staple', 'adhesive', 'glue'] },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // FEATURES  -  on/off switches (true = on). Turning one off hides its buttons, tabs, menu rows and screens.
  // It never deletes data. A few need a new phone build to change (marked "build").
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  features: {
    /** Local weather for signed-in people (the weather button on each home screen). */
    weather: true,
    /** People who open the app WITHOUT signing in see a public weather + "Request a service" + contact area instead of
     *  just the sign-in screen. Also needs the owner's "Public weather" switch in Settings. Needs features.weather. */
    publicVisitorArea: false,
    /** Home-screen and lock-screen weather widgets (build). Needs features.weather. */
    widgets: false,
    /** The optional clothing-size question for workers (named by wording.uniformSizeLabel). */
    uniformSize: true,
    /** The optional private photo of a worker's ID (driver license). */
    workerIdPhoto: true,
    /** Lets a job on the schedule repeat (every week, etc.). */
    repeatJobs: false,
    /** Worker clock in / clock out, hours, payroll review and labor reports. */
    timeClock: true,
    /** Email/notice when someone clocks in far from the yard. Needs features.timeClock. */
    clockInAlerts: true,
    /** Quotes, change orders and invoices (and the public quote-approval page). */
    financials: true,
    /** Materials lists (what to order or pick up for jobs). */
    materials: true,
    /** Trucks and equipment, with service logs and documents. */
    trucks: true,
    /** "Request a service": customers ask for new work; the owner sees the requests. */
    requests: true,
    /** Workers report problems ("issues") on a job. */
    issues: true,
    /** People can report a message or photo. Leave ON: Apple requires a way to report content in apps with messaging. */
    reports: true,
    /** Company-wide announcements from the owner. */
    announcements: true,
    /** Messages between the company and its customers. */
    messages: true,
    /** Customers get their own login (their job sites, messages, documents). */
    customerPortal: true,
    /** Address suggestions while typing (Google Places). Also needs the key EXPO_PUBLIC_GOOGLE_PLACES_KEY. */
    addressSuggestions: true,
    /** Maps: directions buttons and map previews. (The check-in distance rule keeps working when this is off.) */
    maps: true,
    /** Spanish for workers and customers (the language buttons). */
    spanish: true,
    /** Over-the-air updates (EAS Update) (build). */
    otaUpdates: true,
  },

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // LEGAL  -  shown on the Privacy Policy, Terms of Use and Help & Support pages
  // (after changing, run: node scripts/build-legal-pages.cjs)
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  legal: {
    /** The legal name of the business that runs the app. */
    businessName: 'Your Company LLC',
    /** Which state's law the Terms follow (full name, e.g. "Texas"). */
    state: 'Your State',
    /** The contact email printed on the legal pages. */
    contactEmail: 'support@yourcompany.com',
    /** Leave these three empty to use the pages this app publishes itself (app.webUrl + /legal/privacy.html and so on).
     *  These are the addresses you give App Store Connect. */
    privacyUrl: '',
    termsUrl: '',
    supportUrl: '',
    /** The date the pages take effect. */
    effectiveDate: 'January 1, 2027',
  },

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // WEATHER  -  where the forecast starts (US places only: it uses the National Weather Service)
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  weather: {
    /** EXAMPLE - REPLACE: the place weather shows the first time. key = a short lowercase id; lat/lon = its map point. */
    defaultPlace: { key: 'lakewood', name: 'Lakewood', state: 'NJ', lat: 40.0771, lon: -74.1985 },
    /** EXAMPLE - REPLACE: the short list of nearby towns at the top of the weather town picker (the default place first).
     *  These New Jersey towns come from the original app. IMPORTANT: the weather server function
     *  (supabase/functions/weather/index.ts, the TOWNS list) must hold the same keys and names, each with its National
     *  Weather Service grid. If you change this list, change that one too (or empty both: any US place still works by its
     *  map point). A check (weatherData.check.cjs) keeps the two lists the same. */
    nearbyTowns: [
      { key: 'lakewood', name: 'Lakewood', state: 'NJ', lat: 40.0771, lon: -74.1985 },
      { key: 'jackson', name: 'Jackson', state: 'NJ', lat: 40.0909, lon: -74.3613 },
      { key: 'howell', name: 'Howell', state: 'NJ', lat: 40.1781, lon: -74.2062 },
      { key: 'toms-river', name: 'Toms River', state: 'NJ', lat: 39.9943, lon: -74.1662 },
      { key: 'brick', name: 'Brick', state: 'NJ', lat: 40.0618, lon: -74.1096 },
      { key: 'manchester', name: 'Manchester', state: 'NJ', lat: 39.9616, lon: -74.3753 },
      { key: 'freehold', name: 'Freehold', state: 'NJ', lat: 40.2602, lon: -74.2759 },
      { key: 'point-pleasant', name: 'Point Pleasant', state: 'NJ', lat: 40.0777, lon: -74.0699 },
    ],
  },
};
