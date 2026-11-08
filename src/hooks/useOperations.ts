import { landscapingNotifications } from '@/lib/notificationScope';
import { useMemo, useCallback } from 'react';
import type {
  WorkSession,
  WorkerHourlyRate,
  WorkerPaySettings,
  OvertimeRule,
  NotificationPreference,
  AppNotification,
  CompanyOperationsSettings,
  WorkerAttendance,
  AttendanceStatus,
  WorkerReminder,
  NotificationEventType,
} from '@/types/operations';
import type { Assignment } from '@/types/schedule';
import type { PersonSummary } from '@/types/company';
import { db, useDb, updateRow, insertRow, upsertRow, deleteRow } from '@/data/store';
import { todayKey, localDateKey, isoToLocalDateKey, localDateTime } from '@/lib/ids';
import { computeTargetPay, type TargetPayBreakdown } from '@/lib/targetPay';

// ── Hours Calculation ─────────────────────────────────────────

export interface DailyHours {
  date: string;
  sessions: WorkSession[];
  totalMinutes: number;
  totalHours: number;
}

export interface WorkerWeeklyHours {
  personId: string;
  worker: PersonSummary;
  weekStart: string;
  weekEnd: string;
  dailyHours: DailyHours[];
  totalMinutes: number;
  totalHours: number;
}

function getWeekRange(referenceDate: string): { start: string; end: string } {
  const d = localDateTime(referenceDate, '12:00');
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: localDateKey(monday), end: localDateKey(sunday) };
}

/** The local day a work session started on. */
function getSessionDate(session: WorkSession): string {
  return isoToLocalDateKey(session.checkInTime);
}

export function useWorkSessions() {
  const v = useDb();
  const sessions = useMemo(() => db.workSessions, [v]);

  const getSessionsForWorker = useCallback(
    (personId: string, startDate?: string, endDate?: string) => {
      return sessions.filter((s) => {
        if (s.personId !== personId) return false;
        const date = getSessionDate(s);
        if (startDate && date < startDate) return false;
        if (endDate && date > endDate) return false;
        return true;
      });
    },
    [sessions],
  );

  const getSessionsForDate = useCallback(
    (date: string) => sessions.filter((s) => getSessionDate(s) === date),
    [sessions],
  );

  const getWeeklyHoursForWorker = useCallback(
    (personId: string, weekOfDate: string): WorkerWeeklyHours | null => {
      const { start, end } = getWeekRange(weekOfDate);
      const workerSessions = getSessionsForWorker(personId, start, end);
      const worker = db.people[personId];
      if (!worker) return null;

      const dailyMap: Record<string, WorkSession[]> = {};
      for (let i = 0; i < 7; i++) {
        const d = localDateTime(start, '12:00');
        d.setDate(d.getDate() + i);
        dailyMap[localDateKey(d)] = [];
      }
      for (const s of workerSessions) {
        const date = getSessionDate(s);
        if (dailyMap[date]) dailyMap[date].push(s);
      }

      const dailyHours: DailyHours[] = Object.entries(dailyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, daySessions]) => {
          const totalMinutes = daySessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
          return { date, sessions: daySessions, totalMinutes, totalHours: Math.round((totalMinutes / 60) * 100) / 100 };
        });

      const totalMinutes = dailyHours.reduce((sum, d) => sum + d.totalMinutes, 0);
      return {
        personId,
        worker,
        weekStart: start,
        weekEnd: end,
        dailyHours,
        totalMinutes,
        totalHours: Math.round((totalMinutes / 60) * 100) / 100,
      };
    },
    [getSessionsForWorker],
  );

  const getAllWorkersWeeklyHours = useCallback(
    (weekOfDate: string): WorkerWeeklyHours[] => {
      const allMembers = db.members.filter((m) => m.role === 'worker' && m.status === 'active');
      return allMembers
        .map((m) => getWeeklyHoursForWorker(m.personId, weekOfDate))
        .filter((w): w is WorkerWeeklyHours => w !== null);
    },
    [sessions, getWeeklyHoursForWorker],
  );

  return { sessions, getSessionsForWorker, getSessionsForDate, getWeeklyHoursForWorker, getAllWorkersWeeklyHours };
}

// ── Payroll Estimates ─────────────────────────────────────────

export interface PayrollEstimate {
  personId: string;
  worker: PersonSummary;
  weekStart: string;
  weekEnd: string;
  regularHours: number;
  overtimeHours: number;
  regularRate: number;
  overtimeRate: number;
  /** This worker's overtime terms (their own, or the company default). */
  overtime: OvertimeTerms;
  regularPay: number;
  overtimePay: number;
  /** What the worker is paid: the target-pay gross when that applies, else standard overtime pay. */
  totalPay: number;
  /** Standard overtime math at the stored hourly rate (shown for comparison in Target-Pay Mode). */
  standardPay: number;
  /** Set when Target-Pay Mode is on and this worker has a target rate. */
  targetPay?: TargetPayBreakdown & { targetRate: number };
  sessions: WorkSession[];
}

