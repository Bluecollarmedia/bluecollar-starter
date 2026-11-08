/**
 * Materials preparation for each project (owner/admin only; see
 * supabase/updates/015).
 *
 *  • One checklist per project (project_materials) plus one plan row
 *    (project_material_plans) for the vendor / pickup details and the prep
 *    reminder. Every screen (the project's Materials, Owner → More →
 *    Materials) reads these same rows.
 *  • Suggestions are copied from the approved quote and approved change
 *    orders, using plain rules (no AI): lines grouped as Materials, or
 *    ungrouped lines measured in material units (tons, yards, bags…). Every
 *    suggestion starts as "Needs review" with the quantity as written on the
 *    document, so nothing is presented as a verified requirement. Lines
 *    without a usable quantity come in with no quantity.
 *  • The reminder is a date and time the owner picks, tied to the job's next
 *    scheduled date. If the job moves, the checklist flags it.
 */

import { db, insertRow, updateRow, deleteRow, upsertRow } from './store';
import { todayKey } from '@/lib/ids';
import { formatQuantity } from '@/lib/money';
import { formatDocDate } from '@/lib/documentHtml';
import type { MaterialPlan, MaterialSource, MaterialStatus, MaterialVendor, ProjectMaterial } from '@/types/materials';
import type { LineItem } from '@/types/financial';
import type { Project } from '@/types/project';

export const MATERIAL_STATUS_ORDER: MaterialStatus[] = ['needs_review', 'to_order', 'ordered', 'ready', 'picked_up', 'complete'];

export const MATERIAL_STATUS_LABEL: Record<MaterialStatus, string> = {
  needs_review: 'Needs review',
  to_order: 'To order',
  ordered: 'Ordered',
  ready: 'Ready for pickup',
  picked_up: 'Picked up',
  complete: 'Complete',
};

export const MATERIAL_STATUS_TONE: Record<MaterialStatus, 'success' | 'warning' | 'info' | 'neutral'> = {
  needs_review: 'warning',
  to_order: 'neutral',
  ordered: 'info',
  ready: 'info',
  picked_up: 'success',
  complete: 'success',
};

/** Done = nothing left to prepare for this item. */
export const isDone = (m: ProjectMaterial) => m.status === 'picked_up' || m.status === 'complete';

// ── Reading ─────────────────────────────────────────────────────────────────

export function materialsFor(projectId: string): ProjectMaterial[] {
  return db.materials[projectId] ?? [];
}

export function planFor(projectId: string): MaterialPlan {
  return db.materialPlans[projectId] ?? { projectId, companyId: db.companyId, dismissedSources: [] };
}

export function vendorById(id?: string): MaterialVendor | undefined {
  return id ? db.vendors.find((v) => v.id === id) : undefined;
}

/** The project's next scheduled work day (today or later), if any. */
export function nextJobDate(projectId: string): string | undefined {
  const today = todayKey();
  return db.assignments
    .filter((a) => a.projectId === projectId && a.scheduledDate >= today && a.status !== 'cancelled' && a.status !== 'reassigned')
    .map((a) => a.scheduledDate)
    .sort()[0];
}

/** Why the reminder needs a look, or null when it's fine. */
export function reminderProblem(projectId: string): string | null {
  const plan = planFor(projectId);
  if (!plan.reminderAt) return null;
  const job = nextJobDate(projectId);
  if (plan.reminderJobDate && job && job !== plan.reminderJobDate) {
    return `The job moved from ${formatDocDate(plan.reminderJobDate)} to ${formatDocDate(job)}. Check the reminder.`;
  }
  if (plan.reminderJobDate && !job && plan.reminderJobDate >= todayKey()) {
    return `The job on ${formatDocDate(plan.reminderJobDate)} is no longer on the schedule. Check the reminder.`;
  }
  if (job && plan.reminderAt.slice(0, 10) > job) {
    return 'The reminder is after the job date.';
  }
  return null;
}

