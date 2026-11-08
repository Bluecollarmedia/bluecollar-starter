// Pure helpers for the customer's property-first home: one property at a time, and inside it one tab per kind of service (Snow, Lawn,
// Project) so the three never share a list. Which tab opens first, the dot on a property, the "visits this season" numbers, the history
// rows and the "next visit" words. No network, no screens; every value comes from real data passed in.
import type { HomeItem } from './customerHome';
import { SERVICE_VERB, type SnowStatus, type TimelineEntry, type Translate } from './customerSnow';

const plain: Translate = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text);

export type Service = 'snow' | 'lawn' | 'project';
export const SERVICE_ORDER: Service[] = ['snow', 'lawn', 'project'];
export const SERVICE_LABEL: Record<Service, string> = { snow: 'Snow', lawn: 'Lawn', project: 'Project' };

const serviceOf = (k: HomeItem['kind']): Service => (k === 'maintenance' ? 'lawn' : k);

export interface PropertyGroup {
  key: string;
  /** What the chip and the big title say. */
  name: string;
  address: string;
  /** Which tabs exist, in a fixed order. One entry means no switch is drawn. */
  services: Service[];
  items: HomeItem[];
}

/**
 * The customer's properties. Items at the same street address are one property (customerHome.propertyKeyOf); an item with no address stays on its
 * own. Completed projects are not properties: they go to "Past work" (pastWork below), so pass only what is still going.
 */
export function groupProperties(items: HomeItem[]): PropertyGroup[] {
  const byKey = new Map<string, HomeItem[]>();
  for (const i of items) {
    if (i.status === 'completed') continue;
    const k = i.propertyKey || i.key;
    byKey.set(k, [...(byKey.get(k) ?? []), i]);
  }
  return [...byKey.entries()].map(([key, list]) => {
    const services = SERVICE_ORDER.filter((s) => list.some((i) => serviceOf(i.kind) === s));
    const named = list.find((i) => i.kind !== 'project') ?? list[0];
    const street = (list.find((i) => i.address)?.address ?? '').split(',')[0];
    // A lawn or snow property already has the name its owner gave it; with only projects, one project names it and several fall back to the street.
    const name = named.kind !== 'project' || list.length === 1 ? named.name : street || named.name;
    return { key, name, address: list.find((i) => i.address)?.address ?? '', services, items: list };
  });
}

export const pastWork = (items: HomeItem[]): HomeItem[] =>
  items.filter((i) => i.status === 'completed').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

export type Attention = 'on_site' | 'scheduled' | 'none';

/** What is happening right now at a property: the crew is there, a crew is assigned, or nothing. Only Snow has a live state. */
export function attentionOf(group: PropertyGroup, statuses: SnowStatus[]): Attention {
  const ids = group.items.filter((i) => i.kind === 'snow').map((i) => i.key.slice('snow:'.length));
  const mine = statuses.filter((s) => ids.includes(s.propertyId));
  return mine.some((s) => s.state === 'on_site') ? 'on_site' : mine.length ? 'scheduled' : 'none';
}

/** Properties with a crew there first, then ones waiting for a crew, then the rest by name. */
export function sortGroups(groups: PropertyGroup[], statuses: SnowStatus[]): PropertyGroup[] {
  const rank = (g: PropertyGroup) => ({ on_site: 0, scheduled: 1, none: 2 }[attentionOf(g, statuses)]);
  return [...groups].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The tab a property opens on: Snow while a storm involves it, otherwise the recurring Lawn service, then the Project, then whatever is left. */
export function defaultService(group: PropertyGroup, attention: Attention): Service {
  if (attention !== 'none' && group.services.includes('snow')) return 'snow';
  for (const s of ['lawn', 'project', 'snow'] as Service[]) if (group.services.includes(s)) return s;
  return 'snow';
}

// ── visits and seasons ────────────────────────────────────────────────────────

export interface Visit { id: string; arrivedAt?: string; completedAt: string; photos: number; title: string }

/** Snow seasons start on October 1 (same rule as customerSnow.seasonStart), so "2026" means Oct 2026 to Sep 2027. Lawn is the calendar year. */
export function seasonKey(iso: string, service: 'snow' | 'lawn'): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  return String(service === 'snow' && d.getMonth() < 9 ? y - 1 : y);
}
export const seasonLabel = (key: string, service: 'snow' | 'lawn'): string =>
  service === 'snow' ? `${key}–${String(Number(key) + 1).slice(2)}` : key;