export interface OvertimeTerms {
  enabled: boolean;
  afterHours: number;
  multiplier: number;
  /** False when the worker has no settings of their own and uses the company rule. */
  isCustom: boolean;
}

function companyOvertimeTerms(rule: OvertimeRule): OvertimeTerms {
  return {
    enabled: rule.isActive && rule.ruleType === 'weekly_40',
    afterHours: rule.weeklyThresholdHours ?? 40,
    multiplier: rule.overtimeMultiplier,
    isCustom: false,
  };
}

function getRateForDate(rates: WorkerHourlyRate[], date: string): number {
  const applicable = rates
    .filter((r) => r.effectiveDate <= date && (!r.endDate || r.endDate >= date))
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  return applicable[0]?.hourlyRate ?? 0;
}

export function usePayroll() {
  const v = useDb();
  const rates = useMemo<WorkerHourlyRate[]>(() => db.hourlyRates, [v]);
  const overtimeRule = useMemo<OvertimeRule>(() => db.overtimeRule, [v]);
  const paySettings = useMemo<Record<string, WorkerPaySettings>>(() => db.paySettings, [v]);
  const targetPayEnabled = useMemo(() => db.company?.targetPayEnabled === true, [v]);
  const { sessions, getAllWorkersWeeklyHours } = useWorkSessions();

  const getRatesForWorker = useCallback(
    (personId: string) => rates.filter((r) => r.personId === personId).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)),
    [rates],
  );

  const getCurrentRate = useCallback(
    (personId: string) => getRateForDate(getRatesForWorker(personId), todayKey()),
    [getRatesForWorker],
  );

  const getOvertimeTerms = useCallback(
    (personId: string): OvertimeTerms => {
      const own = paySettings[personId];
      if (!own) return companyOvertimeTerms(overtimeRule);
      return { enabled: own.overtimeEnabled, afterHours: own.overtimeAfterHours, multiplier: own.overtimeMultiplier, isCustom: true };
    },
    [paySettings, overtimeRule],
  );

  const getPayrollEstimates = useCallback(
    (weekOfDate: string): PayrollEstimate[] => {
      const allWeekly = getAllWorkersWeeklyHours(weekOfDate);

      return allWeekly.map((wh) => {
        const workerRates = getRatesForWorker(wh.personId);
        const overtime = getOvertimeTerms(wh.personId);
        let regularHours = 0;
        let overtimeHours = 0;
        let regularPay = 0;
        let overtimePay = 0;

        if (overtime.enabled) {
          const threshold = overtime.afterHours;
          let cumulativeHours = 0;

          for (const day of wh.dailyHours) {
            const dayRate = getRateForDate(workerRates, day.date);
            const dayHours = day.totalHours;

            if (cumulativeHours + dayHours <= threshold) {
              regularHours += dayHours;
              regularPay += dayHours * dayRate;
            } else if (cumulativeHours >= threshold) {
              overtimeHours += dayHours;
              overtimePay += dayHours * dayRate * overtime.multiplier;
            } else {
              const regPortion = threshold - cumulativeHours;
              const otPortion = dayHours - regPortion;
              regularHours += regPortion;
              overtimeHours += otPortion;
              regularPay += regPortion * dayRate;
              overtimePay += otPortion * dayRate * overtime.multiplier;
            }
            cumulativeHours += dayHours;
          }
        } else {
          for (const day of wh.dailyHours) {
            const dayRate = getRateForDate(workerRates, day.date);
            regularHours += day.totalHours;
            regularPay += day.totalHours * dayRate;
          }
        }

        const rate = getCurrentRate(wh.personId);
        const standardPay = Math.round((regularPay + overtimePay) * 100) / 100;
        const targetRate = paySettings[wh.personId]?.targetHourlyRate;
        const targetPay = targetPayEnabled && targetRate
          ? { ...computeTargetPay(targetRate, regularHours + overtimeHours, overtime), targetRate }
          : undefined;
        return {
          personId: wh.personId,
          worker: wh.worker,
          weekStart: wh.weekStart,
          weekEnd: wh.weekEnd,
          regularHours: Math.round(regularHours * 100) / 100,
          overtimeHours: Math.round(overtimeHours * 100) / 100,
          regularRate: rate,
          overtimeRate: Math.round(rate * overtime.multiplier * 100) / 100,
          overtime,
          regularPay: Math.round(regularPay * 100) / 100,
          overtimePay: Math.round(overtimePay * 100) / 100,
          totalPay: targetPay ? targetPay.grossPay : standardPay,
          standardPay,
          targetPay,
          sessions: sessions.filter(
            (s) => s.personId === wh.personId && getSessionDate(s) >= wh.weekStart && getSessionDate(s) <= wh.weekEnd,
          ),
        };
      });
    },
    [sessions, getAllWorkersWeeklyHours, getRatesForWorker, getCurrentRate, getOvertimeTerms, paySettings, targetPayEnabled],
  );

  /** Saves a worker's target hourly rate (Target-Pay Mode). Keeps their current overtime terms. */
  const setTargetRate = useCallback(
    (personId: string, targetHourlyRate: number) => {
      const terms = getOvertimeTerms(personId);
      upsertRow('worker_pay_settings', {
        personId,
        companyId: db.companyId,
        overtimeEnabled: terms.enabled,
        overtimeAfterHours: terms.afterHours,
        overtimeMultiplier: terms.multiplier,
        targetHourlyRate,
      });
    },
    [getOvertimeTerms],
  );

  /** Turns Target-Pay Mode on or off for the whole company. */
  const setTargetPayEnabled = useCallback((enabled: boolean) => {
    if (db.company) updateRow('companies', db.company.id, { targetPayEnabled: enabled });
  }, []);

  /** Saves a worker's own overtime terms (on/off, hours a week before it starts, multiplier). */
  const setWorkerOvertime = useCallback(
    (personId: string, terms: { enabled: boolean; afterHours: number; multiplier: number }) => {
      upsertRow('worker_pay_settings', {
        personId,
        companyId: db.companyId,
        overtimeEnabled: terms.enabled,
        overtimeAfterHours: terms.afterHours,
        overtimeMultiplier: terms.multiplier,
      });
    },
    [],
  );

  /**
   * Sets a worker's pay rate from a date on (today by default; their first
   * rate applies to all past hours too). Ends their previous rate the day before.
   */
  const setHourlyRate = useCallback((personId: string, hourlyRate: number, effectiveDate?: string) => {
    const existing = db.hourlyRates.filter((r) => r.personId === personId);
    const from = effectiveDate ?? (existing.length === 0 ? '2000-01-01' : todayKey());
    const sameDay = existing.find((r) => !r.endDate && r.effectiveDate === from);
    if (sameDay) {
      updateRow('worker_hourly_rates', sameDay.id, { hourlyRate });
      return;
    }
    const prevDay = localDateTime(from, '12:00');
    prevDay.setDate(prevDay.getDate() - 1);
    for (const r of existing) {
      if (!r.endDate && r.effectiveDate < from) {
        updateRow('worker_hourly_rates', r.id, { endDate: localDateKey(prevDay) });
      }
    }
    insertRow('worker_hourly_rates', { personId, hourlyRate, effectiveDate: from, setBy: db.personId || undefined });
  }, []);

  return {
    rates, overtimeRule, targetPayEnabled, getRatesForWorker, getCurrentRate, getOvertimeTerms, getPayrollEstimates,
    setHourlyRate, setWorkerOvertime, setTargetRate, setTargetPayEnabled,
  };
}

