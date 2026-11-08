/**
 * Quotes, change orders and invoices: creating, editing drafts, and moving
 * them through their statuses.
 *
 * Rules (also enforced by the database, see supabase/updates/008):
 *  • Only drafts can be edited or deleted. Once a document is sent/issued its
 *    contents and price are locked; to change it, duplicate it as a new draft.
 *  • Statuses only move forward: draft → sent → approved / declined / expired
 *    for quotes and change orders, draft → issued → void for invoices.
 *  • A project's approved amount counts only approved quotes and approved
 *    change orders.
 */

import { db, insertRow, updateRow, deleteRow, findRow, upsertRow, rowsOf, rpc, refresh, isDemo } from './store';
import { notifyPeople, logProjectHistory, addCustomerTimeline } from './actions';
import { generateProjectCode } from '@/hooks/useCustomerAccess';
import { DEFAULT_CHECKIN_RADIUS_M } from '@/lib/maps';
import { supabase } from '@/lib/supabase';
import { config } from '@/lib/config';
import { describeEmailError } from '@/lib/documentEmail';
import { uuid, todayKey, localDateKey } from '@/lib/ids';
import { calcTotals, lineAmount, sumMoney, formatMoney } from '@/lib/money';
import type {
  FinancialDocType, FinancialDoc, FinancialEventType, LineItem, DocumentSnapshot,
  Quote, ChangeOrder, Invoice, ProjectFinancialSummary, FinancialStatus,
} from '@/types/financial';
import type { Project } from '@/types/project';

type TableFor = 'quotes' | 'change_orders' | 'invoices';

export const TABLE_OF: Record<FinancialDocType, TableFor> = {
  quote: 'quotes',
  change_order: 'change_orders',
  invoice: 'invoices',
};

export const DOC_LABEL: Record<FinancialDocType, string> = {
  quote: 'Quote',
  change_order: 'Change Order',
  invoice: 'Invoice',
};

const PREFIX: Record<FinancialDocType, string> = {
  quote: 'Q-',
  change_order: 'CO-',
  invoice: 'INV-',
};

const FIRST_NUMBER = 1001;

export { CATEGORY_ORDER, CATEGORY_LABEL } from '@/lib/documentHtml';

// ── Reading ─────────────────────────────────────────────────────────────────

function listOf(kind: FinancialDocType): (Quote | ChangeOrder | Invoice)[] {
  return kind === 'quote' ? db.quotes : kind === 'change_order' ? db.changeOrders : db.invoices;
}

export function getDoc(kind: FinancialDocType, id: string): FinancialDoc | null {
  const doc = listOf(kind).find((d) => d.id === id);
  return doc ? ({ kind, ...doc } as FinancialDoc) : null;
}

/** All documents, newest first, optionally for one project. */
export function allDocs(projectId?: string): FinancialDoc[] {
  const docs: FinancialDoc[] = [
    ...db.quotes.map((d) => ({ kind: 'quote' as const, ...d })),
    ...db.changeOrders.map((d) => ({ kind: 'change_order' as const, ...d })),
    ...db.invoices.map((d) => ({ kind: 'invoice' as const, ...d })),
  ];
  return docs
    .filter((d) => !projectId || d.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The document's date: invoice date for invoices, issue date otherwise. */
export function docDate(doc: FinancialDoc): string {
  return doc.kind === 'invoice' ? doc.invoiceDate : doc.issueDate;
}

/** A sent quote past its "valid until" date reads as Expired. */
export function displayStatus(doc: FinancialDoc): FinancialStatus {
  if (doc.kind === 'quote' && doc.status === 'sent' && doc.validUntil && doc.validUntil < todayKey()) {
    return 'expired';
  }
  return doc.status;
}

export const STATUS_LABEL: Record<FinancialStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Expired',
  issued: 'Issued',
  void: 'Void',
};

export const STATUS_TONE: Record<FinancialStatus, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  draft: 'neutral',
  sent: 'info',
  approved: 'success',
  declined: 'error',
  expired: 'warning',
  issued: 'info',
  void: 'neutral',
};

