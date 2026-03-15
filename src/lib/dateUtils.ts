export function hoursToWorkingDays(hours: number | null, hoursPerDay: number): string {
  if (hours === null || hours === undefined) return '-';
  const days = hours / hoursPerDay;
  return days.toFixed(1);
}

export function hoursToDays(hours: number | null, hoursPerDay: number): string {
  if (hours === null || hours === undefined) return '-';
  const days = hours / hoursPerDay;
  if (days === 0) return '0';
  return days.toFixed(1);
}

export function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const day = date.getDate().toString().padStart(2, '0');
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const year = date.getFullYear().toString().slice(-2);
  return `${day}-${month}-${year}`;
}

export interface EffectiveDates {
  start: Date | null;
  finish: Date | null;
}

export function getEffectiveDates(activity: any): EffectiveDates {
  let start: Date | null = null;
  let finish: Date | null = null;

  // Start date priority: actual_start > early_start
  if (activity.actual_start) {
    start = new Date(activity.actual_start);
  } else if (activity.early_start) {
    start = new Date(activity.early_start);
  }

  // Finish date priority: actual_finish > early_finish
  if (activity.actual_finish) {
    finish = new Date(activity.actual_finish);
  } else if (activity.early_finish) {
    finish = new Date(activity.early_finish);
  }

  return { start, finish };
}

export function isMilestone(activity: any): boolean {
  return activity.activity_type === 'start_milestone' ||
         activity.activity_type === 'finish_milestone';
}
