/**
 * Owner review of a maintenance route: what actually happened, who recorded
 * it, how well each event was verified, and what needs a look.
 *
 * Owner corrections never change the crew's own records. A correction is a
 * 'correction' event (supabase/updates/019); the screens show the corrected
 * time next to what the crew recorded.
 */
import { db, insertRow, rpc, refresh, isDemo } from './store';
import { locationLabel, type Result } from './maintenance';
import { todayKey } from '@/lib/ids';
import type { PersonSummary } from '@/types/company';
import type {
  LocationStatus, MaintenanceDayAttendance, MaintenanceEvent, MaintenanceRouteDetail, MaintenanceStopDetail,
} from '@/types/maintenance';

export type StopTimeKind = 'arrival' | 'completion';

export interface StopCorrection {
  /** The corrected time. */
  at: string;
  by?: PersonSummary;
  note?: string;
  /** When the correction was made. */
  madeAt: string;
  /** What the crew had recorded (none = nothing was recorded). */
  originalAt?: string;
}

export interface RecordedTime {
  /** What the crew (or owner) recorded. Undefined = never recorded. */
  at?: string;
  by?: PersonSummary;
  locationStatus?: LocationStatus;
  /** Latest owner correction, if any. Earlier ones stay in the activity log. */
  correction?: StopCorrection;
}

export interface WorkerArrival {
  person?: PersonSummary;
  personId?: string;
  at: string;
  locationStatus?: LocationStatus;
  distanceM?: number;
}

export interface StopReview {
  stop: MaintenanceStopDetail;
  arrival: RecordedTime;
  completion: RecordedTime;
  /** Each crew member's own I'm Here, oldest first. */
  arrivals: WorkerArrival[];
  tasksDone: number;
  tasksRequiredOpen: number;
  photoCount: number;
  /** Completed without the crew tapping I'm Here (the owner finished it). */
  finishedWithoutArrival: boolean;
}

export type AttentionTone = 'error' | 'warning';

export interface AttentionItem {
  key: string;
  tone: AttentionTone;
  text: string;
  stopId?: string;
  personId?: string;
}

export interface AttendanceReview {
  personId: string;
  person?: PersonSummary;
  isLead: boolean;
  attendance?: MaintenanceDayAttendance;
  /** Arrived at a property without starting the day at the yard. */
  workedWithoutStart: boolean;
}

export interface RouteReview {
  stops: StopReview[];
  attendance: AttendanceReview[];
  attention: AttentionItem[];
}

const name = (p?: PersonSummary, fallback = 'Someone') => (p ? `${p.firstName} ${p.lastName}`.trim() : fallback);
const first = (p?: PersonSummary, fallback = 'A crew member') => p?.firstName || fallback;

function correctionOf(events: MaintenanceEvent[], stopId: string, kind: StopTimeKind): StopCorrection | undefined {
  // events are newest first, so the first match is the latest correction.
  const e = events.find((x) => x.eventType === 'correction' && x.stopId === stopId && x.metadata?.kind === `stop_${kind}`);
  if (!e) return undefined;
  const md = e.metadata as Record<string, unknown>;
  return {
    at: String(md.corrected_time),
    by: e.actor,
    note: e.note,
    madeAt: e.occurredAt,
    originalAt: md.original_time ? String(md.original_time) : undefined,
  };
}