/** Original approved quote(s) + approved change orders. Unapproved changes are
 * reported separately and never counted as approved. */
export function projectSummary(projectId: string): ProjectFinancialSummary {
  const approvedQuotes = db.quotes.filter((q) => q.projectId === projectId && q.status === 'approved');
  const cos = db.changeOrders.filter((c) => c.projectId === projectId);
  const originalQuote = sumMoney(approvedQuotes.map((q) => q.total));
  const approvedChanges = sumMoney(cos.filter((c) => c.status === 'approved').map((c) => c.total));
  return {
    originalQuote,
    approvedChanges,
    approvedTotal: sumMoney([originalQuote, approvedChanges]),
    pendingChanges: sumMoney(cos.filter((c) => c.status === 'sent').map((c) => c.total)),
    invoiced: sumMoney(db.invoices.filter((i) => i.projectId === projectId && i.status === 'issued').map((i) => i.total)),
  };
}

/** Approved change orders not already on an issued or draft invoice. */
export function uninvoicedChangeOrders(projectId: string, exceptInvoiceId?: string): ChangeOrder[] {
  const used = new Set(
    db.invoices
      .filter((i) => i.projectId === projectId && i.status !== 'void' && i.id !== exceptInvoiceId)
      .flatMap((i) => i.changeOrderIds),
  );
  return db.changeOrders.filter((c) => c.projectId === projectId && c.status === 'approved' && !used.has(c.id));
}

// ── Numbers & defaults ──────────────────────────────────────────────────────

