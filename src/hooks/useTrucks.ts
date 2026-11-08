import { useMemo, useCallback } from 'react';
import type { Truck, TruckStatus } from '@/types/truck';
import { db, useDb, insertRow, updateRow } from '@/data/store';

interface UseTrucksOptions {
  statusFilter?: TruckStatus | 'all';
}

export function useTrucks(options: UseTrucksOptions = {}) {
  const { statusFilter = 'all' } = options;
  const v = useDb();
  const trucks = useMemo(() => db.trucks, [v]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return trucks;
    return trucks.filter((t) => t.status === statusFilter);
  }, [trucks, statusFilter]);

  const counts = useMemo(() => {
    const c = { all: trucks.length, available: 0, assigned: 0, maintenance: 0, out_of_service: 0 };
    for (const t of trucks) {
      c[t.status]++;
    }
    return c;
  }, [trucks]);

  const addTruck = useCallback((truck: Omit<Truck, 'id' | 'createdAt' | 'updatedAt'>) => {
    const { assigneeName, ...values } = truck;
    return insertRow('trucks', values) as unknown as Truck;
  }, []);

  const updateTruck = useCallback((id: string, updates: Partial<Truck>) => {
    const { assigneeName, ...changes } = updates;
    updateRow('trucks', id, changes);
  }, []);

  return { trucks: filtered, allTrucks: trucks, counts, addTruck, updateTruck };
}
