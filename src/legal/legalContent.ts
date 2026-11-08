// The text of the Privacy Policy, Terms of Use and Support pages. One source: the app screens (app/legal/*) and the
// public web pages (public/legal/*.html, made by scripts/build-legal-pages.cjs) both come from here.

export const BUSINESS = {
  name: 'Brighton Lawn and Landscape',
  appName: 'Brighton Lawn + Landscape',
  addressLines: ['111 Spruce Street', 'Lakewood, New Jersey 08701'],
  email: 'support@yourcompany.com',
  phone: '848-226-0090',
  website: 'https://app.brightonlawn.com',
  effective: 'October 29, 2026',
} as const;

export type LegalSection = { heading: string; paragraphs?: string[]; bullets?: string[] };
export type LegalDoc = { slug: 'privacy' | 'terms' | 'support'; title: string; intro: string; sections: LegalSection[] };

const contactLine = `${BUSINESS.name}, ${BUSINESS.addressLines.join(', ')}. Email ${BUSINESS.email}. Phone ${BUSINESS.phone}.`;

export const PRIVACY: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  intro: `This policy explains what ${BUSINESS.appName} (the app) collects, why, who sees it, and how you can have it deleted. The app is run by ${BUSINESS.name}. Effective ${BUSINESS.effective}.`,
  sections: [
    {
      heading: 'Who uses the app and who controls the data',
      paragraphs: [
        'The app is a business tool for landscaping, maintenance and snow-removal companies. A company owner sets up the company, and its workers, snow crew and customers join with a code or invitation.',
        'Information about a company\'s projects, properties, customers, schedules and records belongs to that company, and the company decides who on its team can see it. If you are a customer or worker, your company can also answer questions about your records.',
      ],
    },
    {
      heading: 'What we collect',
      bullets: [
        'Account details: your name, email address and password (the password is stored in scrambled form and is never visible to us). Optional: phone number, birthday and profile photo.',
        'Company details entered by the owner: company name, address, phone, email, logo and header photos.',
        'Customer and property details entered by the company: names, phone numbers, email addresses, service addresses, contact and gate or access instructions, and notes.',
        'Work records: projects, tasks, schedules, hours worked, pay rates and payroll estimates, maintenance routes and visit history, snow storms, routes, stops and clock-in/clock-out times.',
        'Photos and videos you take or choose (job photos, stop photos, problem reports, profile photos). The app asks for camera and photo-library permission before it can use them.',
        'Our Work: the company owner can add photos, videos (reels), stories and music (an audio file chosen from the phone, or the sound taken from one of its videos) to show finished projects. When the owner turns Our Work on, these are public: anyone who opens the app, including people who are not signed in, can see them. They show the town of a project, never the name or address of a customer.',
        'Service requests: if you use the Request page (you do not need an account), the name, phone number, optional email address, town or ZIP code, kind of property, services you choose and any details you write. They are saved for the company, shown to its owner and administrators in the app, and emailed to them.',
        'Weather: the Weather page shows a forecast for a town you choose from a list or type. It does not track you and does not read your location.',
        'Messages sent inside a project, and reports of problems at a property.',
        'Quotes, change orders and invoices, including the name, time, IP address and browser a customer records when approving or declining one through a link.',
        'Location: only when you tap to check in at a job site, the app reads your phone\'s precise location once to check that you are near the job. It does not track you in the background. If you deny location access, you can still use the app, and check-in then records that location was unavailable.',
        'Device information needed to send notifications: a push notification token for your phone.',
        'Activity logs: who did what and when (for example a stop was finished), so the company can review its own work.',
      ],
    },
    {
      heading: 'What we do not do',
      bullets: [
        'We do not sell your information.',
        'We do not show advertising and we do not use advertising identifiers.',
        'We do not track you across other companies\' apps or websites, and we do not use third-party analytics or advertising tools.',
        'The app does not process card payments. Any payment for services is arranged between the company and its customer outside the app.',
      ],
    },
    {
      heading: 'How we use it',
      paragraphs: [
        'We use your information only to run the app for you and your company: to sign you in, show the right records to the right people, schedule and record work, send the notifications you or your company turn on, send quotes and invoices, keep a record of activity, give support and keep the service secure.',
      ],
    },
    {
      heading: 'Who sees it and who helps us run the app',
      paragraphs: [
        'Information is shown only to people your company allows (for example workers see their own assignments; customers see their own projects and the photos the company chooses to share).',
        'We use these service providers to run the app. They handle data only to provide their service to us:',
      ],
      bullets: [
        'Supabase: sign-in, the database and file storage.',
        'Cloudflare: storage and delivery of photos and videos.',
        'Expo: delivery of push notifications to your phone.',
        'Resend: delivery of some email notices, such as an arrival or completion notice a customer asked for, and the email that tells the company about a new service request.',
        'Netlify: hosting of the web page that customers use to approve a quote, and of this policy.',
        'Google: address suggestions. When you type an address, the text you have typed so far is sent to Google Places to suggest matching addresses.',
      ],
    },
    {
      heading: 'When the app opens other apps',
      paragraphs: [
        'When you tap directions, the app opens Apple Maps, Google Maps or Waze with the job address. That address is then handled under that app\'s own privacy policy.',
      ],
    },
    {
      heading: 'How long we keep it and how to delete it',
      bullets: [
        'You can delete your account inside the app: Settings, then Delete Account. This removes your login and your personal contact details (email, phone, photo). Your name may remain on past company records such as hours and history, because the company needs those records.',
        'A company owner can delete the whole company in the app: Settings, then Delete Company. This removes the company\'s data. An owner must do this before deleting their own account.',
        'You can also ask us to delete or correct your information by emailing or calling the contact details below. Copies may remain in routine backups for a limited time.',
        'To withdraw permission for camera, photos, location or notifications, turn them off in your phone\'s Settings app at any time. The app keeps working without them.',
      ],
    },
    {
      heading: 'Security',
      paragraphs: [
        'Data is sent over encrypted connections, and the database limits what each person can see by their role. No system is perfectly secure, so please use a strong password and do not share it.',
      ],
    },
    {
      heading: 'Children',
      paragraphs: ['The app is not meant for children under 13, and we do not knowingly collect their information.'],
    },
    {
      heading: 'Changes',
      paragraphs: ['If we change this policy we will update the date at the top. If a change is significant we will tell you in the app.'],
    },
    { heading: 'Contact us', paragraphs: [contactLine] },
  ],
};

