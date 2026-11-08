/** Shared snow date formats, so every screen writes times the same way. */

/** "Oct 19, 9:43 AM" from a stored timestamp, in the phone's own time zone. Empty for a missing or bad date. */
export function shortWhen(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
