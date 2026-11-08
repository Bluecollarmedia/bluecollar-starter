import { useCallback } from 'react';
import { db, useDb, updateRow } from '@/data/store';
import type { AddressParts } from '@/lib/address';

export interface YardLocation extends AddressParts {
  latitude?: number;
  longitude?: number;
}

/** "Brighton Yard" for "Brighton Lawn + Landscape"; just "Yard" without a company name. */
export function yardLabel(companyName?: string): string {
  const first = companyName?.trim().split(/\s+/)[0];
  return first ? `${first} Yard` : 'Yard';
}

/**
 * The company's yard: where crews start and end the day. One setting per
 * company, saved on the companies row, so the owner's Yard Location screen and
 * the worker's Today screen read the same thing (and Realtime pushes changes).
 */
export function useCompanyYard() {
  useDb();
  const company = db.company;

  const yard: YardLocation | null = company?.yardAddress
    ? {
        address: company.yardAddress,
        city: company.yardCity ?? '',
        state: company.yardState ?? '',
        zip: company.yardZip ?? '',
        latitude: company.yardLatitude ?? undefined,
        longitude: company.yardLongitude ?? undefined,
      }
    : null;

  /** Saves a new yard address. Callers validate first; this never clears the yard. */
  const saveYard = useCallback((next: YardLocation) => {
    if (!db.company) return;
    updateRow('companies', db.company.id, {
      yardAddress: next.address.trim(),
      yardCity: next.city.trim(),
      yardState: next.state.trim().toUpperCase(),
      yardZip: next.zip.trim(),
      // null (not undefined) so an old map spot is cleared when the new address wasn't found.
      yardLatitude: next.latitude ?? null,
      yardLongitude: next.longitude ?? null,
    });
  }, []);

  return {
    yard,
    label: yardLabel(company?.name),
    saveYard,
  };
}
