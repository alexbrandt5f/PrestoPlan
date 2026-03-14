import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Calendar, ArrowLeft } from 'lucide-react';
import { GanttLayoutProvider, useGanttLayout } from '../contexts/GanttLayoutContext';
import ResizablePanels from '../components/gantt/ResizablePanels';
import ActivityTableAdvanced from '../components/gantt/ActivityTableAdvanced';
import GanttChartAdvanced from '../components/gantt/GanttChartAdvanced';
import ActivityDetailTabs from '../components/gantt/ActivityDetailTabs';
import GanttToolbar from '../components/gantt/GanttToolbar';
import ColorLegend from '../components/gantt/ColorLegend';

interface Activity {
  id: string;
  [key: string]: any;
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

interface Project {
  id: string;
  settings: {
    near_critical_float_threshold?: number;
  };
}

const COLOR_PALETTE = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'
];

function GanttViewerContent() {
  const { projectId, versionId } = useParams<{ projectId: string; versionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { layout } = useGanttLayout();

  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [version, setVersion] = useState<ScheduleVersion | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [codeAssignments, setCodeAssignments] = useState<Map<string, Map<string, string>>>(new Map());
  const [customFieldValues, setCustomFieldValues] = useState<Map<string, Map<string, any>>>(new Map());
  const [wbsMap, setWbsMap] = useState<Map<string, any>>(new Map());
  const [codeColors, setCodeColors] = useState<Map<string, string>>(new Map());
  const [showColorLegend, setShowColorLegend] = useState(false);
  const [codeTypeName, setCodeTypeName] = useState('');
  const [tracedActivityIds, setTracedActivityIds] = useState<Set<string>>(new Set());
  const [backgroundLoading, setBackgroundLoading] = useState(false);

  useEffect(() => {
    if (!user || !projectId || !versionId) return;
    loadData();
  }, [user, projectId, versionId]);

  useEffect(() => {
    if (layout.viewSettings.colorByCodeTypeId) {
      generateCodeColors();
    }
  }, [layout.viewSettings.colorByCodeTypeId, activities, codeAssignments]);

  async function loadData() {
    try {
      setLoading(true);
      setLoadingProgress(10);

      const [projectRes, versionRes, calendarsRes, wbsRes] = await Promise.all([
        supabase
          .from('projects')
          .select('id, settings')
          .eq('id', projectId)
          .maybeSingle(),
        supabase
          .from('schedule_versions')
          .select('id, version_label, data_date')
          .eq('id', versionId)
          .maybeSingle(),
        supabase
          .from('cpm_calendars')
          .select('id, calendar_name, hours_per_day')
          .eq('schedule_version_id', versionId),
        supabase
          .from('cpm_wbs')
          .select('id, wbs_name, wbs_code, parent_wbs_id, level, sort_order')
          .eq('schedule_version_id', versionId)
          .order('sort_order', { ascending: true })
      ]);

      setLoadingProgress(30);

      if (projectRes.error) throw projectRes.error;
      if (versionRes.error) throw versionRes.error;
      if (calendarsRes.error) throw calendarsRes.error;

      if (!versionRes.data) {
        showToast('Schedule version not found', 'error');
        navigate(`/project/${projectId}`);
        return;
      }

      setProject(projectRes.data);
      setVersion(versionRes.data);
      setCalendars(calendarsRes.data || []);

      if (wbsRes.data) {
        const map = new Map();
        wbsRes.data.forEach(wbs => map.set(wbs.id, wbs));
        setWbsMap(map);
      }

      setLoadingProgress(50);

      const INITIAL_BATCH_SIZE = 2000;
      const BATCH_SIZE = 1000;

      const { data: firstBatch, error: firstError } = await supabase
        .from('cpm_activities')
        .select('*')
        .eq('schedule_version_id', versionId)
        .order('early_start', { ascending: true })
        .range(0, INITIAL_BATCH_SIZE - 1);

      if (firstError) throw firstError;

      setLoadingProgress(70);

      const firstBatchActivities = firstBatch || [];
      setActivities(firstBatchActivities);

      await Promise.all([
        loadCodeAssignmentsBatched([firstBatchActivities], 0),
        loadCustomFieldValuesBatched([firstBatchActivities], 0)
      ]);

      setLoadingProgress(100);
      setLoading(false);

      if (firstBatchActivities.length === INITIAL_BATCH_SIZE) {
        setBackgroundLoading(true);
        loadRemainingData(INITIAL_BATCH_SIZE, BATCH_SIZE);
      }
    } catch (error) {
      console.error('Error loading Gantt data:', error);
      showToast('Failed to load schedule data', 'error');
      setLoading(false);
    }
  }

  async function loadRemainingData(startFrom: number, batchSize: number) {
    try {
      let from = startFrom;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('cpm_activities')
          .select('*')
          .eq('schedule_version_id', versionId)
          .order('early_start', { ascending: true })
          .range(from, from + batchSize - 1);

        if (error) {
          console.error('Error loading additional activities:', error);
          break;
        }

        if (data && data.length > 0) {
          setActivities(prev => [...prev, ...data]);

          await Promise.all([
            loadCodeAssignmentsBatched([data], from),
            loadCustomFieldValuesBatched([data], from)
          ]);

          from += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error('Error loading remaining data:', error);
    } finally {
      setBackgroundLoading(false);
    }
  }

  async function loadCodeAssignmentsBatched(activityBatches: Activity[][], batchIndex: number) {
    const CHUNK_SIZE = 1000;

    for (const activities of activityBatches) {
      if (activities.length === 0) continue;

      for (let i = 0; i < activities.length; i += CHUNK_SIZE) {
        const chunk = activities.slice(i, i + CHUNK_SIZE);

        try {
          const { data, error } = await supabase
            .from('cpm_code_assignments')
            .select(`
              activity_id,
              code_value_id,
              cpm_code_values!inner (
                id,
                code_type_id,
                code_value_name
              )
            `)
            .eq('schedule_version_id', versionId)
            .in('activity_id', chunk.map(a => a.id));

          if (error) {
            console.error('Error loading code assignments chunk:', error);
            continue;
          }

          if (data) {
            setCodeAssignments(prev => {
              const newMap = new Map(prev);

              data.forEach((assignment: any) => {
                if (!newMap.has(assignment.activity_id)) {
                  newMap.set(assignment.activity_id, new Map());
                }
                const activityCodes = newMap.get(assignment.activity_id)!;
                activityCodes.set(
                  assignment.cpm_code_values.code_type_id,
                  assignment.cpm_code_values.code_value_name
                );
              });

              return newMap;
            });
          }
        } catch (error) {
          console.error('Error in code assignments batch:', error);
        }
      }
    }
  }

  async function loadCustomFieldValuesBatched(activityBatches: Activity[][], batchIndex: number) {
    const CHUNK_SIZE = 1000;

    for (const activities of activityBatches) {
      if (activities.length === 0) continue;

      for (let i = 0; i < activities.length; i += CHUNK_SIZE) {
        const chunk = activities.slice(i, i + CHUNK_SIZE);

        try {
          const { data, error } = await supabase
            .from('cpm_custom_field_values')
            .select(`
              activity_id,
              field_type_id,
              field_value,
              field_value_numeric,
              field_value_date
            `)
            .eq('schedule_version_id', versionId)
            .in('activity_id', chunk.map(a => a.id));

          if (error) {
            console.error('Error loading custom field values chunk:', error);
            continue;
          }

          if (data) {
            setCustomFieldValues(prev => {
              const newMap = new Map(prev);

              data.forEach((fieldValue: any) => {
                if (!newMap.has(fieldValue.activity_id)) {
                  newMap.set(fieldValue.activity_id, new Map());
                }
                const activityFields = newMap.get(fieldValue.activity_id)!;
                const value = fieldValue.field_value_numeric ?? fieldValue.field_value_date ?? fieldValue.field_value;
                activityFields.set(fieldValue.field_type_id, value);
              });

              return newMap;
            });
          }
        } catch (error) {
          console.error('Error in custom field values batch:', error);
        }
      }
    }
  }

  async function generateCodeColors() {
    if (!layout.viewSettings.colorByCodeTypeId) return;

    const uniqueValues = new Set<string>();
    activities.forEach(activity => {
      const activityCodes = codeAssignments.get(activity.id);
      const value = activityCodes?.get(layout.viewSettings.colorByCodeTypeId!);
      if (value) uniqueValues.add(value);
    });

    const newColors = new Map<string, string>();
    Array.from(uniqueValues).forEach((value, index) => {
      newColors.set(value, COLOR_PALETTE[index % COLOR_PALETTE.length]);
    });

    setCodeColors(newColors);

    const { data } = await supabase
      .from('cpm_code_types')
      .select('code_type_name')
      .eq('id', layout.viewSettings.colorByCodeTypeId)
      .maybeSingle();

    if (data) {
      setCodeTypeName(data.code_type_name);
    }
  }

  const processedActivities = useMemo(() => {
    return activities.map(activity => {
      const enriched: any = { ...activity };

      layout.columns.forEach(col => {
        if (col.source === 'code' && col.sourceId) {
          const activityCodes = codeAssignments.get(activity.id);
          enriched[col.field] = activityCodes?.get(col.sourceId) || '';
        } else if (col.source === 'custom' && col.sourceId) {
          const activityFields = customFieldValues.get(activity.id);
          enriched[col.field] = activityFields?.get(col.sourceId) || '';
        } else if (col.field.endsWith('_days')) {
          const hoursField = col.field.replace('_days', '_hours');
          enriched[col.field] = activity[hoursField];
        }
      });

      return enriched;
    });
  }, [activities, layout.columns, codeAssignments, customFieldValues]);

  const groupedActivities = useMemo(() => {
    let result = [...processedActivities];

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

    if (layout.grouping.type === 'none') {
      return result.map(act => ({ type: 'activity' as const, activity: act }));
    }

    if (layout.grouping.type === 'wbs') {
      const wbsHierarchy: Array<{ type: 'group' | 'activity'; groupKey?: string; groupLabel?: string; activities?: Activity[]; activity?: Activity; level?: number }> = [];

      const wbsActivities = new Map<string, Activity[]>();
      result.forEach(activity => {
        if (activity.wbs_id) {
          if (!wbsActivities.has(activity.wbs_id)) {
            wbsActivities.set(activity.wbs_id, []);
          }
          wbsActivities.get(activity.wbs_id)!.push(activity);
        }
      });

      const wbsArray = Array.from(wbsMap.values());
      const rootWbs = wbsArray
        .filter(w => !w.parent_wbs_id)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

      function addWbsHierarchy(wbsId: string, level: number = 0) {
        const wbs = wbsMap.get(wbsId);
        if (!wbs) return;

        const activities = wbsActivities.get(wbsId) || [];

        wbsHierarchy.push({
          type: 'group',
          groupKey: wbsId,
          groupLabel: wbs.wbs_name,
          activities,
          level
        });

        activities.forEach(activity => {
          wbsHierarchy.push({ type: 'activity', activity });
        });

        const children = wbsArray
          .filter(w => w.parent_wbs_id === wbsId)
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        children.forEach(child => addWbsHierarchy(child.id, level + 1));
      }

      rootWbs.forEach(wbs => addWbsHierarchy(wbs.id));

      return wbsHierarchy;
    }

    const groups = new Map<string, { label: string; activities: Activity[] }>();

    result.forEach(activity => {
      let groupKey = '';
      let groupLabel = '';

      if (layout.grouping.type === 'code' && layout.grouping.codeTypeId) {
        const activityCodes = codeAssignments.get(activity.id);
        groupLabel = activityCodes?.get(layout.grouping.codeTypeId) || '(None)';
        groupKey = groupLabel;
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, { label: groupLabel, activities: [] });
      }
      groups.get(groupKey)!.activities.push(activity);
    });

    const finalResult: Array<{ type: 'group' | 'activity'; groupKey?: string; groupLabel?: string; activities?: Activity[]; activity?: Activity; level?: number }> = [];

    groups.forEach((groupData, groupKey) => {
      finalResult.push({
        type: 'group',
        groupKey,
        groupLabel: groupData.label,
        activities: groupData.activities,
        level: 0
      });

      groupData.activities.forEach(activity => {
        finalResult.push({ type: 'activity', activity });
      });
    });

    return finalResult;
  }, [processedActivities, layout, codeAssignments, wbsMap]);

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

  function handleGoToDataDate() {
    if (!version?.data_date) return;
    const event = new CustomEvent('gantt-goto-date', { detail: version.data_date });
    window.dispatchEvent(event);
  }

  function handleSelectActivityFromTrace(activityId: string) {
    const activity = activities.find(a => a.id === activityId);
    if (activity) {
      setTracedActivityIds(prev => new Set([...prev, activityId]));
      setSelectedActivity(activity);
    }
  }

  function handleDirectSelect(activity: Activity) {
    setTracedActivityIds(new Set());
    setSelectedActivity(activity);
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
        <div className="p-8 flex flex-col items-center justify-center gap-6">
          <div className="w-full max-w-md">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300 ease-out"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
          </div>
          <div className="text-sm text-gray-600">
            Loading schedule data... {loadingProgress}%
          </div>
        </div>
      </div>
    );
  }

  const nearCriticalThreshold = project?.settings?.near_critical_float_threshold || 10;

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
              <Calendar className="w-6 h-6 text-blue-600" />
              <div>
                <h1 className="text-lg font-semibold text-gray-900">{version?.version_label}</h1>
                <p className="text-sm text-gray-500">
                  {groupedActivities.filter(i => i.type === 'activity').length.toLocaleString()} activities
                  {backgroundLoading && <span className="ml-2 text-blue-600">(loading more...)</span>}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <GanttToolbar
        scheduleVersionId={versionId || ''}
        onGoToDataDate={handleGoToDataDate}
        dataDate={version?.data_date || null}
        onToggleColorLegend={() => setShowColorLegend(!showColorLegend)}
      />

      <div className="flex-1 overflow-hidden relative">
        {showColorLegend && layout.viewSettings.colorByCodeTypeId && (
          <ColorLegend
            codeColors={codeColors}
            codeTypeName={codeTypeName}
            onClose={() => setShowColorLegend(false)}
          />
        )}
        <ResizablePanels
          leftPanel={
            <ActivityTableAdvanced
              activities={processedActivities}
              calendars={calendars}
              selectedActivity={selectedActivity}
              onSelectActivity={handleDirectSelect}
              codeAssignments={codeAssignments}
              customFieldValues={customFieldValues}
              wbsMap={wbsMap}
              tracedActivityIds={tracedActivityIds}
              groupedActivitiesFromParent={groupedActivities}
            />
          }
          rightPanel={
            <GanttChartAdvanced
              activities={processedActivities}
              calendars={calendars}
              selectedActivity={selectedActivity}
              dataDate={version?.data_date || null}
              scheduleVersionId={versionId || ''}
              groupedActivities={groupedActivities}
              nearCriticalThreshold={nearCriticalThreshold}
              codeColors={codeColors}
            />
          }
          bottomPanel={
            selectedActivity ? (
              <ActivityDetailTabs
                activity={selectedActivity}
                calendars={calendars}
                scheduleVersionId={versionId || ''}
                nearCriticalThreshold={nearCriticalThreshold}
                onSelectActivity={handleSelectActivityFromTrace}
                tracedActivityIds={tracedActivityIds}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                Select an activity to view details
              </div>
            )
          }
        />
      </div>
    </div>
  );
}

export default function GanttViewerAdvanced() {
  const { versionId } = useParams<{ versionId: string }>();

  return (
    <GanttLayoutProvider scheduleVersionId={versionId || ''}>
      <GanttViewerContent />
    </GanttLayoutProvider>
  );
}
