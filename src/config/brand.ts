/**
 * The app's settings, typed. The values live in ONE place, src/config/brand.js (plain JavaScript so the build tools in app.config.js
 * can read it too). Edit that file, not this one. App code imports from here:  import { brand, features } from '@/config/brand';
 *
 * Pure: no React, no network. Small helpers that work things out from the settings (tap-to-call link, legal page addresses, the label
 * shown for a role) live here too, so nothing is typed twice.
 */

export interface BrandPlace { key: string; name: string; state: string; lat: number; lon: number }
export interface MaterialCategory { name: string; words: string[] }
/** The six nouns the app's sentences are written with (wording.job ... wording.crews, and the same in wording.es). */
export interface WordingNouns { job: string; jobs: string; place: string; places: string; crew: string; crews: string }

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
    es: WordingNouns;
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

// ─── The client's words in every sentence ───────────────────────────────────────────────────────────────────────────────────────
// The app's text is written with the default nouns (Job / Jobs / Job site / Job sites / Crew / Crews). w() swaps them for the
// settings file's words when the text is shown, keeping the case of each spot ("job site" mid-sentence, "Job site" at the start,
// "JOB SITE" in a heading) and fixing "a" / "an" in front. t() / tr() (src/i18n) run every sentence through it, so a screen that
// translates needs nothing more; an English-only screen writes w('New Job').

/** The words the app's text is written with. */
export const DEFAULT_NOUNS: Readonly<WordingNouns> = { job: 'Job', jobs: 'Jobs', place: 'Job site', places: 'Job sites', crew: 'Crew', crews: 'Crews' };
/** The same words in the Spanish dictionary (src/i18n/es*.ts). */
export const DEFAULT_NOUNS_ES: Readonly<WordingNouns> = { job: 'Trabajo', jobs: 'Trabajos', place: 'Sitio de trabajo', places: 'Sitios de trabajo', crew: 'Cuadrilla', crews: 'Cuadrillas' };

const NOUN_KEYS: (keyof WordingNouns)[] = ['places', 'place', 'jobs', 'job', 'crews', 'crew']; // longest first
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A noun as a match rule: any run of spaces between its words, whole words only. */
const nounRe = (noun: string) => escapeRe(noun.trim()).replace(/\s+/g, '\\s+');
const isUpper = (s: string) => /[A-Za-z]/.test(s) && s === s.toUpperCase();

/** Puts `value` in the same case as `seen` ("job site" / "Job site" / "Job Site" / "JOB SITE"). */
function matchCase(seen: string, value: string): string {
  if (isUpper(seen) && seen.length > 1) return value.toUpperCase();
  if (seen[0] === seen[0].toLowerCase()) return value.toLowerCase();
  if (/\s/.test(seen) && seen.split(/\s+/).every((p) => p[0] === p[0].toUpperCase())) return value.replace(/(^|\s)(\S)/g, (_m, sp: string, c: string) => sp + c.toUpperCase());
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Swaps the `from` nouns for the `to` nouns in `text` (only the `only` ones when given). Returns the text untouched when no noun differs. */
export function swapNouns(text: string, from: WordingNouns, to: WordingNouns, only?: (keyof WordingNouns)[]): string {
  // Unchanged nouns stay in the match too, so a longer one protects the words inside it ("job site" is not read as "job").
  const keys = NOUN_KEYS.filter((k) => from[k]?.trim() && to[k]?.trim() && (!only || only.includes(k)));
  if (!text || !keys.some((k) => from[k] !== to[k])) return text;
  const byLower = new Map(keys.map((k) => [from[k].trim().toLowerCase().replace(/\s+/g, ' '), to[k].trim()] as const));
  const re = new RegExp(`(?:\\b(an?|An?|AN)\\s+)?\\b(${keys.map((k) => nounRe(from[k])).join('|')})\\b`, 'gi');
  return text.replace(re, (m: string, article: string | undefined, noun: string, at: number, all: string) => {
    if (all[at - 1] === '{' && all[at + m.length] === '}') return m; // a {job} value slot, filled in later
    const value = matchCase(noun, byLower.get(noun.toLowerCase().replace(/\s+/g, ' ')) ?? noun);
    if (!article) return value;
    const an = /^[aeiou]/i.test(value) ? 'an' : 'a';
    const art = isUpper(article) && article.length > 1 ? an.toUpperCase() : article[0] === 'A' ? `A${an.slice(1)}` : an;
    return `${art} ${value}`;
  });
}

/** English text with the client's words: w('New Job') is "New Project" when wording.job is "Project". Values go in as {name}
 *  AFTER the swap, so a customer called "Job Lot" is never changed: w('Remove {name} from this job?', { name }). */
export function w(text: string, vars?: Record<string, string | number>): string {
  const out = swapNouns(text, DEFAULT_NOUNS, raw.wording);
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}

/** Which default nouns an English sentence uses ("Add a job site" -> place, not also job). Spanish swaps only those, so the
 *  "trabajo" in "Buen trabajo" (great work) stays when wording.es.job is "Proyecto". */
export function nounsIn(english: string): (keyof WordingNouns)[] {
  let rest = english.replace(/\{\w+\}/g, ' ');
  return NOUN_KEYS.filter((k) => {
    const re = new RegExp(`\\b${nounRe(DEFAULT_NOUNS[k])}\\b`, 'gi');
    const hit = re.test(rest);
    rest = rest.replace(re, ' ');
    return hit;
  });
}

/** Spanish text (from the dictionary) with the client's Spanish words, for the English sentence it translates. */
export function wEs(spanish: string, english: string): string {
  const only = nounsIn(english);
  if (only.length === 0) return spanish;
  // "sitio de trabajo" holds "trabajo": keep the place nouns in the match so they are read whole.
  return swapNouns(spanish, DEFAULT_NOUNS_ES, raw.wording.es ?? DEFAULT_NOUNS_ES, [...only, 'place', 'places']);
}
