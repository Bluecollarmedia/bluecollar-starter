/**
 * "Request a service" (the public Weather area's Request tab): the services people can ask for, and the checks a request must pass before it is
 * sent. Pure (no React, no network). The server (submit_service_request in setup.sql) repeats every check, so this only gives a person a quick,
 * friendly answer before anything is sent.
 */

import { brand, companyPhoneLink } from '@/config/brand';

/**
 * The services people can pick: the settings file's list (src/config/brand.js, wording.serviceTypes). The words are saved with the
 * request, and the database function submit_service_request accepts only these, so the list in setup.sql must match it exactly.
 */
export const SERVICE_CHOICES: readonly string[] = brand.wording.serviceTypes;
export type ServiceChoice = string;
export type PropertyType = 'residential' | 'commercial';

/** Where people can reach the company directly (settings file: company.phone and company.supportEmail). */
export const COMPANY_PHONE_DISPLAY = brand.company.phone.display;
export const COMPANY_PHONE_LINK = companyPhoneLink();
export const COMPANY_EMAIL = brand.company.supportEmail;

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
  if (r.services.some((s) => !SERVICE_CHOICES.includes(s))) return 'Choose from the services listed.';
  if (r.town.trim().length < 2) return 'Enter the town or ZIP code of the job site.';
  if (r.name.trim().length < 2) return 'Enter your name.';
  const digits = r.phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return 'Enter a phone number we can reach you at.';
  const email = r.email.trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'That email address does not look right.';
  if (r.details.length > DETAILS_MAX) return 'Please keep the description under 2000 characters.';
  return null;
}

/** Toggles one service in the picked list (keeps the list order). */
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
