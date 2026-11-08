import { useCallback } from 'react';
import { db, useDb } from '@/data/store';
import { DEFAULT_TERMS, type OvertimeTerms } from '@/lib/timeCalc';

/** Each employee's weekly overtime terms: their own (Payroll settings) or the company rule. Used by the weekly summary. */
export function useLaborTerms(): (personId: string) => OvertimeTerms {
  const v = useDb();
  return useCallback((personId: string): OvertimeTerms => {
    const own = db.paySettings[personId];
    if (own) return { enabled: own.overtimeEnabled, weeklyThresholdHours: own.overtimeAfterHours, multiplier: own.overtimeMultiplier };
    const rule = db.overtimeRule;
    if (!rule) return DEFAULT_TERMS;
    return { enabled: rule.isActive && rule.ruleType === 'weekly_40', weeklyThresholdHours: rule.weeklyThresholdHours ?? 40, multiplier: rule.overtimeMultiplier };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
}
