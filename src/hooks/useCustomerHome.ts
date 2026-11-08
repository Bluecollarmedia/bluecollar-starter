import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider';
import { db, useDb } from '@/data/store';
import { loadCustomerMaintenanceUpdates, loadNextVisits, useMyMaintenanceProperties, type CustomerMaintenanceUpdate, type NextVisit } from '@/data/maintenanceCustomer';
import { loadTimeline, peekTimeline } from '@/data/snowCustomer';
import { useMySnowProperties } from '@/hooks/useHasSnow';
import { useSnowHome } from '@/hooks/useSnowHome';
import { snowCardSubtitle } from '@/lib/customerPortal';
import { meaningfulUpdates } from '@/lib/customerOverview';
import { buildHomeItems } from '@/lib/customerHome';
import { groupProperties, pastWork, sortGroups } from '@/lib/customerProperty';
import type { TimelineEntry } from '@/lib/customerSnow';

/**
 * Everything the customer's property-first Home (and its History screen) needs: their properties grouped by street address, what a crew is
 * doing right now at each, the snow and lawn visit history with photos, and the next planned lawn visit. `null` for a list means "still
 * loading", an empty list means "really none". If the database has not got update 116 yet, arrival times, task names and the next visit are
 * simply missing and the screens leave those lines out.
 */
export function useCustomerHome() {
  const { user } = useAuth();
  const maintenance = useMyMaintenanceProperties();
  const snow = useMySnowProperties();
  const snowHome = useSnowHome();
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(() => peekTimeline());
  const [lawn, setLawn] = useState<CustomerMaintenanceUpdate[] | null>(null);
  const [nextVisits, setNextVisits] = useState<NextVisit[]>([]);

  useDb();
  const projects = db.projects.filter((p) => p.customerId === user?.id || p.customerClaimedBy === user?.id);

  useFocusEffect(useCallback(() => {
    let alive = true;
    void (async () => {
      const [tl, lw, nv] = await Promise.all([loadTimeline(), loadCustomerMaintenanceUpdates(), loadNextVisits()]);
      if (!alive) return;
      if (tl.ok) setTimeline(tl.data); else setTimeline((cur) => cur ?? []);
      setLawn(lw.ok ? lw.data : []);
      setNextVisits(nv);
    })();
    return () => { alive = false; };
  }, []));

  const items = useMemo(
    () => buildHomeItems({
      projects,
      maintenance,
      snow,
      snowNote: snowCardSubtitle,
      latestUpdateFor: (id) => {
        const e = meaningfulUpdates(db.customerTimeline[id] ?? [], 1)[0];
        return e ? { title: e.title, at: e.timestamp } : undefined;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects.map((p) => `${p.id}${p.status}${p.progress}${p.updatedAt}`).join('|'), maintenance, snow],
  );

  const groups = useMemo(() => sortGroups(groupProperties(items), snowHome.statuses), [items, snowHome.statuses]);
  const past = useMemo(() => pastWork(items), [items]);

  return { groups, past, items, statuses: snowHome.statuses, snowServices: snowHome.services, timeline, lawn, nextVisits };
}

export type CustomerHomeData = ReturnType<typeof useCustomerHome>;
