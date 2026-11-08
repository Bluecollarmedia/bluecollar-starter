// What the Snow dashboard shows for the active storm and its crews. Pure functions over the StormOverview the
// dashboard already builds (src/data/snowDashboard.ts): this file adds NO new definition of "completed" or
// "remaining". It only picks the active storm and shapes numbers for display.
//
// The app's definitions (kept as they are):
//   completed = stops with status 'completed'
//   skipped   = stops with status 'skipped'
//   remaining = stops not finished yet (pending + arrived)
//   total     = completed + skipped + remaining
//   progress  = (completed + skipped) / total   (a skipped stop is closed out, so a route can reach 100%)
// Cancelled routes are not counted in the storm's totals, so they are not listed as crews either.
import type { RouteOverview, StormOverview } from '@/data/snowDashboard';

/** Whole percent, safe for 0 stops (0%), never above 100. */
export function percentOf(done: number, total: number): number {
  if (!(total > 0) || !(done > 0)) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

/**
 * The storm the dashboard puts at the top. The overview is already ordered (dispatched before drafts, then the one
 * needing most attention, then newest); ended storms never reach it. So: the first dispatched storm, else the first draft.
 */
export function pickActiveStorm(storms: StormOverview[]): StormOverview | undefined {
  return storms.find((s) => s.status === 'dispatched') ?? storms[0];
}

/** Every other storm, in the same order, for the list under the main card. */
export function otherStorms(storms: StormOverview[], active: StormOverview | undefined): StormOverview[] {
  return active ? storms.filter((s) => s.id !== active.id) : storms;
}

/**
 * What the owner's dashboard lists: only storms that are running right now. A draft is not running yet and an ended storm is
 * history (both stay on the Storms tab), so neither appears here.
 */
export function runningStorms(storms: StormOverview[]): StormOverview[] {
  return storms.filter((s) => s.status === 'dispatched');
}

/** "2 out of 40 stops complete": every route of the storm together. Skipped stops are closed out, so they count as done. */
export function stopsCompleteLabel(storm: Pick<StormOverview, 'completed' | 'skipped' | 'total'>): string {
  return storm.total > 0 ? `${storm.completed + storm.skipped} out of ${storm.total} stops complete` : 'No stops yet';
}

export type CrewStatus = 'planned' | 'not_started' | 'in_progress' | 'completed' | 'empty';

export const CREW_STATUS_LABEL: Record<CrewStatus, string> = {
  planned: 'Planned',
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
  empty: 'No stops',
};

/** One route's state. A storm that has not been dispatched is 'planned' whatever its stops say. */
export function crewStatus(r: Pick<RouteOverview, 'total' | 'completed' | 'skipped' | 'remaining' | 'onSite'>, dispatched: boolean): CrewStatus {
  if (r.total === 0) return 'empty';
  if (!dispatched) return 'planned';
  if (r.remaining === 0) return 'completed';
  if (r.completed > 0 || r.skipped > 0 || r.onSite > 0) return 'in_progress';
  return 'not_started';
}

/** "Route 1" -> "R1", "North Lot Crew" -> "NL", "Crew 4" -> "C4". Two characters at most. */
export function crewInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const num = words.length > 1 ? words[words.length - 1].match(/^\d+/)?.[0] : undefined;
  if (num && words.length === 2) return `${words[0][0]}${num.slice(0, 1)}`.toUpperCase();
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export interface CrewRow {
  id: string;
  name: string;
  initials: string;
  /** "Lead: Jane Doe" / "Leads: Jane Doe, Sam Lee, ...", or a neutral note when nobody is assigned. */
  leadLabel: string;
  completed: number;
  total: number;
  skipped: number;
  remaining: number;
  percent: number;
  status: CrewStatus;
  statusLabel: string;
  onSite: number;
}

/** The crews to list: this storm's routes that count toward its totals (cancelled ones are left out). */
export function crewRows(storm: StormOverview): CrewRow[] {
  const dispatched = storm.status === 'dispatched';
  return storm.routes.filter((r) => !r.cancelled).map((r) => {
    const status = crewStatus(r, dispatched);
    return {
      id: r.id,
      name: r.name,
      initials: crewInitials(r.name),
      leadLabel: r.leadName ? `${r.leadNames.length > 1 ? 'Leads' : 'Lead'}: ${r.leadName}` : 'No lead assigned',
      completed: r.completed,
      total: r.total,
      skipped: r.skipped,
      remaining: r.remaining,
      percent: percentOf(r.completed + r.skipped, r.total),
      status,
      statusLabel: CREW_STATUS_LABEL[status],
      onSite: r.onSite,
    };
  });
}

/** The routes still being worked: a finished route comes off the dashboard the moment its last stop is closed. */
export function openCrewRows(storm: StormOverview): CrewRow[] {
  return crewRows(storm).filter((r) => r.status !== 'completed');
}

export interface StormHeadline {
  stormId: string;
  name: string;
  dispatched: boolean;
  /** 'Active' for a dispatched storm, 'Planned' for one that is not dispatched yet. */
  badgeLabel: string;
  /** 'In Progress' once any stop is closed or someone is on site; 'Not Started'; 'Completed'; 'Planned'. */
  stateLabel: string;
  completed: number;
  remaining: number;
  skipped: number;
  total: number;
  percent: number;
  routeCount: number;
  cancelledRoutes: number;
  /** "12 of 30 stops completed across 4 routes" (+ ", 2 skipped" when any were skipped). */
  summary: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function stormHeadline(storm: StormOverview): StormHeadline {
  const live = storm.routes.filter((r) => !r.cancelled);
  const cancelledRoutes = storm.routes.length - live.length;
  const dispatched = storm.status === 'dispatched';
  const anyStarted = storm.completed > 0 || storm.skipped > 0 || live.some((r) => r.onSite > 0);
  let stateLabel: string;
  if (!dispatched) stateLabel = 'Planned';
  else if (storm.total > 0 && storm.remaining === 0) stateLabel = 'Completed';
  else if (anyStarted) stateLabel = 'In Progress';
  else stateLabel = 'Not Started';

  const routes = plural(live.length, 'route', 'routes');
  let summary: string;
  if (storm.total === 0) {
    summary = live.length ? `No stops yet across ${routes}` : 'No routes yet';
  } else {
    summary = `${storm.completed} of ${storm.total} stops completed across ${routes}`;
    if (storm.skipped > 0) summary += `, ${storm.skipped} skipped`;
  }
  return {
    stormId: storm.id,
    name: storm.name,
    dispatched,
    badgeLabel: dispatched ? 'Active' : 'Planned',
    stateLabel,
    completed: storm.completed,
    remaining: storm.remaining,
    skipped: storm.skipped,
    total: storm.total,
    percent: percentOf(storm.completed + storm.skipped, storm.total),
    routeCount: live.length,
    cancelledRoutes,
    summary,
  };
}

/** "Dispatched Oct 19 · 9:44 AM", or a note for a storm that is not dispatched. */
export function dispatchedLabel(dispatchedAt: string | undefined, dispatched: boolean): string {
  if (!dispatched) return 'Not dispatched yet';
  if (!dispatchedAt) return 'Dispatched';
  const d = new Date(dispatchedAt);
  if (Number.isNaN(d.getTime())) return 'Dispatched';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Dispatched ${date} · ${time}`;
}

/** A list with repeated ids collapsed to the first of each, so a stop returned twice is never counted twice. */
export function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
