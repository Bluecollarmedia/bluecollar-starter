// The owner's private notes turned into a vendor-ready materials list. Pure helpers, no network.
// The AI (supabase/functions/organize-materials) sorts the notes into items; whatever it returns is cleaned and capped here
// before it is ever shown, saved or printed, so a strange answer can never put anything odd on a vendor sheet.

export interface MaterialItem {
  category: string;
  item: string;
  /** A number when the notes gave one, else null (never guessed). */
  quantity: number | null;
  unit: string;
  notes: string;
}

export interface MaterialList {
  title: string;
  items: MaterialItem[];
  /** Things in the notes that aren't materials (measurements, access, reminders), kept so nothing is lost. */
  otherNotes: string[];
}

const MAX_ITEMS = 150;
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** Cleans whatever came back into a safe list. Unknown shapes become an empty list rather than an error. */
export function normalizeMaterialList(raw: unknown, fallbackTitle = 'Materials list'): MaterialList {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { title?: unknown; items?: unknown; other_notes?: unknown; otherNotes?: unknown };
  const items: MaterialItem[] = [];
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    const item = clip(o.item, 160);
    if (!item) continue;
    const q = typeof o.quantity === 'number' ? o.quantity : typeof o.quantity === 'string' && o.quantity.trim() !== '' ? Number(o.quantity) : NaN;
    items.push({
      category: clip(o.category, 60) || 'Other',
      item,
      quantity: Number.isFinite(q) && q >= 0 ? Math.round(q * 100) / 100 : null,
      unit: clip(o.unit, 30),
      notes: clip(o.notes, 300),
    });
    if (items.length >= MAX_ITEMS) break;
  }
  const other = (Array.isArray(r.other_notes) ? r.other_notes : Array.isArray(r.otherNotes) ? r.otherNotes : []).map((x) => clip(x, 300)).filter(Boolean).slice(0, 40);
  return { title: clip(r.title, 80) || fallbackTitle, items, otherNotes: other };
}

/** Items grouped by category in the order the categories first appear. */
export function groupByCategory(items: MaterialItem[]): { category: string; items: MaterialItem[] }[] {
  const out: { category: string; items: MaterialItem[] }[] = [];
  for (const it of items) {
    let g = out.find((x) => x.category === it.category);
    if (!g) { g = { category: it.category, items: [] }; out.push(g); }
    g.items.push(it);
  }
  return out;
}

/** The list as saved: other notes ride along as items in an "Other notes" category, so nothing is lost and nothing needs a new column. */
export function listToStored(list: MaterialList): MaterialItem[] {
  return [
    ...list.items,
    ...list.otherNotes.map((n) => ({ category: 'Other notes', item: n, quantity: null, unit: '', notes: '' })),
  ];
}

/** A saved row back into a list to show or print. */
export function storedToList(row: { title: string; items: unknown }): MaterialList {
  return normalizeMaterialList({ title: row.title, items: row.items }, row.title);
}

export const quantityText = (it: MaterialItem) => (it.quantity == null ? '' : `${it.quantity}${it.unit ? ` ${it.unit}` : ''}`);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The notes joined into one block of text for the AI: oldest first, each with its date. */
export function notesAsText(notes: { body: string; createdAt: string }[]): string {
  return notes
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((n) => `[${new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}] ${n.body.trim()}`)
    .join('\n\n');
}

export const MAX_SOURCE_CHARS = 12000;

/** A printable page to hand to a vendor: grouped items with quantities and notes. No customer details, no prices. */
export function materialListHtml(o: { list: MaterialList; projectName: string; address?: string; company: string; dateText: string }): string {
  const groups = groupByCategory(o.list.items);
  const rows = groups.map((g) => `
    <h3>${esc(g.category)}</h3>
    <table>${g.items.map((i) => `<tr><td class="box">&#9744;</td><td class="item">${esc(i.item)}${i.notes ? `<div class="note">${esc(i.notes)}</div>` : ''}</td><td class="qty">${esc(quantityText(i))}</td></tr>`).join('')}</table>`).join('');
  const other = o.list.otherNotes.length
    ? `<h3>Other notes</h3><ul>${o.list.otherNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1B1B1B;margin:28px;font-size:14px;line-height:1.45}
  h1{font-size:22px;margin:0 0 2px} .sub{color:#555;margin:0 0 18px}
  h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#2D5A43;margin:18px 0 4px;border-bottom:1px solid #ccd5cf;padding-bottom:3px}
  table{width:100%;border-collapse:collapse} td{padding:6px 4px;border-bottom:1px solid #eee;vertical-align:top}
  .box{width:22px;font-size:16px} .qty{width:34%;text-align:right;font-weight:600} .note{color:#666;font-size:12px;margin-top:2px}
  ul{margin:6px 0 0 18px;padding:0} .foot{margin-top:26px;color:#777;font-size:11px}
</style></head><body>
<h1>${esc(o.list.title)}</h1>
<p class="sub">${esc(o.projectName)}${o.address ? ` &middot; ${esc(o.address)}` : ''} &middot; ${esc(o.dateText)}</p>
${rows || '<p>No materials listed.</p>'}${other}
<p class="foot">Prepared by ${esc(o.company)}</p>
</body></html>`;
}
