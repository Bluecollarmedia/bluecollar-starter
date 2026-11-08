/**
 * One place for every property (supabase/updates/075 and 079). A property is entered once, for one customer; landscaping projects,
 * Maintenance properties and Snow properties are that same property (linked by property_id) with their own settings.
 *
 * Every form that asks for an address goes through `propertyForSave`: it picks the customer's existing property, or makes it once.
 * Before update 79 is installed the function does not exist; then the form just saves as it always did, so nothing breaks.
 */
import { useMemo } from 'react';
import { db, insertRow, rowsOf, rpc, refresh, updateRow, useDb, isDemo } from '@/data/store';
import type { Property } from '@/types/property';

export interface PropertyFields {
  name?: string;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
}

const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameAddress = (a: PropertyFields, b: PropertyFields) => norm(a.address) === norm(b.address) && norm(a.zip) === norm(b.zip);

/** Every property of one customer, newest last. */
export function propertiesOf(customerId?: string): Property[] {
  if (!customerId) return [];
  return (rowsOf('properties') as unknown as Property[])
    .filter((p) => p.customerId === customerId && p.isActive !== false)
    .slice()
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

export function useCustomerProperties(customerId?: string): Property[] {
  const v = useDb();
  return useMemo(() => propertiesOf(customerId), [customerId, v]);
}

/** Every property in the company. */
export function useAllProperties(): Property[] {
  const v = useDb();
  return useMemo(() => (rowsOf('properties') as unknown as Property[]).filter((p) => p.isActive !== false), [v]);
}

const MISSING = /does not exist|schema cache|could not find the function|not found in the schema/i;

export type EnsureResult = { ok: true; propertyId: string; created: boolean } | { ok: false; error: string; missing: boolean };

/** The customer's property at this address: reuses it when it is already there (even typed differently), makes it when it is not. */
export async function ensureProperty(customerId: string, f: PropertyFields): Promise<EnsureResult> {
  if (isDemo()) {
    const existing = propertiesOf(customerId).find((p) => sameAddress(p, f));
    if (existing) return { ok: true, propertyId: existing.id, created: false };
    const row = insertRow('properties', {
      customerId, name: f.name?.trim() || undefined, address: f.address.trim(), city: f.city?.trim() || undefined,
      state: f.state?.trim() || undefined, zip: f.zip?.trim() || undefined, latitude: f.latitude, longitude: f.longitude, isActive: true,
    });
    return { ok: true, propertyId: row.id, created: true };
  }
  const { data, error } = await rpc<{ property_id: string; created: boolean }>('ensure_property', {
    p_customer: customerId, p_name: f.name ?? null, p_address: f.address, p_city: f.city ?? null, p_state: f.state ?? null,
    p_zip: f.zip ?? null, p_lat: f.latitude ?? null, p_lng: f.longitude ?? null,
  });
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the property.', missing: MISSING.test(error?.message ?? '') };
  await refresh('properties');
  return { ok: true, propertyId: data.property_id, created: data.created };
}

/**
 * What a form calls when it saves: the property id to store on its record (or nothing when there is no customer / address, or the
 * database update is not installed yet). When the form is editing a record that already has a property and the address changed,
 * the property itself is updated, and the database carries the change to every place it is used.
 */
export async function propertyForSave(input: {
  customerId?: string;
  propertyId?: string;
  fields: PropertyFields;
}): Promise<{ propertyId?: string; error?: string }> {
  const { customerId, propertyId, fields } = input;
  if (propertyId) {
    const stored = (rowsOf('properties') as unknown as Property[]).find((p) => p.id === propertyId);
    if (stored && !sameAddress(stored, fields) && fields.address.trim()) {
      updateRow('properties', propertyId, {
        address: fields.address.trim(), city: fields.city?.trim() || null, state: fields.state?.trim() || null, zip: fields.zip?.trim() || null,
        latitude: fields.latitude ?? null, longitude: fields.longitude ?? null,
      });
    }
    return { propertyId };
  }
  if (!customerId || !fields.address.trim()) return {};
  const res = await ensureProperty(customerId, fields);
  if (res.ok) return { propertyId: res.propertyId };
  return res.missing ? {} : { error: res.error };
}

/** Turns Snow on for a property: its Snow record is made (or found) and the customer is linked as its contact. */
export async function enableSnowForProperty(propertyId: string): Promise<{ ok: true; snowPropertyId: string } | { ok: false; error: string }> {
  if (isDemo()) return { ok: false, error: 'Snow needs the live database.' };
  const { data, error } = await rpc<{ snow_property_id: string }>('snow_enable_for_property', { p_property: propertyId });
  if (error || !data) return { ok: false, error: MISSING.test(error?.message ?? '') ? 'This needs the latest database update (79).' : error?.message ?? 'Could not turn Snow on.' };
  return { ok: true, snowPropertyId: data.snow_property_id };
}

/** Customer name for a property, from the customer list. */
export function customerNameOf(personId?: string): string {
  if (!personId) return '';
  const p = db.people[personId];
  return p ? `${p.firstName} ${p.lastName}`.trim() : '';
}