// ── Checklist ───────────────────────────────────────────────────────────────

export function addMaterial(input: {
  projectId: string;
  name: string;
  quantity?: number;
  unit?: string;
  status?: MaterialStatus;
  vendorId?: string;
  notes?: string;
  source?: MaterialSource;
}): ProjectMaterial {
  const list = materialsFor(input.projectId);
  const sortOrder = list.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1;
  return insertRow('project_materials', {
    ...input,
    name: input.name.trim(),
    unit: input.unit?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    status: input.status ?? 'to_order',
    sortOrder,
    createdBy: db.personId || undefined,
  }) as unknown as ProjectMaterial;
}

export function updateMaterial(id: string, patch: Partial<Pick<ProjectMaterial, 'name' | 'quantity' | 'unit' | 'status' | 'vendorId' | 'notes'>>) {
  updateRow('project_materials', id, patch);
}

/** Removes an item. A removed suggestion isn't suggested again. */
export function removeMaterial(m: ProjectMaterial) {
  deleteRow('project_materials', m.id);
  if (m.source) {
    const plan = planFor(m.projectId);
    const key = sourceKey(m.source);
    if (!plan.dismissedSources.includes(key)) savePlan(m.projectId, { dismissedSources: [...plan.dismissedSources, key] });
  }
}

