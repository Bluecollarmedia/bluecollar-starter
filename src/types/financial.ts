/**
 * Quotes, change orders and invoices.
 *
 * Each document saves its own line items and totals, so it always re-prints
 * exactly as it was saved. Customer and project are referenced by id; when a
 * document is sent/issued, the company, customer and property details are
 * also frozen into `snapshot` so the PDF never changes after the fact.
 */

import type { PersonSummary } from './company';

export type FinancialDocType = 'quote' | 'change_order' | 'invoice';

export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'declined' | 'expired';
export type ChangeOrderStatus = 'draft' | 'sent' | 'approved' | 'declined';
export type InvoiceStatus = 'draft' | 'issued' | 'void';
export type FinancialStatus = QuoteStatus | ChangeOrderStatus | InvoiceStatus;

/** Optional grouping for line items; documents show a subtotal per group. */
export type LineItemCategory = 'labor' | 'materials' | 'equipment' | 'misc';

export interface LineItem {
  id: string;
  category?: LineItemCategory;
  description: string;
  /** Optional second line (scope details, materials, etc.). */
  details?: string;
  quantity: number;
  /** e.g. "sq ft", "yd", "plant", "hr", "ea". */
  unit?: string;
  unitPrice: number;
  /** quantity × unitPrice, rounded to cents. */
  amount: number;
  /** On invoices: which quote / change order this line came from. */
  source?: { type: 'quote' | 'change_order'; id: string; number: string };
}

/** Details frozen into a document when it's sent/issued. */
export interface DocumentSnapshot {
  company: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  billTo: {
    name: string;
    email?: string;
    phone?: string;
  } | null;
  property: {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

interface FinancialDocBase {
  id: string;
  companyId: string;
  projectId: string;
  customerId?: string;
  number: string;
  title?: string;
  lineItems: LineItem[];
  /** Percent, e.g. 6.625. */
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  notes?: string;
  snapshot?: DocumentSnapshot;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  // Joined
  customer?: PersonSummary;
  projectName?: string;
}

export interface Quote extends FinancialDocBase {
  status: QuoteStatus;
  exclusions?: string;
  terms?: string;
  /** YYYY-MM-DD */
  issueDate: string;
  validUntil?: string;
  sentAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  /** Name typed by the customer (approval link) or the customer's own name (app). */
  approvedName?: string;
  /** The customer's drawn signature as SVG path text, saved with an approval made on the approval page. */
  approvedSignature?: string;
  /** Private token for the approval link (…/approve/<token>). */
  shareToken?: string;
  declinedAt?: string;
  declinedBy?: string;
  declineReason?: string;
}

export interface ChangeOrder extends FinancialDocBase {
  status: ChangeOrderStatus;
  quoteId?: string;
  description?: string;
  terms?: string;
  issueDate: string;
  sentAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  /** Name typed by the customer (approval link) or the customer's own name (app). */
  approvedName?: string;
  /** The customer's drawn signature as SVG path text, saved with an approval made on the approval page. */
  approvedSignature?: string;
  /** Private token for the approval link (…/approve/<token>). */
  shareToken?: string;
  declinedAt?: string;
  declinedBy?: string;
  declineReason?: string;
}

export interface Invoice extends FinancialDocBase {
  status: InvoiceStatus;
  quoteId?: string;
  changeOrderIds: string[];
  paymentInstructions?: string;
  /** YYYY-MM-DD */
  /** The private view link's token (update 81); the database makes it. */
  shareToken?: string;
  invoiceDate: string;
  dueDate?: string;
  issuedAt?: string;
  voidedAt?: string;
  voidReason?: string;
}

export type FinancialDoc =
  | ({ kind: 'quote' } & Quote)
  | ({ kind: 'change_order' } & ChangeOrder)
  | ({ kind: 'invoice' } & Invoice);

export type FinancialEventType = 'created' | 'sent' | 'approved' | 'declined' | 'expired' | 'issued' | 'voided';

export interface FinancialEvent {
  id: string;
  companyId: string;
  projectId: string;
  documentType: FinancialDocType;
  documentId: string;
  eventType: FinancialEventType;
  actorId?: string;
  note?: string;
  /** Approval-link answers: typed name, IP address, browser. */
  metadata?: { via?: 'app' | 'link'; name?: string; ip?: string; user_agent?: string };
  createdAt: string;
  actor?: PersonSummary;
}

/** A project's approved amount: approved quotes plus approved change orders. */
export interface ProjectFinancialSummary {
  originalQuote: number;
  approvedChanges: number;
  approvedTotal: number;
  /** Change orders sent but not answered yet (not counted above). */
  pendingChanges: number;
  invoiced: number;
}

/** What every new document starts with (Quotes & Invoices → Defaults). */
export interface FinancialSettings {
  companyId: string;
  defaultTaxRate?: number;
  defaultTerms?: string;
  defaultExclusions?: string;
  defaultPaymentInstructions?: string;
  defaultInvoiceNotes?: string;
  updatedAt?: string;
}
