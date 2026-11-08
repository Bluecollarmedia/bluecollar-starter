import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { db, getSession, isDemo, useDb } from '@/data/store';
import { uniqueById } from '@/lib/snowDashboardView';
import {
  buildSnowDashboard, type DashboardRoute, type DashboardSkipRequest, type DashboardStorm,
  type DashboardVisit, type OpenShift,
} from '@/data/snowDashboard';

/**
 * Loads what the owner's Snow dashboard needs, straight from Supabase (snow
 * tables aren't in the store; see foundation 020b), and shapes it with
 * buildSnowDashboard. Reads only: nothing here changes a record, so opening the
 * dashboard never clears an alert. Owner/admin only by the tables' own rules.
 *
 * Reloads when the screen gains focus, when the app returns to the foreground,
 * and on pull-to-refresh.
 */

type Row = Record<string, any>;

export type SnowDashboardState =
  | { kind: 'loading' }
  /** Demo mode, or the snow update (020b) isn't on this database yet. */
  | { kind: 'unavailable'; reason: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

function camelRow<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v ?? undefined;
  return out as T;
}

/** PostgREST / Postgres "that table isn't there". */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01' || /does not exist|schema cache/i.test(error.message ?? ''));
}

interface Loaded {
  storms: DashboardStorm[];
  routes: DashboardRoute[];
  visits: DashboardVisit[];
  mediaCountByVisit: Record<string, number>;
  pendingSkips: DashboardSkipRequest[];
  extraStormNames: Record<string, string>;
  extraLeadsByRoute: Record<string, string[]>;
  openShifts: OpenShift[] | null;
  mediaToReview: { count: number; oldest: string } | null;
}

