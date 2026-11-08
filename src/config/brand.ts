/**
 * The app's settings, typed. The values live in ONE place, src/config/brand.js (plain JavaScript so the build tools in app.config.js
 * can read it too). Edit that file, not this one. App code imports from here:  import { brand, features } from '@/config/brand';
 *
 * Pure: no React, no network. Small helpers that work things out from the settings (tap-to-call link, legal page addresses, the label
 * shown for a role) live here too, so nothing is typed twice.
 */

export interface BrandPlace { key: string; name: string; state: string; lat: number; lon: number }
export interface MaterialCategory { name: string; words: string[] }

export interface BrandFeatures {
  weather: boolean;
  publicVisitorArea: boolean;
  widgets: boolean;
  uniformSize: boolean;
  workerIdPhoto: boolean;
  repeatJobs: boolean;
  timeClock: boolean;
  clockInAlerts: boolean;
  financials: boolean;
  materials: boolean;
  trucks: boolean;
  requests: boolean;
  issues: boolean;
  reports: boolean;
  announcements: boolean;
  messages: boolean;
  customerPortal: boolean;
  addressSuggestions: boolean;
  maps: boolean;
  spanish: boolean;
  otaUpdates: boolean;
}
export type FeatureName = keyof BrandFeatures;

export interface Brand {
  company: {
    name: string;
    legalName: string;
    phone: { display: string; tel: string };
    supportEmail: string;
    addressLines: string[];
    website: string;
    state: string;
    timezone: string;
  };
  app: {
    name: string;
    slug: string;
    bundleId: string;
    androidPackage: string;
    scheme: string;
    expoProjectId: string;
    expoOwner: string;
    webUrl: string;
    appleTeamId: string;
  };
  look: {
    brandColor: string;
    logo: string;
    icon: string;
    androidIconForeground: string;
    androidIconBackground: string;
    splashImage: string;
    splashBackground: string;
  };
  wording: {
    job: string;
    jobs: string;
    place: string;
    places: string;
    crew: string;
    crews: string;
    leaderRoleLabel: string;
    uniformSizeLabel: string;
    units: string[];
    materialUnits: string[];
    serviceTypes: string[];
    materialCategories: MaterialCategory[];
  };
  features: BrandFeatures;
  legal: {
    businessName: string;
    state: string;
    contactEmail: string;
    privacyUrl: string;
    termsUrl: string;
    supportUrl: string;
    effectiveDate: string;
  };
  weather: {
    defaultPlace: BrandPlace;
    nearbyTowns: BrandPlace[];
  };
}

// A plain require (not an import) on purpose: TypeScript would resolve "./brand.js" back to this very file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const raw = require('./brand.js') as Brand;

export const brand: Brand = raw;
export const features: Readonly<BrandFeatures> = raw.features;
export const words = raw.wording;

/** Is this feature switched on for this app? */
export const isFeatureOn = (name: FeatureName): boolean => raw.features[name] === true;

/** The tap-to-call link for the company phone ("tel:..."), worked out from the display number if the setting is left empty. */
export const companyPhoneLink = (): string => {
  const tel = raw.company.phone.tel.trim();
  if (tel) return tel.startsWith('tel:') ? tel : `tel:${tel}`;
  return `tel:${raw.company.phone.display.replace(/[^\d+]/g, '')}`;
};

/** The app's web address without a trailing slash. */
export const appWebUrl = (): string => raw.app.webUrl.replace(/\/+$/, '');

/** The three legal page addresses (the settings when filled in, else the pages this app publishes under its web address). */
export const legalUrls = () => ({
  privacy: raw.legal.privacyUrl || `${appWebUrl()}/legal/privacy.html`,
  terms: raw.legal.termsUrl || `${appWebUrl()}/legal/terms.html`,
  support: raw.legal.supportUrl || `${appWebUrl()}/legal/support.html`,
});

/** The name SHOWN for a company role. The database keeps 'admin'; people see wording.leaderRoleLabel (e.g. "Manager"). */
export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'owner': return 'Owner';
    case 'admin': return raw.wording.leaderRoleLabel;
    case 'worker': return 'Worker';
    case 'customer': return 'Customer';
    default: return role ? role.charAt(0).toUpperCase() + role.slice(1) : '';
  }
}

/** The leader role label in lowercase for the middle of a sentence ("make them a manager"). */
export const leaderWord = (): string => raw.wording.leaderRoleLabel.toLowerCase();
/** Plural of the leader label ("Managers"). */
export const leaderPlural = (): string => {
  const l = raw.wording.leaderRoleLabel;
  return /s$/i.test(l) ? l : /[^aeiou]y$/i.test(l) ? `${l.slice(0, -1)}ies` : `${l}s`;
};

/** "a" or "an" before a word ("a manager", "an admin"). */
export const aOrAn = (word: string): string => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** A word list from the settings as one match rule: a plural "s" also matches, and a space also matches no space. */
export function wordsPattern(list: string[]): RegExp {
  const esc = (w: string) => w.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, ' ?');
  return new RegExp(`\\b(?:${list.filter((w) => w.trim()).map(esc).join('|')})(?:e?s)?\\b`, 'i');
}
