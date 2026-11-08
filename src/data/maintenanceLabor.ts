import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { VisitRecord } from '@/lib/propertyTrend';

type Raw = Record<string, any>;

/**
 * Every visit to one maintenance property with its saved arrival / completion, elapsed time and ESTIMATED labor-hours
 * (maintenance_property_visits, update 68). Owner/admin only: the database refuses anyone else.
 * Returns null when the update is not installed yet (the screen then simply shows no labor numbers).
 */
export async function loadPropertyVisits(propertyId: string): Promise<VisitRecord[] | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('maintenance_property_visits', { p_property: propertyId });
  if (error || !Array.isArray(data)) return null;
  return (data as Raw[]).map((r): VisitRecord => ({
    stopId: r.stop_id, visitId: r.visit_id ?? null, serviceDate: r.service_date, status: r.status, leaderName: r.leader_name ?? null,
    arrivedAt: r.arrived_at ?? null, completedAt: r.completed_at ?? null,
    elapsedMinutes: r.elapsed_minutes == null ? null : Number(r.elapsed_minutes),
    estLaborMinutes: r.est_labor_minutes == null ? null : Number(r.est_labor_minutes),
    crew: ((r.crew ?? []) as Raw[]).map((c) => ({ personId: c.person_id, name: c.name ?? '', minutes: Number(c.minutes) })),
    tasksDone: r.tasks_done ?? 0, tasksTotal: r.tasks_total ?? 0, photos: r.photos ?? 0, savedVisit: !!r.saved_visit,
  }));
}

export interface RouteNeedingLeader { routeId: string; name?: string; serviceDate: string; status: string; crew: number }

/** Routes (today and later) that still have no crew leader: nobody but the owner can check in at their properties until one is chosen. */
export async function loadRoutesWithoutLeader(): Promise<RouteNeedingLeader[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc('maintenance_routes_without_leader');
  if (error || !Array.isArray(data)) return [];
  return (data as Raw[]).map((r) => ({ routeId: r.route_id, name: r.name ?? undefined, serviceDate: r.service_date, status: r.status, crew: Number(r.crew ?? 0) }));
}
