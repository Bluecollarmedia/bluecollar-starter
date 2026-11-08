// Pure helpers for "Report content" (messages and shared photos). No network.
import { BUSINESS } from '@/legal/legalContent';

export type ReportReason = 'inappropriate' | 'harassment' | 'spam' | 'other';
export type ReportContentType = 'message' | 'photo';

export const REPORT_REASONS: { key: ReportReason; label: string; hint: string }[] = [
  { key: 'inappropriate', label: 'Inappropriate or offensive', hint: 'Content that should not be here' },
  { key: 'harassment', label: 'Harassment or abuse', hint: 'Threats, insults or bullying' },
  { key: 'spam', label: 'Spam or not relevant', hint: 'Ads, junk or unrelated content' },
  { key: 'other', label: 'Something else', hint: 'Tell us in the details' },
];

export const reasonLabel = (r: string) => REPORT_REASONS.find((x) => x.key === r)?.label ?? 'Reported';
export const contentLabel = (t: string) => (t === 'photo' ? 'photo' : 'message');

export const MAX_REPORT_DETAILS = 500;

/** '' when the report can be sent, otherwise what is missing. */
export function reportProblem(reason: ReportReason | null, details: string): string {
  if (!reason) return 'Pick a reason.';
  if (reason === 'other' && !details.trim()) return 'Tell us what is wrong.';
  if (details.length > MAX_REPORT_DETAILS) return `Keep the details under ${MAX_REPORT_DETAILS} characters.`;
  return '';
}

/** A ready-to-send email to support, used when the report can't be saved in the app (for example before SQL 049 is run). */
export function reportMailto(input: { type: ReportContentType; reason: ReportReason; details?: string; where?: string }): string {
  const subject = `Report: ${contentLabel(input.type)} (${reasonLabel(input.reason)})`;
  const body = [
    `I want to report a ${contentLabel(input.type)}${input.where ? ` in "${input.where}"` : ''}.`,
    `Reason: ${reasonLabel(input.reason)}`,
    input.details?.trim() ? `Details: ${input.details.trim()}` : '',
  ].filter(Boolean).join('\n');
  return `mailto:${BUSINESS.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export interface ReportRow {
  id: string;
  project_id: string;
  reported_by: string;
  content_type: ReportContentType;
  content_id: string;
  reason: ReportReason;
  details: string | null;
  status: 'open' | 'handled';
  handled_note: string | null;
  created_at: string;
}

/** Open reports first, newest first within each group. */
export function sortReports<T extends { status: string; created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.status === b.status ? b.created_at.localeCompare(a.created_at) : a.status === 'open' ? -1 : 1));
}
