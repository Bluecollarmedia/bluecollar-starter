/**
 * Clock-in location alerts (database update 107, edge function clock-in-alert).
 *
 * The yard is the one the owner already set on the Yard Location screen; Settings > Yard and clock-in alerts holds the rest. When a worker clocks in, the phone's location is recorded with that workday; if a yard is set and the
 * worker is outside it (or no location could be read) the owner is emailed exactly where the worker clocked in from. Clocking in is NEVER
 * blocked or slowed by any of this: the location is read while the clock-in is happening, and everything here is best effort and silent.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { GpsResult } from '@/lib/location';
import type { MyDay } from '@/data/timeTracking';

export interface YardAlerts {
  /** Whether the owner has set a yard on the Yard Location screen (alerts need one). */
  yardSet: boolean;
  yardAddress: string;
  radiusM: number;
  alertOn: boolean;
  /** Where the email goes; empty = every owner's own email. */
  alertEmail: string;
}

/** How close counts as "at the yard" (shown in feet, kept in meters). */
export const YARD_RADII: { label: string; meters: number }[] = [
  { label: '300 ft', meters: 91 },
  { label: '500 ft', meters: 152 },
  { label: '1,000 ft', meters: 305 },
  { label: '1/4 mile', meters: 402 },
  { label: '1/2 mile', meters: 805 },
];
export const DEFAULT_RADIUS_M = 152;

type Raw = Record<string, any>;
const parse = (r: Raw | null): YardAlerts => ({
  yardSet: !!r?.yard_set,
  yardAddress: String(r?.yard_address ?? ''),
  radiusM: Number(r?.radius_m) || DEFAULT_RADIUS_M,
  alertOn: r?.alert_on === true,
  alertEmail: String(r?.alert_email ?? ''),
});

type Answer<T> = { ok: true; data: T } | { ok: false; error: string; notInstalled?: boolean };
const missing = (m: string) => /could not find the function|does not exist|schema cache/i.test(m);

export async function loadYardAlerts(): Promise<Answer<YardAlerts>> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Not connected.' };
  const { data, error } = await supabase.rpc('owner_get_yard_alerts');
  if (error) return { ok: false, error: error.message, notInstalled: missing(error.message) };
  return { ok: true, data: parse(data as Raw | null) };
}

export async function saveYardAlerts(a: Pick<YardAlerts, 'radiusM' | 'alertOn' | 'alertEmail'>): Promise<Answer<YardAlerts>> {
  const { data, error } = await supabase.rpc('owner_set_yard_alerts', { p_radius_m: a.radiusM, p_alert_on: a.alertOn, p_alert_email: a.alertEmail.trim() || null });
  if (error) return { ok: false, error: error.message, notInstalled: missing(error.message) };
  return { ok: true, data: parse(data as Raw | null) };
}

/**
 * After a clock-in: record where the phone was, and ask for the email when the database says the owner should be told. Never throws,
 * never waits for anything the worker is looking at, and does nothing before update 107 is installed.
 */
export async function reportClockInLocation(day: MyDay, where: Promise<GpsResult>): Promise<void> {
  try {
    if (!isSupabaseConfigured) return;
    const open = [...day.days].reverse().find((d) => !d.clockOutAt);
    if (!open) return;
    const here = await where;
    const gps = here.status === 'ok' ? here.gps : null;
    const note = here.status === 'ok' ? null : here.status === 'denied' ? 'location permission denied' : 'location unavailable';
    const { data, error } = await supabase.rpc('time_record_clock_in_location', {
      p_workday: open.id, p_lat: gps?.latitude ?? null, p_lng: gps?.longitude ?? null, p_accuracy: gps?.accuracy ?? null, p_note: note,
    });
    if (error) return;
    if ((data as Raw | null)?.alert_needed === true) await supabase.functions.invoke('clock-in-alert', { body: { workday_id: open.id } });
  } catch {
    /* the clock-in already worked; this is only the owner's heads-up */
  }
}
