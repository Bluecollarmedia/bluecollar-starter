import { useMemo, useCallback } from 'react';
import type { CompanySetupState, SetupStepKey } from '@/types/company';
import { db, useDb, updateRow, findRow } from '@/data/store';

export interface SetupStepInfo {
  key: SetupStepKey;
  title: string;
  subtitle: string;
  icon: 'truck' | 'users' | 'dollar-sign' | 'bell' | 'briefcase';
}

/** The owner's first-time setup, in the order the wizard walks through it. */
export const SETUP_STEPS: SetupStepInfo[] = [
  { key: 'trucks', title: 'Add your trucks', subtitle: 'So you can hand out trucks to crews each day.', icon: 'truck' },
  { key: 'workers', title: 'Invite your workers', subtitle: 'Add a name and phone number, then text them a private link.', icon: 'users' },
  { key: 'payRates', title: 'Set pay rates', subtitle: 'Hourly rates power the payroll estimates.', icon: 'dollar-sign' },
  { key: 'notifications', title: 'Choose your alerts', subtitle: 'Pick what you want to be told about.', icon: 'bell' },
  { key: 'company', title: 'Company info & photos', subtitle: 'Contact details and your header photos.', icon: 'briefcase' },
];

function activeWorkerIds(): string[] {
  return db.members.filter((m) => m.role === 'worker' && m.status === 'active').map((m) => m.personId);
}

/** Steps that count as done because the data is already there, even without tapping through. */
function autoDone(key: SetupStepKey): boolean {
  switch (key) {
    case 'trucks':
      return db.trucks.length > 0;
    case 'workers':
      return activeWorkerIds().length > 0;
    case 'payRates': {
      const ids = activeWorkerIds();
      return ids.length > 0 && ids.every((id) => db.hourlyRates.some((r) => r.personId === id));
    }
    case 'company': {
      const c = db.company;
      return !!(c?.phone && c?.email && c?.address);
    }
    default:
      return false;
  }
}

export function useCompanySetup() {
  const v = useDb();
  const company = db.company;
  const state: CompanySetupState = (company?.setupState as CompanySetupState) ?? {};

  const steps = useMemo(
    () => SETUP_STEPS.map((s) => ({
      ...s,
      done: !!state.done?.[s.key] || autoDone(s.key),
      skipped: !!state.skipped?.[s.key],
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v],
  );

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  const save = useCallback((next: CompanySetupState, extra: Record<string, unknown> = {}) => {
    if (!db.company) return;
    updateRow('companies', db.company.id, { setupState: next, ...extra });
  }, []);

  // Read the raw row: db.company is only re-derived after the current tick, so two saves in a row would clobber each other.
  const current = (): CompanySetupState =>
    ((db.company && findRow('companies', db.company.id)?.setupState) as CompanySetupState) ?? {};

  const markDone = useCallback((key: SetupStepKey) => {
    const s = current();
    save({ done: { ...s.done, [key]: true }, skipped: { ...s.skipped, [key]: false } });
  }, [save]);

  const skip = useCallback((key: SetupStepKey) => {
    const s = current();
    save({ ...s, skipped: { ...s.skipped, [key]: true } });
  }, [save]);

  /** The owner reached the end of the walkthrough (some steps may still be skipped). */
  const finishWalkthrough = useCallback(() => {
    if (!db.company || findRow('companies', db.company.id)?.setupCompletedAt) return;
    save(current(), { setupCompletedAt: new Date().toISOString() });
  }, [save]);

  return {
    steps,
    doneCount,
    total: steps.length,
    allDone,
    /** True until the owner has gone through the walkthrough once. Never in demo mode. */
    needsWalkthrough: !db.demo && !!company && !company.setupCompletedAt,
    /** Show the dashboard checklist until every step is really done. Never in demo mode. */
    showChecklist: !db.demo && !!company && !allDone,
    markDone,
    skip,
    finishWalkthrough,
  };
}
