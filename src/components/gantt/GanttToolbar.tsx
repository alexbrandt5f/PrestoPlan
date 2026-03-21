import { useState } from 'react';
import { Columns2 as Columns, Filter as FilterIcon, Settings } from 'lucide-react';
import { useGanttLayout } from '../../contexts/GanttLayoutContext';
import ColumnPicker from './ColumnPicker';
import FilterBuilder from './FilterBuilder';
import SettingsPanel from './SettingsPanel';
import { LayoutManager } from './LayoutManager';

interface GanttToolbarProps {
  scheduleVersionId: string;
  projectId: string;
  companyId: string;
  onGoToDataDate: () => void;
  dataDate: string | null;
  onToggleColorLegend?: () => void;
}

export default function GanttToolbar({ scheduleVersionId, projectId, companyId, onGoToDataDate, dataDate, onToggleColorLegend }: GanttToolbarProps) {
  const { layout, updateColumns, updateFilters } = useGanttLayout();
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const activeFilterCount = layout.filters.length;

  return (
    <>
      <div className="flex items-center gap-2">
        <LayoutManager
          projectId={projectId}
          scheduleVersionId={scheduleVersionId}
          companyId={companyId}
        />

        <div className="h-6 w-px bg-gray-300 mx-1"></div>

        <button
          onClick={() => setShowColumnPicker(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
        >
          <Columns className="w-4 h-4" />
          Columns
        </button>

        <button
          onClick={() => setShowFilterBuilder(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
        >
          <FilterIcon className="w-4 h-4" />
          Filter
          {activeFilterCount > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-semibold text-white bg-blue-600 rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>
      </div>

      {showColumnPicker && (
        <ColumnPicker
          columns={layout.columns}
          scheduleVersionId={scheduleVersionId}
          onUpdate={updateColumns}
          onClose={() => setShowColumnPicker(false)}
        />
      )}

      {showFilterBuilder && (
        <FilterBuilder
          filters={layout.filters}
          columns={layout.columns}
          onUpdate={updateFilters}
          onClose={() => setShowFilterBuilder(false)}
        />
      )}

      {showSettings && (
        <SettingsPanel
          scheduleVersionId={scheduleVersionId}
          onClose={() => setShowSettings(false)}
          onToggleColorLegend={onToggleColorLegend}
        />
      )}
    </>
  );
}
