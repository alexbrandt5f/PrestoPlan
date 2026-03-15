import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface Activity {
  id: string;
  activity_id_display: string;
  activity_name: string;
  activity_type: string;
  activity_status: string;
  calendar_id: string | null;
  early_start: string | null;
  early_finish: string | null;
  late_start: string | null;
  late_finish: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  original_duration_hours: number | null;
  remaining_duration_hours: number | null;
  total_float_hours: number | null;
  free_float_hours: number | null;
  physical_percent_complete: number | null;
  duration_percent_complete: number | null;
}

interface Calendar {
  id: string;
  calendar_name: string;
  hours_per_day: number;
}

interface ActivityTableProps {
  activities: Activity[];
  calendars: Calendar[];
  selectedActivity: Activity | null;
  onSelectActivity: (activity: Activity) => void;
}

type SortColumn = 'activity_id_display' | 'activity_name' | 'original_duration_hours' | 'early_start' | 'early_finish' | 'total_float_hours';
type SortDirection = 'asc' | 'desc';

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 40;

const COLUMN_WIDTHS = {
  activityId: 100,
  activityName: 250,
  origDur: 70,
  earlyStart: 90,
  earlyFinish: 90,
  totalFloat: 70
};

export default function ActivityTable({ activities, calendars, selectedActivity, onSelectActivity }: ActivityTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('early_start');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const calendarMap = useMemo(() => {
    const map = new Map<string, Calendar>();
    calendars.forEach(cal => map.set(cal.id, cal));
    return map;
  }, [calendars]);

  function getWorkingDays(hours: number | null, calendarId: string | null, isMilestone: boolean): string {
    if (isMilestone) return '0';
    if (hours === null || hours === undefined) return '-';
    if (hours === 0) return '0';
    const calendar = calendarId ? calendarMap.get(calendarId) : null;
    const hoursPerDay = calendar?.hours_per_day || 8;
    const days = Math.round(hours / hoursPerDay);
    return days.toString();
  }

  const sortedActivities = useMemo(() => {
    const sorted = [...activities];
    sorted.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (sortColumn === 'original_duration_hours') {
        aVal = a.original_duration_hours ?? -Infinity;
        bVal = b.original_duration_hours ?? -Infinity;
      } else if (sortColumn === 'total_float_hours') {
        aVal = a.total_float_hours ?? -Infinity;
        bVal = b.total_float_hours ?? -Infinity;
      } else {
        aVal = a[sortColumn] ?? '';
        bVal = b[sortColumn] ?? '';
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [activities, sortColumn, sortDirection]);

  function handleColumnHeaderDoubleClick(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      e.preventDefault();

      if (sortedActivities.length === 0) return;

      const currentIndex = selectedActivity
        ? sortedActivities.findIndex(a => a.id === selectedActivity.id)
        : -1;

      let newIndex: number;
      if (e.key === 'ArrowDown') {
        newIndex = currentIndex < sortedActivities.length - 1 ? currentIndex + 1 : currentIndex;
      } else {
        newIndex = currentIndex > 0 ? currentIndex - 1 : 0;
      }

      if (newIndex >= 0 && newIndex < sortedActivities.length) {
        const newActivity = sortedActivities[newIndex];
        onSelectActivity(newActivity);

        if (scrollContainerRef.current) {
          const rowTop = newIndex * ROW_HEIGHT;
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sortedActivities, selectedActivity, onSelectActivity]);

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const day = date.getDate().toString().padStart(2, '0');
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const year = date.getFullYear().toString().slice(-2);
    return `${day}-${month}-${year}`;
  }

  function isMilestone(activity: Activity): boolean {
    return activity.activity_type === 'TT_Mile' || activity.original_duration_hours === 0;
  }

  const tableWidth = Object.values(COLUMN_WIDTHS).reduce((sum, width) => sum + width, 0);

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-white overflow-hidden">
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto"
        style={{ overflowX: 'auto', overflowY: 'auto' }}
      >
        <table className="border-collapse" style={{ width: tableWidth, tableLayout: 'fixed' }}>
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr className="border-b border-gray-200">
              <th
                className="border-r border-gray-200 px-3 text-left text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                style={{ width: COLUMN_WIDTHS.activityId, minWidth: COLUMN_WIDTHS.activityId, maxWidth: COLUMN_WIDTHS.activityId, height: HEADER_HEIGHT }}
                onDoubleClick={() => handleColumnHeaderDoubleClick('activity_id_display')}
              >
                <div className="flex items-center">
                  <span>Activity ID</span>
                  {sortColumn === 'activity_id_display' && (
                    sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />
                  )}
                </div>
              </th>
              <th
                className="border-r border-gray-200 px-3 text-left text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                style={{ width: COLUMN_WIDTHS.activityName, minWidth: COLUMN_WIDTHS.activityName, maxWidth: COLUMN_WIDTHS.activityName, height: HEADER_HEIGHT }}
                onDoubleClick={() => handleColumnHeaderDoubleClick('activity_name')}
              >
                <div className="flex items-center">
                  <span>Activity Name</span>
                  {sortColumn === 'activity_name' && (
                    sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />
                  )}
                </div>
              </th>
              <th
                className="border-r border-gray-200 px-3 text-right text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                style={{ width: COLUMN_WIDTHS.origDur, minWidth: COLUMN_WIDTHS.origDur, maxWidth: COLUMN_WIDTHS.origDur, height: HEADER_HEIGHT }}
                onDoubleClick={() => handleColumnHeaderDoubleClick('original_duration_hours')}
              >
                <div className="flex items-center justify-end">
                  <span>Orig Dur (d)</span>
                  {sortColumn === 'original_duration_hours' && (
                    sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />
                  )}
                </div>
              </th>
              <th
                className="border-r border-gray-200 px-3 text-left text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                style={{ width: COLUMN_WIDTHS.earlyStart, minWidth: COLUMN_WIDTHS.earlyStart, maxWidth: COLUMN_WIDTHS.earlyStart, height: HEADER_HEIGHT }}
                onDoubleClick={() => handleColumnHeaderDoubleClick('early_start')}
              >
                <div className="flex items-center">
                  <span>Early Start</span>
                  {sortColumn === 'early_start' && (
                    sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />
                  )}
                </div>
              </th>
              <th
                className="border-r border-gray-200 px-3 text-left text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                style={{ width: COLUMN_WIDTHS.earlyFinish, minWidth: COLUMN_WIDTHS.earlyFinish, maxWidth: COLUMN_WIDTHS.earlyFinish, height: HEADER_HEIGHT }}
                onDoubleClick={() => handleColumnHeaderDoubleClick('early_finish')}
              >
                <div className="flex items-center">
                  <span>Early Finish</span>
                  {sortColumn === 'early_finish' && (
                    sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />
                  )}
                </div>
              </th>
              <th
                className="px-3 text-right text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                style={{ width: COLUMN_WIDTHS.totalFloat, minWidth: COLUMN_WIDTHS.totalFloat, maxWidth: COLUMN_WIDTHS.totalFloat, height: HEADER_HEIGHT }}
                onDoubleClick={() => handleColumnHeaderDoubleClick('total_float_hours')}
              >
                <div className="flex items-center justify-end">
                  <span>Total Float (d)</span>
                  {sortColumn === 'total_float_hours' && (
                    sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />
                  )}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedActivities.map((activity) => (
              <tr
                key={activity.id}
                className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedActivity?.id === activity.id ? 'bg-yellow-50' : 'bg-white'
                }`}
                style={{ height: ROW_HEIGHT }}
                onClick={() => onSelectActivity(activity)}
              >
                <td
                  className="border-r border-gray-100 px-3 text-xs whitespace-nowrap overflow-hidden text-ellipsis"
                  style={{ width: COLUMN_WIDTHS.activityId, minWidth: COLUMN_WIDTHS.activityId, maxWidth: COLUMN_WIDTHS.activityId }}
                >
                  {activity.activity_id_display}
                </td>
                <td
                  className="border-r border-gray-100 px-3 text-xs whitespace-nowrap overflow-hidden text-ellipsis"
                  style={{ width: COLUMN_WIDTHS.activityName, minWidth: COLUMN_WIDTHS.activityName, maxWidth: COLUMN_WIDTHS.activityName }}
                >
                  {activity.activity_name}
                </td>
                <td
                  className="border-r border-gray-100 px-3 text-xs text-right tabular-nums whitespace-nowrap"
                  style={{ width: COLUMN_WIDTHS.origDur, minWidth: COLUMN_WIDTHS.origDur, maxWidth: COLUMN_WIDTHS.origDur }}
                >
                  {getWorkingDays(activity.original_duration_hours, activity.calendar_id, isMilestone(activity))}
                </td>
                <td
                  className="border-r border-gray-100 px-3 text-xs whitespace-nowrap"
                  style={{ width: COLUMN_WIDTHS.earlyStart, minWidth: COLUMN_WIDTHS.earlyStart, maxWidth: COLUMN_WIDTHS.earlyStart }}
                >
                  {formatDate(activity.early_start)}
                </td>
                <td
                  className="border-r border-gray-100 px-3 text-xs whitespace-nowrap"
                  style={{ width: COLUMN_WIDTHS.earlyFinish, minWidth: COLUMN_WIDTHS.earlyFinish, maxWidth: COLUMN_WIDTHS.earlyFinish }}
                >
                  {formatDate(activity.early_finish)}
                </td>
                <td
                  className="px-3 text-xs text-right tabular-nums whitespace-nowrap"
                  style={{ width: COLUMN_WIDTHS.totalFloat, minWidth: COLUMN_WIDTHS.totalFloat, maxWidth: COLUMN_WIDTHS.totalFloat }}
                >
                  {getWorkingDays(activity.total_float_hours, activity.calendar_id, false)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
