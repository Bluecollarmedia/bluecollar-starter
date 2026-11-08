/**
 * Brighton-branded HTML for quotes, change orders and invoices.
 *
 * One template serves both the in-app preview and the PDF, so they always
 * match. It's built only from the saved document (line items, totals and the
 * frozen snapshot), so the same document always prints the same way.
 *
 * Multi-page: the table header repeats on every page, rows and the totals
 * block never split across pages, and page numbers are stamped onto the
 * finished PDF (see lib/pdf.ts) since print engines don't support CSS page
 * counters.
 */

import { BRAND_LOGO_DATA_URI } from './brandLogo';
import { isValidSignaturePath } from '@/lib/signature';
import { formatMoney, formatQuantity, formatPercent, sumMoney } from './money';
import { brand } from '@/theme/colors';
import type { FinancialDoc, DocumentSnapshot, FinancialEvent, LineItem, LineItemCategory } from '@/types/financial';

/** Line item groups, in the order documents print them. */
export const CATEGORY_ORDER: LineItemCategory[] = ['labor', 'materials', 'equipment', 'misc'];
export const CATEGORY_LABEL: Record<LineItemCategory, string> = {
  labor: 'Labor',
  materials: 'Materials',
  equipment: 'Equipment',
  misc: 'Miscellaneous',
};

interface LineGroup { title: string; items: LineItem[] }

/** How the line items are grouped on the page, or null for one plain list:
 *  • invoices that bill change orders: original quote work, then each change
 *    order, then anything added on the invoice;
 *  • otherwise, when items have a group (Labor, Materials…): by group, with
 *    ungrouped items last under "Other". */
export function lineGroups(doc: FinancialDoc): LineGroup[] | null {
  const items = doc.lineItems;
  if (doc.kind === 'invoice' && items.some((li) => li.source?.type === 'change_order')) {
    const groups: LineGroup[] = [];
    const add = (title: string, list: LineItem[]) => list.length && groups.push({ title, items: list });
    add(`Original quote${items.find((li) => li.source?.type === 'quote')?.source?.number ? ` ${items.find((li) => li.source?.type === 'quote')!.source!.number}` : ''}`,
      items.filter((li) => li.source?.type === 'quote'));
    const coNumbers = [...new Set(items.filter((li) => li.source?.type === 'change_order').map((li) => li.source!.number))];
    for (const n of coNumbers) add(`Change order ${n}`, items.filter((li) => li.source?.type === 'change_order' && li.source.number === n));
    add('Additional items', items.filter((li) => !li.source));
    return groups;
  }
  if (!items.some((li) => li.category)) return null;
  const groups: LineGroup[] = [];
  for (const c of CATEGORY_ORDER) {
    const list = items.filter((li) => li.category === c);
    if (list.length) groups.push({ title: CATEGORY_LABEL[c], items: list });
  }
  const other = items.filter((li) => !li.category);
  if (other.length) groups.push({ title: 'Other', items: other });
  return groups;
}

export interface DocumentHtmlOptions {
  /** 'pdf' lays out for Letter pages; 'preview' is one continuous page for the screen. */
  mode: 'pdf' | 'preview';
  /** Set when the print engine applies its own page margins (iOS). */
  nativeMargins?: boolean;
  /** For change orders: the quote they amend. */
  linkedQuoteNumber?: string;
  /** For invoices: numbers of the quote / change orders it bills. */
  sourceNumbers?: string[];
  events?: FinancialEvent[];
  /** Approval link printed on a sent quote / change order. */
  approvalUrl?: string;
  /** Hide the "how to approve" note (e.g. on the approval page itself). */
  hideApprovalHint?: boolean;
}

const INK = '#1F2A24';
const MUTED = '#5F6B64';
const FAINT = '#8A948E';
const RULE = '#E4E1DA';
const WARM = '#F7F6F2';
const ACCENT = brand.accent; // deep forest green from the wordmark
const GREEN = brand.primary; // the app's green token, used sparingly

