import { useEffect, useState, useMemo, useRef } from 'react';
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

interface CpmProject {
  project_name: string;
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
  const [loadingMessage, setLoadingMessage] = useState('');
  const [version, setVersion] = useState<ScheduleVersion | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [cpmProject, setCpmProject] = useState<CpmProject | null>(null);
  const [rootWbsName, setRootWbsName] = useState<string | null>(null);
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

  const loadedVersionRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!user || !projectId || !versionId) return;

    // Only load if we haven't loaded this version yet
    if (loadedVersionRef.current !== versionId) {
      loadedVersionRef.current = versionId;
      loadData();
    }
  }, [user, projectId, versionId]);

  useEffect(() => {
    if (layout.viewSettings.colorByCodeTypeId) {
      generateCodeColors();
    }
  }, [layout.viewSettings.colorByCodeTypeId, activities, codeAssignments]);

  async function loadData() {
    if (!mountedRef.current) return;

    try {
      setLoading(true);
      setLoadingProgress(5);
      setLoadingMessage('Loading project metadata...');

      const [projectRes, versionRes, calendarsRes, cpmProjectRes, rootWbsRes] = await Promise.all([
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
          .from('cpm_projects')
          .select('project_name')
          .eq('schedule_version_id', versionId)
          .maybeSingle(),
        supabase
          .from('cpm_wbs')
          .select('wbs_name')
          .eq('schedule_version_id', versionId)
          .is('parent_wbs_id', null)
          .maybeSingle()
      ]);

      if (!mountedRef.current) return;

      setLoadingProgress(10);

      if (projectRes.error) throw projectRes.error;
      if (versionRes.error) throw versionRes.error;
      if (calendarsRes.error) throw calendarsRes.error;
      if (cpmProjectRes.error) console.warn('CPM project query failed:', cpmProjectRes.error);

      if (!versionRes.data) {
        if (mountedRef.current) {
          showToast('Schedule version not found', 'error');
          setLoading(false);
          navigate(`/project/${projectId}`);
        }
        return;
      }

      if (!mountedRef.current) return;

      setProject(projectRes.data);
      setVersion(versionRes.data);
      setCpmProject(cpmProjectRes.data);
      setRootWbsName(rootWbsRes.data?.wbs_name || null);
      setCalendars(calendarsRes.data || []);

      setLoadingProgress(15);
      setLoadingMessage('Loading WBS hierarchy...');

      // Load ALL WBS nodes with pagination
      const allWbs = await fetchAllWbs();
      if (!mountedRef.current) return;

      const wbsMapLocal = new Map();
      allWbs.forEach(wbs => wbsMapLocal.set(wbs.id, wbs));
      setWbsMap(wbsMapLocal);
      console.log('DEBUG: wbsMap size:', wbsMapLocal.size);

      setLoadingProgress(25);
      setLoadingMessage('Loading activities...');

      // Load ALL activities with pagination and progress updates
      const allActivities = await fetchAllActivities();
      if (!mountedRef.current) return;

      if (!allActivities || allActivities.length === 0) {
        console.warn('No activities loaded for schedule');
        if (mountedRef.current) {
          showToast('No activities found in schedule', 'warning');
          setLoading(false);
        }
        return;
      }

      setActivities(allActivities);
      console.log('DEBUG: activities loaded:', allActivities.length);

      setLoadingProgress(60);
      setLoadingMessage('Loading activity codes...');

      // Load code assignments for all activities
      try {
        await loadCodeAssignmentsForActivities(allActivities);
        if (!mountedRef.current) return;
      } catch (error) {
        console.warn('Error loading code assignments:', error);
      }

      setLoadingProgress(80);
      setLoadingMessage('Loading custom fields...');

      // Load custom field values for all activities
      try {
        await loadCustomFieldValuesForActivities(allActivities);
        if (!mountedRef.current) return;
      } catch (error) {
        console.warn('Error loading custom fields:', error);
      }

      if (!mountedRef.current) return;

      setLoadingProgress(100);
      setLoadingMessage('Complete');
      setLoading(false);
    } catch (error) {
      console.error('Error loading Gantt data:', error);
      if (mountedRef.current) {
        showToast('Failed to load schedule data. Please try again.', 'error');
        setLoading(false);
        loadedVersionRef.current = null;
      }
    }
  }

  async function fetchAllWbs(): Promise<any[]> {
    const PAGE_SIZE = 1000;
    let allWbs: any[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('cpm_wbs')
        .select('id, wbs_name, wbs_code, parent_wbs_id, level, sort_order')
        .eq('schedule_version_id', versionId)
        .order('sort_order', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.warn('WBS query error:', error);
        break;
      }

      if (data && data.length > 0) {
        allWbs = [...allWbs, ...data];
        offset += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    return allWbs;
  }

  async function fetchAllActivities(): Promise<Activity[]> {
    const PAGE_SIZE = 1000;
    let allActivities: Activity[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore && mountedRef.current) {
      const { data, error } = await supabase
        .from('cpm_activities')
        .select('*')
        .eq('schedule_version_id', versionId)
        .order('early_start', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        allActivities.push(...data);
        offset += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;

        if (mountedRef.current) {
          const progress = 25 + Math.min(35, (allActivities.length / 10000) * 35);
          setLoadingProgress(progress);
          setLoadingMessage(`Loading activities... (${allActivities.length.toLocaleString()})`);
        }
      } else {
        hasMore = false;
      }
    }

    return allActivities;
  }

  async function loadCodeAssignmentsForActivities(activities: Activity[]) {
    if (activities.length === 0) return;

    const CHUNK_SIZE = 1000;
    const PAGE_SIZE = 1000;

    for (let i = 0; i < activities.length; i += CHUNK_SIZE) {
      const chunk = activities.slice(i, i + CHUNK_SIZE);
      const activityIds = chunk.map(a => a.id);

      // Fetch code assignments with pagination (since there could be 16,436 assignments)
      let allAssignments: any[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
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
          .in('activity_id', activityIds)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          console.error('Error loading code assignments:', error);
          break;
        }

        if (data && data.length > 0) {
          allAssignments = [...allAssignments, ...data];
          offset += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      // Update state with all assignments for this chunk
      if (allAssignments.length > 0) {
        setCodeAssignments(prev => {
          const newMap = new Map(prev);
          allAssignments.forEach((assignment: any) => {
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
    }
  }

  async function loadCustomFieldValuesForActivities(activities: Activity[]) {
    if (activities.length === 0) return;

    const CHUNK_SIZE = 1000;

    for (let i = 0; i < activities.length; i += CHUNK_SIZE) {
      const chunk = activities.slice(i, i + CHUNK_SIZE);

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
        console.error('Error loading custom field values:', error);
        continue;
      }

      if (data && data.length > 0) {
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
    console.log('DEBUG: groupedActivities input - processedActivities:', processedActivities.length, 'grouping type:', layout.grouping.type, 'wbsMap size:', wbsMap.size);
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
      const output = result.map(act => ({ type: 'activity' as const, activity: act }));
      console.log('DEBUG: groupedActivities output length:', output.length);
      return output;
    }

    if (layout.grouping.type === 'wbs') {
      // Defensive: if wbsMap is empty or has no root nodes, fall back to flat list
      // rather than returning an empty array (which causes a blank screen).
      const wbsArray = Array.from(wbsMap.values());
      const rootWbs = wbsArray
        .filter(w => !w.parent_wbs_id)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

      if (wbsArray.length === 0 || rootWbs.length === 0) {
        // No WBS data available — show activities as a flat list
        const output = result.map(act => ({ type: 'activity' as const, activity: act }));
        console.log('DEBUG: groupedActivities output length:', output.length);
        return output;
      }

      const wbsHierarchy: Array<{ type: 'group' | 'activity'; groupKey?: string; groupLabel?: string; activities?: Activity[]; activity?: Activity; level?: number; totalActivities?: number }> = [];

      const wbsActivities = new Map<string, Activity[]>();
      const orphanedActivities: Activity[] = [];
      result.forEach(activity => {
        if (activity.wbs_id && wbsMap.has(activity.wbs_id)) {
          if (!wbsActivities.has(activity.wbs_id)) {
            wbsActivities.set(activity.wbs_id, []);
          }
          wbsActivities.get(activity.wbs_id)!.push(activity);
        } else {
          // Activity has no wbs_id or its wbs_id doesn't match any known WBS node
          orphanedActivities.push(activity);
        }
      });

      function addWbsHierarchy(wbsId: string, level: number = 0) {
        const wbs = wbsMap.get(wbsId);
        if (!wbs) return;

        const directActivities = wbsActivities.get(wbsId) || [];

        // Count all activities in this WBS node AND all descendant nodes
        function countDescendantActivities(nodeId: string): number {
          let count = (wbsActivities.get(nodeId) || []).length;
          const childNodes = wbsArray.filter(w => w.parent_wbs_id === nodeId);
          childNodes.forEach(child => {
            count += countDescendantActivities(child.id);
          });
          return count;
        }
        const totalActivities = countDescendantActivities(wbsId);

        // Store totalActivities on the group item so the table can display it
        wbsHierarchy.push({
          type: 'group',
          groupKey: wbsId,
          groupLabel: wbs.wbs_name,
          activities: directActivities,
          level,
          totalActivities
        });

        directActivities.forEach(activity => {
          wbsHierarchy.push({ type: 'activity', activity });
        });

        const children = wbsArray
          .filter(w => w.parent_wbs_id === wbsId)
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        children.forEach(child => addWbsHierarchy(child.id, level + 1));
      }

      rootWbs.forEach(wbs => addWbsHierarchy(wbs.id));

      // Append any orphaned activities (no wbs_id or unrecognized wbs_id)
      // so they don't silently disappear
      if (orphanedActivities.length > 0) {
        wbsHierarchy.push({
          type: 'group',
          groupKey: '__orphaned__',
          groupLabel: '(No WBS)',
          activities: orphanedActivities,
          level: 0
        });
        orphanedActivities.forEach(activity => {
          wbsHierarchy.push({ type: 'activity', activity });
        });
      }

      // Final safety net: if hierarchy is still empty, fall back to flat list
      if (wbsHierarchy.length === 0) {
        const output = result.map(act => ({ type: 'activity' as const, activity: act }));
        console.log('DEBUG: groupedActivities output length:', output.length);
        return output;
      }

      console.log('DEBUG: groupedActivities output length:', wbsHierarchy.length);
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

    console.log('DEBUG: groupedActivities output length:', finalResult.length);
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
            {loadingMessage || `Loading schedule data... ${loadingProgress}%`}
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
                <h1 className="text-lg font-semibold text-gray-900">
                  {version?.version_label}
                </h1>
                {rootWbsName && (
                  <p className="text-sm text-gray-600">
                    {rootWbsName}
                  </p>
                )}
                <p className="text-sm text-gray-500">
                  {groupedActivities.filter(i => i.type === 'activity').length.toLocaleString()} activities
                  {backgroundLoading && <span className="ml-2 text-blue-600">(loading more...)</span>}
                </p>
              </div>
            </div>
          </div>

          <GanttToolbar
            scheduleVersionId={versionId || ''}
            onGoToDataDate={handleGoToDataDate}
            dataDate={version?.data_date || null}
            onToggleColorLegend={() => setShowColorLegend(!showColorLegend)}
          />
        </div>
      </div>

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