export function moveMaterial(projectId: string, id: string, dir: -1 | 1) {
  const list = materialsFor(projectId).slice();
  const i = list.findIndex((m) => m.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((m, idx) => { if (m.sortOrder !== idx) updateRow('project_materials', m.id, { sortOrder: idx }); });
}

// ── Plan: vendor, pickup, reminder ──────────────────────────────────────────

export function savePlan(projectId: string, patch: Partial<Omit<MaterialPlan, 'projectId' | 'companyId'>>) {
  const current = planFor(projectId);
  upsertRow('project_material_plans', { ...current, ...patch, projectId, companyId: current.companyId || db.companyId });
}

/** Sets the prep reminder, remembering which job date it was set for. */
export function setReminder(projectId: string, at: Date, note?: string) {
  savePlan(projectId, { reminderAt: at.toISOString(), reminderJobDate: nextJobDate(projectId), reminderNote: note?.trim() || undefined });
}

export function clearReminder(projectId: string) {
  savePlan(projectId, { reminderAt: undefined, reminderJobDate: undefined, reminderNote: undefined });
}

/** A sensible first suggestion for the reminder: 8:00 AM three days before
 * the job (never in the past), or tomorrow 8:00 AM without a job date. */
export function defaultReminderDate(projectId: string): Date {
  const job = nextJobDate(projectId);
  const d = new Date();
  if (job) {
    const [y, m, day] = job.split('-').map(Number);
    d.setFullYear(y, m - 1, day - 3);
  } else {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(8, 0, 0, 0);
  if (d.getTime() < Date.now()) {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(8, 0, 0, 0);
    return t;
  }
  return d;
}

// ── Vendors ─────────────────────────────────────────────────────────────────

export type VendorInput = Pick<MaterialVendor, 'name'> & Partial<Pick<MaterialVendor, 'contactName' | 'phone' | 'email' | 'address' | 'pickupInstructions' | 'notes'>>;

const clean = (v: VendorInput) => ({
  name: v.name.trim(),
  contactName: v.contactName?.trim() || undefined,
  phone: v.phone?.trim() || undefined,
  email: v.email?.trim() || undefined,
  address: v.address?.trim() || undefined,
  pickupInstructions: v.pickupInstructions?.trim() || undefined,
  notes: v.notes?.trim() || undefined,
});

export function addVendor(v: VendorInput): MaterialVendor {
  return insertRow('material_vendors', clean(v)) as unknown as MaterialVendor;
}

export function updateVendor(id: string, v: VendorInput) {
  updateRow('material_vendors', id, clean(v));
}

export function deleteVendor(id: string) {
  deleteRow('material_vendors', id);
}

// ── Suggestions from approved documents ─────────────────────────────────────

/** Units that measure a material (normalised: lower case, no dots/plural s). */
const MATERIAL_UNITS = new Set([
  'ton', 'yd', 'cu yd', 'cuyd', 'cy', 'yard', 'cubic yard', 'bag', 'pallet', 'plant', 'flat', 'roll', 'gal', 'gallon',
  'bundle', 'bale', 'piece', 'pc', 'stone', 'block', 'paver', 'tree', 'shrub', 'lb', 'sq yd',
]);

const normUnit = (u?: string) => (u ?? '').toLowerCase().replace(/\./g, '').trim().replace(/s$/, '');

/** Whether a document line looks like a material, by the plain rules above. */
export function isMaterialLine(li: LineItem): boolean {
  if (li.category) return li.category === 'materials';
  return MATERIAL_UNITS.has(normUnit(li.unit));
}

const sourceKey = (s: Pick<MaterialSource, 'id' | 'lineItemId'>) => `${s.id}:${s.lineItemId}`;

export interface SuggestionResult {
  added: number;
  /** Documents the suggestions came from, e.g. ["Q-1001", "CO-1001"]. */
  from: string[];
  /** Approved documents exist but none of their lines looked like materials. */
  nothingFound: boolean;
  /** No approved quote or change order on the project. */
  noApproved: boolean;
}

/** Adds suggested materials from the project's approved quote(s) and approved
 * change orders. Lines already on the checklist (or removed before) are
 * skipped, so running it again after a change order adds only what's new. */
export function suggestMaterials(projectId: string): SuggestionResult {
  const docs: { type: 'quote' | 'change_order'; id: string; number: string; lineItems: LineItem[] }[] = [
    ...db.quotes.filter((q) => q.projectId === projectId && q.status === 'approved').map((q) => ({ type: 'quote' as const, ...q })),
    ...db.changeOrders.filter((c) => c.projectId === projectId && c.status === 'approved').map((c) => ({ type: 'change_order' as const, ...c })),
  ];
  const result: SuggestionResult = { added: 0, from: [], nothingFound: false, noApproved: docs.length === 0 };
  if (!docs.length) return result;

  const plan = planFor(projectId);
  const have = new Set([
    ...materialsFor(projectId).filter((m) => m.source).map((m) => sourceKey(m.source!)),
    ...plan.dismissedSources,
  ]);
  let anyMaterial = false;
  for (const d of docs) {
    for (const li of d.lineItems) {
      if (!isMaterialLine(li)) continue;
      anyMaterial = true;
      const source: MaterialSource = { type: d.type, id: d.id, number: d.number, lineItemId: li.id, quantity: li.quantity, unit: li.unit };
      if (have.has(sourceKey(source))) continue;
      const usable = li.quantity > 0 && normUnit(li.unit) !== 'lot';
      addMaterial({
        projectId,
        name: li.description,
        quantity: usable ? li.quantity : undefined,
        unit: usable ? li.unit : undefined,
        status: 'needs_review',
        source,
      });
      have.add(sourceKey(source));
      result.added++;
      if (!result.from.includes(d.number)) result.from.push(d.number);
    }
  }
  result.nothingFound = !anyMaterial;
  return result;
}

/** Approved quote / change order lines that would be suggested but aren't on
 * the checklist yet (e.g. after a new change order was approved). */
export function pendingSuggestionCount(projectId: string): number {
  const plan = planFor(projectId);
  const have = new Set([
    ...materialsFor(projectId).filter((m) => m.source).map((m) => sourceKey(m.source!)),
    ...plan.dismissedSources,
  ]);
  let n = 0;
  for (const d of [
    ...db.quotes.filter((q) => q.projectId === projectId && q.status === 'approved'),
    ...db.changeOrders.filter((c) => c.projectId === projectId && c.status === 'approved'),
  ]) {
    for (const li of d.lineItems) if (isMaterialLine(li) && !have.has(`${d.id}:${li.id}`)) n++;
  }
  return n;
}

// ── Sharing ─────────────────────────────────────────────────────────────────

/** Plain-text checklist for the share sheet (crew, vendor). Internal item
 * notes are left out; pickup instructions are included. */
export function checklistText(projectId: string, opts: { includeDone?: boolean } = {}): string {
  const project = db.projects.find((p) => p.id === projectId);
  const plan = planFor(projectId);
  const vendor = vendorById(plan.vendorId);
  const job = nextJobDate(projectId);
  const items = materialsFor(projectId).filter((m) => opts.includeDone || !isDone(m));
  const qty = (m: ProjectMaterial) => (m.quantity != null ? `${formatQuantity(m.quantity)}${m.unit ? ` ${m.unit}` : ''}` : 'qty TBD');

  const lines: string[] = [];
  lines.push(`Materials: ${project?.name ?? 'Project'}`);
  const addr = [project?.address, project?.city].filter(Boolean).join(', ');
  if (addr) lines.push(addr);
  if (job) lines.push(`Job date: ${formatDocDate(job)}`);
  lines.push('');
  if (items.length === 0) lines.push('Nothing left to prepare.');
  for (const m of items) {
    const v = m.vendorId && m.vendorId !== plan.vendorId ? vendorById(m.vendorId) : undefined;
    lines.push(`• ${m.name}: ${qty(m)} (${MATERIAL_STATUS_LABEL[m.status]})${v ? ` from ${v.name}` : ''}`);
  }
  if (vendor || plan.pickupLocation || plan.pickupInstructions || plan.handlingNotes) lines.push('');
  if (vendor) {
    lines.push(`Vendor: ${vendor.name}${vendor.phone ? `, ${vendor.phone}` : ''}`);
    if (vendor.address) lines.push(vendor.address);
  }
  if (plan.pickupLocation) lines.push(`Pickup: ${plan.pickupLocation}`);
  const instructions = plan.pickupInstructions ?? vendor?.pickupInstructions;
  if (instructions) lines.push(`Instructions: ${instructions}`);
  if (plan.handlingNotes) lines.push(`Handling: ${plan.handlingNotes}`);
  return lines.join('\n');
}

// ── Company-wide overview ───────────────────────────────────────────────────

export interface MaterialsOverviewRow {
  project: Project;
  nextJob?: string;
  total: number;
  done: number;
  outstanding: ProjectMaterial[];
  reminderAt?: string;
  reminderProblem: string | null;
  vendor?: MaterialVendor;
  pickupLocation?: string;
  /** Approved work with material lines not on the checklist yet. */
  newSuggestions: number;
}

/** Projects that need materials preparing: anything with a checklist, plus
 * open projects with an approved quote. Soonest job first. */
export function materialsOverview(): MaterialsOverviewRow[] {
  const rows: MaterialsOverviewRow[] = [];
  for (const project of db.projects) {
    if (project.status === 'archived') continue;
    const items = materialsFor(project.id);
    const plan = db.materialPlans[project.id];
    const approved = db.quotes.some((q) => q.projectId === project.id && q.status === 'approved');
    if (!items.length && !plan && !(approved && project.status !== 'completed')) continue;
    if (project.status === 'completed' && items.every(isDone)) continue;
    rows.push({
      project,
      nextJob: nextJobDate(project.id),
      total: items.length,
      done: items.filter(isDone).length,
      outstanding: items.filter((m) => !isDone(m)),
      reminderAt: plan?.reminderAt,
      reminderProblem: reminderProblem(project.id),
      vendor: vendorById(plan?.vendorId),
      pickupLocation: plan?.pickupLocation,
      newSuggestions: pendingSuggestionCount(project.id),
    });
  }
  return rows.sort((a, b) =>
    (a.nextJob ?? '9999').localeCompare(b.nextJob ?? '9999') || a.project.name.localeCompare(b.project.name));
}
