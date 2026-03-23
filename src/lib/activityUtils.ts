/**
 * activityUtils.ts
 *
 * Shared utility functions for CPM (Critical Path Method) activity data.
 *
 * SINGLE SOURCE OF TRUTH for:
 *   - isMilestone()      — determines if an activity is a milestone
 *   - mapTaskType()      — maps P6 XER task type codes to internal types
 *   - mapStatusCode()    — maps P6 XER status codes to internal statuses
 *   - evaluateFilter()   — evaluates a single filter condition against a value
 *
 * These were previously duplicated across multiple files:
 *   - isMilestone:     dateUtils.ts, GanttChart.tsx, GanttChartAdvanced.tsx, ActivityTable.tsx
 *   - mapTaskType:     xerParser.ts, taskTransform.worker.ts
 *   - mapStatusCode:   xerParser.ts, taskTransform.worker.ts
 *   - evaluateFilter:  GanttViewerAdvanced.tsx, ActivityTableAdvanced.tsx
 *
 * IMPORTANT — Worker compatibility:
 *   mapTaskType and mapStatusCode are also used inside Web Workers
 *   (taskTransform.worker.ts). Workers cannot import from modules that
 *   reference the DOM or browser APIs. This file is safe for worker
 *   imports because it contains only pure functions with zero browser
 *   dependencies.
 */


// ============================================================================
// Milestone detection
// ============================================================================

/**
 * Determines whether an activity is a milestone (zero-duration marker).
 *
 * P6 (Primavera P6) milestone types:
 *   - 'start_milestone'  — marks the start of a phase or deliverable
 *   - 'finish_milestone' — marks the completion of a phase or deliverable
 *
 * Also treats any activity with zero original duration as a milestone,
 * which catches edge cases where the activity_type wasn't mapped correctly.
 *
 * @param activity - Activity object with activity_type and original_duration_hours fields
 * @returns true if the activity is a milestone
 */
export function isMilestone(activity: {
  activity_type?: string;
  original_duration_hours?: number | null;
}): boolean {
  return (
    activity.activity_type === 'start_milestone' ||
    activity.activity_type === 'finish_milestone' ||
    activity.original_duration_hours === 0
  );
}


// ============================================================================
// P6 XER (Extended Exchange Resource) code mappings
// ============================================================================

/**
 * Maps a Primavera P6 XER task type code to an internal activity type string.
 *
 * P6 XER codes and their meanings:
 *   TT_Task    — Task Dependent (duration-based scheduling)
 *   TT_Rsrc    — Resource Dependent (scheduled by resource availability)
 *   TT_LOE     — Level of Effort (spans the duration of its predecessors)
 *   TT_Mile    — Milestone (generic)
 *   TT_FinMile — Finish Milestone
 *   TT_WBS     — WBS (Work Breakdown Structure) Summary
 *
 * @param xerType - The raw task type string from the XER file's TASK table
 * @returns Internal activity type string
 */
export function mapTaskType(xerType: string): string {
  const mapping: Record<string, string> = {
    'TT_Task': 'task_dependent',
    'TT_Rsrc': 'resource_dependent',
    'TT_LOE': 'level_of_effort',
    'TT_Mile': 'finish_milestone',
    'TT_FinMile': 'finish_milestone',
    'TT_WBS': 'wbs_summary',
  };
  return mapping[xerType] || 'task_dependent';
}

/**
 * Maps a Primavera P6 XER status code to an internal activity status string.
 *
 * P6 XER codes and their meanings:
 *   TK_NotStart — Not Started (no actual start date)
 *   TK_Active   — In Progress (has actual start but no actual finish)
 *   TK_Complete — Complete (has both actual start and actual finish)
 *
 * @param xerStatus - The raw status code string from the XER file's TASK table
 * @returns Internal activity status string
 */
export function mapStatusCode(xerStatus: string): string {
  const mapping: Record<string, string> = {
    'TK_NotStart': 'not_started',
    'TK_Active': 'in_progress',
    'TK_Complete': 'complete',
  };
  return mapping[xerStatus] || 'not_started';
}


// ============================================================================
// Filter evaluation
// ============================================================================

/**
 * Evaluates a single filter condition against a value.
 *
 * Used by both the advanced filter system (FilterBuilder) and the
 * activity table's local filter logic.
 *
 * Operator behavior:
 *   - 'isBlank'     — true if value is null, undefined, or empty string
 *   - 'isNotBlank'  — inverse of isBlank
 *   - 'equals'      — case-insensitive string equality
 *   - 'notEquals'   — case-insensitive string inequality
 *   - 'contains'    — case-insensitive substring match
 *   - 'greaterThan' — raw value comparison (works for numbers and date strings)
 *   - 'lessThan'    — raw value comparison
 *   - 'between'     — inclusive range check (value >= filterValue AND value <= filterValue2)
 *
 * @param value       - The activity field value to test
 * @param operator    - The comparison operator
 * @param filterValue - The primary filter value to compare against
 * @param filterValue2 - Optional second value for 'between' operator
 * @returns true if the value satisfies the filter condition
 */
export function evaluateFilter(
  value: unknown,
  operator: string,
  filterValue: unknown,
  filterValue2?: unknown
): boolean {
  if (operator === 'isBlank') {
    return value === null || value === undefined || value === '';
  }
  if (operator === 'isNotBlank') {
    return value !== null && value !== undefined && value !== '';
  }

  const strValue = String(value ?? '').toLowerCase();
  const strFilter = String(filterValue ?? '').toLowerCase();

  switch (operator) {
    case 'equals':
      return strValue === strFilter;
    case 'notEquals':
      return strValue !== strFilter;
    case 'contains':
      return strValue.includes(strFilter);
    case 'greaterThan':
      return (value as number) > (filterValue as number);
    case 'lessThan':
      return (value as number) < (filterValue as number);
    case 'between':
      return (
        (value as number) >= (filterValue as number) &&
        (value as number) <= (filterValue2 as number)
      );
    default:
      return true;
  }
}
