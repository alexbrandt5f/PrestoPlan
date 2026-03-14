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

  return (
    <div className="h-full overflow-auto p-6 bg-white">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Activity Details</h2>

      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-200">
            General Information
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Activity ID</label>
              <p className="text-sm text-gray-900">{activity.activity_id_display}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Activity Type</label>
              <p className="text-sm text-gray-900">{formatActivityType(activity.activity_type)}</p>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Activity Name</label>
              <p className="text-sm text-gray-900">{activity.activity_name}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <p className="text-sm text-gray-900">{formatStatus(activity.activity_status)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Calendar</label>
              <p className="text-sm text-gray-900">{calendar?.calendar_name || '-'}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-200">
            Schedule Dates
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Early Start</label>
              <p className="text-sm text-gray-900">{formatDate(activity.early_start)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Early Finish</label>
              <p className="text-sm text-gray-900">{formatDate(activity.early_finish)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Late Start</label>
              <p className="text-sm text-gray-900">{formatDate(activity.late_start)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Late Finish</label>
              <p className="text-sm text-gray-900">{formatDate(activity.late_finish)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Actual Start</label>
              <p className="text-sm text-gray-900">{formatDate(activity.actual_start)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Actual Finish</label>
              <p className="text-sm text-gray-900">{formatDate(activity.actual_finish)}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-200">
            Duration & Float
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Original Duration</label>
              <p className="text-sm text-gray-900 tabular-nums">{getWorkingDays(activity.original_duration_hours)} days</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Remaining Duration</label>
              <p className="text-sm text-gray-900 tabular-nums">{getWorkingDays(activity.remaining_duration_hours)} days</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Total Float</label>
              <p className="text-sm text-gray-900 tabular-nums">{getWorkingDays(activity.total_float_hours)} days</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Free Float</label>
              <p className="text-sm text-gray-900 tabular-nums">{getWorkingDays(activity.free_float_hours)} days</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-200">
            Progress
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Physical % Complete</label>
              <p className="text-sm text-gray-900 tabular-nums">
                {activity.physical_percent_complete !== null ? `${activity.physical_percent_complete.toFixed(1)}%` : '-'}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Duration % Complete</label>
              <p className="text-sm text-gray-900 tabular-nums">
                {activity.duration_percent_complete !== null ? `${activity.duration_percent_complete.toFixed(1)}%` : '-'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
