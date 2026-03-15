import { useMemo } from 'react';

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

interface ActivityDetailProps {
  activity: Activity | null;
  calendars: Calendar[];
}

export default function ActivityDetail({ activity, calendars }: ActivityDetailProps) {
  const calendar = useMemo(() => {
    if (!activity?.calendar_id) return null;
    return calendars.find(cal => cal.id === activity.calendar_id) || null;
  }, [activity?.calendar_id, calendars]);

  function getWorkingDays(hours: number | null): string {
    if (hours === null || hours === undefined) return '-';
    const hoursPerDay = calendar?.hours_per_day || 8;
    const days = hours / hoursPerDay;
    return days.toFixed(1);
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function formatActivityType(type: string): string {
    const typeMap: Record<string, string> = {
      'task_dependent': 'Task Dependent',
      'resource_dependent': 'Resource Dependent',
      'level_of_effort': 'Level of Effort',
      'start_milestone': 'Start Milestone',
      'finish_milestone': 'Finish Milestone',
      'wbs_summary': 'WBS Summary',
    };
    return typeMap[type] || type;
  }

  function formatStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'not_started': 'Not Started',
      'in_progress': 'In Progress',
      'complete': 'Complete',
    };
    return statusMap[status] || status;
  }

  if (!activity) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <p>Select an activity to view details</p>
      </div>
    );
  }

  const isCritical = activity.total_float_hours !== null && activity.total_float_hours <= 0;

  return (
    <div className="h-full overflow-auto p-6 bg-white">
      <div className="grid grid-cols-[120px_1fr_120px_1fr_120px_1fr] gap-x-4 gap-y-4 text-sm">
        <label className="font-medium text-gray-900">ID</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">{activity.activity_id_display}</span>
        </div>

        <label className="font-medium text-gray-900">Name</label>
        <div className="col-span-3 border-b border-gray-300 pb-1">
          <span className="text-gray-900">{activity.activity_name}</span>
        </div>

        <label className="font-medium text-gray-900">Start</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">{formatDate(activity.early_start)}</span>
        </div>

        <label className="font-medium text-gray-900">Finish</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">{formatDate(activity.early_finish)}</span>
        </div>

        <label className="font-medium text-gray-900">Expected Finish</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">{formatDate(activity.actual_finish || activity.early_finish)}</span>
        </div>

        <label className="font-medium text-gray-900">Base Start</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">{formatDate(activity.early_start)}</span>
        </div>

        <label className="font-medium text-gray-900">Base Finish</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">{formatDate(activity.early_finish)}</span>
        </div>

        <label className="font-medium text-gray-900">Criticality</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">{isCritical ? 'Critical' : 'Non-Critical'}</span>
        </div>

        <label className="font-medium text-gray-900">Act % Cmpl</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900 tabular-nums">
            {activity.physical_percent_complete !== null ? `${activity.physical_percent_complete.toFixed(1)}%` : '-'}
          </span>
        </div>

        <label className="font-medium text-gray-900">Base % Cmpl</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900 tabular-nums">
            {activity.duration_percent_complete !== null ? `${activity.duration_percent_complete.toFixed(1)}%` : '-'}
          </span>
        </div>

        <label className="font-medium text-gray-900">Total Float</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900 tabular-nums">{getWorkingDays(activity.total_float_hours)}</span>
        </div>

        <label className="font-medium text-gray-900">Pri Constraint</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">-</span>
        </div>

        <label className="font-medium text-gray-900">Date</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">-</span>
        </div>

        <label className="font-medium text-gray-900">Free Float</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900 tabular-nums">{getWorkingDays(activity.free_float_hours)}</span>
        </div>

        <label className="font-medium text-gray-900">Sec Constraint</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">-</span>
        </div>

        <label className="font-medium text-gray-900">Date</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">-</span>
        </div>

        <label className="font-medium text-gray-900">Calendar</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900">{calendar?.calendar_name || '-'}</span>
        </div>

        <div className="col-span-6 mt-4" />

        <label className="font-medium text-gray-900">Orig Dur</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900 tabular-nums">{getWorkingDays(activity.original_duration_hours)}</span>
        </div>

        <label className="font-medium text-gray-900">Act Dur</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900 tabular-nums">
            {activity.physical_percent_complete !== null && activity.original_duration_hours !== null
              ? ((activity.original_duration_hours * activity.physical_percent_complete) / 100 / (calendar?.hours_per_day || 8)).toFixed(1)
              : '-'}
          </span>
        </div>

        <label className="font-medium text-gray-900">Rem Dur</label>
        <div className="border-b border-gray-300 pb-1">
          <span className="text-gray-900 tabular-nums">{getWorkingDays(activity.remaining_duration_hours)}</span>
        </div>

        <label className="font-medium text-gray-900">At Compl</label>
        <div className="col-span-2 border-b border-gray-300 pb-1">
          <span className="text-gray-900 tabular-nums">
            {activity.original_duration_hours !== null && activity.remaining_duration_hours !== null && activity.physical_percent_complete !== null
              ? ((activity.original_duration_hours * activity.physical_percent_complete) / 100 / (calendar?.hours_per_day || 8) + activity.remaining_duration_hours / (calendar?.hours_per_day || 8)).toFixed(1)
              : '-'}
          </span>
        </div>
      </div>
    </div>
  );
}
