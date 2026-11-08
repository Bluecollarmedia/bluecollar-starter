/**
 * A maintenance service while it is being added or edited: the form's working copy, and how it becomes a saved rule.
 * Shared by the full property form and the short "Add Service" screen, so both offer the same choices.
 *
 * "How often" has exactly three choices: every week, every N days, or a set number of visits. (Older services saved with another schedule
 * keep working and are shown as they are; they are just not offered for new ones.)
 */
import { todayKey } from '@/lib/ids';
import { spreadDates, cleanDates } from '@/lib/serviceDates';
import type { ServiceRuleInput } from '@/data/maintenance';
import { SERVICE_TYPES, type MaintenanceServiceRule, type ServiceFrequency } from '@/types/maintenance';

export interface ServiceDraft {
  key: string;
  /** Set for saved rules. */
  id?: string;
  serviceType: string;
  label: string;
  frequency: ServiceFrequency;
  intervalDays: string;
  startsOn?: string;
  windowStart?: string;
  windowEnd?: string;
  /** For "Set number of visits": the exact dates, and the span they were spread across. */
  scheduledDates: string[];
  spreadFrom?: string;
  spreadTo?: string;
  seasonQuantity: string;
  priorCompletedCount: string;
  lastCompletedOn?: string;
  requiresPhotos: boolean;
  minPhotos: number;
  /** One checklist item per line. */
  checklist: string;
  instructions: string;
  isActive: boolean;
}

/** The three ways to say how often. */
export const FREQUENCIES: { key: ServiceFrequency; label: string }[] = [
  { key: 'weekly', label: 'Every week' },
  { key: 'every_n_days', label: 'Every N days' },
  { key: 'fixed_dates', label: 'Set number of visits' },
];

/** Names for schedules saved before there were only three choices (shown when such a service is opened; not offered for new ones). */
export const LEGACY_FREQUENCY_LABELS: Partial<Record<ServiceFrequency, string>> = {
  biweekly: 'Every 2 weeks',
  seasonal_window: 'Once, in a date range',
  as_needed: 'As needed',
};

/**
 * Where "Set number of visits" spreads the visits when nothing else says: from today (or the season start, if it is still ahead) to the
 * season end, or the end of November when the contract has no end date.
 */
export function defaultSpan(seasonStart: string | undefined, seasonEnd: string | undefined, today = todayKey()): { start: string; end: string } {
  const start = seasonStart && seasonStart > today ? seasonStart : today;
  let end = seasonEnd && seasonEnd >= start ? seasonEnd : `${start.slice(0, 4)}-11-30`;
  if (end < start) end = `${Number(start.slice(0, 4)) + 1}-11-30`;
  return { start, end };
}

/** The visit dates for a draft with `seasonQuantity` visits, spread evenly across the default span. */
export function spreadForDraft(d: Pick<ServiceDraft, 'seasonQuantity'>, seasonStart?: string, seasonEnd?: string): string[] {
  const { start, end } = defaultSpan(seasonStart, seasonEnd);
  return spreadDates(start, end, toInt(d.seasonQuantity) ?? 0);
}

/**
 * Starting values when the owner picks a service type. Only suggestions to save typing; every field stays editable.
 * Lawn cuts repeat weekly; everything else starts as one visit (change the number if it happens more than once).
 */
export function suggestedFor(type: string): Partial<ServiceDraft> {
  return type === 'lawn_cut' ? { frequency: 'weekly' } : { frequency: 'fixed_dates', seasonQuantity: '1' };
}

let draftSeq = 0;
const nextKey = () => `draft-${++draftSeq}`;

export function newDraft(type: string, seasonStart?: string, seasonEnd?: string): ServiceDraft {
  const t = SERVICE_TYPES.find((s) => s.key === type);
  const d: ServiceDraft = {
    key: nextKey(),
    serviceType: type,
    label: t && type !== 'other' ? t.label : '',
    frequency: 'weekly',
    intervalDays: '',
    scheduledDates: [],
    seasonQuantity: '',
    priorCompletedCount: '',
    requiresPhotos: false,
    minPhotos: 1,
    checklist: '',
    instructions: '',
    isActive: true,
    ...suggestedFor(type),
  };
  if (d.frequency === 'fixed_dates') d.scheduledDates = spreadForDraft(d, seasonStart, seasonEnd);
  return d;
}

export function draftFromRule(r: MaintenanceServiceRule): ServiceDraft {
  return {
    key: r.id,
    id: r.id,
    serviceType: r.serviceType,
    label: r.label,
    frequency: r.frequency,
    intervalDays: r.intervalDays != null ? String(r.intervalDays) : '',
    startsOn: r.startsOn,
    windowStart: r.windowStart,
    windowEnd: r.windowEnd,
    scheduledDates: cleanDates(r.scheduledDates),
    spreadFrom: cleanDates(r.scheduledDates)[0],
    spreadTo: cleanDates(r.scheduledDates).slice(-1)[0],
    seasonQuantity: r.seasonQuantity != null ? String(r.seasonQuantity) : '',
    priorCompletedCount: r.priorCompletedCount ? String(r.priorCompletedCount) : '',
    lastCompletedOn: r.lastCompletedOn,
    requiresPhotos: r.requiresPhotos,
    minPhotos: r.minPhotos ?? 1,
    checklist: r.defaultChecklist.join('\n'),
    instructions: r.instructions ?? '',
    isActive: r.isActive,
  };
}

export const toInt = (s: string): number | undefined => {
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
};

export function draftToInput(d: ServiceDraft, sortOrder: number): ServiceRuleInput {
  const window = d.frequency === 'seasonal_window';
  const fixed = d.frequency === 'fixed_dates';
  const fixedDates = fixed ? cleanDates(d.scheduledDates) : [];
  const repeating = d.frequency === 'weekly' || d.frequency === 'biweekly' || d.frequency === 'every_n_days';
  return {
    serviceType: d.serviceType,
    label: d.label.trim(),
    frequency: d.frequency,
    // Clear fields that don't apply to the chosen frequency, so an old value
    // can't quietly change the due date.
    intervalDays: d.frequency === 'every_n_days' ? toInt(d.intervalDays) : undefined,
    startsOn: repeating ? d.startsOn : undefined,
    windowStart: window ? d.windowStart : undefined,
    windowEnd: window ? d.windowEnd : undefined,
    scheduledDates: fixed ? fixedDates : undefined,
    // For a set number of visits the count is always the number of saved dates.
    seasonQuantity: d.frequency === 'as_needed' ? undefined : fixed ? fixedDates.length : toInt(d.seasonQuantity),
    priorCompletedCount: toInt(d.priorCompletedCount) ?? 0,
    lastCompletedOn: d.lastCompletedOn,
    requiresPhotos: d.requiresPhotos,
    minPhotos: Math.max(1, Math.min(20, d.minPhotos || 1)),
    defaultChecklist: d.checklist.split('\n').map((s) => s.trim()).filter(Boolean),
    instructions: d.instructions.trim() || undefined,
    isActive: d.isActive,
    sortOrder,
  };
}

