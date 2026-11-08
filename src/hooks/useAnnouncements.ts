import { useCallback, useMemo } from 'react';
import type { Announcement, AnnouncementAudience, AnnouncementPriority } from '@/types/announcement';
import type { WeatherActionType } from '@/types/operations';
import { db, useDb, insertRow } from '@/data/store';
import { notifyPeople } from '@/data/actions';

function activeWorkerIds(): string[] {
  return db.members.filter((m) => m.role === 'worker' && m.status === 'active').map((m) => m.personId);
}

export function useAnnouncements() {
  const v = useDb();
  // Messages to customers have their own screen (Message Customers); they never mix into the workers' announcements.
  const announcements = useMemo(() => db.announcements.filter((a) => !String(a.audience).startsWith('customers_')), [v]);
  const reads = useMemo(() => db.announcementReads, [v]);

  const addAnnouncement = useCallback(
    (data: {
      title: string;
      body: string;
      audience: AnnouncementAudience;
      priority: AnnouncementPriority;
      weatherAction?: WeatherActionType;
    }) => {
      const recipients = activeWorkerIds();
      const row = insertRow('announcements', {
        createdBy: db.personId,
        title: data.title,
        body: data.body,
        audience: data.audience,
        priority: data.priority,
        weatherAction: data.weatherAction,
        recipientIds: recipients,
      }) as unknown as Announcement;

      // In-app notifications for each active worker (shown in their app).
      // Phone push notifications aren't set up yet.
      const isUrgentOrWeather = data.priority === 'urgent' || !!data.weatherAction;
      notifyPeople(
        recipients,
        'announcement_posted',
        isUrgentOrWeather ? `Urgent: ${data.title}` : data.title,
        data.body,
        { type: 'announcement', id: row.id },
        { priority: data.priority, weatherAction: data.weatherAction },
      );
      return { ...row, readCount: 0, totalRecipients: recipients.length } as Announcement;
    },
    [],
  );

  const isReadBy = useCallback(
    (announcementId: string, personId: string) => reads.some((r) => r.announcementId === announcementId && r.personId === personId),
    [reads],
  );

  const markAnnouncementRead = useCallback((announcementId: string, personId: string) => {
    if (db.announcementReads.some((r) => r.announcementId === announcementId && r.personId === personId)) return;
    insertRow('announcement_reads', { announcementId, personId, readAt: new Date().toISOString() });
  }, []);

  /** Newest announcement this worker hasn't read yet, or null if fully caught up. */
  const getUnreadForWorker = useCallback(
    (personId: string): Announcement | null => {
      const unread = announcements
        .filter((a) => !isReadBy(a.id, personId))
        .filter((a) => !a.recipientIds || a.recipientIds.length === 0 || a.recipientIds.includes(personId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return unread[0] ?? null;
    },
    [announcements, isReadBy],
  );

  return { announcements, addAnnouncement, markAnnouncementRead, isReadBy, getUnreadForWorker };
}
