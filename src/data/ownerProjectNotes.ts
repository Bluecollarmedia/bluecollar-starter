/**
 * The owner's private notes, pictures and materials lists for a project (supabase/updates/057). They belong to the project, so
 * notes written while quoting are still there when the quote is approved and the project is running. Only the company owner can
 * read or change any of it: the database enforces it, and the screens only show it to the owner.
 */
import { useMemo } from 'react';
import { db, useDb, insertRow, updateRow, deleteRow, rowsOf } from '@/data/store';
import { uploadImage, removeMedia } from '@/lib/media';
import { noteProblem } from '@/lib/truckDocs';
import { sortNotesLocally } from '@/lib/sortNotes';
import { MAX_SOURCE_CHARS, listToStored, normalizeMaterialList, notesAsText, type MaterialList } from '@/lib/materialList';
import type { OwnerMaterialList, OwnerProjectNote, OwnerProjectPhoto } from '@/types/project';

export type Result = { ok: true } | { ok: false; error: string };

/** Whether this person may see the private notes (the company owner). */
export function useIsProjectOwner(): boolean {
  useDb();
  return db.role === 'owner';
}

const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

export function useOwnerNotes(projectId: string | undefined): OwnerProjectNote[] {
  const v = useDb();
  return useMemo(() => (rowsOf('owner_project_notes') as unknown as OwnerProjectNote[]).filter((n) => n.projectId === projectId).sort(byNewest), [projectId, v]);
}
export function useOwnerPhotos(projectId: string | undefined): OwnerProjectPhoto[] {
  const v = useDb();
  return useMemo(() => (rowsOf('owner_project_photos') as unknown as OwnerProjectPhoto[]).filter((n) => n.projectId === projectId).sort(byNewest), [projectId, v]);
}
export function useOwnerMaterialLists(projectId: string | undefined): OwnerMaterialList[] {
  const v = useDb();
  return useMemo(() => (rowsOf('owner_material_lists') as unknown as OwnerMaterialList[]).filter((n) => n.projectId === projectId).sort(byNewest), [projectId, v]);
}

export function addOwnerNote(projectId: string, body: string): Result {
  const problem = noteProblem(body);
  if (problem) return { ok: false, error: problem };
  insertRow('owner_project_notes', { projectId, body: body.trim(), createdBy: db.personId });
  return { ok: true };
}
export function updateOwnerNote(id: string, body: string): Result {
  const problem = noteProblem(body);
  if (problem) return { ok: false, error: problem };
  updateRow('owner_project_notes', id, { body: body.trim() });
  return { ok: true };
}
export const deleteOwnerNote = (id: string) => deleteRow('owner_project_notes', id);

/** Uploads a picture the owner took or chose, then saves it on the project. */
export async function addOwnerPhoto(projectId: string, localUri: string, caption?: string): Promise<Result> {
  try {
    const { url, key } = await uploadImage(localUri, `${db.companyId}/projects/${projectId}/private`);
    insertRow('owner_project_photos', { projectId, fileUrl: url, fileKey: key, caption: caption?.trim() || undefined, createdBy: db.personId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The picture couldn't be uploaded." };
  }
}
export function updateOwnerPhotoCaption(id: string, caption: string) {
  updateRow('owner_project_photos', id, { caption: caption.trim() || null } as Record<string, unknown>);
}
export function removeOwnerPhoto(photo: OwnerProjectPhoto) {
  deleteRow('owner_project_photos', photo.id);
  if (photo.fileKey && !/^https?:\/\//i.test(photo.fileKey)) removeMedia(photo.fileKey).catch(() => {});
}

export const deleteMaterialList = (id: string) => deleteRow('owner_material_lists', id);

/** Sorts all of this project's notes into a materials list on the phone (no AI, no account) and saves it. */
export function organizeMaterials(projectId: string, projectName: string): { ok: true; list: MaterialList } | { ok: false; error: string } {
  const notes = (rowsOf('owner_project_notes') as unknown as OwnerProjectNote[]).filter((n) => n.projectId === projectId);
  const text = notesAsText(notes);
  if (!text.trim()) return { ok: false, error: 'Write some notes first, then sort them.' };
  if (text.length > MAX_SOURCE_CHARS) return { ok: false, error: `Your notes are too long to sort at once (the limit is about ${MAX_SOURCE_CHARS} characters). Delete old notes or sort them in parts.` };
  const list = normalizeMaterialList(sortNotesLocally(text, projectName), `${projectName} materials`);
  if (list.items.length === 0 && list.otherNotes.length === 0) return { ok: false, error: "The notes didn't have any materials in them yet." };
  insertRow('owner_material_lists', { projectId, title: list.title, items: listToStored(list), sourceText: text, createdBy: db.personId });
  return { ok: true, list };
}
