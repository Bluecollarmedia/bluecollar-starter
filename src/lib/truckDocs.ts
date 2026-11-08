// Truck documents (insurance, registration, inspection, any PDF or photo) and the owner's private notes. Pure helpers, no network.

export type DocKind = 'insurance' | 'registration' | 'inspection' | 'other';

export const DOC_KINDS: { key: DocKind; label: string; icon: 'shield' | 'file-text' | 'check-square' | 'paperclip' }[] = [
  { key: 'insurance', label: 'Insurance', icon: 'shield' },
  { key: 'registration', label: 'Registration', icon: 'file-text' },
  { key: 'inspection', label: 'Inspection', icon: 'check-square' },
  { key: 'other', label: 'Other', icon: 'paperclip' },
];

export const kindLabel = (k: string) => DOC_KINDS.find((d) => d.key === k)?.label ?? 'Document';

/** PDFs and pictures (an insurance card photo, for example). */
export const ALLOWED_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** Guesses a file's type from its name when the phone didn't say. */
export function typeFromName(name: string | undefined): string | undefined {
  const ext = (name ?? '').toLowerCase().split('?')[0].split('.').pop();
  const map: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };
  return ext ? map[ext] : undefined;
}

export function isAllowedDocument(mime: string | undefined, name?: string): boolean {
  const type = (mime && mime !== 'application/octet-stream' ? mime : typeFromName(name)) ?? '';
  return ALLOWED_DOC_TYPES.includes(type.toLowerCase());
}

export const isPdf = (mime?: string, name?: string) => (mime ?? typeFromName(name)) === 'application/pdf';

/** A title to suggest from the kind and the file name: "Insurance" or the file's own name. */
export function suggestedTitle(kind: DocKind, fileName?: string): string {
  const base = (fileName ?? '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_]+/g, ' ').trim();
  return base ? base : kindLabel(kind);
}

export function formatSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export const SOON_DAYS = 30;

export interface Expiry { state: 'none' | 'ok' | 'soon' | 'expired'; days?: number; label: string }

/** How an insurance (or any) document's expiry date looks today: expired, expiring within 30 days, fine, or no date. */
export function expiryStatus(expiresOn: string | undefined | null, today: Date = new Date()): Expiry {
  const m = (expiresOn ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { state: 'none', label: '' };
  const end = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((end - start) / 86400000);
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (days < 0) return { state: 'expired', days, label: `Expired ${date}` };
  if (days <= SOON_DAYS) return { state: 'soon', days, label: days === 0 ? 'Expires today' : `Expires in ${days} ${days === 1 ? 'day' : 'days'}` };
  return { state: 'ok', days, label: `Expires ${date}` };
}

export const NOTE_MAX = 2000;
export const noteProblem = (text: string) => (!text.trim() ? 'Write a note first.' : text.trim().length > NOTE_MAX ? `Keep it under ${NOTE_MAX} characters.` : '');
