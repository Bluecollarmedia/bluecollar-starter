/**
 * Target-Pay Mode: the owner sets the hourly amount a worker should end up
 * with for every hour worked, overtime included. When the week goes past the
 * overtime threshold we back-solve the base rate so that regular pay plus
 * overtime pay at that base equals target × hours.
 *
 *   base = target × hours / (threshold + (hours − threshold) × multiplier)
 *
 * e.g. $35 target, 50h, 1.5x after 40h → base = 35 × 50 / 55 = $31.82,
 * and 40 × 31.82 + 10 × 31.82 × 1.5 = $1,750 = 50 × $35.
 *
 * At or under the threshold the base equals the target (no solve needed).
 * Hours are the week's total, bucketed by check-in date, so an overnight
 * shift counts in the week it started.
 */
export interface TargetPayBreakdown {
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  /** Base rate actually paid on regular hours (overtime pays base × multiplier). */
  solvedBaseRate: number;
  regularPay: number;
  overtimePay: number;
  grossPay: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeTargetPay(
  targetRate: number,
  totalHours: number,
  overtime: { enabled: boolean; afterHours: number; multiplier: number },
): TargetPayBreakdown {
  const hours = Number.isFinite(totalHours) && totalHours > 0 ? totalHours : 0;
  const target = Number.isFinite(targetRate) && targetRate > 0 ? targetRate : 0;
  const threshold = overtime.afterHours > 0 ? overtime.afterHours : 40;
  const multiplier = overtime.multiplier >= 1 ? overtime.multiplier : 1;

  const hasOvertime = overtime.enabled && hours > threshold;
  const regularHours = hasOvertime ? threshold : hours;
  const overtimeHours = hasOvertime ? hours - threshold : 0;

  // Weighted hours = what the base gets multiplied by. Always ≥ hours > 0 when
  // there's overtime, so this never divides by zero.
  const weightedHours = regularHours + overtimeHours * multiplier;
  const base = hasOvertime ? (target * hours) / weightedHours : target;

  const regularPay = regularHours * base;
  const overtimePay = overtimeHours * base * multiplier;

  return {
    totalHours: round2(hours),
    regularHours: round2(regularHours),
    overtimeHours: round2(overtimeHours),
    solvedBaseRate: round2(base),
    regularPay: round2(regularPay),
    overtimePay: round2(overtimePay),
    // Gross is target × hours by construction; computed directly so cents
    // rounding on the base rate can't drift it.
    grossPay: round2(target * hours),
  };
}
