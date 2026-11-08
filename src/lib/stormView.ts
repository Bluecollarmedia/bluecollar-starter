/**
 * Brighton's storm outlooks, as the screens show them (pure: no React, no network). The shape matches what the database functions return
 * (supabase/updates/104_storm_outlooks.sql). Every published update is its own locked version; the screens only ever read them.
 */
export interface StormVersion {
  id: string;
  version_no: number;
  headline: string;
  message: string;
  message_es: string | null;
  snow_low: number | null;
  snow_high: number | null;
  starts_at: string | null;
  ends_at: string | null;
  disclaimer: string;
  actual_snow: number | null;
  actual_source: string | null;
  is_final: boolean;
  published_at: string;
  /** The storm map the owner attached to this update (an https picture link), or null. */
  map_url: string | null;
}
export interface StormOutlook {
  id: string;
  name: string;
  status: 'active' | 'ended';
  created_at: string;
  ended_at: string | null;
  version_count: number;
  latest: StormVersion | null;
  /** All versions, newest first (only in the history answer). */
  versions: StormVersion[];
}

/** The standard disclaimer. The owner can change it for any update; each update keeps the wording it was published with. */
export const DEFAULT_DISCLAIMER = "Brighton's Storm Outlook. This is Brighton's own estimate, not an official weather forecast. Snowfall amounts and timing may change as conditions develop.";

const EASTERN = 'America/New_York';
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function normalizeVersion(raw: any): StormVersion | null {
  if (!raw || typeof raw !== 'object' || typeof raw.headline !== 'string' || typeof raw.message !== 'string') return null;
  return {
    id: str(raw.id),
    version_no: Number(raw.version_no) || 1,
    headline: raw.headline,
    message: raw.message,
    message_es: typeof raw.message_es === 'string' && raw.message_es.trim() ? raw.message_es : null,
    snow_low: num(raw.snow_low),
    snow_high: num(raw.snow_high),
    starts_at: typeof raw.starts_at === 'string' ? raw.starts_at : null,
    ends_at: typeof raw.ends_at === 'string' ? raw.ends_at : null,
    disclaimer: str(raw.disclaimer),
    actual_snow: num(raw.actual_snow),
    actual_source: typeof raw.actual_source === 'string' && raw.actual_source.trim() ? raw.actual_source : null,
    is_final: !!raw.is_final,
    published_at: str(raw.published_at),
    map_url: typeof raw.map_url === 'string' && /^https:\/\//i.test(raw.map_url) ? raw.map_url : null,
  };
}

/** One outlook from the database's JSON, or null if it is not a usable outlook. */
export function normalizeStorm(raw: any): StormOutlook | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const latest = normalizeVersion(raw.latest);
  const versions = Array.isArray(raw.versions) ? (raw.versions.map(normalizeVersion).filter(Boolean) as StormVersion[]) : [];
  if (!latest && !versions.length) return null;
  return {
    id: raw.id,
    name: str(raw.name),
    status: raw.status === 'ended' ? 'ended' : 'active',
    created_at: str(raw.created_at),
    ended_at: typeof raw.ended_at === 'string' ? raw.ended_at : null,
    version_count: Number(raw.version_count) || versions.length || 1,
    latest: latest ?? versions[0],
    versions,
  };
}
export const normalizeStorms = (raw: unknown): StormOutlook[] => (Array.isArray(raw) ? raw.map(normalizeStorm).filter((s): s is StormOutlook => !!s) : []);

const trim1 = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
/** "3–6 in", "4 in" when both are the same, or null when the owner has no estimate ("not sure yet"): the screens then say "Unavailable", never 0. */
export function snowRange(v: Pick<StormVersion, 'snow_low' | 'snow_high'>): string | null {
  if (v.snow_low === null || v.snow_high === null) return null;
  return v.snow_low === v.snow_high ? `${trim1(v.snow_low)} in` : `${trim1(v.snow_low)}–${trim1(v.snow_high)} in`;
}
/** Measured snowfall, only ever shown when the owner entered it (with its source). */
export const actualSnow = (v: Pick<StormVersion, 'actual_snow'>): string | null => (v.actual_snow === null ? null : `${trim1(v.actual_snow)} in`);

/** The message in the visitor's language. Spanish is shown only when the owner wrote a Spanish version; nothing is ever translated automatically. */
export function messageFor(v: Pick<StormVersion, 'message' | 'message_es'>, language: string): { text: string; spanish: boolean } {
  if (language === 'es' && v.message_es) return { text: v.message_es, spanish: true };
  return { text: v.message, spanish: false };
}

/** Which kind of update this is: the first (original), a later one, or the final one. */
export function versionKind(v: Pick<StormVersion, 'version_no' | 'is_final'>): 'original' | 'update' | 'final' {
  return v.is_final ? 'final' : v.version_no === 1 ? 'original' : 'update';
}

/** "Tue 6 PM" in Eastern time (Brighton's time), in the visitor's language. */
export function whenText(iso: string | null, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', timeZone: EASTERN }).format(d);
}
export function publishedText(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: EASTERN }).format(d);
}

/** A date key and an hour (0 to 23) in Eastern time -> the UTC moment, for saving. Handles the daylight-saving change. */
export function easternToIso(dateKey: string, hour: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) throw new Error('Not a date.');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const want = Date.UTC(y, mo - 1, d, hour, 0, 0);
  let guess = want + 5 * 3_600_000;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: EASTERN, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const got = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), 0, 0);
    guess += want - got;
  }
  return new Date(guess).toISOString();
}
/** The reverse: a saved moment -> its Eastern date key and hour. */
export function isoToEastern(iso: string): { dateKey: string; hour: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: EASTERN, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { dateKey: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
