/**
 * Property visit history helpers (update 68). A visit's ELAPSED time (arrival to completion) and its ESTIMATED labor-hours (the minutes
 * each assigned worker's own recorded workday overlapped the visit, added up) are different numbers and are never mixed up.
 * The comparison below only tells the owner "this visit took noticeably longer than this property usually does"; it is a pointer to
 * investigate, not a verdict, and uses only saved times.
 */
export interface VisitRecord {
  stopId: string;
  visitId?: string | null;
  serviceDate: string;
  status: string;
  leaderName?: string | null;
  arrivedAt?: string | null;
  completedAt?: string | null;
  elapsedMinutes: number | null;
  estLaborMinutes: number | null;
  crew: { personId: string; name: string; minutes: number }[];
  tasksDone: number;
  tasksTotal: number;
  photos: number;
  savedVisit: boolean;
}

export const hoursText = (minutes: number | null | undefined) => (minutes == null ? '' : `${(Math.round((minutes / 60) * 10) / 10).toFixed(1)} h`);
export const minutesText = (minutes: number | null | undefined) => {
  if (minutes == null) return '';
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

/** Visits that have both an arrival and a completion (the ones that can be compared). Oldest first. */
const timed = (visits: VisitRecord[]) => visits.filter((v) => v.elapsedMinutes != null && v.status === 'completed').sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));

export interface SeasonSummary { visits: number; averageElapsedMinutes: number | null; averageLaborMinutes: number | null; totalLaborMinutes: number }
export function seasonSummary(visits: VisitRecord[]): SeasonSummary {
  const t = timed(visits);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    visits: t.length,
    averageElapsedMinutes: avg(t.map((v) => v.elapsedMinutes as number)),
    averageLaborMinutes: avg(t.filter((v) => v.estLaborMinutes != null).map((v) => v.estLaborMinutes as number)),
    totalLaborMinutes: t.reduce((s, v) => s + (v.estLaborMinutes ?? 0), 0),
  };
}

/**
 * For one visit: how its elapsed time compares with the average of the visits BEFORE it (the 5 most recent). Null when there is nothing
 * to compare. `unusual` = at least 25% and at least 15 minutes longer than that average.
 */
export function compareToUsual(visits: VisitRecord[], stopId: string): { usualMinutes: number; differenceMinutes: number; percent: number; unusual: boolean } | null {
  const t = timed(visits);
  const i = t.findIndex((v) => v.stopId === stopId);
  if (i < 1) return null;
  const prior = t.slice(Math.max(0, i - 5), i).map((v) => v.elapsedMinutes as number);
  if (!prior.length) return null;
  const usual = prior.reduce((a, b) => a + b, 0) / prior.length;
  const diff = (t[i].elapsedMinutes as number) - usual;
  const percent = usual > 0 ? (diff / usual) * 100 : 0;
  return { usualMinutes: usual, differenceMinutes: diff, percent, unusual: diff >= 15 && percent >= 25 };
}
