import { useCallback } from 'react';
import { db, updateRow, useDb } from '@/data/store';
import type { CustomerProjectAccess } from '@/types/project';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A fresh 8-character customer portal code (no 0/O/1/I to avoid mix-ups). */
export function generateProjectCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

export function useCustomerAccess() {
  useDb();

  const getAccessForProject = useCallback((projectId: string): CustomerProjectAccess | null => {
    const project = db.projects.find((p) => p.id === projectId);
    if (!project) return null;
    const settings = db.settings[projectId];
    const claimedPerson = project.customerClaimedBy ? db.people[project.customerClaimedBy] : undefined;

    return {
      projectId: project.id,
      projectName: project.name,
      code: project.customerProjectCode ?? '',
      portalEnabled: settings?.customerInteractionEnabled ?? false,
      claimedBy: project.customerClaimedBy,
      claimedByEmail: claimedPerson?.email,
      claimedAt: project.customerClaimedAt,
    };
  }, []);

  /** Removes the customer's access to this project. */
  const revokeAccess = useCallback(async (projectId: string): Promise<void> => {
    updateRow('projects', projectId, {
      customerClaimedBy: undefined,
      customerClaimedAt: undefined,
      customerId: undefined,
    });
  }, []);

  return { getAccessForProject, revokeAccess };
}