export function escapeHtml(text: string | undefined | null): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → 'Aug 12, 2026' (no timezone shift). */
export function formatDocDate(key?: string): string {
  if (!key) return '';
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return key;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** ISO timestamp → 'Aug 12, 2026 at 2:45 PM' in local time. */
export function formatDocDateTime(iso?: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  let h = dt.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()} at ${h}:${String(dt.getMinutes()).padStart(2, '0')} ${ampm}`;
}

function cityLine(p: { city?: string; state?: string; zip?: string }): string {
  const cs = [p.city, p.state].filter(Boolean).join(', ');
  return [cs, p.zip].filter(Boolean).join(' ');
}

function lines(...parts: (string | undefined)[]): string {
  return parts.filter((p) => p && p.trim()).map((p) => `<div>${escapeHtml(p)}</div>`).join('');
}

const TITLE: Record<FinancialDoc['kind'], string> = {
  quote: 'Quote',
  change_order: 'Change Order',
  invoice: 'Invoice',
};

function metaRows(doc: FinancialDoc, opts: DocumentHtmlOptions): [string, string][] {
  const rows: [string, string][] = [];
  if (doc.kind === 'quote') {
    rows.push(['Quote #', doc.number], ['Date', formatDocDate(doc.issueDate)]);
    if (doc.validUntil) rows.push(['Valid until', formatDocDate(doc.validUntil)]);
  } else if (doc.kind === 'change_order') {
    rows.push(['Change order #', doc.number], ['Date', formatDocDate(doc.issueDate)]);
    if (opts.linkedQuoteNumber) rows.push(['Original quote', opts.linkedQuoteNumber]);
  } else {
    rows.push(['Invoice #', doc.number], ['Invoice date', formatDocDate(doc.invoiceDate)]);
    if (doc.dueDate) rows.push(['Due date', formatDocDate(doc.dueDate)]);
  }
  return rows;
}

function statusStamp(doc: FinancialDoc): string {
  if (doc.status === 'draft') return 'Draft';
  if (doc.kind === 'invoice' && doc.status === 'void') return 'Void';
  if (doc.status === 'declined') return 'Declined';
  return '';
}

function section(title: string, body?: string): string {
  if (!body || !body.trim()) return '';
  return `<div class="block"><div class="label">${escapeHtml(title)}</div><div class="prose">${escapeHtml(body.trim())}</div></div>`;
}

function approvalBlock(doc: FinancialDoc, s: DocumentSnapshot, opts: DocumentHtmlOptions): string {
  if (doc.kind === 'invoice') return '';
  const who = (id?: string) => {
    const e = opts.events?.find((ev) => ev.actorId === id && ev.actor);
    return e?.actor ? `${e.actor.firstName} ${e.actor.lastName}`.trim() : undefined;
  };
  if (doc.status === 'approved' && doc.approvedAt) {
    const by = doc.approvedName || who(doc.approvedBy);
    // The drawn signature is only ever plain path text (the database refuses anything else), re-checked here before it is drawn.
    const sig = isValidSignaturePath(doc.approvedSignature)
      ? `<div style="margin-top:8px"><svg viewBox="0 0 300 120" width="180" height="72" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Signature"><path d="${doc.approvedSignature}" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`
      : '';
    return `<div class="block approval"><div class="label">Approval</div><div class="prose">Approved${by ? ` by ${escapeHtml(by)}` : ''} on ${escapeHtml(formatDocDateTime(doc.approvedAt))}.</div>${sig}</div>`;
  }
  if (doc.status === 'sent' && !opts.hideApprovalHint) {
    const contact = s.company.phone ? ` or call us at ${escapeHtml(s.company.phone)}` : '';
    const where = opts.approvalUrl
      ? `visit <a href="${escapeHtml(opts.approvalUrl)}">${escapeHtml(opts.approvalUrl.replace(/^https?:\/\//, ''))}</a>`
      : `open this ${doc.kind === 'quote' ? 'quote' : 'change order'} in the Brighton app`;
    return `<div class="block approval"><div class="label">Approval</div><div class="prose">To approve, ${where}${contact}.</div></div>`;
  }
  return '';
}

export function renderDocumentHtml(doc: FinancialDoc, s: DocumentSnapshot, opts: DocumentHtmlOptions): string {
  const pdf = opts.mode === 'pdf';
  const title = TITLE[doc.kind];
  const stamp = statusStamp(doc);
  const companyCity = cityLine(s.company);
  const propCity = cityLine(s.property);

  const row = (li: LineItem) => {
    const qty = `${formatQuantity(li.quantity)}${li.unit ? ` <span class="unit">${escapeHtml(li.unit)}</span>` : ''}`;
    return `<tr>
      <td class="desc"><div class="item">${escapeHtml(li.description)}</div>${li.details ? `<div class="details">${escapeHtml(li.details)}</div>` : ''}<div class="calc">${qty} × ${formatMoney(li.unitPrice)}</div></td>
      <td class="num c-hide">${qty}</td>
      <td class="num c-hide">${formatMoney(li.unitPrice)}</td>
      <td class="num amt">${formatMoney(li.amount)}</td>
    </tr>`;
  };
  const groups = lineGroups(doc);
  const rows = groups
    ? groups.map((g) => `<tr class="group"><td colspan="4">${escapeHtml(g.title)}</td></tr>${g.items.map(row).join('')}
      <tr class="gsub"><td class="desc">${escapeHtml(g.title)} subtotal</td><td class="c-hide"></td><td class="c-hide"></td><td class="num">${formatMoney(sumMoney(g.items.map((li) => li.amount)))}</td></tr>`).join('')
    : doc.lineItems.map(row).join('');

  const totalLabel = doc.kind === 'invoice' ? 'Total due' : 'Total';
  const taxRow = doc.taxRate > 0 || doc.taxAmount > 0
    ? `<tr><td>Tax (${formatPercent(doc.taxRate)})</td><td class="num">${formatMoney(doc.taxAmount)}</td></tr>` : '';

  const intro = doc.kind === 'change_order' && doc.description
    ? `<div class="block"><div class="label">Description of change</div><div class="prose">${escapeHtml(doc.description)}</div></div>` : '';

  const sources = doc.kind === 'invoice' && opts.sourceNumbers?.length
    ? `<div class="sources">Billed from ${opts.sourceNumbers.map(escapeHtml).join(', ')}</div>` : '';

  const notes = [
    section('Notes', doc.notes),
    doc.kind === 'quote' ? section('Exclusions', doc.exclusions) : '',
    doc.kind !== 'invoice' ? section('Terms', doc.terms) : '',
    doc.kind === 'invoice' ? section('Payment instructions', doc.paymentInstructions) : '',
    doc.kind === 'invoice' && doc.status === 'void' && doc.voidReason ? section('Void', doc.voidReason) : '',
  ].join('');

  const margin = '0.6in 0.6in 0.85in 0.6in';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} ${escapeHtml(doc.number)}</title>
