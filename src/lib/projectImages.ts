import type { Project } from '@/types/project';
import { db } from '@/data/store';

/**
 * A project's picture: the owner's own cover photo, or undefined when none
 * was added (screens then show the Brighton green backdrop via BrandCover).
 */
export function getProjectImageUri(project: Pick<Project, 'id' | 'coverPhotoUrl'>): string | undefined {
  return project.coverPhotoUrl || undefined;
}

/** Projects looked up by id, for screens that only have an assignment's project id. */
export function getProjectImageUriById(projectId: string | undefined): string | undefined {
  const project = projectId ? db.projects.find((p) => p.id === projectId) : undefined;
  return project ? getProjectImageUri(project) : undefined;
}

/** The dashboard header photo: the company's own, or undefined for the Brighton green backdrop. */
export function getCompanyImageUri(): string | undefined {
  return db.company?.coverPhotoUrl || undefined;
}

/** The workers' home header photo the owner picked, or undefined for the Brighton green backdrop. */
export function getWorkerHeaderImageUri(): string | undefined {
  return db.company?.workerCoverPhotoUrl || undefined;
}
