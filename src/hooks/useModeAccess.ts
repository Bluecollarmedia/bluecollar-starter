import { useCallback, useEffect, useState } from 'react';
import { db, useDb, updateRow } from '@/data/store';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { CompanyMode } from '@/types/company';
import type { UserRole } from '@/types';

/**
 * Landscaping Mode vs Snow Mode.
 *
 * Two separate questions, kept apart on purpose:
 *  1. Which mode is the company in? (`companies.active_mode`, set by the owner.)
 *  2. Which modes is this person allowed into? (their own permissions.)
 *
 * The company mode only picks between the experiences a person is already
 * allowed into. It never grants access. Data access is enforced by the
 * database's row-level security, not by which screens are shown.
 *
 * Routing (snow-mode/architecture-review.md §5, decided 2026-10-15):
 *
 *   Person                    Company in Landscaping   Company in Snow
 *   Owner/admin               landscaping owner app    snow owner app
 *   Landscaping-only worker   landscaping app          "Snow Mode is on" notice
 *   Worker with snow access   landscaping app          snow worker app (no switch: when the owner turns Snow Mode on, that is
 *                                                       what they see; snow access is per worker (Snow Team))
 *   Snow-only worker          snow worker app          snow worker app
 *   Customer                  landscaping app          landscaping app (snow
 *                                                       updates are added there)
 */

export interface ModeAccess {
  landscaping: boolean;
  snow: boolean;
}

/** Which experience to show. 'snow_notice' = the "Snow Mode is on" screen. */
export type Shell = 'landscaping' | 'snow' | 'snow_notice';

/** The company's current mode. Missing (SQL update not run yet) means Landscaping. */
export function companyMode(): CompanyMode {
  return db.company?.activeMode === 'snow' ? 'snow' : 'landscaping';
}

/**
 * Which modes a person may use. Owner/admin: both. Workers: landscaping by
 * default, snow only when `granted` says so (their snow-team membership).
 * Customers: landscaping. Keep this the single place that answers the
 * question so routing can't drift from the permission model.
 */
export function modeAccessFor(role: UserRole | null | undefined, granted?: Partial<ModeAccess>): ModeAccess {
  if (role === 'owner' || role === 'admin') return { landscaping: true, snow: true };
  if (role === 'worker') return { landscaping: granted?.landscaping ?? true, snow: granted?.snow ?? false };
  if (role === 'customer') return { landscaping: true, snow: false };
  return { landscaping: false, snow: false };
}

/** The routing table above, as a function. */
export function shellFor(role: UserRole | null | undefined, mode: CompanyMode, access: ModeAccess): Shell {
  if (role === 'customer') return 'landscaping';
  // Snow Mode on means Snow Mode for everyone who has snow access. There is no switch to step out of it.
  if (access.snow && (mode === 'snow' || !access.landscaping)) return 'snow';
  if (mode === 'snow' && role === 'worker') return 'snow_notice';
  return 'landscaping';
}

/** Company mode plus the owner's switch. */
export function useCompanyMode() {
  useDb();
  const mode = companyMode();
  const canSwitch = db.role === 'owner' || db.role === 'admin';

  /** Owner/admin only (the database refuses anyone else). Records who and when on the server. */
  const setMode = useCallback((next: CompanyMode) => {
    if (!db.company || companyMode() === next) return;
    updateRow('companies', db.company.id, { activeMode: next });
  }, []);

  return {
    mode,
    canSwitch,
    setMode,
    changedAt: db.company?.activeModeChangedAt,
  };
}

/**
 * The worker's own snow access, from get_my_snow_access() (the snow
 * permissions update). Re-checked whenever the company mode changes, so a
 * worker added to the snow team picks it up on the next switch. If the
 * function isn't installed yet or the call fails, the answer is "no snow
 * access": a failure never opens Snow Mode.
 */
const snowAccessCache = new Map<string, Partial<ModeAccess>>();
/** If the answer is slower than this, the app stops waiting and carries on as "no snow access" (a later answer still updates it). */
const SNOW_ACCESS_WAIT_MS = 3000;

function useWorkerSnowAccess(role: UserRole | null | undefined, mode: CompanyMode): { access: Partial<ModeAccess>; ready: boolean } {
  const [, bump] = useState(0);
  const companyId = db.companyId;
  const asks = role === 'worker' && isSupabaseConfigured && !!companyId;

  useEffect(() => {
    if (!asks || !companyId) {
      // Signed out, or not a worker: forget what was learned so nobody inherits another person's answer.
      snowAccessCache.clear();
      return;
    }
    let cancelled = false;
    // Never show the wrong screen while waiting: callers hold off until `ready`, with this as the upper limit on the wait.
    const giveUp = setTimeout(() => {
      if (cancelled || snowAccessCache.has(companyId)) return;
      snowAccessCache.set(companyId, { snow: false });
      bump((n) => n + 1);
    }, SNOW_ACCESS_WAIT_MS);
    supabase.rpc('get_my_snow_access').then(({ data, error }) => {
      if (cancelled) return;
      const rows = !error && Array.isArray(data) ? (data as { company_id?: string; landscaping_access?: boolean }[]) : [];
      const mine = rows.find((r) => r.company_id === companyId);
      snowAccessCache.set(companyId, mine ? { snow: true, landscaping: mine.landscaping_access !== false } : { snow: false });
      bump((n) => n + 1);
    });
    return () => {
      cancelled = true;
      clearTimeout(giveUp);
    };
  }, [asks, mode, companyId]);

  if (!asks || !companyId) return { access: { snow: false }, ready: true };
  const known = snowAccessCache.get(companyId);
  return { access: known ?? { snow: false }, ready: !!known };
}

/**
 * What this signed-in person may use, and which experience they see now.
 * `granted` overrides what was looked up (e.g. a snow-only worker resolved
 * at sign-in).
 */
export function useModeAccess(role: UserRole | null | undefined, granted?: Partial<ModeAccess>) {
  useDb();
  const mode = companyMode();
  const { access: looked, ready } = useWorkerSnowAccess(role, mode);
  const access = modeAccessFor(role, { ...looked, ...granted });
  // While Snow Mode is on, a worker's screen depends on one answer that arrives a moment after launch: their snow access. Until it is in,
  // no screen is chosen, so the "Snow Mode is on" notice or the wrong shell never flashes before the real one.
  const pending = role === 'worker' && mode === 'snow' && !ready;
  return { mode, access, shell: shellFor(role, mode, access), pending };
}
