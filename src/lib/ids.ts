/**
 * Small id/date helpers shared by the data layer.
 */

/** RFC 4122 v4 UUID. Records are created client-side with their final id so
 * the UI can show them immediately while the save happens in the background. */
export function uuid(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 'YYYY-MM-DD' for a date in the device's local timezone (not UTC — after
 * 8pm in Ohio, toISOString() already reports tomorrow). */
export function localDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Today's local date, 'YYYY-MM-DD'. */
export function todayKey(): string {
  return localDateKey(new Date());
}

/** Local date key `days` away from today. */
export function offsetDateKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

/** Local 'YYYY-MM-DD' of an ISO timestamp. */
export function isoToLocalDateKey(iso: string): string {
  return localDateKey(new Date(iso));
}

/** Builds a local Date from a 'YYYY-MM-DD' key plus an 'HH:MM' wall-clock time. */
export function localDateTime(dateKey: string, time: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}