/** The seasons that have visits, newest first, always including the current one so an empty season is still a choice. */
export function seasonsOf(visits: Visit[], service: 'snow' | 'lawn', now = new Date()): string[] {
  const keys = new Set(visits.map((v) => seasonKey(v.completedAt, service)));
  keys.add(seasonKey(now.toISOString(), service));
  return [...keys].sort((a, b) => b.localeCompare(a));
}

export const visitsIn = (visits: Visit[], service: 'snow' | 'lawn', key: string): Visit[] =>
  visits.filter((v) => seasonKey(v.completedAt, service) === key).sort((a, b) => b.completedAt.localeCompare(a.completedAt));

export interface VisitStats { visits: number; lastAt?: string; photos: number }
export function visitStats(visits: Visit[], service: 'snow' | 'lawn', key: string): VisitStats {
  const list = visitsIn(visits, service, key);
  return { visits: list.length, lastAt: list[0]?.completedAt, photos: list.reduce((n, v) => n + v.photos, 0) };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const keyIds = (group: PropertyGroup, kind: 'snow' | 'maintenance') => group.items.filter((i) => i.kind === kind).map((i) => i.key.slice(kind.length + 1));
const keyNames = (group: PropertyGroup, kind: 'snow' | 'maintenance') => group.items.filter((i) => i.kind === kind).map((i) => i.name);

/** The snow visits that belong to this property. A visit matches by property id, or (older database) by the same property name. */
export function snowVisits(entries: TimelineEntry[], group: PropertyGroup): Visit[] {
  const ids = keyIds(group, 'snow');
  const names = keyNames(group, 'snow');
  return entries
    .filter((e) => ids.includes(e.propertyId) || (e.propertyId === e.propertyName && names.some((n) => sameName(n, e.propertyName))))
    .map((e) => ({ id: e.visitId, arrivedAt: e.arrivedAt, completedAt: e.completedAt, photos: e.media.filter((m) => m.kind === 'photo').length, title: SERVICE_VERB[e.service] ?? 'Visit' }));
}

export interface LawnUpdateLike { stopId: string; propertyId?: string; propertyName: string; arrivedAt?: string; completedAt: string; services?: string; photos: unknown[] }

/** The lawn visits that belong to this property (by property id, or by the same name on an older database). */
export function lawnVisits(updates: LawnUpdateLike[], group: PropertyGroup): Visit[] {
  const ids = keyIds(group, 'maintenance');
  const names = keyNames(group, 'maintenance');
  return updates
    .filter((u) => (u.propertyId ? ids.includes(u.propertyId) : names.some((n) => sameName(n, u.propertyName))))
    .map((u) => ({ id: u.stopId, arrivedAt: u.arrivedAt, completedAt: u.completedAt, photos: u.photos.length, title: u.services || 'Lawn visit' }));
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** "Arrived 6:05 AM · Left 6:40 AM", or just "Finished 6:40 AM" when the arrival was not recorded or is not the same day. */
export function visitTimes(v: Pick<Visit, 'arrivedAt' | 'completedAt'>, tx: Translate = plain): string {
  const sameDay = v.arrivedAt && new Date(v.arrivedAt).toDateString() === new Date(v.completedAt).toDateString() && v.arrivedAt < v.completedAt;
  return sameDay
    ? tx('Arrived {a} · Left {b}', { a: timeOf(v.arrivedAt!), b: timeOf(v.completedAt) })
    : tx('Finished {b}', { b: timeOf(v.completedAt) });
}

/** "Oct 28". */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** "Today", "Tomorrow", or "Thursday, Oct 30" for a date saved as "2026-10-30" (a calendar day, read in the phone's own time zone). */
export function nextVisitLabel(day: string, now = new Date(), tx: Translate = plain): string {
  const [y, m, d] = day.split('-').map(Number);
  const when = new Date(y, m - 1, d);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((when.getTime() - start.getTime()) / 86_400_000);
  if (diff === 0) return tx('Today');
  if (diff === 1) return tx('Tomorrow');
  return when.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