/** Pure: build the owner's review from a route, its events (newest first) and attendance rows. */
export function buildRouteReview(
  route: MaintenanceRouteDetail,
  events: MaintenanceEvent[],
  attendance: MaintenanceDayAttendance[],
  people: Record<string, PersonSummary>,
  today: string = todayKey(),
): RouteReview {
  const routeEvents = events.filter((e) => e.routeId === route.id || (e.stopId && route.stops.some((s) => s.id === e.stopId)));
  const isPast = route.serviceDate < today;
  const isToday = route.serviceDate === today;
  const cancelled = route.status === 'cancelled';
  const attention: AttentionItem[] = [];

  const stops: StopReview[] = route.stops.map((stop) => {
    const arrivals = routeEvents
      .filter((e) => e.stopId === stop.id && e.eventType === 'arrived')
      .map((e) => ({ person: e.actor, personId: e.personId, at: e.occurredAt, locationStatus: e.locationStatus, distanceM: e.distanceM }))
      .sort((a, b) => a.at.localeCompare(b.at));
    const arrival: RecordedTime = {
      at: stop.arrivedAt,
      by: stop.arrivedBy ? people[stop.arrivedBy] : undefined,
      locationStatus: stop.arrivalLocationStatus,
      correction: correctionOf(routeEvents, stop.id, 'arrival'),
    };
    const completion: RecordedTime = {
      at: stop.completedAt,
      by: stop.completedBy ? people[stop.completedBy] : undefined,
      locationStatus: stop.completionLocationStatus,
      correction: correctionOf(routeEvents, stop.id, 'completion'),
    };
    const review: StopReview = {
      stop,
      arrival,
      completion,
      arrivals,
      tasksDone: stop.tasks.filter((t) => t.completedAt).length,
      tasksRequiredOpen: stop.tasks.filter((t) => t.isRequired && !t.completedAt).length,
      photoCount: stop.photos.length,
      finishedWithoutArrival: stop.status === 'completed' && !stop.arrivedAt,
    };

    if (cancelled) return review;
    const label = `Stop ${stop.number} · ${stop.property?.name ?? 'Property'}`;
    if (review.finishedWithoutArrival && !arrival.correction) {
      attention.push({ key: `noarr-${stop.id}`, tone: 'warning', stopId: stop.id, text: `${label}: finished with no I'm Here recorded` });
    }
    if (!arrival.correction) {
      // Each worker's own I'm Here is checked, not just the first one.
      const unverified = arrivals.length
        ? arrivals.filter((a) => a.locationStatus !== 'verified')
        : stop.arrivedAt && stop.arrivalLocationStatus !== 'verified'
          ? [{ person: arrival.by, personId: stop.arrivedBy, locationStatus: stop.arrivalLocationStatus }]
          : [];
      for (const a of unverified) {
        attention.push({
          key: `arrloc-${stop.id}-${a.personId ?? ''}`, tone: 'warning', stopId: stop.id, personId: a.personId,
          text: `${label}: ${first(a.person)}'s arrival not GPS verified (${locationLabel(a.locationStatus)})`,
        });
      }
    }
    if (stop.status === 'completed' && stop.completionLocationStatus && stop.completionLocationStatus !== 'verified' && !completion.correction) {
      attention.push({ key: `donloc-${stop.id}`, tone: 'warning', stopId: stop.id, text: `${label}: finish not GPS verified (${locationLabel(stop.completionLocationStatus)})` });
    }
    if (stop.status === 'completed' && stop.requiresPhotos && review.photoCount < stop.minPhotos) {
      attention.push({ key: `photo-${stop.id}`, tone: 'warning', stopId: stop.id, text: `${label}: ${review.photoCount} of ${stop.minPhotos} required photos` });
    }
    if (isPast && (stop.status === 'pending' || stop.status === 'arrived')) {
      attention.push({ key: `open-${stop.id}`, tone: 'error', stopId: stop.id, text: `${label}: never finished` });
    }
    return review;
  });

  const startedRoute = route.status === 'in_progress' || route.status === 'completed' || routeEvents.some((e) => e.eventType === 'arrived');
  const attendanceRows: AttendanceReview[] = route.crewIds.map((personId) => {
    const att = attendance.find((a) => a.personId === personId && a.serviceDate === route.serviceDate);
    const arrivedSomewhere = routeEvents.some((e) => e.eventType === 'arrived' && e.personId === personId);
    const row: AttendanceReview = {
      personId,
      person: people[personId],
      isLead: route.leadPersonId === personId,
      attendance: att,
      workedWithoutStart: !att && arrivedSomewhere,
    };
    if (cancelled || route.serviceDate > today) return row;
    const who = first(people[personId]);
    if (!att && arrivedSomewhere) {
      attention.push({ key: `att-${personId}`, tone: 'warning', personId, text: `${who} worked the route but didn't start the day at the yard` });
    } else if (!att && (isPast || (isToday && startedRoute))) {
      attention.push({ key: `att-${personId}`, tone: isPast ? 'error' : 'warning', personId, text: isPast ? `${who} never started the day` : `${who} hasn't started the day` });
    } else if (att && att.source === 'worker' && !att.correctedAt && att.locationStatus !== 'verified') {
      attention.push({ key: `attloc-${personId}`, tone: 'warning', personId, text: `${who}'s day start wasn't GPS verified (${locationLabel(att.locationStatus)})` });
    }
    return row;
  });

  // Errors first, then warnings; each group keeps route order.
  attention.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'error' ? -1 : 1));
  return { stops, attendance: attendanceRows, attention };
}

