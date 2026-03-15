import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { ChevronUp, ChevronDown, ChevronRight } from 'lucide-react';
import { useGanttLayout } from '../../contexts/GanttLayoutContext';
import { hoursToWorkingDays, hoursToDays, formatDate } from '../../lib/dateUtils';

interface Activity {
  id: string;
  [key: string]: any;
}

interface Calendar {
  id: string;
  hours_per_day: number;
}

interface ActivityTableAdvancedProps {
  activities: Activity[];
  calendars: Calendar[];
  selectedActivity: Activity | null;
  onSelectActivity: (activity: Activity) => void;
  codeAssignments: Map<string, Map<string, string>>;
  customFieldValues: Map<string, Map<string, any>>;
  wbsMap: Map<string, any>;
  tracedActivityIds: Set<string>;
  groupedActivitiesFromParent?: Array<{ type: 'group' | 'activity'; groupKey?: string; groupLabel?: string; activities?: Activity[]; activity?: Activity; level?: number }>;
}

const ROW_HEIGHT = 26;
const HEADER_HEIGHT = 40;

export default function ActivityTableAdvanced({
  activities,
  calendars,
  selectedActivity,
  onSelectActivity,
  codeAssignments,
  customFieldValues,
  wbsMap,
  tracedActivityIds,
  groupedActivitiesFromParent
}: ActivityTableAdvancedProps) {
  const { layout, updateSorts, updateColumns } = useGanttLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const lastClickTimeRef = useRef<number>(0);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const calendarMap = useMemo(() => {
    const map = new Map<string, Calendar>();
    calendars.forEach(cal => map.set(cal.id, cal));
    return map;
  }, [calendars]);

  const processedActivities = useMemo(() => {
    let result = [...activities];

    result = result.map(activity => {
      const enriched: any = { ...activity };

      layout.columns.forEach(col => {
        if (col.source === 'code' && col.sourceId) {
          const activityCodes = codeAssignments.get(activity.id);
          enriched[col.field] = activityCodes?.get(col.sourceId) || '';
        } else if (col.source === 'custom' && col.sourceId) {
          const activityFields = customFieldValues.get(activity.id);
          enriched[col.field] = activityFields?.get(col.sourceId) || '';
        }
      });

      return enriched;
    });

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

    if (layout.sorts.length > 0) {
      result.sort((a, b) => {
        for (const sort of layout.sorts) {
          let aVal = a[sort.field];
          let bVal = b[sort.field];

          if (aVal === null || aVal === undefined) aVal = '';
          if (bVal === null || bVal === undefined) bVal = '';

          if (aVal < bVal) return sort.direction === 'asc' ? -1 : 1;
          if (aVal > bVal) return sort.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    return result;
  }, [activities, layout.filters, layout.sorts, layout.columns, codeAssignments, customFieldValues]);

  const groupedActivities = useMemo(() => {
    if (groupedActivitiesFromParent) {
      const result: Array<{ type: 'group' | 'activity'; groupKey?: string; groupLabel?: string; activities?: Activity[]; activity?: Activity; level?: number }> = [];
      const collapsedStack: Array<{ key: string; level: number }> = [];

      for (const item of groupedActivitiesFromParent) {
        if (item.type === 'group') {
          while (collapsedStack.length > 0 && collapsedStack[collapsedStack.length - 1].level >= (item.level || 0)) {
            collapsedStack.pop();
          }

          if (collapsedStack.length === 0) {
            result.push(item);
          }

          if (collapsedGroups.has(item.groupKey!)) {
            collapsedStack.push({ key: item.groupKey!, level: item.level || 0 });
          }
        } else if (item.type === 'activity') {
          if (collapsedStack.length === 0) {
            result.push(item);
          }
        }
      }

      return result;
    }

    if (layout.grouping.type === 'none') {
      return processedActivities.map(act => ({ type: 'activity' as const, activity: act }));
    }

    const groups = new Map<string, Activity[]>();

    processedActivities.forEach(activity => {
      let groupKey = '';
      let groupLabel = '';

      if (layout.grouping.type === 'wbs' && activity.wbs_id) {
        const wbs = wbsMap.get(activity.wbs_id);
        groupKey = activity.wbs_id;
        groupLabel = wbs?.wbs_name || 'Unknown WBS';
      } else if (layout.grouping.type === 'code' && layout.grouping.codeTypeId) {
        const activityCodes = codeAssignments.get(activity.id);
        groupLabel = activityCodes?.get(layout.grouping.codeTypeId) || '(None)';
        groupKey = groupLabel;
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(activity);
    });

    const result: Array<{ type: 'group' | 'activity'; groupKey?: string; groupLabel?: string; activities?: Activity[]; activity?: Activity; level?: number }> = [];

    groups.forEach((activities, groupKey) => {
      result.push({
        type: 'group',
        groupKey,
        groupLabel: groupKey,
        activities,
        level: 0
      });

      if (!collapsedGroups.has(groupKey)) {
        activities.forEach(activity => {
          result.push({ type: 'activity', activity });
        });
      }
    });

    return result;
  }, [processedActivities, layout.grouping, codeAssignments, wbsMap, collapsedGroups, groupedActivitiesFromParent]);

  function evaluateFilter(value: any, operator: string, filterValue: any, filterValue2?: any): boolean {
    if (operator === 'isBlank') return value === null || value === undefined || value === '';
    if (operator === 'isNotBlank') return value !== null && value !== undefined && value !== '';

    const strValue = String(value || '').toLowerCase();
    const strFilter = String(filterValue || '').toLowerCase();

    switch (operator) {
      case 'equals': return strValue === strFilter;
      case 'notEquals': return strValue !== strFilter;
      case 'contains': return strValue.includes(strFilter);
      case 'greaterThan': return value > filterValue;
      case 'lessThan': return value < filterValue;
      case 'between': return value >= filterValue && value <= filterValue2;
      default: return true;
    }
  }

  function handleColumnHeaderClick(field: string, shiftKey: boolean) {
    if (shiftKey) {
      const existingIndex = layout.sorts.findIndex(s => s.field === field);
      if (existingIndex >= 0) {
        const currentSort = layout.sorts[existingIndex];
        if (currentSort.direction === 'asc') {
          const newSorts = [...layout.sorts];
          newSorts[existingIndex] = { field, direction: 'desc' };
          updateSorts(newSorts);
        } else {
          updateSorts(layout.sorts.filter(s => s.field !== field));
        }
      } else {
        updateSorts([...layout.sorts, { field, direction: 'asc' }]);
      }
    } else {
      const existing = layout.sorts.find(s => s.field === field);
      if (existing) {
        if (existing.direction === 'asc') {
          updateSorts([{ field, direction: 'desc' }]);
        } else {
          updateSorts([]);
        }
      } else {
        updateSorts([{ field, direction: 'asc' }]);
      }
    }
  }

  function handleResizeStart(e: React.MouseEvent, columnId: string, currentWidth: number) {
    e.preventDefault();
    setResizingColumn(columnId);
    setResizeStartX(e.clientX);
    setResizeStartWidth(currentWidth);
  }

  useEffect(() => {
    if (!resizingColumn) return;

    function handleMouseMove(e: MouseEvent) {
      const delta = e.clientX - resizeStartX;
      const newWidth = Math.max(60, resizeStartWidth + delta);

      const updated = layout.columns.map(col =>
        col.id === resizingColumn ? { ...col, width: newWidth } : col
      );
      updateColumns(updated);
    }

    function handleMouseUp() {
      setResizingColumn(null);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn, resizeStartX, resizeStartWidth, layout.columns, updateColumns]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    function handleScroll() {
      if (scrollContainer) {
        const event = new CustomEvent('activity-table-scroll', {
          detail: { scrollTop: scrollContainer.scrollTop }
        });
        window.dispatchEvent(event);
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    function handleGanttScroll(e: Event) {
      const customEvent = e as CustomEvent;
      if (scrollContainerRef.current && customEvent.detail?.scrollTop !== undefined) {
        scrollContainerRef.current.scrollTop = customEvent.detail.scrollTop;
      }
    }

    window.addEventListener('gantt-scroll', handleGanttScroll);
    return () => window.removeEventListener('gantt-scroll', handleGanttScroll);
  }, []);

  const flatActivities = useMemo(() => {
    return groupedActivities
      .filter(item => item.type === 'activity')
      .map(item => item.activity!);
  }, [groupedActivities]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      e.preventDefault();

      if (flatActivities.length === 0) return;

      const currentIndex = selectedActivity
        ? flatActivities.findIndex(a => a.id === selectedActivity.id)
        : -1;

      let newIndex: number;
      if (e.key === 'ArrowDown') {
        newIndex = currentIndex < flatActivities.length - 1 ? currentIndex + 1 : currentIndex;
      } else {
        newIndex = currentIndex > 0 ? currentIndex - 1 : 0;
      }

      if (newIndex >= 0 && newIndex < flatActivities.length) {
        const newActivity = flatActivities[newIndex];
        onSelectActivity(newActivity);

        if (scrollContainerRef.current) {
          const visualIndex = groupedActivities.findIndex(item =>
            item.type === 'activity' && item.activity?.id === newActivity.id
          );

          if (visualIndex >= 0) {
            const rowTop = visualIndex * ROW_HEIGHT;
            const rowBottom = rowTop + ROW_HEIGHT;
            const containerHeight = scrollContainerRef.current.clientHeight;
            const scrollTop = scrollContainerRef.current.scrollTop;

            if (rowBottom > scrollTop + containerHeight) {
              scrollContainerRef.current.scrollTop = rowBottom - containerHeight;
            } else if (rowTop < scrollTop) {
              scrollContainerRef.current.scrollTop = rowTop;
            }
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flatActivities, groupedActivities, selectedActivity, onSelectActivity]);

  function formatValue(value: any, column: any, activity: Activity): string {
    if (value === null || value === undefined) return '-';

    if (column.dataType === 'date') {
      return formatDate(value);
    }

    if (column.dataType === 'duration') {
      const calendar = calendarMap.get(activity.calendar_id || '');
      const hoursPerDay = calendar?.hours_per_day || 8;
      return hoursToDays(value, hoursPerDay);
    }

    if (column.dataType === 'number') {
      if (column.field.endsWith('_hours') || column.field.endsWith('_days') || column.field.includes('duration') || column.field.includes('float') || column.field.includes('lag')) {
        const calendar = calendarMap.get(activity.calendar_id || '');
        const hoursPerDay = calendar?.hours_per_day || 8;
        return hoursToWorkingDays(value, hoursPerDay);
      }

      if (value === 0) return '0';
      return value.toString();
    }

    if (column.dataType === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    return String(value);
  }

  const handleActivityClick = useCallback((activity: Activity) => {
    const now = Date.now();
    if (now - lastClickTimeRef.current < 100) {
      return;
    }
    lastClickTimeRef.current = now;

    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
    }

    clickTimeoutRef.current = setTimeout(() => {
      try {
        onSelectActivity(activity);
      } catch (error) {
        console.error('Error selecting activity:', error);
      }
      clickTimeoutRef.current = null;
    }, 50);
  }, [onSelectActivity]);

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedActivity || !scrollContainerRef.current) return;

    const rowIndex = groupedActivities.findIndex(item =>
      item.type === 'activity' && item.activity?.id === selectedActivity.id
    );

    if (rowIndex !== -1) {
      const scrollTop = rowIndex * ROW_HEIGHT;
      const containerHeight = scrollContainerRef.current.clientHeight;
      const currentScrollTop = scrollContainerRef.current.scrollTop;

      if (scrollTop < currentScrollTop || scrollTop > currentScrollTop + containerHeight - ROW_HEIGHT) {
        scrollContainerRef.current.scrollTop = scrollTop - containerHeight / 2 + ROW_HEIGHT / 2;
      }
    }
  }, [selectedActivity, groupedActivities]);

  function toggleGroup(groupKey: string) {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(groupKey)) {
      newCollapsed.delete(groupKey);
    } else {
      newCollapsed.add(groupKey);
    }
    setCollapsedGroups(newCollapsed);

    const event = new CustomEvent('collapsed-groups-change', {
      detail: { collapsedGroups: newCollapsed }
    });
    window.dispatchEvent(event);
  }

  const visibleColumns = layout.columns.filter(col => col.visible);
  const totalWidth = visibleColumns.reduce((sum, col) => sum + col.width, 0);

  return (
    <div ref={containerRef} className="h-full w-full bg-white overflow-hidden flex flex-col">
      <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50 overflow-hidden" style={{ height: HEADER_HEIGHT, minHeight: HEADER_HEIGHT, maxHeight: HEADER_HEIGHT, boxSizing: 'border-box' }}>
        <div style={{ width: totalWidth }}>
          <div className="flex">
            {visibleColumns.map((column, index) => {
              const sortInfo = layout.sorts.find(s => s.field === column.field);
              const sortIndex = layout.sorts.findIndex(s => s.field === column.field);

              const isNumericColumn = column.dataType === 'number' || column.dataType === 'duration';

              return (
                <div
                  key={column.id}
                  className="relative flex items-center border-r border-gray-200 px-3 bg-gray-50 select-none"
                  style={{ width: column.width, height: HEADER_HEIGHT }}
                >
                  <div
                    className={`flex-1 flex items-center gap-1 cursor-pointer hover:bg-gray-100 -mx-3 px-3 h-full ${isNumericColumn ? 'justify-end' : ''}`}
                    onDoubleClick={(e) => handleColumnHeaderClick(column.field, e.shiftKey)}
                  >
                    <span className="text-xs font-semibold text-gray-700 truncate">
                      {column.label}
                    </span>
                    {sortInfo && (
                      <div className="flex items-center gap-1">
                        {sortInfo.direction === 'asc' ? (
                          <ChevronUp className="w-3 h-3 text-gray-600" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-gray-600" />
                        )}
                        {layout.sorts.length > 1 && (
                          <span className="text-[10px] text-gray-500">{sortIndex + 1}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400"
                    onMouseDown={(e) => handleResizeStart(e, column.id, column.width)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <div style={{ width: totalWidth }}>
          {groupedActivities.map((item, index) => {
            if (item.type === 'group') {
              const isCollapsed = collapsedGroups.has(item.groupKey!);
              const level = item.level || 0;
              const indent = level * 20;

              const bgColorClass = level === 0 ? 'bg-gray-200' : level === 1 ? 'bg-gray-150' : level === 2 ? 'bg-gray-100' : 'bg-gray-50';
              const hoverColorClass = level === 0 ? 'hover:bg-gray-300' : level === 1 ? 'hover:bg-gray-200' : 'hover:bg-gray-150';
              const textSizeClass = level === 0 ? 'text-base font-bold' : level === 1 ? 'text-sm font-semibold' : 'text-xs font-medium';

              return (
                <div
                  key={`group-${item.groupKey}`}
                  className={`flex items-center ${bgColorClass} border-b border-gray-300 cursor-pointer ${hoverColorClass}`}
                  style={{ height: ROW_HEIGHT, minHeight: ROW_HEIGHT, maxHeight: ROW_HEIGHT, boxSizing: 'border-box', overflow: 'hidden' }}
                  onClick={() => toggleGroup(item.groupKey!)}
                >
                  <div className="flex items-center gap-2 px-3" style={{ paddingLeft: `${12 + indent}px` }}>
                    <ChevronRight
                      className={`w-4 h-4 text-gray-600 transition-transform ${isCollapsed ? '' : 'transform rotate-90'}`}
                    />
                    <span className={`${textSizeClass} text-gray-900`}>
                      {item.groupLabel} ({(item as any).totalActivities ?? item.activities?.length ?? 0})
                    </span>
                  </div>
                </div>
              );
            }

            const activity = item.activity!;
            const isSelected = selectedActivity?.id === activity.id;
            const isTraced = tracedActivityIds.has(activity.id);
            return (
              <div
                key={activity.id}
                className={`flex border-b border-gray-100 cursor-pointer ${
                  isSelected ? 'bg-yellow-100' : isTraced ? 'bg-orange-50' : 'bg-white hover:bg-gray-50'
                }`}
                style={{ height: ROW_HEIGHT, minHeight: ROW_HEIGHT, maxHeight: ROW_HEIGHT, boxSizing: 'border-box', overflow: 'hidden' }}
                onClick={() => handleActivityClick(activity)}
              >
                {visibleColumns.map(column => {
                  const isNumericColumn = column.dataType === 'number' || column.dataType === 'duration';
                  return (
                    <div
                      key={column.id}
                      className={`border-r border-gray-100 px-3 text-xs flex items-center overflow-hidden ${isNumericColumn ? 'justify-end' : ''}`}
                      style={{ width: column.width }}
                    >
                      <span className="truncate">
                        {formatValue(activity[column.field], column, activity)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