// ── Attendance ────────────────────────────────────────────────

export function useAttendance() {
  const { sessions, getSessionsForDate } = useWorkSessions();
  const v = useDb();
  const settings = useMemo<CompanyOperationsSettings>(() => db.operationsSettings, [v]);

  const getAttendanceForDate = useCallback(
    (date: string): WorkerAttendance[] => {
      const dayAssignments = db.assignments.filter(
        (a) => a.scheduledDate === date && a.status !== 'cancelled' && a.status !== 'reassigned',
      );
      const daySessions = getSessionsForDate(date);
      const allCheckIns = db.checkIns;

      const workerIds = [...new Set(dayAssignments.map((a) => a.personId))];

      return workerIds.map((personId) => {
        const worker = db.people[personId];
        const workerAssignments = dayAssignments.filter((a) => a.personId === personId);
        const workerSessions = daySessions.filter((s) => s.personId === personId);

        const assignments = workerAssignments.map((a) => {
          const session = workerSessions.find((s) => s.assignmentId === a.id);
          const checkIn = allCheckIns.find((ci) => ci.assignmentId === a.id);

          let status: AttendanceStatus = 'not_checked_in';
          let lateMinutes: number | undefined;

          if (session) {
            if (session.checkOutTime) {
              status = 'checked_out';
            } else {
              const scheduledEnd = a.endTime;
              if (scheduledEnd) {
                const now = new Date();
                const endToday = localDateTime(date, scheduledEnd);
                if (now > endToday) {
                  status = 'past_scheduled_end';
                } else {
                  status = 'checked_in';
                }
              } else {
                status = 'checked_in';
              }
            }

            if (a.startTime && session.checkInTime) {
              const scheduledStart = localDateTime(date, a.startTime);
              const actualIn = new Date(session.checkInTime);
              const diffMin = (actualIn.getTime() - scheduledStart.getTime()) / 60000;
              if (diffMin > settings.lateCheckinThresholdMinutes) {
                lateMinutes = Math.round(diffMin);
                if (status === 'checked_in') status = 'late';
              }
            }
          } else if (checkIn) {
            status = 'checked_in';
            if (a.startTime) {
              const scheduledStart = localDateTime(date, a.startTime);
              const actualIn = new Date(checkIn.timestamp);
              const diffMin = (actualIn.getTime() - scheduledStart.getTime()) / 60000;
              if (diffMin > settings.lateCheckinThresholdMinutes) {
                lateMinutes = Math.round(diffMin);
                status = 'late';
              }
            }
          }

          return {
            assignmentId: a.id,
            projectId: a.projectId,
            projectName: a.project?.name ?? 'Unknown',
            projectAddress: a.project?.address,
            scheduledStart: a.startTime,
            scheduledEnd: a.endTime,
            actualCheckIn: session?.checkInTime ?? checkIn?.timestamp,
            actualCheckOut: session?.checkOutTime,
            status,
            lateMinutes,
            distanceFromSite: checkIn?.gps?.distanceFromSite ?? session?.checkInGps?.distanceFromSite,
            withinRadius: checkIn?.withinRadius,
          };
        });

        return {
          personId,
          scheduledDate: date,
          assignments,
          worker,
        };
      });
    },
    [sessions, getSessionsForDate, settings, v],
  );

  return { getAttendanceForDate, settings };
}

