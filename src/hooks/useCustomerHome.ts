import { useMemo } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { db, useDb } from '@/data/store';
import { meaningfulUpdates } from '@/lib/customerOverview';
import { buildHomeItems } from '@/lib/customerHome';
import { groupProperties, pastWork, sortGroups } from '@/lib/customerProperty';

/**
 * Everything the customer's property-first Home needs: their projects grouped by street address (with the latest real update for each),
 * and the finished ones for "Past work".
 */
export function useCustomerHome() {
  const { user } = useAuth();

  useDb();
  const projects = db.projects.filter((p) => p.customerId === user?.id || p.customerClaimedBy === user?.id);

  const items = useMemo(
    () => buildHomeItems({
      projects,
      latestUpdateFor: (id) => {
        const e = meaningfulUpdates(db.customerTimeline[id] ?? [], 1)[0];
        return e ? { title: e.title, at: e.timestamp } : undefined;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects.map((p) => `${p.id}${p.status}${p.progress}${p.updatedAt}`).join('|')],
  );

  const groups = useMemo(() => sortGroups(groupProperties(items)), [items]);
  const past = useMemo(() => pastWork(items), [items]);

  return { groups, past, items };
}

export type CustomerHomeData = ReturnType<typeof useCustomerHome>;
