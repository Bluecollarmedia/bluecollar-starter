/**
 * Sample quotes, change orders and invoices for demo mode (no Supabase
 * configured). Real companies start with none.
 */

import { calcTotals, lineAmount } from '@/lib/money';
import type { Project } from '@/types/project';
import type { LineItem, LineItemCategory } from '@/types/financial';

type Row = Record<string, any>;

function li(id: string, description: string, quantity: number, unit: string, unitPrice: number, details?: string, category?: LineItemCategory): LineItem {
  return { id, category, description, details, quantity, unit, unitPrice, amount: lineAmount(quantity, unitPrice) };
}

const TAX = 8;
const TERMS = '50% deposit due to schedule the work. Balance due on completion.\nPrices include materials, labor and cleanup.';
const EXCLUSIONS = 'Irrigation repairs, utility relocation and permit fees are not included unless listed above.';

export function buildMockFinancials(projects: Project[]) {
  const [p1, p2, p3] = projects;
  const quotes: Row[] = [];
  const changeOrders: Row[] = [];
  const invoices: Row[] = [];
  const events: Row[] = [];
  const vendors: Row[] = [];
  const materials: Row[] = [];
  const materialPlans: Row[] = [];
  if (!p1) return { quotes, changeOrders, invoices, events, vendors, materials, materialPlans };

  const company = { companyId: p1.companyId };
  const ev = (documentType: string, documentId: string, projectId: string, eventType: string, createdAt: string, actorId = 'owner1') =>
    events.push({ id: `fe-${events.length + 1}`, ...company, projectId, documentType, documentId, eventType, actorId, createdAt });

  // Approved quote on the first project
  const q1Items = [
    li('q1-1', 'Lawn installation', 5000, 'sq ft', 3.5, 'Strip existing turf, grade, amend soil and lay premium sod.', 'labor'),
    li('q1-2', 'Mulch (premium hardwood)', 10, 'yd', 65, undefined, 'materials'),
    li('q1-3', 'Plantings', 15, 'plant', 125, 'Boxwood, hydrangea and ornamental grasses per plan.', 'materials'),
    li('q1-4', 'Landscape fabric', 5000, 'sq ft', 0.75, undefined, 'materials'),
  ];
  quotes.push({
    id: 'quote1', shareToken: 'demoquote1'.padEnd(64, '0'), ...company, projectId: p1.id, customerId: p1.customerId, number: 'Q-1001', title: p1.name,
    status: 'approved', lineItems: q1Items, taxRate: TAX, ...calcTotals(q1Items, TAX),
    notes: 'All work will be completed to industry standards.', exclusions: EXCLUSIONS, terms: TERMS,
    issueDate: '2026-07-08', validUntil: '2026-08-07',
    sentAt: '2026-07-08T15:10:00Z', approvedAt: '2026-07-09T18:45:00Z', approvedBy: p1.customerId,
    createdBy: 'owner1', createdAt: '2026-07-08T14:00:00Z', updatedAt: '2026-07-09T18:45:00Z',
  });
  ev('quote', 'quote1', p1.id, 'created', '2026-07-08T14:00:00Z');
  ev('quote', 'quote1', p1.id, 'sent', '2026-07-08T15:10:00Z');
  ev('quote', 'quote1', p1.id, 'approved', '2026-07-09T18:45:00Z', p1.customerId);

  const co1Items = [li('co1-1', 'Additional planting bed', 8, 'plant', 125, undefined, 'materials'), li('co1-2', 'Mulch (premium hardwood)', 4, 'yd', 65, undefined, 'materials')];
  changeOrders.push({
    id: 'co1', shareToken: 'democo1'.padEnd(64, '0'), ...company, projectId: p1.id, quoteId: 'quote1', customerId: p1.customerId, number: 'CO-1001',
    description: 'Additional planting bed and extended mulch area around the back patio.',
    status: 'approved', lineItems: co1Items, taxRate: TAX, ...calcTotals(co1Items, TAX), terms: TERMS,
    issueDate: '2026-08-05', sentAt: '2026-08-05T14:12:00Z', approvedAt: '2026-08-05T18:45:00Z', approvedBy: p1.customerId,
    createdBy: 'owner1', createdAt: '2026-08-05T14:00:00Z', updatedAt: '2026-08-05T18:45:00Z',
  });
  ev('change_order', 'co1', p1.id, 'created', '2026-08-05T14:00:00Z');
  ev('change_order', 'co1', p1.id, 'sent', '2026-08-05T14:12:00Z');
  ev('change_order', 'co1', p1.id, 'approved', '2026-08-05T18:45:00Z', p1.customerId);

  const co2Items = [li('co2-1', 'French drain along north fence', 60, 'ln ft', 28, 'Perforated pipe in washed stone, wrapped in fabric, daylighted to the swale.')];
  changeOrders.push({
    id: 'co2', shareToken: 'democo2'.padEnd(64, '0'), ...company, projectId: p1.id, quoteId: 'quote1', customerId: p1.customerId, number: 'CO-1002',
    description: 'Drainage correction for standing water along the north fence line.',
    status: 'sent', lineItems: co2Items, taxRate: TAX, ...calcTotals(co2Items, TAX), terms: TERMS,
    issueDate: '2026-09-02', sentAt: '2026-09-02T16:00:00Z',
    createdBy: 'owner1', createdAt: '2026-09-02T15:30:00Z', updatedAt: '2026-09-02T16:00:00Z',
  });
  ev('change_order', 'co2', p1.id, 'created', '2026-09-02T15:30:00Z');
  ev('change_order', 'co2', p1.id, 'sent', '2026-09-02T16:00:00Z');

  // Draft invoice billing the approved quote + approved change order
  const invItems = [
    ...q1Items.map((x) => ({ ...x, id: `inv-${x.id}`, source: { type: 'quote' as const, id: 'quote1', number: 'Q-1001' } })),
    ...co1Items.map((x) => ({ ...x, id: `inv-${x.id}`, source: { type: 'change_order' as const, id: 'co1', number: 'CO-1001' } })),
  ];
  invoices.push({
    id: 'inv1', ...company, projectId: p1.id, quoteId: 'quote1', changeOrderIds: ['co1'], customerId: p1.customerId,
    number: 'INV-1001', title: p1.name, status: 'draft', lineItems: invItems, taxRate: TAX, ...calcTotals(invItems, TAX),
    paymentInstructions: 'Please make checks payable to Brighton Lawn + Landscape. Payment is due within 30 days.',
    invoiceDate: '2026-09-20', dueDate: '2026-10-20',
    createdBy: 'owner1', createdAt: '2026-09-20T13:00:00Z', updatedAt: '2026-09-20T13:00:00Z',
  });
  ev('invoice', 'inv1', p1.id, 'created', '2026-09-20T13:00:00Z');

  if (p2) {
    const q2Items = [
      li('q2-1', 'Paver patio', 420, 'sq ft', 24, 'Compacted base, 1" bedding sand, polymeric joint sand.'),
      li('q2-2', 'Seat wall', 24, 'ln ft', 95),
      li('q2-3', 'Low-voltage lighting', 8, 'fixture', 185),
    ];
    quotes.push({
      id: 'quote2', shareToken: 'demoquote2'.padEnd(64, '0'), ...company, projectId: p2.id, customerId: p2.customerId, number: 'Q-1002', title: p2.name,
      status: 'sent', lineItems: q2Items, taxRate: TAX, ...calcTotals(q2Items, TAX), exclusions: EXCLUSIONS, terms: TERMS,
      issueDate: '2026-09-28', validUntil: '2026-11-15', sentAt: '2026-09-28T17:00:00Z',
      createdBy: 'owner1', createdAt: '2026-09-28T16:00:00Z', updatedAt: '2026-09-28T17:00:00Z',
    });
    ev('quote', 'quote2', p2.id, 'created', '2026-09-28T16:00:00Z');
    ev('quote', 'quote2', p2.id, 'sent', '2026-09-28T17:00:00Z');
  }

  if (p3) {
    const q3Items = [li('q3-1', 'Fall cleanup', 1, 'visit', 450), li('q3-2', 'Aeration and overseeding', 8000, 'sq ft', 0.12)];
    quotes.push({
      id: 'quote3', shareToken: 'demoquote3'.padEnd(64, '0'), ...company, projectId: p3.id, customerId: p3.customerId, number: 'Q-1003', title: p3.name,
      status: 'draft', lineItems: q3Items, taxRate: TAX, ...calcTotals(q3Items, TAX), terms: TERMS,
      issueDate: '2026-10-08', validUntil: '2026-11-07',
      createdBy: 'owner1', createdAt: '2026-10-08T12:00:00Z', updatedAt: '2026-10-08T12:00:00Z',
    });
    ev('quote', 'quote3', p3.id, 'created', '2026-10-08T12:00:00Z');
  }

  // Materials checklist on the first project: two suggestions from the
  // approved quote and an internal item that isn't on the quote.
  vendors.push({
    id: 'vendor1', ...company, name: 'Greenway Supply Co.', contactName: 'Mike', phone: '(216) 555-0188',
    address: '123 Industrial Way, Cleveland, OH', pickupInstructions: 'Pickup at the main entrance. Bring the truck with the trailer.',
    createdAt: '2026-08-01T12:00:00Z', updatedAt: '2026-08-01T12:00:00Z',
  });
  const mat = (id: string, name: string, quantity: number | undefined, unit: string | undefined, status: string, sortOrder: number, extra: Row = {}) =>
    materials.push({ id, ...company, projectId: p1.id, name, quantity, unit, status, sortOrder, createdBy: 'owner1', createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-01T12:00:00Z', ...extra });
  mat('mat1', 'Mulch (premium hardwood)', 10, 'yd', 'ordered', 0, { vendorId: 'vendor1', source: { type: 'quote', id: 'quote1', number: 'Q-1001', lineItemId: 'q1-2', quantity: 10, unit: 'yd' } });
  mat('mat2', 'Plantings', 15, 'plant', 'needs_review', 1, { source: { type: 'quote', id: 'quote1', number: 'Q-1001', lineItemId: 'q1-3', quantity: 15, unit: 'plant' } });
  mat('mat3', 'Topsoil', 25, 'ton', 'to_order', 2, { notes: 'For regrading the side yard. Not on the quote.' });
  materialPlans.push({
    projectId: p1.id, ...company, vendorId: 'vendor1', pickupLocation: 'Greenway Supply Co. yard',
    pickupInstructions: 'Pickup at the main entrance. Bring the truck with the trailer.', dismissedSources: [],
  });

  return { quotes, changeOrders, invoices, events, vendors, materials, materialPlans };
}
