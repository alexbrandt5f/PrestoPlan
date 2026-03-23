/**
 * useActivityFiltering.ts
 *
 * Custom hook for activity filtering, sorting, and grouping.
 *
 * EXTRACTED FROM: GanttViewerAdvanced.tsx (processedActivities + groupedActivities useMemos)
 */

import { useMemo } from 'react';
import { evaluateFilter } from '../lib/activityUtils';
import type { Activity, Calendar, ScheduleVersion } from './useScheduleData';
import type { CodeAssignmentMap } from './useColorByCode';
import type { GanttLayoutState } from '../types/gantt';

// ============================================================================
// Types
// ============================================================================

export interface GroupedItem {
  type: 'group' | 'activity';
  groupKey?: string;
  groupLabel?: string;
  activities?: Activity[];
  activity?: Activity;
  level?: number;
  totalActivities?: number;
}

export interface ActivityFilteringResult {
  processedActivities: Activity[];
  groupedActivities: GroupedItem[];
  nearCriticalThreshold: number;
}

// ============================================================================
// Hook
// ============================================================================

export function useActivityFiltering(
  activities: Activity[],
  calendars: Calendar[],
  version: ScheduleVersion | null,
  layout: GanttLayoutState,
  codeAssignments: CodeAssignmentMap,
  wbsMap: Map<string, any>,
  quickFilterCodeAssignments: Map<string, Set<string>>,
  nearCriticalThresholdSetting: number | undefined
): ActivityFilteringResult {

  const nearCriticalThreshold = nearCriticalThresholdSetting || 10;

  // Step 1: Enrich activities with code/custom columns
  const processedActivities = useMemo(() => {
    return activities.map(activity => {
      const enriched: any = { ...activity };

      layout.columns.forEach(col => {
        if (col.source === 'code' && col.sourceId) {
          const activityCodes = codeAssignments.get(activity.id);
          enriched[col.field] = activityCodes?.get(col.sourceId) || '';
        } else if (col.source === 'custom' && col.sourceId) {
          enriched[col.field] = '';
        } else if (col.field.endsWith('_days')) {
          const hoursField = col.field.replace('_days', '_hours');
          enriched[col.field] = activity[hoursField];
        }
      });

      return enriched;
    });
  }, [activities, layout.columns, codeAssignments]);

  // Step 2: Filter, sort, group
  const groupedActivities = useMemo(() => {
    let result = [...processedActivities];
    const qf = layout.quickFilters;

    // --- Quick filters ---

    // WBS selection with descendant expansion (uses childrenMap for O(N) not O(N²))
    if (qf.selectedWbsIds.length > 0) {
      const childrenMap = new Map<string, string[]>();
      wbsMap.forEach((wbs, id) => {
        if (wbs.parent_wbs_id) {
          if (!childrenMap.has(wbs.parent_wbs_id)) childrenMap.set(wbs.parent_wbs_id, []);
          childrenMap.get(wbs.parent_wbs_id)!.push(id);
        }
      });

      const selectedWbsSet = new Set<string>();
      function addDescendants(wbsId: string) {
        selectedWbsSet.add(wbsId);
        (childrenMap.get(wbsId) || []).forEach(childId => addDescendants(childId));
      }
      qf.selectedWbsIds.forEach(id => addDescendants(id));
      result = result.filter(a => a.wbs_id && selectedWbsSet.has(a.wbs_id));
    }

    if (qf.activityStatus !== 'all') {
      result = result.filter(a => {
        switch (qf.activityStatus) {
          case 'not_completed': return a.activity_status !== 'complete';
          case 'in_progress': return a.activity_status === 'in_progress';
          case 'completed': return a.activity_status === 'complete';
          case 'not_started': return a.activity_status === 'not_started';
          default: return true;
        }
      });
    }

    if (qf.criticality !== 'all') {
      result = result.filter(a => {
        const calendar = calendars.find(c => c.id === a.calendar_id);
        const hoursPerDay = calendar?.hours_per_day || 8;
        const floatDays = (a.total_float_hours || 0) / hoursPerDay;
        switch (qf.criticality) {
          case 'critical': return floatDays <= 0 || a.is_critical === true;
          case 'crit_and_near_critical': return floatDays <= nearCriticalThreshold;
          case 'non_critical': return floatDays > 0 && a.is_critical !== true;
          default: return true;
        }
      });
    }

    if (qf.timeframe !== 'all' && version?.data_date) {
      const dataDateMs = new Date(version.data_date).getTime();
      const DAY_MS = 86400000;
      let windowStart: number, windowEnd: number;
      switch (qf.timeframe) {
        case '3_week_lookahead': windowStart = dataDateMs - (7 * DAY_MS); windowEnd = dataDateMs + (21 * DAY_MS); break;
        case '3_month_lookahead': windowStart = dataDateMs - (14 * DAY_MS); windowEnd = dataDateMs + (90 * DAY_MS); break;
        case '1_month_lookback': windowStart = dataDateMs - (30 * DAY_MS); windowEnd = dataDateMs; break;
        default: windowStart = -Infinity; windowEnd = Infinity;
      }
      result = result.filter(a => {
        const start = a.actual_start || a.early_start;
        const finish = a.actual_finish || a.early_finish;
        if (!start || !finish) return false;
        return new Date(start).getTime() <= windowEnd && new Date(finish).getTime() >= windowStart;
      });
    }

    if (qf.selectedCodeValueIds.length > 0 && quickFilterCodeAssignments.size > 0) {
      const matchingIds = new Set<string>();
      qf.selectedCodeValueIds.forEach(cvId => {
        const actIds = quickFilterCodeAssignments.get(cvId);
        if (actIds) actIds.forEach(id => matchingIds.add(id));
      });
      result = result.filter(a => matchingIds.has(a.id));
    }

    // --- Advanced filters ---
    if (layout.filters.length > 0) {
      result = result.filter(activity => {
        return layout.filters.every((filter, index) => {
          const value = activity[filter.field];
          const matches = evaluateFilter(value, filter.operator, filter.value, filter.value2);
          if (index === 0) return matches;
          return filter.combinator === 'AND' ? matches : true;
        });
      });
    }

    // --- Sort helper ---
    const sortActivities = (items: Activity[]): Activity[] => {
      if (layout.sorts.length === 0) return items;
      return [...items].sort((a, b) => {
        for (const sort of layout.sorts) {
          let aVal = a[sort.field] ?? '';
          let bVal = b[sort.field] ?? '';
          if (aVal < bVal) return sort.direction === 'asc' ? -1 : 1;
          if (aVal > bVal) return sort.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    };

    // --- Grouping ---
    if (layout.grouping.type === 'none') {
      return sortActivities(result).map(act => ({ type: 'activity' as const, activity: act }));
    }

    if (layout.grouping.type === 'wbs') {
      return buildWbsGroupedList(result, wbsMap, sortActivities);
    }

    return buildCodeGroupedList(result, codeAssignments, layout.grouping.codeTypeId, sortActivities);

  }, [processedActivities, layout.grouping, layout.filters, layout.sorts, layout.quickFilters, codeAssignments, wbsMap, calendars, version?.data_date, nearCriticalThreshold, quickFilterCodeAssignments]);

  return { processedActivities, groupedActivities, nearCriticalThreshold };
}


// ============================================================================
// WBS grouping
// ============================================================================

function buildWbsGroupedList(
  filteredActivities: Activity[], wbsMap: Map<string, any>,
  sortActivities: (items: Activity[]) => Activity[]
): GroupedItem[] {
  const wbsArray = Array.from(wbsMap.values());
  const childrenMap = new Map<string, any[]>();
  const rootWbs: any[] = [];

  wbsArray.forEach(w => {
    if (!w.parent_wbs_id) { rootWbs.push(w); }
    else {
      if (!childrenMap.has(w.parent_wbs_id)) childrenMap.set(w.parent_wbs_id, []);
      childrenMap.get(w.parent_wbs_id)!.push(w);
    }
  });
  rootWbs.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  if (wbsArray.length === 0 || rootWbs.length === 0) {
    return filteredActivities.map(act => ({ type: 'activity' as const, activity: act }));
  }

  const wbsActivities = new Map<string, Activity[]>();
  const orphaned: Activity[] = [];
  filteredActivities.forEach(activity => {
    if (activity.wbs_id && wbsMap.has(activity.wbs_id)) {
      if (!wbsActivities.has(activity.wbs_id)) wbsActivities.set(activity.wbs_id, []);
      wbsActivities.get(activity.wbs_id)!.push(activity);
    } else { orphaned.push(activity); }
  });

  const descendantCache = new Map<string, number>();
  function countDescendants(nodeId: string): number {
    if (descendantCache.has(nodeId)) return descendantCache.get(nodeId)!;
    let count = (wbsActivities.get(nodeId) || []).length;
    (childrenMap.get(nodeId) || []).forEach(child => { count += countDescendants(child.id); });
    descendantCache.set(nodeId, count);
    return count;
  }

  const output: GroupedItem[] = [];

  function walk(wbsId: string, level: number = 0) {
    const wbs = wbsMap.get(wbsId);
    if (!wbs) return;
    const totalActivities = countDescendants(wbsId);
    if (totalActivities === 0) return;

    const directActivities = sortActivities(wbsActivities.get(wbsId) || []);
    output.push({ type: 'group', groupKey: wbsId, groupLabel: wbs.wbs_name, activities: directActivities, level, totalActivities });
    directActivities.forEach(activity => { output.push({ type: 'activity', activity }); });

    const children = (childrenMap.get(wbsId) || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
    children.forEach((child: any) => walk(child.id, level + 1));
  }

  rootWbs.forEach(wbs => walk(wbs.id));

  if (orphaned.length > 0) {
    const sorted = sortActivities(orphaned);
    output.push({ type: 'group', groupKey: '__orphaned__', groupLabel: '(No WBS)', activities: sorted, level: 0 });
    sorted.forEach(activity => { output.push({ type: 'activity', activity }); });
  }

  if (output.length === 0) {
    return filteredActivities.map(act => ({ type: 'activity' as const, activity: act }));
  }

  return output;
}


// ============================================================================
// Code grouping
// ============================================================================

function buildCodeGroupedList(
  filteredActivities: Activity[], codeAssignments: CodeAssignmentMap,
  codeTypeId: string | undefined, sortActivities: (items: Activity[]) => Activity[]
): GroupedItem[] {
  const groups = new Map<string, { label: string; activities: Activity[] }>();

  filteredActivities.forEach(activity => {
    let groupKey = '(None)', groupLabel = '(None)';
    if (codeTypeId) {
      const activityCodes = codeAssignments.get(activity.id);
      const codeValue = activityCodes?.get(codeTypeId);
      if (codeValue) { groupLabel = codeValue; groupKey = codeValue; }
    }
    if (!groups.has(groupKey)) groups.set(groupKey, { label: groupLabel, activities: [] });
    groups.get(groupKey)!.activities.push(activity);
  });

  const output: GroupedItem[] = [];
  groups.forEach((groupData, groupKey) => {
    const sorted = sortActivities(groupData.activities);
    output.push({ type: 'group', groupKey, groupLabel: groupData.label, activities: sorted, level: 0 });
    sorted.forEach(activity => { output.push({ type: 'activity', activity }); });
  });

  return output;
}
