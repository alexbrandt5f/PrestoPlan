import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { GanttLayoutState, ColumnDefinition, SortConfig, FilterCondition, GroupConfig, ViewSettings } from '../types/gantt';

interface GanttLayoutContextType {
  layout: GanttLayoutState;
  updateColumns: (columns: ColumnDefinition[]) => void;
  updateSorts: (sorts: SortConfig[]) => void;
  updateFilters: (filters: FilterCondition[]) => void;
  updateGrouping: (grouping: GroupConfig) => void;
  updateViewSettings: (settings: Partial<ViewSettings>) => void;
  resetLayout: () => void;
}

const GanttLayoutContext = createContext<GanttLayoutContextType | undefined>(undefined);

const DEFAULT_COLUMNS: ColumnDefinition[] = [
  { id: 'activity_id_display', label: 'Activity ID', field: 'activity_id_display', width: 100, visible: true, dataType: 'string', source: 'activity' },
  { id: 'activity_name', label: 'Activity Name', field: 'activity_name', width: 250, visible: true, dataType: 'string', source: 'activity' },
  { id: 'original_duration_hours', label: 'Orig Dur (h)', field: 'original_duration_hours', width: 75, visible: true, dataType: 'number', source: 'activity' },
  { id: 'original_duration_days', label: 'Orig Dur (d)', field: 'original_duration_days', width: 75, visible: false, dataType: 'number', source: 'activity' },
  { id: 'remaining_duration_hours', label: 'Rem Dur (h)', field: 'remaining_duration_hours', width: 75, visible: false, dataType: 'number', source: 'activity' },
  { id: 'remaining_duration_days', label: 'Rem Dur (d)', field: 'remaining_duration_days', width: 75, visible: false, dataType: 'number', source: 'activity' },
  { id: 'actual_duration_hours', label: 'Act Dur (h)', field: 'actual_duration_hours', width: 75, visible: false, dataType: 'number', source: 'activity' },
  { id: 'actual_duration_days', label: 'Act Dur (d)', field: 'actual_duration_days', width: 75, visible: false, dataType: 'number', source: 'activity' },
  { id: 'at_completion_duration_hours', label: 'AtComp Dur (h)', field: 'at_completion_duration_hours', width: 85, visible: false, dataType: 'number', source: 'activity' },
  { id: 'at_completion_duration_days', label: 'AtComp Dur (d)', field: 'at_completion_duration_days', width: 85, visible: false, dataType: 'number', source: 'activity' },
  { id: 'early_start', label: 'Early Start', field: 'early_start', width: 90, visible: true, dataType: 'date', source: 'activity' },
  { id: 'early_finish', label: 'Early Finish', field: 'early_finish', width: 90, visible: true, dataType: 'date', source: 'activity' },
  { id: 'total_float_hours', label: 'Total Float (h)', field: 'total_float_hours', width: 75, visible: true, dataType: 'number', source: 'activity' },
  { id: 'total_float_days', label: 'Total Float (d)', field: 'total_float_days', width: 75, visible: false, dataType: 'number', source: 'activity' },
  { id: 'free_float_hours', label: 'Free Float (h)', field: 'free_float_hours', width: 75, visible: false, dataType: 'number', source: 'activity' },
  { id: 'free_float_days', label: 'Free Float (d)', field: 'free_float_days', width: 75, visible: false, dataType: 'number', source: 'activity' },
];

const DEFAULT_LAYOUT: GanttLayoutState = {
  columns: DEFAULT_COLUMNS,
  sorts: [{ field: 'early_start', direction: 'asc' }],
  filters: [],
  grouping: { type: 'wbs', showSummaryBars: false },
  viewSettings: {
    showFloat: false,
    showRelationships: 'none',
    showDrivingOnly: true,
    timescale: 'year-month',
    zoom: 1
  }
};

export function GanttLayoutProvider({ children, scheduleVersionId }: { children: ReactNode; scheduleVersionId: string }) {
  const [layout, setLayout] = useState<GanttLayoutState>(DEFAULT_LAYOUT);

  useEffect(() => {
    const saved = localStorage.getItem(`gantt-layout-${scheduleVersionId}`);
    if (saved) {
      try {
        const parsedLayout = JSON.parse(saved);

        // Migrate old boolean showRelationships to new format
        if (parsedLayout.viewSettings && typeof parsedLayout.viewSettings.showRelationships === 'boolean') {
          parsedLayout.viewSettings.showRelationships = parsedLayout.viewSettings.showRelationships ? 'all' : 'none';
        }

        // Ensure there are visible columns
        const hasVisibleColumns = parsedLayout.columns?.some((col: ColumnDefinition) => col.visible);
        if (!hasVisibleColumns && parsedLayout.columns) {
          parsedLayout.columns = parsedLayout.columns.map((col: ColumnDefinition, index: number) => ({
            ...col,
            visible: index < 6
          }));
        }

        // If no columns at all, use defaults
        if (!parsedLayout.columns || parsedLayout.columns.length === 0) {
          parsedLayout.columns = DEFAULT_COLUMNS;
        }

        setLayout(parsedLayout);
      } catch (e) {
        console.error('Failed to parse saved layout', e);
        setLayout(DEFAULT_LAYOUT);
      }
    }
  }, [scheduleVersionId]);

  useEffect(() => {
    localStorage.setItem(`gantt-layout-${scheduleVersionId}`, JSON.stringify(layout));
  }, [layout, scheduleVersionId]);

  const updateColumns = (columns: ColumnDefinition[]) => {
    setLayout(prev => ({ ...prev, columns }));
  };

  const updateSorts = (sorts: SortConfig[]) => {
    setLayout(prev => ({ ...prev, sorts }));
  };

  const updateFilters = (filters: FilterCondition[]) => {
    setLayout(prev => ({ ...prev, filters }));
  };

  const updateGrouping = (grouping: GroupConfig) => {
    setLayout(prev => ({ ...prev, grouping }));
  };

  const updateViewSettings = (settings: Partial<ViewSettings>) => {
    setLayout(prev => ({
      ...prev,
      viewSettings: { ...prev.viewSettings, ...settings }
    }));
  };

  const resetLayout = () => {
    setLayout(DEFAULT_LAYOUT);
  };

  return (
    <GanttLayoutContext.Provider
      value={{
        layout,
        updateColumns,
        updateSorts,
        updateFilters,
        updateGrouping,
        updateViewSettings,
        resetLayout
      }}
    >
      {children}
    </GanttLayoutContext.Provider>
  );
}

export function useGanttLayout() {
  const context = useContext(GanttLayoutContext);
  if (!context) {
    throw new Error('useGanttLayout must be used within GanttLayoutProvider');
  }
  return context;
}
