import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Calendar as CalendarIcon, ArrowLeft } from 'lucide-react';
import { GanttLayoutProvider, useGanttLayout } from '../contexts/GanttLayoutContext';
import ResizablePanels from '../components/gantt/ResizablePanels';
import ActivityTableAdvanced from '../components/gantt/ActivityTableAdvanced';
import GanttChartAdvanced from '../components/gantt/GanttChartAdvanced';
import ActivityDetailTabs from '../components/gantt/ActivityDetailTabs';
import GanttToolbar from '../components/gantt/GanttToolbar';
import ColorLegend from '../components/gantt/ColorLegend';
import { QuickFilterPanel } from '../components/gantt/QuickFilterPanel';

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
  company_id: string;
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
  const { layout, loadLayout } = useGanttLayout();
  const [searchParams] = useSearchParams();

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
  const [wbsMap, setWbsMap] = useState<Map<string, any>>(new Map());
  const [codeColors, setCodeColors] = useState<Map<string, string>>(new Map());
  const [showColorLegend, setShowColorLegend] = useState(false);
  const [codeTypeName, setCodeTypeName] = useState('');
  const [tracedActivityIds, setTracedActivityIds] = useState<Set<string>>(new Set());
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [quickFilterCodeAssignments, setQuickFilterCodeAssignments] = useState<Map<string, Set<string>>>(new Map());
  const [isQuickFilterOpen, setIsQuickFilterOpen] = useState(false);
  const [isFilterPinned, setIsFilterPinned] = useState(false);
  const [layouts, setLayouts] = useState<Array<{ id: string; name: string; is_default: boolean; user_id: string | null }>>([]);

  const loadedVersionRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const colorCacheRef = useRef<Map<string, { assignments: Map<string, Map<string, string>>; colors: Map<string, string>; typeName: string }>>(new Map());
  const layoutLoadedRef = useRef(false);

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
      layoutLoadedRef.current = false;
      loadData();
    }
  }, [user, projectId, versionId]);

  useEffect(() => {
    if (!loading && !layoutLoadedRef.current && projectId && user) {
      const layoutIdFromUrl = searchParams.get('layout');
      if (layoutIdFromUrl) {
        loadLayoutFromUrl(layoutIdFromUrl);
      }
      layoutLoadedRef.current = true;
    }
  }, [loading, projectId, user]);

  useEffect(() => {
    if (projectId && user) {
      loadAvailableLayouts();
    }
  }, [projectId, user]);

  useEffect(() => {
    if (!layout.viewSettings.colorByCodeTypeId) {
      setCodeColors(new Map());
      setCodeTypeName('');
      return;
    }

    const codeTypeId = layout.viewSettings.colorByCodeTypeId;

    const cached = colorCacheRef.current.get(codeTypeId);
    if (cached) {
      setCodeAssignments(cached.assignments);
      setCodeColors(cached.colors);
      setCodeTypeName(cached.typeName);
      return;
    }

    loadColorByCodeType(codeTypeId);
  }, [layout.viewSettings.colorByCodeTypeId]);

  async function loadAvailableLayouts() {
    try {
      const { data: layoutsData, error } = await supabase
        .from('layouts')
        .select('id, name, is_default, user_id')
        .eq('project_id', projectId)
        .or(`user_id.is.null,user_id.eq.${user?.id}`)
        .order('name');

      if (error) throw error;

      if (layoutsData) {
        setLayouts(layoutsData);
      }
    } catch (error) {
      console.error('Error loading layouts:', error);
    }
  }

  async function loadLayoutFromUrl(layoutId: string) {
    try {
      const { data: layoutData, error } = await supabase
        .from('layouts')
        .select('*')
        .eq('id', layoutId)
        .maybeSingle();

      if (error) throw error;

      if (layoutData && layoutData.definition) {
        loadLayout(layoutId, layoutData.name, layoutData.definition);
      }
    } catch (error) {
      console.error('Error loading layout from URL:', error);
    }
  }

  async function loadData() {
    if (!mountedRef.current) return;

    try {
      setLoading(true);
      setLoadingProgress(5);
      setLoadingMessage('Loading project metadata...');

      const [projectRes, versionRes, calendarsRes, cpmProjectRes, rootWbsRes] = await Promise.all([
        supabase
          .from('projects')
          .select('id, settings, company_id')
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

  async function loadColorByCodeType(codeTypeId: string) {
    try {
      const PAGE_SIZE = 1000;
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
              code_value_name,
              code_value_color
            )
          `)
          .eq('schedule_version_id', versionId)
          .eq('cpm_code_values.code_type_id', codeTypeId)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          console.error('Error loading code assignments for color:', error);
          break;
        }

        if (data && data.length > 0) {
          allAssignments.push(...data);
          offset += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      if (!mountedRef.current) return;

      const newAssignments = new Map<string, Map<string, string>>();
      const uniqueValues = new Set<string>();

      allAssignments.forEach((assignment: any) => {
        const codeValue = assignment.cpm_code_values;
        if (!newAssignments.has(assignment.activity_id)) {
          newAssignments.set(assignment.activity_id, new Map());
        }
        newAssignments.get(assignment.activity_id)!.set(codeValue.code_type_id, codeValue.code_value_name);
        uniqueValues.add(codeValue.code_value_name);
      });

      const newColors = new Map<string, string>();

      const p6ColorMap = new Map<string, number>();
      allAssignments.forEach((assignment: any) => {
        const cv = assignment.cpm_code_values;
        if (cv.code_value_color != null && !p6ColorMap.has(cv.code_value_name)) {
          p6ColorMap.set(cv.code_value_name, cv.code_value_color);
        }
      });

      Array.from(uniqueValues).forEach((valueName) => {
        const p6Color = p6ColorMap.get(valueName);
        if (p6Color != null && p6Color > 0) {
          const r = (p6Color >> 16) & 0xFF;
          const g = (p6Color >> 8) & 0xFF;
          const b = p6Color & 0xFF;
          newColors.set(valueName, `rgb(${r}, ${g}, ${b})`);
        } else {
          newColors.set(valueName, hashColor(valueName));
        }
      });

      let typeName = '';
      const { data: typeData } = await supabase
        .from('cpm_code_types')
        .select('code_type_name')
        .eq('id', codeTypeId)
        .maybeSingle();
      if (typeData) typeName = typeData.code_type_name;

      if (!mountedRef.current) return;

      setCodeAssignments(newAssignments);
      setCodeColors(newColors);
      setCodeTypeName(typeName);

      colorCacheRef.current.set(codeTypeId, {
        assignments: newAssignments,
        colors: newColors,
        typeName,
      });
    } catch (error) {
      console.error('Failed to load color-by code assignments:', error);
    }
  }

  function hashColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

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

  const nearCriticalThreshold = project?.settings?.near_critical_float_threshold || 10;

  const groupedActivities = useMemo(() => {
    console.log('DEBUG: groupedActivities input - processedActivities:', processedActivities.length, 'grouping type:', layout.grouping.type, 'wbsMap size:', wbsMap.size);
    let result = [...processedActivities];

    const qf = layout.quickFilters;

    if (qf.selectedWbsIds.length > 0) {
      const selectedWbsSet = new Set<string>();

      function addDescendants(wbsId: string) {
        selectedWbsSet.add(wbsId);
        wbsMap.forEach((wbs, id) => {
          if (wbs.parent_wbs_id === wbsId) {
            addDescendants(id);
          }
        });
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
          case 'critical':
            return floatDays <= 0 || a.is_critical === true;
          case 'crit_and_near_critical':
            return floatDays <= nearCriticalThreshold;
          case 'non_critical':
            return floatDays > 0 && a.is_critical !== true;
          default: return true;
        }
      });
    }

    if (qf.timeframe !== 'all' && version?.data_date) {
      const dataDateMs = new Date(version.data_date).getTime();
      const DAY_MS = 86400000;
      let windowStart: number;
      let windowEnd: number;

      switch (qf.timeframe) {
        case '3_week_lookahead':
          windowStart = dataDateMs - (7 * DAY_MS);
          windowEnd = dataDateMs + (21 * DAY_MS);
          break;
        case '3_month_lookahead':
          windowStart = dataDateMs - (14 * DAY_MS);
          windowEnd = dataDateMs + (90 * DAY_MS);
          break;
        case '1_month_lookback':
          windowStart = dataDateMs - (30 * DAY_MS);
          windowEnd = dataDateMs;
          break;
        default:
          windowStart = -Infinity;
          windowEnd = Infinity;
      }

      result = result.filter(a => {
        const start = a.actual_start || a.early_start;
        const finish = a.actual_finish || a.early_finish;
        if (!start || !finish) return false;
        const startMs = new Date(start).getTime();
        const finishMs = new Date(finish).getTime();
        return startMs <= windowEnd && finishMs >= windowStart;
      });
    }

    if (qf.selectedCodeValueIds.length > 0 && quickFilterCodeAssignments.size > 0) {
      const matchingActivityIds = new Set<string>();
      qf.selectedCodeValueIds.forEach(cvId => {
        const actIds = quickFilterCodeAssignments.get(cvId);
        if (actIds) actIds.forEach(id => matchingActivityIds.add(id));
      });
      result = result.filter(a => matchingActivityIds.has(a.id));
    }

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
      const wbsArray = Array.from(wbsMap.values());

      const childrenMap = new Map<string, any[]>();
      const rootWbs: any[] = [];
      wbsArray.forEach(w => {
        if (!w.parent_wbs_id) {
          rootWbs.push(w);
        } else {
          if (!childrenMap.has(w.parent_wbs_id)) {
            childrenMap.set(w.parent_wbs_id, []);
          }
          childrenMap.get(w.parent_wbs_id)!.push(w);
        }
      });
      rootWbs.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

      const descendantCountCache = new Map<string, number>();

      if (wbsArray.length === 0 || rootWbs.length === 0) {
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
          orphanedActivities.push(activity);
        }
      });

      function addWbsHierarchy(wbsId: string, level: number = 0) {
        const wbs = wbsMap.get(wbsId);
        if (!wbs) return;

        const directActivities = wbsActivities.get(wbsId) || [];

        function countDescendantActivities(nodeId: string): number {
          if (descendantCountCache.has(nodeId)) return descendantCountCache.get(nodeId)!;
          let count = (wbsActivities.get(nodeId) || []).length;
          const children = childrenMap.get(nodeId) || [];
          children.forEach(child => {
            count += countDescendantActivities(child.id);
          });
          descendantCountCache.set(nodeId, count);
          return count;
        }
        const totalActivities = countDescendantActivities(wbsId);

        // Skip empty groups — no activities in this node or any descendant
        // This covers both "never had activities" and "all activities filtered out"
        if (totalActivities === 0) return;

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

        const children = (childrenMap.get(wbsId) || [])
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
  }, [processedActivities, layout.grouping, layout.filters, layout.sorts, layout.quickFilters, codeAssignments, wbsMap, calendars, version?.data_date, nearCriticalThreshold, quickFilterCodeAssignments]);

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

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* QuickFilterPanel is positioned fixed, so render it outside the flow */}
      <QuickFilterPanel
        wbsMap={wbsMap}
        activities={activities}
        calendars={calendars}
        scheduleVersionId={versionId || ''}
        dataDate={version?.data_date || null}
        nearCriticalThreshold={nearCriticalThreshold}
        onCodeAssignmentsLoaded={setQuickFilterCodeAssignments}
        isOpen={isQuickFilterOpen}
        onClose={() => setIsQuickFilterOpen(false)}
        onPinnedChange={setIsFilterPinned}
      />

      {/* Everything shifts right when panel is pinned */}
      <div
        className="flex-1 flex flex-col min-h-0 overflow-hidden"
        style={{
          marginLeft: isFilterPinned ? 272 : 0,
          transition: 'margin-left 200ms ease',
        }}
      >
        <div className="bg-white border-b border-gray-200 px-4 py-1.5 flex-shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => navigate(`/project/${projectId}`)}
                className="p-1 hover:bg-gray-100 rounded transition-colors flex-shrink-0"
                title="Back to project"
              >
                <ArrowLeft className="w-4 h-4 text-gray-500" />
              </button>
              <span className="text-sm font-semibold text-gray-900 truncate" title={version?.version_label || ''}>
                {version?.version_label}
              </span>
              {rootWbsName && (
                <>
                  <span className="text-gray-300 flex-shrink-0">|</span>
                  <span className="text-xs text-gray-500 truncate" title={rootWbsName}>
                    {rootWbsName}
                  </span>
                </>
              )}
              <span className="text-gray-300 flex-shrink-0">|</span>
              <span className="text-xs text-gray-400 flex-shrink-0">
                {groupedActivities.filter(i => i.type === 'activity').length.toLocaleString()} activities
              </span>
            </div>

            <GanttToolbar
              scheduleVersionId={versionId || ''}
              projectId={projectId || ''}
              companyId={project?.company_id || ''}
              onGoToDataDate={handleGoToDataDate}
              dataDate={version?.data_date || null}
              onToggleColorLegend={() => setShowColorLegend(!showColorLegend)}
              onToggleQuickFilters={() => setIsQuickFilterOpen(!isQuickFilterOpen)}
              versionLabel={version?.version_label || ''}
              layouts={layouts}
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
              codeAssignments={codeAssignments}
              onActivitySelect={handleDirectSelect}
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
