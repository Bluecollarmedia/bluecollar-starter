/**
 * "Request a service" (the public Weather area's Request tab): the services people can ask for, and the checks a request must pass before it is
 * sent. Pure (no React, no network). The server (update 114, submit_service_request) repeats every check, so this only gives a person a quick,
 * friendly answer before anything is sent.
 */

/** The same eight choices as the "Request a Quote" form on brightonlawn.com. The words are saved with the request, and update 114 accepts only these. */
export const SERVICE_CHOICES = [
  'Backyard Design & Build',
  'Pavers, Patios & Walkways',
  'Turf & Sod Installation',
  'Lighting & Planting',
  'Commercial Maintenance',
  'Seasonal Cleanup',
  'Snow & Storm Response',
  'Other / Multiple',
] as const;
export type ServiceChoice = (typeof SERVICE_CHOICES)[number];
export type PropertyType = 'residential' | 'commercial';

/** Where people can reach Brighton directly (the same details as the website). */
export const BRIGHTON_PHONE_DISPLAY = '(848) 226-0090';
export const BRIGHTON_PHONE_LINK = 'tel:8482260090';
export const BRIGHTON_EMAIL = 'info@BrightonLawn.com';

export interface ServiceRequestInput {
  propertyType: PropertyType;
  services: string[];
  details: string;
  town: string;
  name: string;
  phone: string;
  email: string;
}

export const DETAILS_MAX = 2000;

/** The first thing wrong with a request, in plain words, or null when it can be sent. Mirrors the server's checks. */
export function requestProblem(r: ServiceRequestInput): string | null {
  if (r.services.length < 1) return 'Choose at least one service.';
  if (r.services.some((s) => !(SERVICE_CHOICES as readonly string[]).includes(s))) return 'Choose from the services listed.';
  if (r.town.trim().length < 2) return 'Enter the town or ZIP code of the property.';
  if (r.name.trim().length < 2) return 'Enter your name.';
  const digits = r.phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return 'Enter a phone number we can reach you at.';
  const email = r.email.trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'That email address does not look right.';
  if (r.details.length > DETAILS_MAX) return 'Please keep the description under 2000 characters.';
  return null;
}

/** Toggles one service in the picked list (keeps the website's order). */
export function toggleService(picked: string[], service: string): string[] {
  const next = picked.includes(service) ? picked.filter((s) => s !== service) : [...picked, service];
  return SERVICE_CHOICES.filter((s) => next.includes(s));
}

export type RequestStatus = 'new' | 'contacted' | 'done';
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = { new: 'New', contacted: 'Contacted', done: 'Done' };

export interface ServiceRequestRow {
  id: string;
  property_type: PropertyType;
  services: string[];
  details: string;
  town: string;
  name: string;
  phone: string;
  email: string;
  status: RequestStatus;
  created_at: string;
}

/** New ones first, then by date (newest first). */
export function sortRequests(rows: ServiceRequestRow[]): ServiceRequestRow[] {
  const rank = (s: RequestStatus) => (s === 'new' ? 0 : s === 'contacted' ? 1 : 2);
  return [...rows].sort((a, b) => rank(a.status) - rank(b.status) || Date.parse(b.created_at) - Date.parse(a.created_at));
}

export const newRequestCount = (rows: ServiceRequestRow[]): number => rows.filter((r) => r.status === 'new').length;