export const TERMS: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Use',
  intro: `These terms are an agreement between you and ${BUSINESS.name} about using ${BUSINESS.appName}. By creating an account or using the app you agree to them and to the Privacy Policy. Effective ${BUSINESS.effective}.`,
  sections: [
    {
      heading: 'Your account',
      bullets: [
        'Give accurate information and keep your password private. You are responsible for what happens under your account.',
        'Tell us right away if you think someone else is using your account.',
        'You may delete your account at any time in the app (Settings, then Delete Account).',
      ],
    },
    {
      heading: 'Companies, workers and customers',
      bullets: [
        'A company owner is responsible for the information the company puts in the app, for having the right to share its customers\' and workers\' details, and for deciding who on the team can see what.',
        'Workers and customers may use the app only as their company allows. A company may remove a person\'s access at any time.',
      ],
    },
    {
      heading: 'Content you add and what is not allowed',
      paragraphs: ['You are responsible for the messages, photos, videos, notes and reports you post. You must not post or send anything that:'],
      bullets: [
        'is illegal, threatening, harassing, hateful, abusive or sexually explicit;',
        'is false, misleading or pretends to be someone else;',
        'violates anyone\'s privacy, copyright or other rights, or shows people without their permission in a way that could harm them;',
        'contains viruses or tries to break, overload or get into the app or other people\'s accounts without permission.',
        'We have zero tolerance for objectionable or abusive content.',
      ],
    },
    {
      heading: 'Reporting and removal',
      bullets: [
        'To report a message, photo or person, use the Report option next to the content in the app, or contact us using the details on the Support page.',
        'We review reports within two business days. We may remove content, and we or a company owner may suspend or remove a person who breaks these terms. A company owner can remove any worker or customer from their company at any time.',
      ],
    },
    {
      heading: 'Location',
      paragraphs: ['Job-site check-in uses your phone\'s location only when you tap to check in, as described in the Privacy Policy. You can turn location off in your phone\'s Settings.'],
    },
    {
      heading: 'Quotes, invoices and payments',
      paragraphs: ['The app helps a company prepare quotes, change orders and invoices. It does not collect payments. Prices, work and payment are agreed between the company and its customer, and we are not a party to those agreements.'],
    },
    {
      heading: 'The service as is',
      paragraphs: [
        'We work to keep the app reliable, but it is provided "as is" without warranties of any kind. It may be unavailable at times, and features may change. Keep your own copies of anything important.',
        `To the fullest extent the law allows, ${BUSINESS.name} is not liable for indirect or consequential losses, lost profits or lost data arising from using the app, and our total liability is limited to the amount you paid us for the app, which is zero if you did not pay.`,
      ],
    },
    {
      heading: 'Ending use',
      paragraphs: ['You can stop using the app and delete your account at any time. We may suspend or end access for anyone who breaks these terms or misuses the app.'],
    },
    {
      heading: 'Apple',
      paragraphs: [
        'These terms are between you and us, not Apple. Apple has no obligation to provide support or maintenance for the app, and is not responsible for claims about it. Apple and its subsidiaries are third-party beneficiaries of these terms and may enforce them against you. You must also follow the terms of your Apple account and device.',
      ],
    },
    {
      heading: 'Changes and law',
      paragraphs: [
        'We may update these terms and will change the date at the top. Continuing to use the app after a change means you accept it.',
        'These terms are governed by the laws of the State of New Jersey, and any dispute will be handled in the courts located in New Jersey.',
      ],
    },
    { heading: 'Contact us', paragraphs: [contactLine] },
  ],
};

