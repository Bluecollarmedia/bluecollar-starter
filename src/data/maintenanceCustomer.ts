/**
 * A customer's maintenance updates (supabase/updates/034): finished visits to
 * their property and only the photos the owner shared.
 */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export interface CustomerMaintenanceUpdate {
  stopId: string;
  /** Which maintenance property (update 116; empty on an older database). */
  propertyId?: string;
  propertyName: string;
  /** When the crew arrived (update 116; empty on an older database or when it was not recorded). */
  arrivedAt?: string;
  completedAt: string;
  services?: string;
  /** `task` is the name of the task the photo was taken for (update 116 and photos taken after update 111). */
  photos: { id: string; url: string; key?: string; task?: string }[];
}

export async function loadCustomerMaintenanceUpdates(): Promise<Result<CustomerMaintenanceUpdate[]>> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: "Maintenance updates need the live database, which isn't connected in this version of the app." };
  }
  // Update 116's history (adds the property, arrival time and task names); the older function answers when 116 has not been run.
  let { data, error } = await supabase.rpc('maintenance_customer_history');
  if (error && /could not find the function|schema cache|does not exist/i.test(error.message)) ({ data, error } = await supabase.rpc('maintenance_customer_updates'));
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: ((data ?? []) as Record<string, any>[]).map((r) => ({
      stopId: r.stop_id,
      propertyId: r.property_id ?? undefined,
      propertyName: r.property_name,
      arrivedAt: r.arrived_at ?? undefined,
      completedAt: r.completed_at,
      services: r.services ?? undefined,
      photos: ((r.photos ?? []) as { id: string; url: string; key?: string; task?: string | null }[]).map((p) => ({ ...p, task: p.task ?? undefined })),
    })),
  };
}

export interface NextVisit { propertyId: string; /** A calendar day, "2026-10-30". */ day: string; services?: string }

/** The next planned visit to each of their maintenance properties (update 116). Empty on an older database, so the screens just show nothing. */
export async function loadNextVisits(): Promise<NextVisit[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc('maintenance_customer_next_visits');
  if (error) return [];
  return ((data ?? []) as Record<string, any>[]).map((r) => ({ propertyId: r.property_id, day: String(r.service_date), services: r.services ?? undefined }));
}

export interface MyMaintenanceProperty { id: string; name: string; address: string }

/** The maintenance properties linked to this customer, even before the first visit. */
export async function loadMyMaintenanceProperties(): Promise<Result<MyMaintenanceProperty[]>> {
  if (!isSupabaseConfigured) return { ok: true, data: [] };
  const { data, error } = await supabase.rpc('maintenance_my_properties');
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: ((data ?? []) as Record<string, any>[]).map((r) => ({ id: r.id, name: r.name, address: r.address ?? '' })),
  };
}

/** Same list as a hook; asks again each time the screen comes into focus. */
export function useMyMaintenanceProperties(): MyMaintenanceProperty[] {
  const [list, setList] = useState<MyMaintenanceProperty[]>([]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadMyMaintenanceProperties().then((res) => { if (alive && res.ok) setList(res.data); });
      return () => { alive = false; };
    }, []),
  );
  return list;
}