/** One line for an event in the owner's activity log. */
export function describeEvent(e: MaintenanceEvent, route?: MaintenanceRouteDetail): string {
  const who = name(e.actor, 'Someone');
  const stop = e.stopId ? route?.stops.find((s) => s.id === e.stopId) : undefined;
  const where = stop ? `${stop.property?.name ?? 'stop'} (stop ${stop.number})` : 'a stop';
  const md = (e.metadata ?? {}) as Record<string, unknown>;
  switch (e.eventType) {
    case 'day_started': return `${who} started the day · ${locationLabel(e.locationStatus)}`;
    case 'arrived': return `${who} tapped I'm Here at ${where} · ${locationLabel(e.locationStatus)}`;
    case 'task_checked': return `${who} checked "${md.title ?? 'a checklist item'}" at ${where}`;
    case 'task_unchecked': return `${who} unchecked "${md.title ?? 'a checklist item'}" at ${where}`;
    case 'photo_added': return `${who} added a photo at ${where}`;
    case 'completed': return md.recorded_by_staff_without_arrival
      ? `${who} marked ${where} finished (no I'm Here recorded)`
      : `${who} finished ${where} · ${locationLabel(e.locationStatus)}`;
    case 'skipped': return `${who} skipped ${where}${e.note ? `: ${e.note}` : ''}`;
    case 'correction': {
      const when = md.corrected_time ? formatTime(String(md.corrected_time)) : '';
      if (md.kind === 'stop_arrival') return `${who} corrected the arrival at ${where} to ${when}`;
      if (md.kind === 'stop_completion') return `${who} corrected the finish at ${where} to ${when}`;
      if (md.kind === 'attendance') {
        const worker = md.worker_id ? db.people[String(md.worker_id)] : undefined;
        return `${who} set ${first(worker, 'a worker')}'s day start to ${md.started_at ? formatTime(String(md.started_at)) : ''}`;
      }
      return `${who} made a correction`;
    }
  }
}

export function formatTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Owner/admin: set the real arrival or finish time of a stop. Adds a
 * correction event; the crew's own record is left exactly as it was.
 */
export async function correctStopTime(stopId: string, kind: StopTimeKind, at: Date, note: string): Promise<Result> {
  const stop = db.maintenance.stopById[stopId];
  if (!stop) return { ok: false, error: 'Stop not found.' };
  if (!note.trim()) return { ok: false, error: 'Add a note explaining the correction.' };
  if (at.getTime() > Date.now() + 5 * 60_000) return { ok: false, error: "The corrected time can't be in the future." };
  if (kind === 'completion' && stop.status !== 'completed') return { ok: false, error: "Only a finished stop's time can be corrected." };
  if (kind === 'arrival' && stop.status === 'skipped') return { ok: false, error: 'This stop was skipped.' };
  if (isDemo()) {
    insertRow('maintenance_events', {
      eventType: 'correction', personId: db.personId, routeId: stop.routeId, stopId, occurredAt: new Date().toISOString(), note: note.trim(),
      metadata: {
        kind: `stop_${kind}`, stop_id: stopId, corrected_time: at.toISOString(),
        original_time: kind === 'arrival' ? stop.arrivedAt : stop.completedAt,
        original_person_id: kind === 'arrival' ? stop.arrivedBy : stop.completedBy,
      },
    });
    return { ok: true, data: undefined };
  }
  const { error } = await rpc('maintenance_correct_stop_time', { p_stop_id: stopId, p_kind: kind, p_at: at.toISOString(), p_note: note.trim() });
  await refresh('maintenance_events');
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}