export const SUPPORT: LegalDoc = {
  slug: 'support',
  title: 'Help & Support',
  intro: `Need help with ${BUSINESS.appName}? Contact us and we will get back to you.`,
  sections: [
    {
      heading: 'Contact',
      bullets: [`Email: ${BUSINESS.email}`, `Phone: ${BUSINESS.phone}`, `Mail: ${BUSINESS.name}, ${BUSINESS.addressLines.join(', ')}`, `Website: ${BUSINESS.website}`],
    },
    {
      heading: 'Report a problem or inappropriate content',
      paragraphs: [
        'Use the Report option next to a message or photo in the app, or email us with the details. We review reports within two business days. For an emergency, call your local emergency number.',
      ],
    },
    {
      heading: 'Forgot your password?',
      bullets: [
        'On the Sign In screen tap Forgot password, enter your email, and open the link we send you.',
        'If the email does not arrive, contact us using the details above and we will help you get back in.',
      ],
    },
    {
      heading: 'Delete your account',
      bullets: [
        'In the app: Settings, then Delete Account, and type DELETE to confirm.',
        'Company owners: first use Settings, then Delete Company, then delete your account.',
        'Or email or call us and we will do it for you.',
      ],
    },
    {
      heading: 'Policies',
      paragraphs: [`Privacy Policy: ${BUSINESS.website}/legal/privacy.html`, `Terms of Use: ${BUSINESS.website}/legal/terms.html`],
    },
  ],
};

export const LEGAL_DOCS: Record<LegalDoc['slug'], LegalDoc> = { privacy: PRIVACY, terms: TERMS, support: SUPPORT };
