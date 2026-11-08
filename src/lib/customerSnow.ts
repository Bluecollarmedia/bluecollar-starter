// Pure helpers for what a customer sees about Snow: the timeline grouped by day, the "this season" numbers, the "right now" wording and the
// words for each service. No network, no screens. Every value comes from real data passed in; nothing is made up here.

export type SnowSvc = 'plowing' | 'shoveling' | 'salting';

/** The screens pass in their translator (t from useT) so the sentences built here can be shown in Spanish; this file stays free of app imports. Without one, English comes back as written. */
export type Translate = (text: string, vars?: Record<string, string | number>) => string;
const plain: Translate = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text);

export const SERVICE_VERB: Record<SnowSvc, string> = { plowing: 'Plowed', shoveling: 'Shoveled', salting: 'Salted' };
export const SERVICE_NAME: Record<SnowSvc, string> = { plowing: 'Plowing', shoveling: 'Shoveling', salting: 'Salting' };
const ORDER: SnowSvc[] = ['plowing', 'shoveling', 'salting'];

export interface TimelineMedia { id: string; kind: 'photo' | 'video'; url?: string }
export interface TimelineEntry {
  visitId: string; propertyId: string; propertyName: string; service: SnowSvc; stormName?: string; arrivedAt?: string; completedAt: string; media: TimelineMedia[];
}
export interface SnowStatus { propertyId: string; state: 'scheduled' | 'on_site'; since?: string; stormName?: string }

const pad = (n: number) => String(n).padStart(2, '0');
/** The local calendar day of a moment, "2026-10-21". */
export const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** "4:12 AM". */
export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** "Tue, Oct 21 at 5:40 AM". */
export const lastServiceLabel = (iso: string, tx: Translate = plain) =>
  tx('{date} at {time}', { date: new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), time: timeLabel(iso) });

/** "Today", "Yesterday", or "Tuesday, Oct 21" (with the year when it is not this year). */
export function dayLabel(key: string, now = new Date()): string {
  const [y, m, d] = key.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  const todayKey = dayKey(now.toISOString());
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (key === todayKey) return 'Today';
  if (key === dayKey(yest.toISOString())) return 'Yesterday';
  return day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', ...(y !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export interface DayGroup { key: string; label: string; stormNames: string[]; entries: TimelineEntry[] }

/** The timeline: one group per day, newest first, each group's entries newest first. Plowing and salting (even by different crews) are separate entries. */
export function groupTimeline(entries: TimelineEntry[], now = new Date()): DayGroup[] {
  const byDay = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const k = dayKey(e.completedAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(e);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      const stormNames = [...new Set(sorted.map((e) => e.stormName).filter((n): n is string => !!n))];
      return { key, label: dayLabel(key, now), stormNames, entries: sorted };
    });
}

/** The first moment of the current Snow season: October 1. Before October it is last year's October 1. */
export function seasonStart(now = new Date()): Date {
  const year = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 9, 1);
}

export interface SeasonStats { services: number; lastServiceAt?: string; photos: number }
export function seasonStats(entries: TimelineEntry[], now = new Date()): SeasonStats {
  const from = seasonStart(now).getTime();
  const inSeason = entries.filter((e) => new Date(e.completedAt).getTime() >= from);
  const last = inSeason.map((e) => e.completedAt).sort().pop();
  return { services: inSeason.length, lastServiceAt: last, photos: inSeason.reduce((n, e) => n + e.media.filter((m) => m.kind === 'photo').length, 0) };
}

/** Services in a stable order for chips. */
export const sortServices = (s: SnowSvc[]): SnowSvc[] => [...new Set(s)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

export interface StatusView { tone: 'active' | 'scheduled'; headline: string; detail?: string }

/** The "Right now" card on a property. Null (nothing shown) when no storm involves it. */
export function statusView(status: SnowStatus | undefined, address?: string, tx: Translate = plain): StatusView | null {
  if (!status) return null;
  if (status.state === 'on_site') {
    return { tone: 'active', headline: status.since ? tx('Crew on site since {time}', { time: timeLabel(status.since) }) : tx('Crew on site'), detail: address };
  }
  return { tone: 'scheduled', headline: tx('A storm is being handled'), detail: status.stormName ? tx('{storm}. Crew assigned.', { storm: status.stormName }) : tx('Crew assigned.') };
}

export interface HomeStrip { propertyId: string; tone: 'active' | 'scheduled'; headline: string; detail?: string }

/** The strip at the top of Home. Only exists while a storm involves one of their properties; otherwise nothing is shown. */
export function homeStrip(statuses: SnowStatus[], properties: { id: string; address?: string }[], tx: Translate = plain): HomeStrip | null {
  const pick = statuses.find((s) => s.state === 'on_site') ?? statuses.find((s) => s.state === 'scheduled');
  if (!pick) return null;
  const address = properties.find((p) => p.id === pick.propertyId)?.address;
  const v = statusView(pick, address, tx);
  return v ? { propertyId: pick.propertyId, ...v } : null;
}

/** "5 services", "1 service". */
export const countLabel = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Which entries belong to one property. */
export const forProperty = (entries: TimelineEntry[], propertyId: string) => entries.filter((e) => e.propertyId === propertyId);

/** The 5 newest day groups, or all of them. */
export const DAYS_PREVIEW = 5;
export const daysToShow = (groups: DayGroup[], showAll: boolean) => (showAll ? groups : groups.slice(0, DAYS_PREVIEW));

/** Keeps a page number inside the list. */
export const clampPage = (i: number, count: number) => Math.max(0, Math.min(count - 1, Math.round(i)));
