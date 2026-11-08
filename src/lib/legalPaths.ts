// Where the Legal & Support pages live for each part of the app. A signed-in person opens them INSIDE their own area (owner, worker, customer
// or Snow), so the Settings screen they came from stays underneath and Back returns to it. (The one public copy at /legal is for signed-out
// people and for the web address you give Apple; opening that from inside the app would throw the screen you were on away.)

export type LegalSlug = 'privacy' | 'terms' | 'support';
export const LEGAL_SLUGS: LegalSlug[] = ['privacy', 'terms', 'support'];

export const isLegalSlug = (v: unknown): v is LegalSlug => typeof v === 'string' && (LEGAL_SLUGS as string[]).includes(v);

/** The Legal & Support page for the area the person is in, from the first piece of the current route (useSegments()[0]). */
export function legalHubPath(firstSegment?: string): string {
  switch (firstSegment) {
    case '(owner)': return '/(owner)/legal-support';
    case '(worker)': return '/(worker)/legal-support';
    case '(customer)': return '/(customer)/legal-support';
    case 'snow': return '/snow/legal-support';
    default: return '/legal';
  }
}

/** One document under a hub: "/(customer)/legal-support/privacy". */
export const legalDocPath = (hub: string, slug: LegalSlug) => `${hub}/${slug}`;

/** The three rows on the Legal & Support page, in order. */
export const LEGAL_ROWS: { slug: LegalSlug; title: string; subtitle: string; icon: 'shield' | 'file-text' | 'help-circle' }[] = [
  { slug: 'privacy', title: 'Privacy Policy', subtitle: 'What we collect, why, and how to delete it', icon: 'shield' },
  { slug: 'terms', title: 'Terms of Use', subtitle: 'The rules for using the app', icon: 'file-text' },
  { slug: 'support', title: 'Help & Support', subtitle: 'Contact us, and how to delete your account', icon: 'help-circle' },
];
