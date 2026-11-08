/**
 * How the owner's Snow Activity log is laid out: date ranges, grouping by day,
 * collapsing long runs of repetitive entries, and showing which services an
 * entry is about. Read-only and pure: nothing here changes or hides a record.
 * Important events (storms, routes, crew, access, skips, media sharing) are
 * never collapsed.
 */

export type DateRange = 'all' | 'today' | 'week' | 'month';

export const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'Last 30 days' },
];

/** The earliest time included in a range (local midnight of its first day), or undefined for all time. */
export function rangeStart(range: DateRange | undefined, now = new Date()): string | undefined {
  if (!range || range === 'all') return undefined;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (range === 'today' ? 0 : range === 'week' ? 6 : 29));
  return d.toISOString();
}

/**
 * The feed arrives newest first in pages. Keeps the entries inside the range and says whether
 * the end of the range was reached (an older entry was seen), so paging can stop.
 */
export function trimToRange<T extends { occurredAt: string }>(rows: T[], startIso: string | undefined): { rows: T[]; reachedStart: boolean } {
  if (!startIso) return { rows, reachedStart: false };
  const start = new Date(startIso).getTime();
  const kept = rows.filter((r) => new Date(r.occurredAt).getTime() >= start);
  return { rows: kept, reachedStart: kept.length < rows.length };
}

export interface ActivityLike {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  stormId?: string;
  routeId?: string;
  service?: string;
  note?: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
}

/** Actions that happen in long repetitive runs and can be folded into one expandable row. */
const FOLDABLE = new Set([
  'visit.created', 'visit.moved', 'visit.updated',
  'visit.arrived', 'visit.completed',
  'route.updated', 'route.moved',
  'shift.clocked_in', 'shift.clocked_out',
  'completion_media.created', 'reference_media.created',
]);

export function isFoldable(action: string): boolean {
  return FOLDABLE.has(action);
}

/** A run of at least this many similar entries in a row is folded. */
export const MIN_RUN = 3;

export type ViewItem<T extends ActivityLike> =
  | { type: 'day'; key: string; day: string }
  | { type: 'event'; key: string; entry: T }
  | { type: 'run'; key: string; action: string; entries: T[] };

/** Local calendar day of a time, "YYYY-MM-DD". */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Lays entries (newest first) out as a list: a header per day, and, when `fold` is on, runs of
 * MIN_RUN or more consecutive foldable entries of the same kind in the same storm as one row.
 * Every entry still appears exactly once, either on its own or inside a run.
 */
export function buildView<T extends ActivityLike>(entries: T[], opts: { group: boolean; fold: boolean }): ViewItem<T>[] {
  const out: ViewItem<T>[] = [];
  let currentDay = '';
  let i = 0;
  while (i < entries.length) {
    const e = entries[i];
    if (opts.group) {
      const day = dayKey(e.occurredAt);
      if (day !== currentDay) {
        currentDay = day;
        out.push({ type: 'day', key: `day:${day}`, day });
      }
    }
    if (opts.fold && isFoldable(e.action)) {
      let j = i + 1;
      while (
        j < entries.length &&
        entries[j].action === e.action &&
        entries[j].stormId === e.stormId &&
        entries[j].entityType === e.entityType &&
        (!opts.group || dayKey(entries[j].occurredAt) === currentDay)
      ) j++;
      if (j - i >= MIN_RUN) {
        out.push({ type: 'run', key: `run:${e.id}`, action: e.action, entries: entries.slice(i, j) });
        i = j;
        continue;
      }
    }
    out.push({ type: 'event', key: e.id, entry: e });
    i++;
  }
  return out;
}

/**
 * Which services an entry is about, as plain keys. A route or stop entry has its one service.
 * A storm that covers several services has no single service (update 40): they are in its note
 * ("Services: plowing, shoveling") or in the recorded `services` list.
 */
export function entryServices(e: Pick<ActivityLike, 'service' | 'note' | 'after' | 'before'>): string[] {
  if (e.service) return [e.service];
  const list = (e.after?.services ?? e.before?.services) as unknown;
  if (Array.isArray(list) && list.length) return list.map(String);
  const m = /^Services:\s*(.+)$/i.exec(e.note ?? '');
  if (m) return m[1].split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/** "Plowing", "Plowing + Shoveling", "Plowing, Shoveling + Salting". */
export function servicesText(keys: string[], label: (k: string) => string): string {
  const names = keys.map(label);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} + ${names[names.length - 1]}`;
}

/** "10:02 AM – 10:05 AM" style span for a run's header (newest first, so last is the earliest). */
export function runSpan<T extends { occurredAt: string }>(entries: T[], time: (iso: string) => string): string {
  const first = entries[entries.length - 1]?.occurredAt;
  const last = entries[0]?.occurredAt;
  if (!first || !last) return '';
  return first === last ? time(first) : `${time(first)} – ${time(last)}`;
}
