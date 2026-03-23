/**
 * useScheduleData.ts
 *
 * Custom hook that owns all data fetching for the Gantt viewer page.
 *
 * EXTRACTED FROM: GanttViewerAdvanced.tsx
 *
 * Responsibilities:
 *   - Fetch project metadata, schedule version, calendars, CPM project, root WBS
 *   - Fetch all WBS (Work Breakdown Structure) nodes with pagination
 *   - Fetch all activities with pagination and progress reporting
 *   - Build wbsMap (Map of WBS ID → WBS object)
 *   - Track loading state and progress for the loading bar UI
 *
 * Pagination:
 *   Supabase PostgREST (PostgreSQL REST API) defaults to 1,000 rows per request.
 *   Both WBS and activity fetches use paginated loops to handle large schedules
 *   (tested with 9,346+ activities).
 */

import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

// ============================================================================
// Types
// ============================================================================

export interface Activity {
  id: string;
  [key: string]: any;
}

export interface Calendar {
  id: string;
  calendar_name: string;
  hours_per_day: number;
}

export interface ScheduleVersion {
  id: string;
  version_label: string;
  data_date: string | null;
}

export interface CpmProject {
  project_name: string;
}

export interface Project {
  id: string;
  company_id: string;
  settings: {
    near_critical_float_threshold?: number;
  };
}

export interface ScheduleDataResult {
  loading: boolean;
  loadingProgress: number;
  loadingMessage: string;
  version: ScheduleVersion | null;
  project: Project | null;
  cpmProject: CpmProject | null;
  rootWbsName: string | null;
  activities: Activity[];
  calendars: Calendar[];
  wbsMap: Map<string, any>;
}

const PAGE_SIZE = 1000;

// ============================================================================
// Hook
// ============================================================================

export function useScheduleData(
  projectId: string | undefined,
  versionId: string | undefined,
  userId: string | null | undefined,
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void,
  navigate: (path: string) => void
): ScheduleDataResult {
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [version, setVersion] = useState<ScheduleVersion | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [cpmProject, setCpmProject] = useState<CpmProject | null>(null);
  const [rootWbsName, setRootWbsName] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [wbsMap, setWbsMap] = useState<Map<string, any>>(new Map());

  const loadedVersionRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!userId || !projectId || !versionId) return;
    if (loadedVersionRef.current !== versionId) {
      loadedVersionRef.current = versionId;
      loadData();
    }
  }, [userId, projectId, versionId]);

  async function loadData() {
    if (!mountedRef.current) return;

    try {
      setLoading(true);
      setLoadingProgress(5);
      setLoadingMessage('Loading project metadata...');

      const [projectRes, versionRes, calendarsRes, cpmProjectRes, rootWbsRes] = await Promise.all([
        supabase.from('projects').select('id, settings, company_id').eq('id', projectId).maybeSingle(),
        supabase.from('schedule_versions').select('id, version_label, data_date').eq('id', versionId).maybeSingle(),
        supabase.from('cpm_calendars').select('id, calendar_name, hours_per_day').eq('schedule_version_id', versionId),
        supabase.from('cpm_projects').select('project_name').eq('schedule_version_id', versionId).maybeSingle(),
        supabase.from('cpm_wbs').select('wbs_name').eq('schedule_version_id', versionId).is('parent_wbs_id', null).maybeSingle()
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

      const allWbs = await fetchAllPaginated('cpm_wbs', 'id, wbs_name, wbs_code, parent_wbs_id, level, sort_order', versionId!, { orderBy: 'sort_order', ascending: true });
      if (!mountedRef.current) return;

      const wbsMapLocal = new Map();
      allWbs.forEach(wbs => wbsMapLocal.set(wbs.id, wbs));
      setWbsMap(wbsMapLocal);

      setLoadingProgress(25);
      setLoadingMessage('Loading activities...');

      const allActivities = await fetchAllActivitiesWithProgress();
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

  async function fetchAllPaginated(
    tableName: string, selectCols: string, scheduleVersionId: string,
    options?: { orderBy?: string; ascending?: boolean }
  ): Promise<any[]> {
    const allRows: any[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase.from(tableName).select(selectCols)
        .eq('schedule_version_id', scheduleVersionId)
        .range(offset, offset + PAGE_SIZE - 1);

      if (options?.orderBy) {
        query = query.order(options.orderBy, { ascending: options.ascending ?? true });
      }

      const { data, error } = await query;
      if (error) { console.warn(`Paginated fetch error for ${tableName}:`, error); break; }
      if (data && data.length > 0) {
        allRows.push(...data);
        offset += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else { hasMore = false; }
    }
    return allRows;
  }

  async function fetchAllActivitiesWithProgress(): Promise<Activity[]> {
    const allActivities: Activity[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore && mountedRef.current) {
      const { data, error } = await supabase.from('cpm_activities').select('*')
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
      } else { hasMore = false; }
    }
    return allActivities;
  }

  return { loading, loadingProgress, loadingMessage, version, project, cpmProject, rootWbsName, activities, calendars, wbsMap };
}
