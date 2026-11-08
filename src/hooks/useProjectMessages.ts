import { useMemo, useCallback } from 'react';
import type { ProjectMessage } from '@/types/project';
import { db, useDb, insertRow, deleteRow } from '@/data/store';
import { notifyStaff, notifyPeople } from '@/data/actions';
import { customerMessageBody, customerMessageTitle } from '@/lib/notificationTarget';

/** The customer ↔ owner conversation on one project. */
export function useProjectMessages(projectId: string | undefined) {
  const v = useDb();
  const messages = useMemo<ProjectMessage[]>(() => (projectId ? db.messages[projectId] ?? [] : []), [projectId, v]);

  const send = useCallback((text: string) => {
    const body = text.trim();
    if (!projectId || !body) return;
    insertRow('project_messages', { projectId, senderId: db.personId, body });

    const project = db.projects.find((p) => p.id === projectId);
    const me = db.people[db.personId];
    const myName = me ? `${me.firstName} ${me.lastName}`.trim() : 'Someone';
    const preview = body.length > 120 ? `${body.slice(0, 117)}…` : body;
    const link = { type: 'project' as const, id: projectId };
    const iAmStaff = db.members.some((m) => m.personId === db.personId && (m.role === 'owner' || m.role === 'admin'));

    if (iAmStaff) {
      if (project?.customerId) {
        notifyPeople([project.customerId], 'customer_message', `New message from ${db.company?.name ?? 'your landscaper'}`, preview, link);
      }
    } else {
      notifyStaff('customer_message', customerMessageTitle(myName), customerMessageBody(project?.name, body), link, { customerId: db.personId, projectId });
    }
  }, [projectId]);

  const remove = useCallback((messageId: string) => {
    deleteRow('project_messages', messageId);
  }, []);

  return { messages, send, remove };
}
