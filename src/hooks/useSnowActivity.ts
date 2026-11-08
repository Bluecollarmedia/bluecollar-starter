import { rangeStart, trimToRange, type DateRange } from '@/lib/snowActivityView';
import { useCallback, useEffect, useRef, useState } from 'react';
import { db, rpc, isDemo } from '@/data/store';
import type { SnowActivityAction, SnowActivityEvent, SnowService } from '@/types/snow';

/**
 * The Owner's Snow Mode activity log (supabase/updates/029). Events are
 * written by the database whenever a snow record changes; this only reads
 * them, newest first, through snow_activity_feed (owner/admin only).
 */

/** A log entry (update 20b's shape) with the names the feed adds. */
export interface SnowActivityEntry extends SnowActivityEvent {
  actorName?: string;
  /** Name of the worker the event is about. */
  personName?: string;
}

export interface SnowActivityFilters {
  stormId?: string;
  routeId?: string;
  /** Events about this worker or done by them. */
  personId?: string;
  propertyId?: string;
  /** A whole action ('visit.completed') or its first word ('visit'). */
  action?: string;
  /** Only entries from this period (the feed is read newest first until the period's start). */
  range?: DateRange;
  /** Show the archived entries (moved to history, update 51) instead of the live ones. */
  archived?: boolean;
}

export type SnowFilterKind = 'storm' | 'route' | 'property' | 'worker' | 'action';

export interface SnowFilterOption {
  kind: SnowFilterKind;
  /** Record id for storm/route/property/worker; the action for 'action'. */
  value: string;
  /** Best name the log knows; empty when the record never had one logged. */
  label: string;
  count: number;
  lastAt: string;
}

interface EventRow {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  storm_id: string | null;
  route_id: string | null;
  visit_id: string | null;
  property_id: string | null;
  person_id: string | null;
  person_name: string | null;
  service: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
}

interface OptionRow {
  kind: SnowFilterKind;
  id: string | null;
  action: string | null;
  label: string | null;
  event_count: number;
  last_at: string;
}

const PAGE = 50;

function fromRow(r: EventRow): SnowActivityEntry {
  return {
    id: r.id,
    companyId: db.companyId,
    occurredAt: r.occurred_at,
    actorId: r.actor_id ?? undefined,
    actorName: r.actor_name ?? undefined,
    action: r.action as SnowActivityAction,
    entityType: r.entity_type,
    entityId: r.entity_id ?? undefined,
    stormId: r.storm_id ?? undefined,
    routeId: r.route_id ?? undefined,
    visitId: r.visit_id ?? undefined,
    propertyId: r.property_id ?? undefined,
    personId: r.person_id ?? undefined,
    personName: r.person_name ?? undefined,
    service: (r.service ?? undefined) as SnowService | undefined,
    before: r.before ?? undefined,
    after: r.after ?? undefined,
    note: r.note ?? undefined,
  };
}

function feedArgs(f: SnowActivityFilters, before?: SnowActivityEntry) {
  return {
    p_company_id: db.companyId,
    p_storm_id: f.stormId ?? null,
    p_route_id: f.routeId ?? null,
    p_person_id: f.personId ?? null,
    p_property_id: f.propertyId ?? null,
    p_action: f.action ?? null,
    p_before_at: before?.occurredAt ?? null,
    p_before_id: before?.id ?? null,
    p_limit: PAGE,
    // Only sent when asked for, so a database without update 51 keeps working for the normal view.
    ...(f.archived ? { p_archived: true } : {}),
  };
}

export function useSnowActivity(filters: SnowActivityFilters) {
  const [events, setEvents] = useState<SnowActivityEntry[]>([]);
  const [options, setOptions] = useState<SnowFilterOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  // Ignore answers to an older filter choice that arrive late.
  const requestId = useRef(0);
  const key = JSON.stringify(filters);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (isDemo()) {
      // There is no snow data in demo mode; show the honest empty state.
      setEvents([]);
      setOptions([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [feed, opts] = await Promise.all([
      rpc<EventRow[]>('snow_activity_feed', feedArgs(filters)),
      rpc<OptionRow[]>('snow_activity_filter_options', { p_company_id: db.companyId }),
    ]);
    if (id !== requestId.current) return;
    if (feed.error) {
      setError(feed.error.message);
    } else {
      setError('');
      const all = (feed.data ?? []).map(fromRow);
      const t = trimToRange(all, rangeStart(filters.range));
      setEvents(t.rows);
      setHasMore(all.length === PAGE && !t.reachedStart);
    }
    if (!opts.error) {
      setOptions((opts.data ?? []).map((o) => ({
        kind: o.kind,
        value: (o.kind === 'action' ? o.action : o.id) ?? '',
        label: o.label ?? '',
        count: Number(o.event_count) || 0,
        lastAt: o.last_at,
      })));
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || events.length === 0 || isDemo()) return;
    const id = requestId.current;
    setLoadingMore(true);
    const { data, error: rpcError } = await rpc<EventRow[]>('snow_activity_feed', feedArgs(filters, events[events.length - 1]));
    if (id !== requestId.current) return;
    setLoadingMore(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const all = (data ?? []).map(fromRow);
    const t = trimToRange(all, rangeStart(filters.range));
    setEvents((prev) => [...prev, ...t.rows.filter((r) => !prev.some((p) => p.id === r.id))]);
    setHasMore(all.length === PAGE && !t.reachedStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, events, hasMore, loadingMore]);

  useEffect(() => {
    load();
  }, [load]);

  return { events, options, loading, loadingMore, hasMore, error, reload: load, loadMore };
}