async function load(companyId: string): Promise<{ ok: true; data: Loaded } | { ok: false; missing: boolean; message: string }> {
  const fail = (e: { code?: string; message?: string }) => ({ ok: false as const, missing: isMissingTable(e), message: e.message ?? 'Could not load snow data' });

  // `services` (update 40) lists every service of a multi-service storm. A database without that update has no such
  // column, so the same query is repeated without it and the storm shows its first service only.
  const loadStorms = async () => {
    const withServices = await supabase.from('snow_storms')
      .select('id, name, service, services, status, dispatched_at, reopened_count, created_at')
      .eq('company_id', companyId).neq('status', 'ended');
    if (!withServices.error) return withServices;
    if (!/services|column|schema cache/i.test(withServices.error.message ?? '')) return withServices;
    return supabase.from('snow_storms')
      .select('id, name, service, status, dispatched_at, reopened_count, created_at')
      .eq('company_id', companyId).neq('status', 'ended');
  };
  const [stormsRes, skipsRes, shiftsRes, reviewRes] = await Promise.all([
    loadStorms(),
    supabase.from('snow_skip_requests')
      .select('id, storm_id, route_id, visit_id, property_id, requested_by, reason, status, created_at')
      .eq('company_id', companyId).eq('status', 'pending'),
    supabase.from('snow_shifts')
      .select('id, person_id, clock_in_at')
      .eq('company_id', companyId).is('clock_out_at', null),
    supabase.from('snow_completion_media')
      .select('created_at', { count: 'exact' })
      .eq('company_id', companyId).eq('review_status', 'pending')
      .order('created_at', { ascending: true }).limit(1),
  ]);
  if (stormsRes.error) return fail(stormsRes.error);
  if (skipsRes.error) return fail(skipsRes.error);

  const storms = (stormsRes.data ?? []).map((r) => camelRow<DashboardStorm>(r));
  const pendingSkips = (skipsRes.data ?? []).map((r) => camelRow<DashboardSkipRequest>(r));
  // Shift records come from a later update (028); without it there's nothing to check, not "no problems".
  const openShifts = shiftsRes.error ? null : (shiftsRes.data ?? []).map((r) => camelRow<OpenShift>(r));
  // Same for photo review (update 030).
  const mediaToReview = reviewRes.error ? null : { count: reviewRes.count ?? 0, oldest: reviewRes.data?.[0]?.created_at ?? '' };

  // Load routes/visits for current storms plus any storm a pending skip belongs to.
  const stormIds = new Set(storms.map((s) => s.id));
  const otherStormIds = [...new Set(pendingSkips.map((s) => s.stormId))].filter((id) => !stormIds.has(id));
  const allIds = [...stormIds, ...otherStormIds];
  if (allIds.length === 0) {
    return { ok: true, data: { storms, routes: [], visits: [], mediaCountByVisit: {}, pendingSkips, extraStormNames: {}, extraLeadsByRoute: {}, openShifts, mediaToReview } };
  }

  const [routesRes, visitsRes, mediaRes, extraRes, leadsRes] = await Promise.all([
    supabase.from('snow_routes')
      .select('id, storm_id, service, name, position, lead_person_id, media_required, min_media, cancelled_at')
      .in('storm_id', allIds),
    // Each stop's own photo rule (updates 60, 112); a database without them loads the plain columns.
    (async () => {
      const own = await supabase.from('snow_visits')
        .select('id, storm_id, route_id, property_id, property_name, position, status, arrived_at, completed_at, photos_required, min_media')
        .in('storm_id', allIds).limit(10000);
      if (!own.error || !/photos_required|min_media/i.test(own.error.message ?? '')) return own;
      return supabase.from('snow_visits')
        .select('id, storm_id, route_id, property_id, property_name, position, status, arrived_at, completed_at')
        .in('storm_id', allIds).limit(10000);
    })(),
    stormIds.size
      ? supabase.from('snow_completion_media').select('visit_id').in('storm_id', [...stormIds]).limit(50000)
      : Promise.resolve({ data: [] as Row[], error: null }),
    otherStormIds.length
      ? supabase.from('snow_storms').select('id, name').in('id', otherStormIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    // More leads per route (update 110). A database without it just shows the main lead.
    supabase.from('snow_route_extra_leads').select('route_id, person_id').eq('company_id', companyId),
  ]);
  for (const res of [routesRes, visitsRes, mediaRes, extraRes]) if (res.error) return fail(res.error);

  const mediaCountByVisit: Record<string, number> = {};
  for (const m of mediaRes.data ?? []) mediaCountByVisit[m.visit_id] = (mediaCountByVisit[m.visit_id] ?? 0) + 1;
  const extraLeadsByRoute: Record<string, string[]> = {};
  if (!leadsRes.error) for (const l of leadsRes.data ?? []) (extraLeadsByRoute[l.route_id] ??= []).push(l.person_id);
  const extraStormNames: Record<string, string> = {};
  for (const s of extraRes.data ?? []) extraStormNames[s.id] = s.name;

  return {
    ok: true,
    data: {
      storms,
      // A stop or route returned twice must never be counted twice.
      routes: uniqueById((routesRes.data ?? []).map((r) => camelRow<DashboardRoute>(r))),
      visits: uniqueById((visitsRes.data ?? []).map((r) => camelRow<DashboardVisit>(r))),
      mediaCountByVisit,
      pendingSkips,
      extraStormNames,
      extraLeadsByRoute,
      openShifts,
      mediaToReview,
    },
  };
}

export function useSnowDashboard() {
  const v = useDb();
  const [state, setState] = useState<SnowDashboardState>({ kind: 'loading' });
  const [data, setData] = useState<Loaded | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date>(new Date());
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    if (isDemo()) {
      setState({ kind: 'unavailable', reason: 'Snow Mode reads the live database. It has no sample data in demo mode.' });
      return;
    }
    const companyId = getSession()?.companyId;
    if (!companyId || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await load(companyId);
      if (res.ok) {
        setData(res.data);
        setLoadedAt(new Date());
        setState({ kind: 'ready' });
      } else if (res.missing) {
        setState({ kind: 'unavailable', reason: 'Snow Mode isn’t set up on this database yet (Supabase update 020b).' });
      } else {
        // Keep the last good data on screen; the screen shows the error above it.
        setState({ kind: 'error', message: res.message });
      }
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load snow data' });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') reload(); });
    return () => sub.remove();
  }, [reload]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const dashboard = useMemo(() => {
    if (!data) return null;
    const nameOf = (id?: string) => {
      const p = id ? db.people[id] : undefined;
      return p ? `${p.firstName} ${p.lastName}`.trim() || p.email : undefined;
    };
    return buildSnowDashboard({ ...data, nameOf, now: loadedAt });
    // v: people names come from the store.
  }, [data, loadedAt, v]);

  return {
    state,
    storms: dashboard?.storms ?? [],
    needsAttention: dashboard?.needsAttention ?? [],
    /** False until snow_shifts (update 028) exists; the screen says time checks are off. */
    shiftsChecked: data ? data.openShifts !== null : false,
    /** Everyone clocked in right now (not a problem by itself). */
    clockedInCount: data?.openShifts?.length ?? 0,
    loadedAt,
    refreshing,
    onRefresh,
    reload,
  };
}
