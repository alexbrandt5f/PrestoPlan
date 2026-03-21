import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Calendar as CalendarIcon, ArrowLeft } from 'lucide-react';
import ResizablePanels from '../components/gantt/ResizablePanels';
import ActivityTable from '../components/gantt/ActivityTable';
import GanttChart from '../components/gantt/GanttChart';
import ActivityDetail from '../components/gantt/ActivityDetail';

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
  is_critical: boolean | null;
}

interface Calendar {
  id: string;
  calendar_name: string;
  hours_per_day: number;
}

interface ScheduleVersion {
  id: string;
  version_label: string;
  data_date: string | null;
}

export default function GanttViewer() {
  const { projectId, versionId } = useParams<{ projectId: string; versionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState<ScheduleVersion | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);

  useEffect(() => {
    if (!user || !projectId || !versionId) return;
    loadData();
  }, [user, projectId, versionId]);

  async function loadData() {
    try {
      setLoading(true);

      console.log('Loading Gantt data for version:', versionId);

      const [versionRes, activitiesRes, calendarsRes] = await Promise.all([
        supabase
          .from('schedule_versions')
          .select('id, version_label, data_date')
          .eq('id', versionId)
          .maybeSingle(),
        supabase
          .from('cpm_activities')
          .select('*')
          .eq('schedule_version_id', versionId)
          .order('early_start', { ascending: true }),
        supabase
          .from('cpm_calendars')
          .select('id, calendar_name, hours_per_day')
          .eq('schedule_version_id', versionId),
      ]);

      console.log('Version query result:', versionRes);
      console.log('Activities query result:', activitiesRes);
      console.log('Calendars query result:', calendarsRes);

      if (versionRes.error) throw versionRes.error;
      if (activitiesRes.error) throw activitiesRes.error;
      if (calendarsRes.error) throw calendarsRes.error;

      if (!versionRes.data) {
        showToast('Schedule version not found', 'error');
        navigate(`/project/${projectId}`);
        return;
      }

      setVersion(versionRes.data);
      setActivities(activitiesRes.data || []);
      setCalendars(calendarsRes.data || []);

      console.log('Loaded activities count:', activitiesRes.data?.length);
      console.log('Loaded calendars count:', calendarsRes.data?.length);
    } catch (error) {
      console.error('Error loading Gantt data:', error);
      showToast('Failed to load schedule data', 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleGoToDataDate() {
    if (!version?.data_date) return;
    const event = new CustomEvent('gantt-goto-date', { detail: version.data_date });
    window.dispatchEvent(event);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="h-8 w-8 bg-gray-200 animate-pulse rounded"></div>
            <div className="h-6 w-64 bg-gray-200 animate-pulse rounded"></div>
          </div>
        </div>
        <div className="p-8">
          <div className="h-96 bg-gray-200 animate-pulse rounded-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(`/project/${projectId}`)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div className="flex items-center gap-3">
              <CalendarIcon className="w-6 h-6 text-blue-600" />
              <div>
                <h1 className="text-lg font-semibold text-gray-900">{version?.version_label}</h1>
                <p className="text-sm text-gray-500">
                  {activities.length.toLocaleString()} activities
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {version?.data_date && (
              <button
                onClick={handleGoToDataDate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                Go to Data Date
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <ResizablePanels
          leftPanel={
            <ActivityTable
              activities={activities}
              calendars={calendars}
              selectedActivity={selectedActivity}
              onSelectActivity={setSelectedActivity}
            />
          }
          rightPanel={
            <GanttChart
              activities={activities}
              calendars={calendars}
              selectedActivity={selectedActivity}
              dataDate={version?.data_date || null}
              scheduleVersionId={versionId || ''}
            />
          }
          bottomPanel={
            <ActivityDetail
              activity={selectedActivity}
              calendars={calendars}
            />
          }
        />
      </div>
    </div>
  );
}
