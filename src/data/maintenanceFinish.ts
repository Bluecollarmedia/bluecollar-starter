/**
 * Finishing a maintenance stop, as the worker screens use it.
 *
 * The rules and the save live in src/data/maintenance.ts (finishBlockers,
 * finishStop → the maintenance_finish_stop RPC, which locks the stop and
 * counts the services once). This file adds what the screens need on top:
 *  • missingRequirements(): the "what's missing" list, naming each open
 *    checklist item so the worker knows exactly what to tick.
 *  • finishStopAndAdvance(): reads the phone's position without ever
 *    blocking on it, finishes the stop, and returns the next stop in the
 *    owner's saved order.
 *  • useFinishingStop(): true while a finish is being saved (spinner, and
 *    the button stays disabled so a second tap does nothing).
 */

import { useSyncExternalStore } from 'react';
import { db } from './store';
import { finishBlockers, finishStop } from './maintenance';
import { getCurrentGps, type GpsResult } from '@/lib/location';
import { withTimedPhoto } from './timePhotos';
import { tr } from '@/i18n';
import type { MaintenanceStopDetail } from '@/types/maintenance';

const GPS_WAIT_MS = 6000;

function isStaff() {
  return db.role === 'owner' || db.role === 'admin';
}

/**
 * One of the data layer's English "can't finish yet" lines (or an error from the server) in the worker's language. The two lines that
 * carry a number are matched and rebuilt with the number; anything else is looked up as written (and stays as written if unknown).
 */
function blockerText(line: string): string {
  const photos = /^Add (\d+) more photos?\.$/.exec(line);
  if (photos) return Number(photos[1]) === 1 ? tr('Add 1 more photo.') : tr('Add {n} more photos.', { n: photos[1] });
  const items = /^(\d+) required checklist items? still open\.$/.exec(line);
  if (items) return Number(items[1]) === 1 ? tr('1 required checklist item still open.') : tr('{n} required checklist items still open.', { n: items[1] });
  return tr(line);
}

/**
 * What still has to be done before this stop can be finished, in plain
 * words. Empty = ready. Checklist items are listed by name.
 */
export function missingRequirements(stopOrId: string | MaintenanceStopDetail): string[] {
  const stop = typeof stopOrId === 'string' ? db.maintenance.stopById[stopOrId] : stopOrId;
  if (!stop) return [tr('This stop could not be found.')];
  const generic = finishBlockers(stop, { asStaff: isStaff() });
  const open = stop.tasks.filter((t) => t.isRequired && !t.completedAt);
  // Swap the data layer's "N checklist items still open" for the items themselves.
  return generic.flatMap((line) => (/checklist item/.test(line) ? open.map((t) => tr('Tick "{title}"', { title: t.title })) : [blockerText(line)]));
}

/** Photos added on this phone that are still uploading (they don't count yet). */
export function uploadingPhotoCount(stop: MaintenanceStopDetail): number {
  if (db.demo) return 0;
  return stop.photos.filter((p) => !/^https?:\/\//i.test(p.fileUrl)).length;
}

/** The next stop to work on after this one, in the owner's saved order. */
export function nextStopAfter(stop: MaintenanceStopDetail): MaintenanceStopDetail | undefined {
  const route = db.maintenance.routeById[stop.routeId];
  if (!route) return undefined;
  const open = route.stops.filter((s) => s.id !== stop.id && (s.status === 'pending' || s.status === 'arrived'));
  return open.find((s) => s.number > stop.number) ?? open[0];
}

// ── In-progress state, shared by every screen showing the stop ─────────────

/** Finishes being saved, by stop. A repeat tap gets the same promise. */
const finishing = new Map<string, Promise<FinishOutcome>>();
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useFinishingStop(stopId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => !!stopId && finishing.has(stopId), () => false);
}

async function gpsWithin(ms: number): Promise<GpsResult> {
  const timeout = new Promise<GpsResult>((r) => setTimeout(() => r({ status: 'unavailable' }), ms));
  return Promise.race([getCurrentGps(), timeout]);
}

export type FinishOutcome =
  | { ok: true; alreadyDone: boolean; nextStopId?: string }
  | { ok: false; missing: string[]; error?: string };

/**
 * FINISH STOP. Checks the requirements first, then saves once for the whole
 * crew. GPS is recorded when the phone has it; it never blocks finishing.
 * Repeat taps while saving return the same result and save nothing extra.
 */
export function finishStopAndAdvance(stopId: string, note?: string): Promise<FinishOutcome> {
  const running = finishing.get(stopId);
  if (running) return running;

  const stop = db.maintenance.stopById[stopId];
  if (!stop) return Promise.resolve({ ok: false, missing: [], error: tr('This stop could not be found.') });
  if (stop.status === 'completed') return Promise.resolve({ ok: true, alreadyDone: true, nextStopId: nextStopAfter(stop)?.id });
  const missing = missingRequirements(stop);
  if (missing.length) return Promise.resolve({ ok: false, missing });

  const p = (async (): Promise<FinishOutcome> => {
    const gps = await gpsWithin(GPS_WAIT_MS);
    const res = await withTimedPhoto(() => finishStop(stopId, { note, gps }), 'complete', { kind: 'maintenance', stopId });
    if (!res.ok) {
      // The server re-checks the rules; if a crewmate un-ticked something, say what.
      const still = missingRequirements(stopId);
      return { ok: false, missing: still, error: still.length ? undefined : blockerText(res.error) };
    }
    return { ok: true, alreadyDone: false, nextStopId: nextStopFor(stopId) };
  })().finally(() => {
    finishing.delete(stopId);
    emit();
  });
  finishing.set(stopId, p);
  emit();
  return p;
}

function nextStopFor(stopId: string) {
  const s = db.maintenance.stopById[stopId];
  return s ? nextStopAfter(s)?.id : undefined;
}