<style>
  ${pdf ? `@page { size: letter; ${opts.nativeMargins ? 'margin: 0;' : `margin: ${margin};`} }` : ''}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: ${INK}; font-size: 10pt; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    background: ${pdf ? '#fff' : '#ECEAE4'};
  }
  .page { background: #fff; position: relative; ${pdf ? '' : 'max-width: 8.5in; margin: 0 auto; padding: 0.55in 0.55in 0.6in; min-height: 100vh;'} }
  .calc { display: none; color: ${MUTED}; font-size: 8.75pt; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .logo { height: 58px; width: auto; display: block; }
  .company { text-align: right; font-size: 8.5pt; color: ${MUTED}; line-height: 1.5; }
  .company .name { color: ${INK}; font-weight: 600; }

  .titlebar { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px;
    margin-top: 20px; padding-bottom: 14px; border-bottom: 1px solid ${RULE}; }
  h1 { margin: 0; font-size: 25pt; line-height: 1; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${ACCENT}; }
  .stamp { display: inline-block; margin-left: 12px; vertical-align: middle; font-size: 8pt; font-weight: 600; letter-spacing: 0.12em;
    text-transform: uppercase; color: ${MUTED}; border: 1px solid ${RULE}; border-radius: 4px; padding: 3px 7px; }
  .meta { border-collapse: collapse; font-size: 9pt; }
  .meta td { padding: 1px 0; }
  .meta td:first-child { color: ${MUTED}; padding-right: 14px; text-align: right; }
  .meta td:last-child { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }

  .parties { display: flex; gap: 24px; margin: 18px 0 22px; }
  .party { flex: 1; min-width: 0; font-size: 9.5pt; }
  .label { font-size: 7.5pt; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: ${FAINT}; margin-bottom: 4px; }
  .party .strong { font-weight: 600; }
  .party div { overflow-wrap: anywhere; }

  table.items { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.items thead { display: table-header-group; }
  table.items th { font-size: 7.5pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${ACCENT};
    background: ${WARM}; padding: 8px 10px; text-align: left; border-top: 2px solid ${GREEN}; }
  table.items th.num { text-align: right; }
  table.items td { padding: 9px 10px; border-bottom: 1px solid ${RULE}; vertical-align: top; }
  table.items tr { page-break-inside: avoid; break-inside: avoid; }
  col.c-desc { width: auto; } col.c-qty { width: 15%; } col.c-price { width: 15%; } col.c-amt { width: 16%; }
  .item { font-weight: 500; overflow-wrap: anywhere; }
  .details { color: ${MUTED}; font-size: 8.75pt; margin-top: 2px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .unit { color: ${MUTED}; }
  .amt { font-weight: 500; }
  .empty { color: ${FAINT}; text-align: center; padding: 22px 10px !important; }
  table.items tr.group td { padding: 14px 10px 5px; border-bottom: 1px solid ${RULE}; font-size: 7.5pt; font-weight: 600;
    letter-spacing: 0.1em; text-transform: uppercase; color: ${ACCENT}; page-break-after: avoid; break-after: avoid; }
  table.items tr.group:first-child td { padding-top: 8px; }
  table.items tr.gsub td { padding-top: 6px; padding-bottom: 6px; font-size: 8.75pt; color: ${MUTED}; }
  table.items tr.gsub td.num { color: ${INK}; font-weight: 500; }
  .sources { font-size: 8.5pt; color: ${MUTED}; margin-top: 8px; }

  .totals-wrap { display: flex; justify-content: flex-end; margin-top: 14px; page-break-inside: avoid; break-inside: avoid; }
  table.totals { border-collapse: collapse; min-width: 46%; font-size: 9.5pt; }
  table.totals td { padding: 4px 10px; }
  table.totals td:first-child { color: ${MUTED}; }
  table.totals tr.grand td { border-top: 1px solid ${INK}; padding-top: 9px; font-size: 12.5pt; font-weight: 700; color: ${INK}; }
  table.totals tr.grand td:first-child { color: ${ACCENT}; }

  .notes { margin-top: 22px; display: grid; gap: 14px; }
  .block { page-break-inside: avoid; break-inside: avoid; }
  .prose { white-space: pre-wrap; overflow-wrap: anywhere; color: ${INK}; font-size: 9pt; }
  .approval { padding: 10px 12px; background: ${WARM}; border-radius: 6px; }
  .approval a { color: inherit; overflow-wrap: anywhere; }
  .thanks { margin-top: 18px; font-size: 9.5pt; color: ${ACCENT}; font-weight: 500; page-break-inside: avoid; page-break-before: avoid; break-before: avoid; }
  ${pdf ? '' : `.footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid ${RULE}; font-size: 8pt; color: ${FAINT}; }`}
  .void-mark { position: absolute; top: 34%; left: 0; right: 0; text-align: center; font-size: 96pt; font-weight: 800;
    color: rgba(211, 47, 47, 0.10); transform: rotate(-24deg); pointer-events: none; letter-spacing: 0.1em; }
  ${pdf ? '' : `@media (max-width: 600px) {
    .page { padding: 22px 18px 28px; }
    header { flex-direction: column; gap: 10px; }
    .company { text-align: left; }
    .titlebar { flex-direction: column; align-items: flex-start; gap: 10px; }
    .meta td:first-child { text-align: left; }
    .meta td:last-child { text-align: left; }
    col.c-qty, col.c-price { width: 0; }
    .c-hide { display: none; }
    col.c-amt { width: 32%; }
    .calc { display: block; }
    table.items { table-layout: auto; }
    table.totals { min-width: 100%; }
  }`}
</style></head>
<body><div class="page">
  ${doc.kind === 'invoice' && doc.status === 'void' ? '<div class="void-mark">VOID</div>' : ''}
  <header>
    <img class="logo" src="${BRAND_LOGO_DATA_URI}" alt="${escapeHtml(s.company.name)}">
    <div class="company">
      <div class="name">${escapeHtml(s.company.name)}</div>
      ${lines(s.company.address, companyCity, s.company.phone, s.company.email)}
    </div>
  </header>

  <div class="titlebar">
    <h1>${escapeHtml(title)}${stamp ? `<span class="stamp">${stamp}</span>` : ''}</h1>
    <table class="meta">${metaRows(doc, opts).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
  </div>

  <div class="parties">
    <div class="party">
      <div class="label">${doc.kind === 'invoice' ? 'Bill to' : 'Prepared for'}</div>
      ${s.billTo ? `<div class="strong">${escapeHtml(s.billTo.name)}</div>${lines(s.billTo.phone, s.billTo.email)}` : '<div style="color:' + FAINT + '">No customer on this project</div>'}
    </div>
    <div class="party">
      <div class="label">Property</div>
      <div class="strong">${escapeHtml(s.property.name)}</div>
      ${lines(s.property.address, propCity)}
    </div>
  </div>

  ${intro}

  <table class="items">
    <colgroup><col class="c-desc"><col class="c-qty c-hide"><col class="c-price c-hide"><col class="c-amt"></colgroup>
    <thead><tr><th>Description</th><th class="num c-hide">Qty</th><th class="num c-hide">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows || '<tr><td class="empty" colspan="4">No line items yet</td></tr>'}</tbody>
  </table>
  ${sources}

  <div class="totals-wrap"><table class="totals">
    <tr><td>Subtotal</td><td class="num">${formatMoney(doc.subtotal)}</td></tr>
    ${taxRow}
    <tr class="grand"><td>${totalLabel}</td><td class="num">${formatMoney(doc.total)}</td></tr>
  </table></div>

  <div class="notes">${notes}${approvalBlock(doc, s, opts)}</div>

  <div class="thanks">Thank you for choosing ${escapeHtml(s.company.name)}.</div>
  ${pdf ? '' : `<div class="footer">${escapeHtml([s.company.name, s.company.phone, s.company.email].filter(Boolean).join('  ·  '))}</div>`}
</div></body></html>`;
}

/** Footer line stamped on every PDF page, left of the page number. */
export function footerText(doc: FinancialDoc, s: DocumentSnapshot): string {
  return [s.company.name, s.company.phone, `${TITLE[doc.kind]} ${doc.number}`].filter(Boolean).join('  ·  ');
}
