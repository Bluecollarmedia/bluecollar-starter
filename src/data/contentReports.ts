/**
 * Report content (supabase/updates/049): report a message or a shared photo, and for the owner/admin to see,
 * act on and mark handled. Direct database calls (not the shared store) so a database that has not had
 * update 49 yet keeps working everywhere else; reporting then falls back to an email to support.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { reportMailto, reportProblem, sortReports, type ReportContentType, type ReportReason, type ReportRow } from '@/lib/contentReports';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string; needsUpdate?: boolean; mailto?: string };

const NEEDS_UPDATE = 'Reporting inside the app is not switched on yet. You can email us instead.';
const isMissingTable = (msg: string | undefined) => /content_reports/i.test(msg ?? '') && /(does not exist|schema cache|could not find)/i.test(msg ?? '');

export interface SubmitInput {
  projectId: string;
  type: ReportContentType;
  contentId: string;
  reason: ReportReason | null;
  details?: string;
  /** Shown in the fallback email, e.g. the project name. */
  where?: string;
}

/** Sends a report. A second report of the same item by the same person counts as sent. */
export async function submitReport(input: SubmitInput, me: string | undefined): Promise<Result> {
  const problem = reportProblem(input.reason, input.details ?? '');
  if (problem) return { ok: false, error: problem };
  const reason = input.reason as ReportReason;
  const mailto = reportMailto({ type: input.type, reason, details: input.details, where: input.where });
  if (!isSupabaseConfigured || !me) return { ok: false, error: NEEDS_UPDATE, needsUpdate: true, mailto };
  const { error } = await supabase.from('content_reports').insert({
    project_id: input.projectId,
    reported_by: me,
    content_type: input.type,
    content_id: input.contentId,
    reason,
    details: input.details?.trim() || null,
  });
  if (!error) return { ok: true, data: undefined };
  if (error.code === '23505' || /duplicate key|unique/i.test(error.message)) return { ok: true, data: undefined };
  if (isMissingTable(error.message)) return { ok: false, error: NEEDS_UPDATE, needsUpdate: true, mailto };
  return { ok: false, error: error.message, mailto };
}

export interface ReportItem extends ReportRow {
  body?: string;
  photoUrl?: string;
  photoCaption?: string;
  /** The message or photo was already removed. */
  gone: boolean;
}

/** Owner/admin: every report with the reported message or photo, open ones first. */
export async function loadReports(): Promise<Result<ReportItem[]>> {
  if (!isSupabaseConfigured) return { ok: true, data: [] };
  const { data, error } = await supabase.from('content_reports').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) {
    if (isMissingTable(error.message)) return { ok: true, data: [] };
    return { ok: false, error: error.message };
  }
  const rows = (data ?? []) as ReportRow[];
  const ids = (t: ReportContentType) => rows.filter((r) => r.content_type === t).map((r) => r.content_id);
  const msgIds = ids('message');
  const photoIds = ids('photo');
  const [msgs, photos] = await Promise.all([
    msgIds.length ? supabase.from('project_messages').select('id, body').in('id', msgIds) : Promise.resolve({ data: [] as any[] }),
    photoIds.length ? supabase.from('project_photos').select('id, file_url, caption').in('id', photoIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const msgById = new Map<string, any>((msgs.data ?? []).map((m: any) => [m.id, m]));
  const photoById = new Map<string, any>((photos.data ?? []).map((p: any) => [p.id, p]));
  const items: ReportItem[] = rows.map((r) => {
    const m = r.content_type === 'message' ? msgById.get(r.content_id) : undefined;
    const p = r.content_type === 'photo' ? photoById.get(r.content_id) : undefined;
    return { ...r, body: m?.body, photoUrl: p?.file_url, photoCaption: p?.caption ?? undefined, gone: !(m || p) };
  });
  return { ok: true, data: sortReports(items) };
}

/** Marks a report handled. With `removeContent`, also deletes the message / stops sharing the photo first. */
export async function handleReport(report: ReportItem, opts: { removeContent: boolean; note?: string }): Promise<Result> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Needs the live database.' };
  if (opts.removeContent && !report.gone) {
    if (report.content_type === 'message') {
      const { error } = await supabase.from('project_messages').delete().eq('id', report.content_id);
      if (error) return { ok: false, error: `Couldn't remove the message: ${error.message}` };
    } else {
      const { error } = await supabase.from('project_photos')
        .update({ is_customer_visible: false, shared_by: null, shared_at: null }).eq('id', report.content_id);
      if (error) return { ok: false, error: `Couldn't stop sharing the photo: ${error.message}` };
    }
  }
  const { error } = await supabase.from('content_reports')
    .update({ status: 'handled', handled_note: opts.note?.trim() || (opts.removeContent ? 'Content removed' : null) })
    .eq('id', report.id);
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}

/** Reports for the owner's list, refreshed on demand. */
export function useReports() {
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await loadReports();
    if (res.ok) { setItems(res.data); setError(null); } else setError(res.error);
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { items, loading, error, refresh };
}

/** Number of open reports, for the badge on the More tab. 0 when the update is not installed. */
export function useOpenReportCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    if (!isSupabaseConfigured) return;
    supabase.from('content_reports').select('id', { count: 'exact', head: true }).eq('status', 'open')
      .then(({ count, error }) => { if (live && !error) setN(count ?? 0); });
    return () => { live = false; };
  }, []);
  return n;
}
