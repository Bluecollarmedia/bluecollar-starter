import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { loadServices, loadStatuses, loadTimeline } from '@/data/snowCustomer';
import type { SnowStatus, SnowSvc } from '@/lib/customerSnow';

/**
 * What the customer's Home needs about Snow: what is happening right now at each property (for the strip), the services each property
 * gets, and when each was last serviced. Read again every time Home comes to the front and every minute while it is open, so a storm
 * shows up without anyone refreshing. Everything is empty until it loads, and if anything fails Home just shows no Snow extras.
 */
export function useSnowHome(): { statuses: SnowStatus[]; services: Record<string, SnowSvc[]>; lastService: Record<string, string> } {
  const [statuses, setStatuses] = useState<SnowStatus[]>([]);
  const [services, setServices] = useState<Record<string, SnowSvc[]>>({});
  const [lastService, setLastService] = useState<Record<string, string>>({});

  useFocusEffect(useCallback(() => {
    let alive = true;
    const run = async () => {
      const [st, sv, tl] = await Promise.all([loadStatuses(), loadServices(), loadTimeline({ withUrls: false })]);
      if (!alive) return;
      setStatuses(st);
      setServices(sv);
      if (tl.ok) {
        const last: Record<string, string> = {};
        for (const e of tl.data) if (!last[e.propertyId] || e.completedAt > last[e.propertyId]) last[e.propertyId] = e.completedAt;
        setLastService(last);
      }
    };
    void run();
    const timer = setInterval(() => { void run(); }, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []));

  return { statuses, services, lastService };
}
