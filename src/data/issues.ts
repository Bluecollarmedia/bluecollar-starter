/**
 * "Report a problem": a worker reports something at a job (project) with
 * photos and notes. Owner/admin see every
 * report, mark them Resolved and can delete them (supabase/setup.sql).
 */

import { tr } from '@/i18n';
import { useMemo } from 'react';
import { db, insertRow, updateRow, deleteRow, rowsOf, useDb } from './store';
import { uploadImage } from '@/lib/media';
import { w } from '@/config/brand';

export type IssueType = 'tree_down' | 'damage' | 'safety' | 'equipment' | 'customer_request' | 'other';

export const ISSUE_TYPES: { key: IssueType; label: string; icon: string }[] = [
  { key: 'tree_down', label: 'Tree down', icon: 'alert-triangle' },
  { key: 'damage', label: 'Damage', icon: 'alert-octagon' },
  { key: 'safety', label: 'Safety hazard', icon: 'alert-circle' },
  { key: 'equipment', label: 'Equipment', icon: 'tool' },
  { key: 'customer_request', label: 'Customer request', icon: 'message-square' },
  { key: 'other', label: 'Other', icon: 'flag' },
];

export const issueTypeLabel = (t: string) => ISSUE_TYPES.find((x) => x.key === t)?.label ?? 'Problem';

export interface IssuePhoto { url: string; key: string }

export interface PropertyIssue {
  id: string;
  companyId: string;
  reportedBy?: string;
  reporterName: string;
  issueType: IssueType;
  notes?: string;
  photos: IssuePhoto[];
  projectId?: string;
  placeName: string;
  status: 'open' | 'resolved';
  resolvedBy?: string;
  resolvedByName?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  createdAt: string;
}

export type IssueWhere = { projectId: string };

function shape(r: Record<string, any>): PropertyIssue {
  const nameOf = (id?: string) => {
    const p = id ? db.people[id] : undefined;
    return p ? `${p.firstName} ${p.lastName}`.trim() : '';
  };
  return {
    ...(r as PropertyIssue),
    photos: Array.isArray(r.photos) ? r.photos : [],
    reporterName: nameOf(r.reportedBy) || w('A crew member'),
    resolvedByName: nameOf(r.resolvedBy) || undefined,
  };
}

/** Newest first. Pass `where` to see only one project's reports. */
export function useIssues(where?: IssueWhere): PropertyIssue[] {
  return useMemoIssues(useDb(), where);
}

function useMemoIssues(version: number, where?: IssueWhere): PropertyIssue[] {
  const pr = where?.projectId;
  return useMemo(
    () => rowsOf('property_issues')
      .filter((r) => (pr ? r.projectId === pr : true))
      .map(shape)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, pr],
  );
}

export function useOpenIssueCount(): number {
  const version = useDb();
  return useMemo(
    () => rowsOf('property_issues').filter((r) => r.status === 'open').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
}

/** The name shown for where a report was made. */
export function placeNameFor(where: IssueWhere): string {
  return db.projects.find((p) => p.id === where.projectId)?.name ?? '';
}

export interface ReportInput {
  where: IssueWhere;
  type: IssueType;
  notes?: string;
  /** Local photo URIs from the camera or library. */
  photoUris: string[];
}

/** Uploads the photos, then saves the report. Resolves with an error message on failure. */
export async function reportIssue(input: ReportInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const placeId = input.where.projectId;
  const photos: IssuePhoto[] = [];
  try {
    for (const uri of input.photoUris) {
      const { url, key } = await uploadImage(uri, `${db.companyId}/issues/${placeId}`);
      photos.push({ url, key });
    }
  } catch (err) {
    return { ok: false, error: `${tr("A photo couldn't be uploaded.")} ${err instanceof Error ? err.message : ''}`.trim() };
  }
  insertRow('property_issues', {
    reportedBy: db.personId,
    issueType: input.type,
    notes: input.notes?.trim() || undefined,
    photos,
    projectId: input.where.projectId,
    placeName: placeNameFor(input.where),
    status: 'open',
  });
  return { ok: true };
}

export function resolveIssue(id: string, note?: string) {
  updateRow('property_issues', id, {
    status: 'resolved', resolvedBy: db.personId, resolvedAt: new Date().toISOString(), resolutionNote: note?.trim() || undefined,
  });
}

export function reopenIssue(id: string) {
  updateRow('property_issues', id, { status: 'open', resolvedBy: null, resolvedAt: null, resolutionNote: null });
}

export function deleteIssue(id: string) {
  deleteRow('property_issues', id);
}

/** Takes one photo off a report (owner/admin, or the person who reported it). The report stays. */
export function removeIssuePhoto(issueId: string, photoKey: string) {
  const issue = rowsOf('property_issues').find((r) => r.id === issueId) as { photos?: { key?: string; url: string }[] } | undefined;
  if (!issue) return;
  updateRow('property_issues', issueId, { photos: (issue.photos ?? []).filter((p) => (p.key || p.url) !== photoKey) });
}