// ── Notifications ─────────────────────────────────────────────

export function useNotifications() {
  const v = useDb();
  // Only this person's own notifications (the store already filters by recipient).
  // Snow alerts live in the same table but belong to Snow Mode: they never show in the landscaping list, bell number or banner.
  const notifications = useMemo<AppNotification[]>(() => landscapingNotifications(db.notifications), [v]);
  const preferences = useMemo<NotificationPreference[]>(() => db.notificationPreferences, [v]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => n.status === 'unread').length,
    [notifications],
  );

  const markRead = useCallback((notificationId: string) => {
    updateRow('app_notifications', notificationId, { status: 'read', readAt: new Date().toISOString() });
  }, []);

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    for (const n of landscapingNotifications(db.notifications)) {
      if (n.status === 'unread') updateRow('app_notifications', n.id, { status: 'read', readAt: now });
    }
  }, []);

  /** Removes this person's notifications from their notification center (read and unread). Only the notification records go. */
  const clearAll = useCallback(() => {
    // Only the landscaping ones: clearing this list must not remove Snow alerts.
    for (const n of [...landscapingNotifications(db.notifications)]) deleteRow('app_notifications', n.id);
  }, []);

  const getCompanyDefault = useCallback(
    (eventType: NotificationEventType) =>
      preferences.find((p) => !p.personId && p.eventType === eventType),
    [preferences],
  );

  const getWorkerOverride = useCallback(
    (personId: string, eventType: NotificationEventType) =>
      preferences.find((p) => p.personId === personId && p.eventType === eventType),
    [preferences],
  );

  const isEnabledForWorker = useCallback(
    (personId: string, eventType: NotificationEventType): boolean => {
      const override = getWorkerOverride(personId, eventType);
      if (override) return override.enabled;
      const def = getCompanyDefault(eventType);
      return def?.enabled ?? true;
    },
    [getWorkerOverride, getCompanyDefault],
  );

  const updatePreference = useCallback(
    (prefId: string, enabled: boolean) => {
      updateRow('notification_preferences', prefId, { enabled });
    },
    [],
  );

  const setWorkerOverride = useCallback(
    (personId: string, eventType: NotificationEventType, enabled: boolean) => {
      const existing = db.notificationPreferences.find((p) => p.personId === personId && p.eventType === eventType);
      if (existing) updateRow('notification_preferences', existing.id, { enabled });
      else insertRow('notification_preferences', { personId, eventType, enabled });
    },
    [],
  );

  return {
    notifications,
    unreadCount,
    preferences,
    markRead,
    markAllRead,
    clearAll,
    getCompanyDefault,
    getWorkerOverride,
    isEnabledForWorker,
    updatePreference,
    setWorkerOverride,
  };
}

// ── Worker Reminders ──────────────────────────────────────────

export function useWorkerReminders(personId?: string) {
  const v = useDb();
  const reminders = useMemo<WorkerReminder[]>(() => db.workerReminders, [v]);

  const filtered = useMemo(
    () => (personId ? reminders.filter((r) => r.personId === personId) : reminders),
    [reminders, personId],
  );

  return { reminders: filtered };
}
