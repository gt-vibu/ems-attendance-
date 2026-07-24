// Single source of truth for "how does this tenant/branch/shift define
// lateness, expected checkout, and worked/half/short/overtime minutes".
//
// Before this module existed, three separate call sites (office check-in,
// QR check-in, and dashboard/report "late" counts) each reimplemented this
// independently and disagreed — office check-in only ever consulted
// tenant-level shiftStart/gracePeriodMins (ignoring the employee's actual
// shift or branch override entirely), QR check-in resolved shift -> branch
// -> tenant correctly, and dashboards/reports didn't recompute lateness at
// all — they string-matched the log's `reason` text for "Late Arrival".
// Every call site now goes through resolveEffectivePolicy() +
// computeLateness()/computeExpectedCheckout()/computeDayOutcome() instead.
export type ArrivalPolicy = 'strict' | 'buffered' | 'flexible';
export type WorkingHoursPolicy = 'fixed_shift_end' | 'complete_required_hours' | 'hybrid';

export interface EffectivePolicy {
  arrivalPolicy: ArrivalPolicy;
  workingHoursPolicy: WorkingHoursPolicy;
  shiftStartStr: string; // 'HH:MM'
  shiftEndStr: string; // 'HH:MM'
  gracePeriodMins: number;
  halfDayMins: number;
  requiredWorkingMins: number;
  hybridMaxCheckoutTime: string | null; // 'HH:MM'
}

function parseHHMM(str: string): { hour: number; minute: number } {
  const [h, m] = str.split(':').map(Number);
  return { hour: h || 0, minute: m || 0 };
}

// Minutes from `startStr` to `endStr` on the same day, treating an
// end-time at or before the start-time as crossing midnight (adds 24h) —
// the same "shift spans past midnight" assumption implicit in how
// shiftStart/shiftEnd are already entered elsewhere in this codebase.
function shiftDurationMins(startStr: string, endStr: string): number {
  const start = parseHHMM(startStr);
  const end = parseHHMM(endStr);
  let mins = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}

// Resolves the shift -> branch -> tenant fallback chain for every policy
// field, including the new Attendance Policy fields. `shift` is the
// already-resolved effective shift for this date (see
// services/shiftOverrides.ts's getEffectiveShift) — null if the user has
// no shift assigned, which is a normal/common case, not an error.
export function resolveEffectivePolicy(
  tenant: any,
  branch: any | null | undefined,
  shift: any | null | undefined,
): EffectivePolicy {
  const shiftStartStr = shift?.checkInTime || branch?.shiftStart || tenant.shiftStart || '09:00';
  const shiftEndStr = shift?.checkOutTime || branch?.shiftEnd || tenant.shiftEnd || '18:00';
  const gracePeriodMins = shift?.gracePeriodMins ?? branch?.gracePeriodMins ?? tenant.gracePeriodMins ?? 15;
  const halfDayMins = branch?.halfDayMins ?? tenant.halfDayMins ?? 240;
  const arrivalPolicy = (branch?.arrivalPolicy || tenant.arrivalPolicy || 'buffered') as ArrivalPolicy;
  const workingHoursPolicy = (branch?.workingHoursPolicy || tenant.workingHoursPolicy || 'fixed_shift_end') as WorkingHoursPolicy;
  const requiredWorkingMins = branch?.requiredWorkingMins ?? tenant.requiredWorkingMins ?? shiftDurationMins(shiftStartStr, shiftEndStr);
  const hybridMaxCheckoutTime = branch?.hybridMaxCheckoutTime ?? tenant.hybridMaxCheckoutTime ?? null;

  return { arrivalPolicy, workingHoursPolicy, shiftStartStr, shiftEndStr, gracePeriodMins, halfDayMins, requiredWorkingMins, hybridMaxCheckoutTime };
}

// today's Date at the given 'HH:MM', relative to `relativeTo` (defaults to
// now) so callers checking a specific check-in timestamp get the shift
// boundary for THAT day, not necessarily today.
function timeToday(hhmm: string, relativeTo: Date = new Date()): Date {
  const { hour, minute } = parseHHMM(hhmm);
  const d = new Date(relativeTo);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function computeLateness(policy: EffectivePolicy, checkInAt: Date): { isLate: boolean; lateByMinutes: number } {
  if (policy.arrivalPolicy === 'flexible') return { isLate: false, lateByMinutes: 0 };

  const shiftTime = timeToday(policy.shiftStartStr, checkInAt);
  const lateByMinutes = Math.max(0, Math.round((checkInAt.getTime() - shiftTime.getTime()) / 60000));

  if (policy.arrivalPolicy === 'strict') {
    return { isLate: checkInAt.getTime() > shiftTime.getTime(), lateByMinutes };
  }

  // 'buffered' — today's existing grace-period math.
  const thresholdTime = new Date(shiftTime.getTime() + policy.gracePeriodMins * 60000);
  return { isLate: checkInAt.getTime() > thresholdTime.getTime(), lateByMinutes };
}

// Null return means "no forced/expected checkout" (Fixed Shift End —
// informational only, matches today's behavior of never constraining
// checkout time).
export function computeExpectedCheckout(policy: EffectivePolicy, checkInAt: Date): Date | null {
  if (policy.workingHoursPolicy === 'fixed_shift_end') {
    return timeToday(policy.shiftEndStr, checkInAt);
  }

  const requiredCompletion = new Date(checkInAt.getTime() + policy.requiredWorkingMins * 60000);

  if (policy.workingHoursPolicy === 'complete_required_hours' || !policy.hybridMaxCheckoutTime) {
    return requiredCompletion;
  }

  // 'hybrid' with a configured max checkout time — whichever is earlier.
  const maxCheckout = timeToday(policy.hybridMaxCheckoutTime, checkInAt);
  return requiredCompletion.getTime() < maxCheckout.getTime() ? requiredCompletion : maxCheckout;
}

export interface DayOutcome {
  workedMinutes: number;
  isHalfDay: boolean;
  isShortDay: boolean;
  overtimeMinutes: number;
}

export function computeDayOutcome(policy: EffectivePolicy, checkInAt: Date, checkoutAt: Date, breakMinutes = 0): DayOutcome {
  const rawMinutes = (checkoutAt.getTime() - checkInAt.getTime()) / 60000;
  const workedMinutes = Math.max(0, rawMinutes - breakMinutes);

  const isHalfDay = workedMinutes < policy.halfDayMins;
  const isShortDay = !isHalfDay && workedMinutes < policy.requiredWorkingMins;
  // Fixed Shift End has no overtime concept — worked hours simply track
  // actual time, matching the spec ("Attendance, payroll, overtime... should
  // work based on the reduced worked hours" under Fixed Shift End, i.e. it
  // only ever reduces, never grants overtime).
  const overtimeMinutes = policy.workingHoursPolicy === 'fixed_shift_end'
    ? 0
    : Math.max(0, workedMinutes - policy.requiredWorkingMins);

  return { workedMinutes, isHalfDay, isShortDay, overtimeMinutes };
}
