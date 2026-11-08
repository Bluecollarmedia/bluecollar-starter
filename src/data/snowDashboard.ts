/**
 * Owner Snow dashboard: Storm Overview and Needs Attention.
 *
 * Pure functions over rows already loaded by useSnowDashboard (no store, no
 * network) so they can be checked with plain data. Two separate outputs on
 * purpose: the overview describes where work stands, Needs Attention lists only
 * things that wait on the owner. Every attention item comes from a row that is
 * still in that state in the database; nothing is invented or hidden because a
 * screen was opened.
 */
import type {
  SnowRoute, SnowService, SnowSkipRequest, SnowStorm, SnowVisit, StormStatus,
} from '@/types/snow';

// ── Inputs ──────────────────────────────────────────────────────────────────

/** Only the visit columns the dashboard reads. */
export type DashboardVisit = Pick<
  SnowVisit,
  'id' | 'stormId' | 'routeId' | 'propertyId' | 'propertyName' | 'position' | 'status' | 'arrivedAt' | 'completedAt'
> & {
  /** This stop's own photo rule (updates 60 and 112); missing = follow the route. */
  photosRequired?: boolean;
  minMedia?: number;
};

export type DashboardRoute = Pick<
  SnowRoute,
  'id' | 'stormId' | 'service' | 'name' | 'position' | 'leadPersonId' | 'mediaRequired' | 'minMedia' | 'cancelledAt'
>;

export type DashboardStorm = Pick<
  SnowStorm,
  'id' | 'name' | 'service' | 'status' | 'dispatchedAt' | 'reopenedCount' | 'createdAt'
> & Partial<Pick<SnowStorm, 'services'>>;

export type DashboardSkipRequest = Pick<
  SnowSkipRequest,
  'id' | 'stormId' | 'routeId' | 'visitId' | 'propertyId' | 'requestedBy' | 'reason' | 'status' | 'createdAt'
>;

/** A snow shift that has no clock-out yet (snow_shifts, update 028). */
export interface OpenShift {
  id: string;
  personId: string;
  clockInAt: string;
}

export interface SnowDashboardInput {
  /** Draft and dispatched storms (ended ones are history, not current work). */
  storms: DashboardStorm[];
  routes: DashboardRoute[];
  visits: DashboardVisit[];
  /** Completion media count per visit id. Missing key = 0. */
  mediaCountByVisit: Record<string, number>;
  /** Every pending skip request, whatever its storm's status. */
  pendingSkips: DashboardSkipRequest[];
  /** Names for storms that pending skips point at but that aren't in `storms` (ended). */
  extraStormNames?: Record<string, string>;
  /**
   * Completion photos/videos nobody has reviewed yet (snow_completion_media.review_status
   * = 'pending', update 030): count and the oldest upload time. null = review isn't set up.
   */
  mediaToReview: { count: number; oldest: string } | null;
  /** null = shift records aren't available (table not set up yet); never read as "no problems". */
  openShifts: OpenShift[] | null;
  /** Extra crew leads per route id (update 110); a route can have any number besides its main lead. */
  extraLeadsByRoute?: Record<string, string[]>;
  /** Person id → display name. */
  nameOf: (personId?: string) => string | undefined;
  now: Date;
}

// ── Storm Overview ──────────────────────────────────────────────────────────

export interface RouteOverview {
  id: string;
  stormId: string;
  name: string;
  leadPersonId?: string;
  /** Every lead's name (the main lead first), so a route with seven leads shows seven. */
  leadNames: string[];
  /** The leads joined for display ("A, B, C"); undefined when nobody is assigned. */
  leadName?: string;
  cancelled: boolean;
  mediaRequired: boolean;
  minMedia: number;
  total: number;
  completed: number;
  skipped: number;
  /** pending + arrived. */
  remaining: number;
  /** Lead tapped "I'm Here" but hasn't completed it yet. */
  onSite: number;
  /** completed + skipped over total; 0 for an empty route. */
  progress: number;
  /** The first unfinished stop in route order. */
  nextStop?: { visitId: string; propertyName: string; status: 'pending' | 'arrived' };
  /** Needs Attention items that point at this route. */
  attentionCount: number;
}

export interface StormOverview {
  id: string;
  name: string;
  service: SnowService;
  /** Every service the storm covers (update 40); missing on older databases, then `service` is the only one. */
  services?: SnowService[];
  status: Exclude<StormStatus, 'ended'>;
  dispatchedAt?: string;
  reopenedCount: number;
  /** Cancelled routes last. */
  routes: RouteOverview[];
  total: number;
  completed: number;
  skipped: number;
  remaining: number;
  progress: number;
  attentionCount: number;
}

// ── Needs Attention ─────────────────────────────────────────────────────────

/** Where an attention item leads. Turned into a screen path by snowDashboardHref. */
export type SnowTarget =
  | { kind: 'storm'; stormId: string }
  | { kind: 'route'; stormId: string; routeId: string }
  | { kind: 'visit'; stormId: string; routeId: string; visitId: string }
  | { kind: 'employee'; personId: string }
  | { kind: 'media_review' };

