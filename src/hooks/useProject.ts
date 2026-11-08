import { useMemo, useCallback } from 'react';
import type { Project, ProjectTask, ProjectSettings, ProjectPhoto, ProjectUpdate, ProjectRequest, RequestStatus } from '@/types/project';
import { db, useDb, insertRow, updateRow, deleteRow, findRow } from '@/data/store';
import { logProjectHistory, addCustomerTimeline, addProjectPhoto, notifyStaff, type NewPhoto } from '@/data/actions';

const STATUS_LABELS: Record<string, string> = {
  prospect: 'Prospect',
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
  archived: 'Archived',
};

export function useProject(projectId: string) {
  const v = useDb();

  const project = useMemo(() => db.projects.find((p) => p.id === projectId) ?? null, [projectId, v]);
  const tasks = useMemo(() => db.tasks[projectId] ?? [], [projectId, v]);
  const team = useMemo(() => db.team[projectId] ?? [], [projectId, v]);
  const settings = useMemo(() => db.settings[projectId] ?? null, [projectId, v]);
  const photos = useMemo(() => db.photos[projectId] ?? [], [projectId, v]);
  const history = useMemo(
    () => (db.history[projectId] ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [projectId, v],
  );
  const updates = useMemo(
    () => (db.updates[projectId] ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [projectId, v],
  );
  const requests = useMemo(
    () => (db.requests[projectId] ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [projectId, v],
  );
  const customerTimeline = useMemo(
    () => (db.customerTimeline[projectId] ?? []).slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [projectId, v],
  );

  // ── Project ──

  /** Saves edits to the project itself (status, progress, notes, details). */
  const updateProject = useCallback((patch: Partial<Project>) => {
    const before = findRow('projects', projectId);
    if (!before) return;
    const changes: Partial<Project> = { ...patch };
    if (patch.status === 'completed' && before.status !== 'completed') changes.completedAt = new Date().toISOString();
    if (patch.status && patch.status !== 'completed' && before.status === 'completed') changes.completedAt = undefined;
    updateRow('projects', projectId, changes);

    if (patch.status && patch.status !== before.status) {
      logProjectHistory(projectId, 'status_changed', `Status changed to ${STATUS_LABELS[patch.status] ?? patch.status}`, {
        from: before.status, to: patch.status,
      });
      if (patch.status === 'completed') addCustomerTimeline(projectId, 'project_completed', 'Project completed');
      if (patch.status === 'active' && before.status !== 'active' && !before.startDate) {
        addCustomerTimeline(projectId, 'project_started', 'Work has started');
      }
    }
    if (patch.progress != null && patch.progress !== before.progress) {
      logProjectHistory(projectId, 'progress_updated', `Progress updated to ${patch.progress}%`, {
        from: before.progress ?? 0, to: patch.progress,
      });
      addCustomerTimeline(projectId, 'progress_updated', `Project is ${patch.progress}% complete`);
    }
    if (patch.notes !== undefined && patch.notes !== before.notes) {
      logProjectHistory(projectId, 'note_added', 'Project notes updated');
    }
  }, [projectId]);

  // ── Tasks ──

  const addTask = useCallback((input: Omit<ProjectTask, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>) => {
    const { assignee, ...values } = input as ProjectTask;
    const row = insertRow('project_tasks', {
      ...values,
      projectId,
      sortOrder: values.sortOrder ?? (db.tasks[projectId]?.length ?? 0),
    }) as unknown as ProjectTask;
    logProjectHistory(projectId, 'task_created', `Task added: ${input.title}`, { taskId: row.id });
    return row;
  }, [projectId]);

  const updateTask = useCallback((taskId: string, patch: Partial<ProjectTask>) => {
    const before = findRow('project_tasks', taskId);
    const changes: Partial<ProjectTask> = { ...patch };
    delete changes.assignee;
    delete changes.completer;
    // The database stamps the real time and person (update 016); these keep
    // the screen right until the saved row comes back.
    if (patch.status === 'completed' && before?.status !== 'completed') {
      changes.completedAt = new Date().toISOString();
      changes.completedBy = db.personId || undefined;
    }
    if (patch.status && patch.status !== 'completed') {
      changes.completedAt = undefined;
      changes.completedBy = undefined;
    }
    updateRow('project_tasks', taskId, changes);
    if (patch.status === 'completed' && before?.status !== 'completed') {
      logProjectHistory(projectId, 'task_completed', `Task completed: ${before?.title ?? ''}`.trim(), { taskId });
    }
  }, [projectId]);

  // ── Team ──

  const addTeamMember = useCallback((personId: string) => {
    if ((db.team[projectId] ?? []).some((tm) => tm.personId === personId)) return;
    insertRow('project_team', { projectId, personId, addedAt: new Date().toISOString() });
    const p = db.people[personId];
    logProjectHistory(projectId, 'team_member_added', `${p ? `${p.firstName} ${p.lastName}`.trim() : 'Team member'} added to the team`, { personId });
  }, [projectId]);

  const removeTeamMember = useCallback((personId: string) => {
    const row = (db.team[projectId] ?? []).find((tm) => tm.personId === personId);
    if (!row) return;
    deleteRow('project_team', row.id);
    const p = db.people[personId];
    logProjectHistory(projectId, 'team_member_removed', `${p ? `${p.firstName} ${p.lastName}`.trim() : 'Team member'} removed from the team`, { personId });
  }, [projectId]);

  // ── Customer settings ──

  const updateSettings = useCallback((patch: Partial<ProjectSettings>) => {
    const existing = db.settings[projectId];
    if (existing) {
      updateRow('project_settings', existing.id, patch);
    } else {
      insertRow('project_settings', {
        projectId,
        customerInteractionEnabled: false,
        completionPhotoRequired: false,
        customerCanRequest: true,
        customerCanViewPhotos: true,
        customerCanComment: true,
        ...patch,
      });
    }
    logProjectHistory(projectId, 'settings_changed', 'Customer settings updated');
  }, [projectId]);

  // ── Photos ──

  const addPhoto = useCallback((input: Omit<NewPhoto, 'projectId'> & { projectId?: string }) => {
    const photo = addProjectPhoto({ ...input, projectId } as NewPhoto);
    logProjectHistory(projectId, 'photo_added', input.caption ? `Photo added: ${input.caption}` : 'Photo added', { photoId: photo.id });
    if (input.isCustomerVisible) {
      addCustomerTimeline(projectId, 'photo_shared', input.customerDescription || input.caption || 'New photo', undefined, input.fileUrl);
    }
    return photo;
  }, [projectId]);

  const updatePhoto = useCallback((photoId: string, patch: Partial<ProjectPhoto>) => {
    const before = findRow('project_photos', photoId);
    const { uploader, sharer, taskTitle, ...changes } = patch;
    updateRow('project_photos', photoId, changes);
    if (patch.isCustomerVisible && !before?.isCustomerVisible) {
      addCustomerTimeline(
        projectId,
        'photo_shared',
        patch.customerDescription || before?.customerDescription || before?.caption || 'New photo',
        undefined,
        before?.fileUrl,
      );
    }
  }, [projectId]);

  const deletePhoto = useCallback((photoId: string) => {
    deleteRow('project_photos', photoId);
  }, []);

  // ── Updates & requests ──

  const postUpdate = useCallback((input: { title: string; body: string; isCustomerVisible: boolean; photoIds?: string[] }) => {
    const row = insertRow('project_updates', {
      projectId,
      createdBy: db.personId,
      title: input.title,
      body: input.body,
      isCustomerVisible: input.isCustomerVisible,
      photoIds: input.photoIds ?? [],
    }) as unknown as ProjectUpdate;
    logProjectHistory(projectId, 'update_posted', `Update posted: ${input.title}`, { updateId: row.id });
    if (input.isCustomerVisible) addCustomerTimeline(projectId, 'update_shared', input.title, input.body);
    return row;
  }, [projectId]);

  /** Customer sends a request from their portal. */
  const submitRequest = useCallback((input: Pick<ProjectRequest, 'title' | 'category'> & { description?: string; attachmentUrl?: string }) => {
    const row = insertRow('project_requests', {
      projectId,
      requestedBy: db.personId,
      status: 'pending',
      ...input,
    }) as unknown as ProjectRequest;
    logProjectHistory(projectId, 'request_created', `Customer request: ${input.title}`, { requestId: row.id });
    const projectName = db.projects.find((p) => p.id === projectId)?.name ?? 'a project';
    notifyStaff('customer_request_submitted', 'New customer request', `${input.title} (${projectName})`, { type: 'project', id: projectId });
    return row;
  }, [projectId]);

  /** Owner responds to a customer request. */
  const respondToRequest = useCallback((requestId: string, status: RequestStatus, responseNote?: string, linkedTaskId?: string) => {
    const before = findRow('project_requests', requestId);
    updateRow('project_requests', requestId, {
      status,
      respondedAt: new Date().toISOString(),
      ...(responseNote !== undefined ? { responseNote } : {}),
      ...(linkedTaskId ? { linkedTaskId } : {}),
    });
    const verb: Record<string, string> = {
      acknowledged: 'acknowledged', completed: 'completed', declined: 'declined', converted: 'turned into a task',
    };
    const title = before?.title ?? 'Request';
    logProjectHistory(projectId, 'request_responded', `Request ${verb[status] ?? status}: ${title}`, { requestId, status });
    if (status !== 'pending') {
      addCustomerTimeline(projectId, 'request_responded', `Your request was ${verb[status] ?? status}`, responseNote || title);
    }
  }, [projectId]);

  /** Owner fixes the wording of a response already sent. */
  const editRequestResponse = useCallback((requestId: string, responseNote: string) => {
    updateRow('project_requests', requestId, { responseNote: responseNote.trim() || undefined });
  }, []);

  /** Puts a handled request back in the pending list. */
  const reopenRequest = useCallback((requestId: string) => {
    const before = findRow('project_requests', requestId);
    updateRow('project_requests', requestId, { status: 'pending', respondedAt: undefined });
    logProjectHistory(projectId, 'request_responded', `Request reopened: ${before?.title ?? 'Request'}`, { requestId, status: 'pending' });
  }, [projectId]);

  const deleteRequest = useCallback((requestId: string) => {
    const before = findRow('project_requests', requestId);
    deleteRow('project_requests', requestId);
    logProjectHistory(projectId, 'request_responded', `Request deleted: ${before?.title ?? 'Request'}`, { requestId });
  }, [projectId]);

  // ── Stats ──

  const photoStats = useMemo(() => {
    const total = photos.length;
    const shared = photos.filter((p) => p.isCustomerVisible).length;
    return { total, shared, unreviewed: total - shared };
  }, [photos]);

  const taskStats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const pending = tasks.filter((t) => t.status === 'pending').length;
    return { total, completed, inProgress, pending };
  }, [tasks]);

  return {
    project, updateProject,
    tasks, addTask, updateTask,
    team, addTeamMember, removeTeamMember,
    settings, updateSettings,
    history, updates, postUpdate, requests, submitRequest, respondToRequest, editRequestResponse, reopenRequest, deleteRequest,
    photos, addPhoto, updatePhoto, deletePhoto,
    customerTimeline, taskStats, photoStats,
  };
}
