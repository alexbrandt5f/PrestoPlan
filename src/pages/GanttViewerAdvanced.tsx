/**
 * GanttViewerAdvanced.tsx
 *
 * Main page component for the Gantt chart viewer. Composes three custom hooks
 * for data fetching, color-by-code, and activity filtering/grouping, then
 * passes the results to the visual components.
 *
 * REFACTORED: Previously ~963 lines with all logic inline. Now ~300 lines of
 * composition + UI event handlers. The logic lives in:
 *   - useScheduleData      (data fetching + pagination)
 *   - useColorByCode       (Color By Activity Code loading + caching)
 *   - useActivityFiltering (filtering, sorting, grouping)
 */

import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ArrowLeft } from 'lucide-react';
import { GanttLayoutProvider, useGanttLayout } from '../contexts/GanttLayoutContext';
import ResizablePanels from '../components/gantt/ResizablePanels';
import ActivityTableAdvanced from '../components/gantt/ActivityTableAdvanced';
import GanttChartAdvanced from '../components/gantt/GanttChartAdvanced';
import ActivityDetailTabs from '../components/gantt/ActivityDetailTabs';
import GanttToolbar from '../components/gantt/GanttToolbar';
import ColorLegend from '../components/gantt/ColorLegend';
import { GanttErrorBoundary } from '../components/GanttErrorBoundary';
import { QuickFilterPanel } from '../components/gantt/QuickFilterPanel';

import { useScheduleData } from '../hooks/useScheduleData';
import { useColorByCode } from '../hooks/useColorByCode';
import { useActivityFiltering } from '../hooks/useActivityFiltering';

import type { Activity } from '../hooks/useScheduleData';

function GanttViewerContent() {
  const { projectId, versionId } = useParams<{ projectId: string; versionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { layout, loadLayout } = useGanttLayout();
  const [searchParams] = useSearchParams();

  // ========================================================================
  // Data fetching (hook)
  // ========================================================================
  const {
    loading, loadingProgress, loadingMessage,
    version, project, cpmProject, rootWbsName,
    activities, calendars, wbsMap,
  } = useScheduleData(projectId, versionId, user?.id, showToast, navigate);

  // ========================================================================
  // Color by activity code (hook)
  // ========================================================================
  const {
    codeAssignments, codeColors, codeTypeName,
  } = useColorByCode(versionId, layout.viewSettings.colorByCodeTypeId);

  // ========================================================================
  // UI-only state (not data logic)
  // ========================================================================
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [tracedActivityIds, setTracedActivityIds] = useState<Set<string>>(new Set());
  const [quickFilterCodeAssignments, setQuickFilterCodeAssignments] = useState<Map<string, Set<string>>>(new Map());
  const [isQuickFilterOpen, setIsQuickFilterOpen] = useState(false);
  const [isFilterPinned, setIsFilterPinned] = useState(false);
  const [showColorLegend, setShowColorLegend] = useState(false);
  const [layouts, setLayouts] = useState<Array<{ id: string; name: string; is_default: boolean; user_id: string | null }>>([]);

  const layoutLoadedRef = useRef(false);

  // ========================================================================
  // Filtering, sorting, grouping (hook)
  // ========================================================================
  const {
    processedActivities, groupedActivities, nearCriticalThreshold,
  } = useActivityFiltering(
    activities, calendars, version, layout,
    codeAssignments, wbsMap, quickFilterCodeAssignments,
    project?.settings?.near_critical_float_threshold
  );

  // ========================================================================
  // Layout loading from URL + available layouts
  // ========================================================================
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

  async function loadAvailableLayouts() {
    try {
      const { data: layoutsData, error } = await supabase
        .from('layouts')
        .select('id, name, is_default, user_id')
        .eq('project_id', projectId)
        .or(`user_id.is.null,user_id.eq.${user?.id}`)
        .order('name');

      if (error) throw error;
      if (layoutsData) setLayouts(layoutsData);
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

  // ========================================================================
  // UI event handlers
  // ========================================================================
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

  // ========================================================================
  // Loading state
  // ========================================================================
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

  // ========================================================================
  // Render
  // ========================================================================
  return (
    <div className="h-screen flex flex-col bg-gray-50">
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
              <GanttErrorBoundary panelName="Activity Table">
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
              </GanttErrorBoundary>
            }
            rightPanel={
              <GanttErrorBoundary panelName="Gantt Chart">
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
              </GanttErrorBoundary>
            }
            bottomPanel={
              selectedActivity ? (
                <GanttErrorBoundary panelName="Activity Details">
                  <ActivityDetailTabs
                    activity={selectedActivity}
                    calendars={calendars}
                    scheduleVersionId={versionId || ''}
                    nearCriticalThreshold={nearCriticalThreshold}
                    onSelectActivity={handleSelectActivityFromTrace}
                    tracedActivityIds={tracedActivityIds}
                    wbsMap={wbsMap}
                  />
                </GanttErrorBoundary>
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
