import { useCallback } from 'react';
import { db, updateRow, useDb } from '@/data/store';
import type { CustomerProjectAccess } from '@/types/project';

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