export type AttentionKind = 'skip_request' | 'missing_media' | 'route_without_lead' | 'media_review' | 'open_shift';

export interface AttentionItem {
  /** Stable per underlying record, e.g. `skip:<request id>`. */
  key: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  stormId?: string;
  routeId?: string;
  visitId?: string;
  personId?: string;
  /** ISO time the problem started (request made, arrival, clock-in…). Oldest first within a kind. */
  since: string;
  target: SnowTarget;
}

/** An open shift older than this is flagged as a likely missed clock-out. */
export const LONG_OPEN_SHIFT_HOURS = 14;

const KIND_ORDER: AttentionKind[] = ['skip_request', 'missing_media', 'route_without_lead', 'media_review', 'open_shift'];


function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function hoursBetween(fromIso: string, now: Date): number {
  return (now.getTime() - new Date(fromIso).getTime()) / 3_600_000;
}

/** Visits with fewer completion photos/videos than their route currently requires. */
function mediaShortfalls(input: SnowDashboardInput) {
  const routeById = new Map(input.routes.map((r) => [r.id, r]));
  const dispatched = new Set(input.storms.filter((s) => s.status === 'dispatched').map((s) => s.id));
  const out: { visit: DashboardVisit; route: DashboardRoute; have: number }[] = [];
  for (const v of input.visits) {
    if (!dispatched.has(v.stormId)) continue;
    if (v.status !== 'arrived' && v.status !== 'completed') continue;
    const route = routeById.get(v.routeId);
    if (!route || route.cancelledAt || !(v.photosRequired ?? route.mediaRequired)) continue;
    const have = input.mediaCountByVisit[v.id] ?? 0;
    if (have < (v.minMedia ?? route.minMedia)) out.push({ visit: v, route, have });
  }
  return out;
}

export function buildNeedsAttention(input: SnowDashboardInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const stormName = (id: string) =>
    input.storms.find((s) => s.id === id)?.name ?? input.extraStormNames?.[id] ?? 'Storm';
  const routeById = new Map(input.routes.map((r) => [r.id, r]));
  const visitById = new Map(input.visits.map((v) => [v.id, v]));

  // Skip requests waiting on a decision. The visit stays unresolved until then.
  for (const s of input.pendingSkips) {
    if (s.status !== 'pending') continue;
    const visit = visitById.get(s.visitId);
    const route = routeById.get(s.routeId);
    const who = input.nameOf(s.requestedBy) ?? 'The lead';
    items.push({
      key: `skip:${s.id}`,
      kind: 'skip_request',
      title: `Skip requested: ${visit?.propertyName ?? 'a stop'}`,
      detail: `${who} on ${route?.name ?? 'a route'} (${stormName(s.stormId)}): "${s.reason}"`,
      stormId: s.stormId, routeId: s.routeId, visitId: s.visitId, personId: s.requestedBy,
      since: s.createdAt,
      target: { kind: 'visit', stormId: s.stormId, routeId: s.routeId, visitId: s.visitId },
    });
  }

  // Required photos/videos that aren't there. The database won't let a visit be
  // completed short, so a completed one here means the requirement was turned on
  // or raised after it was finished.
  for (const { visit, route, have } of mediaShortfalls(input)) {
    const need = visit.minMedia ?? route.minMedia;
    const completed = visit.status === 'completed';
    items.push({
      key: `media:${visit.id}`,
      kind: 'missing_media',
      title: `${completed ? 'Completed without' : 'Waiting on'} required photos: ${visit.propertyName}`,
      detail: completed
        ? `${have} of ${need} on ${route.name}; finished before this requirement was set`
        : `${have} of ${need} on ${route.name}; can't be completed until ${need - have} more ${need - have === 1 ? 'is' : 'are'} added`,
      stormId: visit.stormId, routeId: route.id, visitId: visit.id,
      since: (completed ? visit.completedAt : visit.arrivedAt) ?? '',
      target: { kind: 'visit', stormId: visit.stormId, routeId: route.id, visitId: visit.id },
    });
  }

  // A dispatched route with unfinished stops and nobody to work it.
  for (const storm of input.storms) {
    if (storm.status !== 'dispatched') continue;
    for (const route of input.routes) {
      if (route.stormId !== storm.id || route.cancelledAt || route.leadPersonId || input.extraLeadsByRoute?.[route.id]?.length) continue;
      const open = input.visits.filter((v) => v.routeId === route.id && (v.status === 'pending' || v.status === 'arrived')).length;
      if (open === 0) continue;
      items.push({
        key: `nolead:${route.id}`,
        kind: 'route_without_lead',
        title: `No crew lead on ${route.name}`,
        detail: `${storm.name}: ${plural(open, 'stop')} left and nobody assigned`,
        stormId: storm.id, routeId: route.id,
        since: storm.dispatchedAt ?? storm.createdAt,
        target: { kind: 'route', stormId: storm.id, routeId: route.id },
      });
    }
  }

  // Completion photos/videos waiting for the owner's review before anything can be shared.
  if (input.mediaToReview && input.mediaToReview.count > 0) {
    const n = input.mediaToReview.count;
    items.push({
      key: 'review:media',
      kind: 'media_review',
      title: `${n} completion ${n === 1 ? 'photo or video' : 'photos and videos'} to review`,
      detail: 'Nothing is shown to customers until you review and share it',
      since: input.mediaToReview.oldest,
      target: { kind: 'media_review' },
    });
  }

  // Shifts still open long enough that a clock-out was probably missed.
  for (const shift of input.openShifts ?? []) {
    const hours = hoursBetween(shift.clockInAt, input.now);
    if (hours < LONG_OPEN_SHIFT_HOURS) continue;
    items.push({
      key: `shift:${shift.id}`,
      kind: 'open_shift',
      title: `${input.nameOf(shift.personId) ?? 'An employee'} is still clocked in`,
      detail: `Clocked in ${Math.floor(hours)} hours ago with no clock-out`,
      personId: shift.personId,
      since: shift.clockInAt,
      target: { kind: 'employee', personId: shift.personId },
    });
  }

  return items.sort((a, b) =>
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.since.localeCompare(b.since));
}

