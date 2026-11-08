// What the customer's project Overview shows: a few meaningful updates and a one-line billing summary. Pure, no network.

interface TimelineLike { id: string; eventType: string; title: string; timestamp: string }

/** Event kinds that are real news for a customer (shared updates and photos). Never "started", "progress" or replies. */
const MEANINGFUL = new Set(['update_shared', 'photo_shared']);
/** Titles that say nothing, even when they arrive as an update. */
const GENERIC = /^(project (started|updated|created)|worker arrived|task created|started the day|arrived|progress updated)\b/i;

export function meaningfulUpdates<T extends TimelineLike>(events: T[], max = 3): T[] {
  return events
    .filter((e) => MEANINGFUL.has(e.eventType) && e.title.trim() && !GENERIC.test(e.title.trim()))
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, max);
}

/** The screens pass in their translator (t from useT) so these short sentences can be shown in Spanish; this file stays free of app imports. Without one, English comes back as written. */
type Translate = (text: string, vars?: Record<string, string | number>) => string;
const plain: Translate = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text);

/** The Billing card's small status: what needs the customer first, else how many invoices are out. Null when nothing to say. */
export function billingStatus(counts: { waiting: number; issuedInvoices: number }, tx: Translate = plain): { label: string } | null {
  if (counts.waiting > 0) return { label: counts.waiting === 1 ? tx('1 needs review') : tx('{count} need review', { count: counts.waiting }) };
  if (counts.issuedInvoices > 0) return { label: tx('{count} issued', { count: counts.issuedInvoices }) };
  return null;
}

export const documentCountLabel = (n: number, tx: Translate = plain) => (n === 1 ? tx('1 document') : tx('{count} documents', { count: n }));