/** Next readable number for this kind: Q-1001, CO-1001, INV-1001 … */
export function nextNumber(kind: FinancialDocType): string {
  const prefix = PREFIX[kind];
  let max = FIRST_NUMBER - 1;
  for (const d of listOf(kind)) {
    const n = parseInt(String(d.number).replace(prefix, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/** What a new document starts with: the company's saved defaults
 * (Quotes & Invoices → Document Defaults). Anything not set there falls back
 * to the most recent document, so the owner never types the same terms twice.
 * With neither, there's no tax (nothing is assumed). */
export function documentDefaults() {
  const s = db.financialSettings;
  const recent = allDocs();
  const quote = db.quotes.find((q) => q.terms || q.exclusions);
  const invoice = db.invoices.find((i) => i.paymentInstructions);
  return {
    taxRate: s?.defaultTaxRate ?? recent.find((d) => d.taxRate > 0)?.taxRate ?? 0,
    terms: s?.defaultTerms ?? quote?.terms,
    exclusions: s?.defaultExclusions ?? quote?.exclusions,
    paymentInstructions: s?.defaultPaymentInstructions ?? invoice?.paymentInstructions,
    invoiceNotes: s?.defaultInvoiceNotes,
  };
}
const lastUsed = documentDefaults;

/** Saves the company's document defaults. Existing documents don't change. */
export function saveDocumentDefaults(patch: { defaultTaxRate?: number; defaultTerms?: string; defaultExclusions?: string; defaultPaymentInstructions?: string; defaultInvoiceNotes?: string }) {
  upsertRow('financial_settings', { companyId: db.companyId, ...db.financialSettings, ...patch });
}

export function newLineItem(partial: Partial<LineItem> = {}): LineItem {
  const quantity = partial.quantity ?? 1;
  const unitPrice = partial.unitPrice ?? 0;
  return {
    id: uuid(),
    description: '',
    unit: '',
    ...partial,
    quantity,
    unitPrice,
    amount: lineAmount(quantity, unitPrice),
  };
}

/** Company, customer and property details as they are right now. */
export function currentSnapshot(projectId: string, customerId?: string): DocumentSnapshot {
  const c = db.company;
  const p = db.projects.find((x) => x.id === projectId);
  const cust = customerId ? db.people[customerId] : p?.customer;
  return {
    company: {
      name: c?.name ?? 'Brighton Lawn + Landscape',
      phone: c?.phone,
      email: c?.email,
      address: c?.address,
      city: c?.city,
      state: c?.state,
      zip: c?.zip,
    },
    billTo: cust
      ? { name: `${cust.firstName} ${cust.lastName}`.trim(), email: cust.email || undefined, phone: cust.phone }
      : null,
    property: {
      name: p?.name ?? '',
      address: p?.address,
      city: p?.city,
      state: p?.state,
      zip: p?.zip,
    },
  };
}

/** What the PDF prints: the frozen snapshot once sent, live details for drafts. */
export function snapshotFor(doc: FinancialDoc): DocumentSnapshot {
  return doc.snapshot ?? currentSnapshot(doc.projectId, doc.customerId);
}

// ── History ─────────────────────────────────────────────────────────────────

function logEvent(kind: FinancialDocType, doc: { id?: unknown; projectId?: unknown } & Record<string, any>, eventType: FinancialEventType, note?: string) {
  insertRow('financial_events', {
    projectId: doc.projectId,
    documentType: kind,
    documentId: doc.id,
    eventType,
    actorId: db.personId || undefined,
    note,
  });
}

export function eventsFor(documentId: string) {
  return db.financialEvents.filter((e) => e.documentId === documentId);
}

// ── Quotes for a new project (prospects) ───────────────────────────────────

const normalize = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The customer's existing projects at this address, so a quote for a
 * property that's already a project goes on that project instead of a copy. */
export function matchingProjects(customerId: string | undefined, address: string): Project[] {
  const a = normalize(address);
  if (!a) return [];
  return db.projects.filter((p) =>
    p.status !== 'archived' && normalize(p.address) === a && (!customerId || !p.customerId || p.customerId === customerId));
}

/** Creates the project for a quote on a new job as a Prospect: no team, not
 * on the schedule, not shown to workers. It becomes Active only when the
 * owner starts it after the quote is approved (startProjectFromQuote). */
export function createProspectProject(input: {
  customerId?: string;
  name: string;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
}): Project {
  const project = insertRow('projects', {
    customerId: input.customerId,
    name: input.name.trim(),
    address: input.address.trim() || undefined,
    city: input.city?.trim() || undefined,
    state: input.state?.trim().toUpperCase() || undefined,
    zip: input.zip?.trim() || undefined,
    status: 'prospect',
    progress: 0,
    customerProjectCode: generateProjectCode(),
  });
  insertRow('project_settings', {
    projectId: project.id,
    customerInteractionEnabled: true,
    completionPhotoRequired: false,
    checkinRadiusMeters: DEFAULT_CHECKIN_RADIUS_M,
    customerCanRequest: true,
    customerCanViewPhotos: true,
    customerCanComment: true,
  });
  logProjectHistory(project.id as string, 'project_created', `Prospect created for a quote: ${input.name.trim()}`);
  return project as unknown as Project;
}

/** Removes a prospect that was created for a quote the owner then cancelled
 * before adding anything. Only an untouched prospect with no documents left. */
export function discardEmptyProspect(projectId: string) {
  const p = db.projects.find((x) => x.id === projectId);
  if (p?.status !== 'prospect') return;
  // Raw rows: the draft deleted a moment ago is already gone from these.
  if ((['quotes', 'change_orders', 'invoices'] as const).some((t) => rowsOf(t).some((r) => r.projectId === projectId))) return;
  if ((db.tasks[projectId] ?? []).length || (db.photos[projectId] ?? []).length || db.assignments.some((a) => a.projectId === projectId)) return;
  deleteRow('projects', projectId);
}

/** A prospect whose quote was approved and is ready to become a project. */
export function canStartProject(projectId: string): boolean {
  const p = db.projects.find((x) => x.id === projectId);
  return p?.status === 'prospect' && db.quotes.some((q) => q.projectId === projectId && q.status === 'approved');
}

/** Turns a prospect into an active project, keeping everything already on it
 * (customer, address, the approved quote). Doesn't schedule anyone. */
export function startProjectFromQuote(projectId: string): boolean {
  if (!canStartProject(projectId)) return false;
  const quote = db.quotes.find((q) => q.projectId === projectId && q.status === 'approved');
  updateRow('projects', projectId, { status: 'active' });
  logProjectHistory(projectId, 'status_changed', `Project started from approved quote ${quote?.number ?? ''}`.trim(), {
    from: 'prospect', to: 'active', quoteId: quote?.id,
  });
  addCustomerTimeline(projectId, 'project_started', 'Your project is confirmed');
  return true;
}

// ── Creating ────────────────────────────────────────────────────────────────

export function createQuote(projectId: string): Quote {
  const project = db.projects.find((p) => p.id === projectId);
  const d = lastUsed();
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);
  const row = insertRow('quotes', {
    projectId,
    customerId: project?.customerId,
    number: nextNumber('quote'),
    title: project?.name,
    status: 'draft',
    lineItems: [],
    taxRate: d.taxRate,
    subtotal: 0,
    taxAmount: 0,
    total: 0,
    terms: d.terms,
    exclusions: d.exclusions,
    issueDate: todayKey(),
    validUntil: localDateKey(validUntil),
    createdBy: db.personId || undefined,
  });
  logEvent('quote', row, 'created');
  return row as unknown as Quote;
}

export function createChangeOrder(projectId: string, quoteId?: string): ChangeOrder {
  const project = db.projects.find((p) => p.id === projectId);
  const quote = quoteId
    ? db.quotes.find((q) => q.id === quoteId)
    : db.quotes.find((q) => q.projectId === projectId && q.status === 'approved');
  const d = lastUsed();
  const row = insertRow('change_orders', {
    projectId,
    quoteId: quote?.id,
    customerId: project?.customerId,
    number: nextNumber('change_order'),
    status: 'draft',
    lineItems: [],
    taxRate: quote?.taxRate ?? d.taxRate,
    subtotal: 0,
    taxAmount: 0,
    total: 0,
    terms: quote?.terms ?? d.terms,
    issueDate: todayKey(),
    createdBy: db.personId || undefined,
  });
  logEvent('change_order', row, 'created');
  return row as unknown as ChangeOrder;
}

function linesFrom(doc: Quote | ChangeOrder, type: 'quote' | 'change_order'): LineItem[] {
  return doc.lineItems.map((li) => ({
    ...li,
    id: uuid(),
    source: { type, id: doc.id, number: doc.number },
  }));
}

/** Invoice prefilled from an approved quote and approved change orders (their
 * line items are copied, tagged with where they came from). */
export function createInvoice(projectId: string, opts: { quoteId?: string; changeOrderIds?: string[] } = {}): Invoice {
  const project = db.projects.find((p) => p.id === projectId);
  const quote = opts.quoteId ? db.quotes.find((q) => q.id === opts.quoteId && q.status === 'approved') : undefined;
  const cos = (opts.changeOrderIds ?? [])
    .map((id) => db.changeOrders.find((c) => c.id === id && c.status === 'approved'))
    .filter((c): c is ChangeOrder => !!c);
  const lineItems = [
    ...(quote ? linesFrom(quote, 'quote') : []),
    ...cos.flatMap((c) => linesFrom(c, 'change_order')),
  ];
  const d = lastUsed();
  const taxRate = quote?.taxRate ?? cos[0]?.taxRate ?? d.taxRate;
  const due = new Date();
  due.setDate(due.getDate() + 30);
  const row = insertRow('invoices', {
    projectId,
    quoteId: quote?.id,
    changeOrderIds: cos.map((c) => c.id),
    customerId: quote?.customerId ?? project?.customerId,
    number: nextNumber('invoice'),
    title: project?.name,
    status: 'draft',
    lineItems,
    taxRate,
    ...calcTotals(lineItems, taxRate),
    notes: d.invoiceNotes,
    paymentInstructions: d.paymentInstructions,
    invoiceDate: todayKey(),
    dueDate: localDateKey(due),
    createdBy: db.personId || undefined,
  });
  logEvent('invoice', row, 'created');
  return row as unknown as Invoice;
}

/** Copies a sent/approved document into a new draft (the original is kept). */
export function duplicateAsDraft(kind: FinancialDocType, id: string): FinancialDoc | null {
  const src = getDoc(kind, id);
  if (!src) return null;
  const {
    kind: _k, id: _id, number: _n, status: _s, snapshot: _snap, createdAt: _c, updatedAt: _u,
    customer: _cust, projectName: _pn, companyId: _co, ...rest
  } = src as FinancialDoc & Record<string, unknown>;
  const clean: Record<string, unknown> = { ...rest };
  for (const k of ['sentAt', 'approvedAt', 'approvedBy', 'approvedName', 'shareToken', 'declinedAt', 'declinedBy', 'declineReason', 'issuedAt', 'voidedAt', 'voidReason']) {
    delete clean[k];
  }
  const today = todayKey();
  const row = insertRow(TABLE_OF[kind], {
    ...clean,
    lineItems: src.lineItems.map((li) => ({ ...li, id: uuid() })),
    number: nextNumber(kind),
    status: 'draft',
    createdBy: db.personId || undefined,
    ...(kind === 'invoice' ? { invoiceDate: today } : { issueDate: today }),
  });
  logEvent(kind, row, 'created', `Copied from ${src.number}`);
  return getDoc(kind, row.id as string) ?? ({ kind, ...row } as unknown as FinancialDoc);
}

// ── Editing drafts ──────────────────────────────────────────────────────────

export class LockedDocumentError extends Error {
  constructor() {
    super('This document was already sent, so it can’t be changed. Duplicate it as a new draft instead.');
  }
}

function assertDraft(kind: FinancialDocType, id: string) {
  const row = findRow(TABLE_OF[kind], id);
  if (!row) throw new Error('Document not found.');
  if (row.status !== 'draft') throw new LockedDocumentError();
  return row;
}

/** Saves edits to a draft, recalculating every line and the totals. */
export function saveDraft(kind: FinancialDocType, id: string, patch: Record<string, unknown>) {
  const row = assertDraft(kind, id);
  const lineItems: LineItem[] = ((patch.lineItems as LineItem[] | undefined) ?? row.lineItems ?? []).map((li: LineItem) => ({
    ...li,
    amount: lineAmount(li.quantity, li.unitPrice),
  }));
  const taxRate = Number(patch.taxRate ?? row.taxRate ?? 0);
  updateRow(TABLE_OF[kind], id, { ...patch, lineItems, taxRate, ...calcTotals(lineItems, taxRate) });
}

export function deleteDraft(kind: FinancialDocType, id: string) {
  assertDraft(kind, id);
  deleteRow(TABLE_OF[kind], id);
}

/** Problems that stop a draft from being sent/issued. Empty when it's ready. */
export function readinessProblems(doc: FinancialDoc): string[] {
  const problems: string[] = [];
  if (doc.lineItems.length === 0) problems.push('Add at least one line item.');
  if (doc.lineItems.some((li) => !li.description.trim())) problems.push('Every line item needs a description.');
  if (doc.lineItems.some((li) => !(li.quantity > 0))) problems.push('Every line item needs a quantity above zero.');
  if (doc.lineItems.some((li) => li.unitPrice < 0)) problems.push('Unit prices can’t be negative.');
  if (doc.kind === 'invoice' && doc.dueDate && doc.dueDate < doc.invoiceDate) problems.push('The due date is before the invoice date.');
  return problems;
}

// ── Status changes ──────────────────────────────────────────────────────────

/** Quote / change order: draft → sent. Freezes the customer & company details. */
export function markSent(kind: 'quote' | 'change_order', id: string) {
  const row = assertDraft(kind, id);
  const now = new Date().toISOString();
  updateRow(TABLE_OF[kind], id, {
    status: 'sent',
    sentAt: now,
    snapshot: currentSnapshot(row.projectId, row.customerId),
  });
  logEvent(kind, row, 'sent');
  notifyCustomer(kind, row, `${DOC_LABEL[kind]} ${row.number} is ready for review`, `${formatMoney(row.total)} · Tap to review and approve`);
}

/** Invoice: draft → issued. Freezes the customer & company details. */
export function issueInvoice(id: string) {
  const row = assertDraft('invoice', id);
  updateRow('invoices', id, {
    status: 'issued',
    issuedAt: new Date().toISOString(),
    snapshot: currentSnapshot(row.projectId, row.customerId),
  });
  logEvent('invoice', row, 'issued');
  notifyCustomer('invoice', row, `Invoice ${row.number}`, `${formatMoney(row.total)} · Tap to view`);
}

/** Tells the project's customer (in their app and by push) that a document
 * is waiting for them. Customers without an app account simply don't get it. */
function notifyCustomer(kind: FinancialDocType, row: Record<string, any>, title: string, body: string) {
  if (!row.customerId) return;
  notifyPeople([row.customerId], kind === 'invoice' ? 'invoice_issued' : 'quote_sent', title, body, { type: kind, id: row.id });
}

export function voidInvoice(id: string, reason?: string) {
  const row = findRow('invoices', id);
  if (!row || row.status !== 'issued') return;
  updateRow('invoices', id, { status: 'void', voidedAt: new Date().toISOString(), voidReason: reason?.trim() || undefined });
  logEvent('invoice', row, 'voided', reason?.trim() || undefined);
}

/** The owner records the customer's answer (e.g. approved in person or by
 * email). Only a sent quote / change order can be approved or declined. */
export function recordResponse(kind: 'quote' | 'change_order', id: string, approved: boolean, note?: string) {
  const row = findRow(TABLE_OF[kind], id);
  if (!row || row.status !== 'sent') return;
  const now = new Date().toISOString();
  updateRow(TABLE_OF[kind], id, approved
    ? { status: 'approved', approvedAt: now, approvedBy: db.personId || undefined }
    : { status: 'declined', declinedAt: now, declinedBy: db.personId || undefined, declineReason: note?.trim() || undefined });
  logEvent(kind, row, approved ? 'approved' : 'declined', note?.trim() || 'Recorded by owner');
}

export function markExpired(id: string) {
  const row = findRow('quotes', id);
  if (!row || row.status !== 'sent') return;
  updateRow('quotes', id, { status: 'expired' });
  logEvent('quote', row, 'expired');
}

const RESPONSE_ERRORS: Record<string, string> = {
  not_found: 'This document isn’t available.',
  not_open: 'This document was already answered.',
  expired: 'This quote has expired. Please contact us for an updated quote.',
};

/** The customer approves or declines from their app. The database records it
 * (customers can't edit documents directly) and alerts the owner. */
export async function respondAsCustomer(kind: 'quote' | 'change_order', id: string, approve: boolean, note?: string): Promise<{ error?: string }> {
  if (isDemo()) {
    const row = findRow(TABLE_OF[kind], id);
    if (!row || row.status !== 'sent') return { error: RESPONSE_ERRORS.not_open };
    if (approve && kind === 'quote' && row.validUntil && row.validUntil < todayKey()) return { error: RESPONSE_ERRORS.expired };
    const now = new Date().toISOString();
    updateRow(TABLE_OF[kind], id, approve
      ? { status: 'approved', approvedAt: now, approvedBy: db.personId, approvedName: personName(db.personId) }
      : { status: 'declined', declinedAt: now, declinedBy: db.personId, declineReason: note?.trim() || undefined });
    logEvent(kind, row, approve ? 'approved' : 'declined', note?.trim() || undefined);
    return {};
  }
  const { data, error } = await rpc<{ success: boolean; error?: string }>('respond_to_financial_document', {
    p_type: kind,
    p_id: id,
    p_approve: approve,
    p_note: note ?? null,
  });
  if (error) return { error: error.message };
  if (!data?.success) return { error: RESPONSE_ERRORS[data?.error ?? ''] ?? 'Something went wrong. Please try again.' };
  await refresh(TABLE_OF[kind], 'financial_events');
  return {};
}

function personName(id?: string): string | undefined {
  const p = id ? db.people[id] : undefined;
  return p ? `${p.firstName} ${p.lastName}`.trim() || undefined : undefined;
}

// ── Approval links ──────────────────────────────────────────────────────────

/** Whether approval links can be sent (the web app's address is set). */
export const approvalLinksEnabled = !!config.webUrl;

/** The private link a customer opens in any browser, without the app: view and approve a sent quote or change order,
 * or view an issued invoice (update 81). */
export async function approvalLink(doc: FinancialDoc): Promise<string | null> {
  if (!config.webUrl || doc.status === 'draft') return null;
  let token = doc.shareToken;
  if (!token && !isDemo()) {
    // Made by the database; fetch it if this copy predates the column.
    const { data } = await supabase.from(TABLE_OF[doc.kind]).select('share_token').eq('id', doc.id).maybeSingle();
    token = (data as { share_token?: string } | null)?.share_token ?? undefined;
  }
  return token ? `${config.webUrl}/approve/${token}` : null;
}

export type EmailResult = { ok: true; to: string } | { ok: false; error: string; code?: string };

/**
 * Emails the customer a short message with a "View quote" button (the approval link). The server function does the sending
 * (it checks the caller is the owner or an admin, and that the document isn't a draft). `typedEmail` is used when the
 * customer has no address on file, or when the owner wants it to go somewhere else.
 */
export async function emailDocumentToCustomer(doc: FinancialDoc, typedEmail?: string): Promise<EmailResult> {
  if (isDemo()) return { ok: false, error: 'Emailing needs the live app (not demo mode).' };
  try {
    const { data, error } = await supabase.functions.invoke('send-document-email', {
      body: { kind: doc.kind, id: doc.id, ...(typedEmail ? { email: typedEmail } : {}) },
    });
    if (error) {
      let code: string | undefined;
      try { code = (await (error as { context?: Response }).context?.json())?.error; } catch { /* not a JSON answer */ }
      code = code ?? error.message;
      return { ok: false, code, error: describeEmailError(code) };
    }
    if (data?.ok) return { ok: true, to: String(data.to ?? typedEmail ?? '') };
    return { ok: false, code: data?.error, error: describeEmailError(data?.error) };
  } catch (err) {
    const code = err instanceof Error ? err.message : undefined;
    return { ok: false, code, error: describeEmailError(code) };
  }
}

/** Text for the message the owner sends with the link. */
export function approvalMessage(doc: FinancialDoc, link: string): string {
  const first = doc.customer?.firstName?.trim();
  const company = db.company?.name ?? 'Brighton Lawn + Landscape';
  const what = `${DOC_LABEL[doc.kind].toLowerCase()} ${doc.number}`;
  const act = doc.kind === 'invoice' ? 'You can view it here' : 'You can review and approve it here';
  return `${first ? `Hi ${first}, here` : 'Here'}'s your ${what} from ${company} (${formatMoney(doc.total)}). ${act}: ${link}`;
}

/** Extra details the document template prints: the quote a change order
 * amends, what an invoice bills, and who approved. */
export function templateOptionsFor(doc: FinancialDoc) {
  const linkedQuoteNumber = doc.kind !== 'quote' && doc.quoteId
    ? db.quotes.find((q) => q.id === doc.quoteId)?.number : undefined;
  const sourceNumbers = doc.kind === 'invoice'
    ? [
        ...(linkedQuoteNumber ? [linkedQuoteNumber] : []),
        ...db.changeOrders.filter((c) => doc.changeOrderIds.includes(c.id)).map((c) => c.number),
      ]
    : undefined;
  const approvalUrl = config.webUrl && doc.kind !== 'invoice' && doc.shareToken
    ? `${config.webUrl}/approve/${doc.shareToken}` : undefined;
  return { linkedQuoteNumber, sourceNumbers, events: eventsFor(doc.id), approvalUrl };
}

/** Line items used before (most recent first, one per description) — offered
 * as suggestions when adding a new item. */
export function recentLineItems(limit = 40): Pick<LineItem, 'description' | 'unit' | 'unitPrice' | 'details' | 'category'>[] {
  const seen = new Set<string>();
  const out: Pick<LineItem, 'description' | 'unit' | 'unitPrice' | 'details' | 'category'>[] = [];
  for (const d of allDocs()) {
    for (const li of d.lineItems) {
      const key = li.description.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ description: li.description, unit: li.unit, unitPrice: li.unitPrice, details: li.details, category: li.category });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