export function buildStormOverview(input: SnowDashboardInput, attention: AttentionItem[]): StormOverview[] {
  const visitsByRoute = new Map<string, DashboardVisit[]>();
  for (const v of input.visits) {
    const list = visitsByRoute.get(v.routeId);
    if (list) list.push(v); else visitsByRoute.set(v.routeId, [v]);
  }
  const countBy = (pick: (i: AttentionItem) => string | undefined) => {
    const m = new Map<string, number>();
    for (const i of attention) {
      const k = pick(i);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const attentionByRoute = countBy((i) => i.routeId);
  const attentionByStorm = countBy((i) => i.stormId);

  const storms = input.storms
    .filter((s): s is DashboardStorm & { status: 'draft' | 'dispatched' } => s.status !== 'ended')
    .map((storm): StormOverview => {
      const routes = input.routes
        .filter((r) => r.stormId === storm.id)
        .map((r): RouteOverview => {
          const visits = (visitsByRoute.get(r.id) ?? []).slice().sort((a, b) => a.position - b.position);
          const completed = visits.filter((v) => v.status === 'completed').length;
          const skipped = visits.filter((v) => v.status === 'skipped').length;
          const onSite = visits.filter((v) => v.status === 'arrived').length;
          const next = visits.find((v) => v.status === 'pending' || v.status === 'arrived');
          const leadNames = [r.leadPersonId, ...(input.extraLeadsByRoute?.[r.id] ?? [])]
            .filter((id, i, all): id is string => !!id && all.indexOf(id) === i)
            .map((id) => input.nameOf(id) ?? 'Unnamed');
          return {
            id: r.id,
            stormId: r.stormId,
            name: r.name,
            leadPersonId: r.leadPersonId,
            leadNames,
            leadName: leadNames.length ? leadNames.join(', ') : undefined,
            cancelled: !!r.cancelledAt,
            mediaRequired: r.mediaRequired,
            minMedia: r.minMedia,
            total: visits.length,
            completed,
            skipped,
            remaining: visits.length - completed - skipped,
            onSite,
            progress: visits.length ? (completed + skipped) / visits.length : 0,
            nextStop: next
              ? { visitId: next.id, propertyName: next.propertyName, status: next.status as 'pending' | 'arrived' }
              : undefined,
            attentionCount: attentionByRoute.get(r.id) ?? 0,
          };
        })
        .sort((a, b) => Number(a.cancelled) - Number(b.cancelled)
          || (input.routes.find((r) => r.id === a.id)!.position - input.routes.find((r) => r.id === b.id)!.position));

      // Cancelled routes don't count toward the storm's workload.
      const live = routes.filter((r) => !r.cancelled);
      const total = live.reduce((n, r) => n + r.total, 0);
      const completed = live.reduce((n, r) => n + r.completed, 0);
      const skipped = live.reduce((n, r) => n + r.skipped, 0);
      return {
        id: storm.id,
        name: storm.name,
        service: storm.service,
        services: storm.services,
        status: storm.status,
        dispatchedAt: storm.dispatchedAt,
        reopenedCount: storm.reopenedCount,
        routes,
        total,
        completed,
        skipped,
        remaining: total - completed - skipped,
        progress: total ? (completed + skipped) / total : 0,
        attentionCount: attentionByStorm.get(storm.id) ?? 0,
      };
    });

  // Dispatched before drafts; within each, the storm needing the most attention first, then newest.
  const createdAt = new Map(input.storms.map((s) => [s.id, s.createdAt]));
  return storms.sort((a, b) =>
    Number(a.status === 'draft') - Number(b.status === 'draft')
    || b.attentionCount - a.attentionCount
    || (createdAt.get(b.id) ?? '').localeCompare(createdAt.get(a.id) ?? ''));
}

export function buildSnowDashboard(input: SnowDashboardInput) {
  const needsAttention = buildNeedsAttention(input);
  return { storms: buildStormOverview(input, needsAttention), needsAttention };
}
