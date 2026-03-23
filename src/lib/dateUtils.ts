/**
 * dateUtils.ts
 *
 * Utility functions for formatting and computing dates and durations
 * in the context of CPM (Critical Path Method) scheduling.
 *
 * All duration display functions convert from P6's native "hours" storage
 * to "working days" using the activity's assigned calendar hours_per_day.
 */


/**
 * Converts a duration in hours to a working-days string with 1 decimal place.
 * Returns '-' for null/undefined inputs.
 *
 * @param hours      - Duration in hours (from P6's *_hr_cnt fields)
 * @param hoursPerDay - The calendar's hours_per_day setting (typically 8.0)
 * @returns Formatted string like "5.0" or "-"
 */
export function hoursToWorkingDays(hours: number | null, hoursPerDay: number): string {
  if (hours === null || hours === undefined) return '-';
  const days = hours / hoursPerDay;
  return days.toFixed(1);
}

/**
 * Converts a duration in hours to a days string. Same as hoursToWorkingDays
 * but returns "0" instead of "0.0" for zero values.
 *
 * @param hours      - Duration in hours
 * @param hoursPerDay - The calendar's hours_per_day setting
 * @returns Formatted string like "5.0", "0", or "-"
 */
export function hoursToDays(hours: number | null, hoursPerDay: number): string {
  if (hours === null || hours === undefined) return '-';
  const days = hours / hoursPerDay;
  if (days === 0) return '0';
  return days.toFixed(1);
}

/**
 * Formats a date string into DD-Mon-YY format (e.g. "15-Mar-26").
 * This matches the conventional display format used in Primavera P6.
 *
 * @param dateString - An ISO date string or null
 * @returns Formatted date string or "-" for null input
 */
export function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const day = date.getDate().toString().padStart(2, '0');
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const year = date.getFullYear().toString().slice(-2);
  return `${day}-${month}-${year}`;
}


// ============================================================================
// Effective dates (status-aware)
// ============================================================================

export interface EffectiveDates {
  start: Date | null;
  finish: Date | null;
}

/**
 * Returns the "effective" start and finish dates for an activity,
 * respecting P6's status-aware date logic.
 *
 * P6 behavior:
 *   - For completed activities, P6 resets early_start/early_finish to the
 *     data date. The real dates are in actual_start/actual_finish.
 *   - For in-progress activities, actual_start is the real start; early_finish
 *     is the forecasted finish.
 *   - For not-started activities, early_start/early_finish are the schedule dates.
 *
 * Priority:
 *   Start:  actual_start  > early_start
 *   Finish: actual_finish > early_finish
 *
 * @param activity - Activity object with date fields
 * @returns Object with start and finish as Date objects (or null if missing)
 */
export function getEffectiveDates(activity: {
  actual_start?: string | null;
  actual_finish?: string | null;
  early_start?: string | null;
  early_finish?: string | null;
}): EffectiveDates {
  let start: Date | null = null;
  let finish: Date | null = null;

  if (activity.actual_start) {
    start = new Date(activity.actual_start);
  } else if (activity.early_start) {
    start = new Date(activity.early_start);
  }

  if (activity.actual_finish) {
    finish = new Date(activity.actual_finish);
  } else if (activity.early_finish) {
    finish = new Date(activity.early_finish);
  }

  return { start, finish };
}


// Re-export isMilestone from activityUtils for backward compatibility.
// isMilestone was previously defined here. It now lives in activityUtils.ts
// as the single source of truth. This re-export keeps existing imports working.
export { isMilestone } from './activityUtils';
