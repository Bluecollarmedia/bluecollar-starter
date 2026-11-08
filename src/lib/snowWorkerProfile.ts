/**
 * What a Snow worker sees about themselves on the Settings screen. Pure helpers.
 * The services and the role come from the owner (the worker cannot change them);
 * the name, phone and photo are the worker's own to edit.
 */

export interface ProfileUser {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  role?: string;
}

/** "Jane Smith", or their email, or "Your name" when nothing is set. */
export function displayName(u: ProfileUser | null | undefined): string {
  const full = `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim();
  return full || u?.email || 'Your name';
}

/** (555) 555-0100 for a 10-digit US number; anything else is shown as typed. */
export function formatPhone(raw?: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw.trim();
}

/** How the person's role is shown. Owners and admins already have every snow service. */
export function roleLabel(role?: string, services: string[] = []): string {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  if (services.length) return 'Snow team';
  return 'Snow team (no services yet)';
}

/** A short note under the profile photo: what is missing, or nothing when the basics are there. */
export function profileNudge(u: ProfileUser | null | undefined): string | null {
  if (!u?.avatarUrl && !(u?.phone ?? '').trim()) return 'Add a photo and your phone number so the office can recognize and reach you.';
  if (!u?.avatarUrl) return 'Add a profile photo so the office can recognize you.';
  if (!(u?.phone ?? '').trim()) return 'Add your phone number so the office can reach you.';
  return null;
}
