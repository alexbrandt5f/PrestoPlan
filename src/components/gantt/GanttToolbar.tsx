import { useState, useEffect } from 'react';
import { Columns2 as Columns, Filter as FilterIcon, Group, Eye, Link, ZoomIn, ZoomOut, Palette } from 'lucide-react';
import { useGanttLayout } from '../../contexts/GanttLayoutContext';
import ColumnPicker from './ColumnPicker';
import FilterBuilder from './FilterBuilder';
import { supabase } from '../../lib/supabase';

interface GanttToolbarProps {
  scheduleVersionId: string;
  onGoToDataDate: () => void;
  dataDate: string | null;
  onToggleColorLegend?: () => void;
}

interface CodeType {
  id: string;
  code_type_name: string;
}

export default function GanttToolbar({ scheduleVersionId, onGoToDataDate, dataDate, onToggleColorLegend }: GanttToolbarProps) {
  const { layout, updateColumns, updateGrouping, updateViewSettings, updateFilters } = useGanttLayout();
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [codeTypes, setCodeTypes] = useState<CodeType[]>([]);

  useEffect(() => {
    loadCodeTypes();
  }, [scheduleVersionId]);

  async function loadCodeTypes() {
    const { data } = await supabase
      .from('cpm_code_types')
      .select('id, code_type_name')
      .eq('schedule_version_id', scheduleVersionId)
      .order('code_type_name');

    if (data) {
      setCodeTypes(data);
    }
  }

  function handleGroupByChange(value: string) {
    if (value === 'none') {
      updateGrouping({ type: 'none', showSummaryBars: false });
    } else if (value === 'wbs') {
      updateGrouping({ type: 'wbs', showSummaryBars: layout.grouping.showSummaryBars });
    } else {
      updateGrouping({ type: 'code', codeTypeId: value, showSummaryBars: layout.grouping.showSummaryBars });
    }
  }

  function handleTimescaleChange(value: string) {
    updateViewSettings({
      timescale: value as 'year-month' | 'year-month-week' | 'month-week-day' | 'quarter-month'
    });
  }

  function handleZoom(direction: 'in' | 'out') {
    const currentZoom = layout.viewSettings.zoom;
    const newZoom = direction === 'in'
      ? Math.min(currentZoom * 1.2, 3)
      : Math.max(currentZoom / 1.2, 0.3);
    updateViewSettings({ zoom: newZoom });
  }

  const activeFilterCount = layout.filters.length;

  return (
    <>
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-wrap">
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

        <div className="flex items-center gap-2">
          <Group className="w-4 h-4 text-gray-500" />
          <select
            value={
              layout.grouping.type === 'none'
                ? 'none'
                : layout.grouping.type === 'wbs'
                  ? 'wbs'
                  : layout.grouping.codeTypeId
            }
            onChange={(e) => handleGroupByChange(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="none">No Grouping</option>
            <option value="wbs">WBS</option>
            {codeTypes.map(ct => (
              <option key={ct.id} value={ct.id}>{ct.code_type_name}</option>
            ))}
          </select>
        </div>

        {layout.grouping.type !== 'none' && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={layout.grouping.showSummaryBars}
              onChange={(e) => updateGrouping({ ...layout.grouping, showSummaryBars: e.target.checked })}
              className="rounded border-gray-300"
            />
            Show Summary Bars
          </label>
        )}

        <div className="border-l border-gray-300 h-6 mx-2" />

        <select
          value={layout.viewSettings.timescale}
          onChange={(e) => handleTimescaleChange(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="year-month">Year & Month</option>
          <option value="year-month-week">Year/Month/Week</option>
          <option value="month-week-day">Month/Week/Day</option>
          <option value="quarter-month">Quarter & Month</option>
        </select>

        <div className="flex items-center gap-1">
          <button
            onClick={() => handleZoom('out')}
            className="p-1.5 text-gray-700 hover:bg-gray-100 rounded"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-500 w-12 text-center">
            {Math.round(layout.viewSettings.zoom * 100)}%
          </span>
          <button
            onClick={() => handleZoom('in')}
            className="p-1.5 text-gray-700 hover:bg-gray-100 rounded"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        <div className="border-l border-gray-300 h-6 mx-2" />

        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-gray-500" />
          <select
            value={layout.viewSettings.colorByCodeTypeId || 'none'}
            onChange={(e) => updateViewSettings({ colorByCodeTypeId: e.target.value === 'none' ? undefined : e.target.value })}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="none">No Color Coding</option>
            {codeTypes.map(ct => (
              <option key={ct.id} value={ct.id}>{ct.code_type_name}</option>
            ))}
          </select>
          {layout.viewSettings.colorByCodeTypeId && onToggleColorLegend && (
            <button
              onClick={onToggleColorLegend}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
              title="Show Color Legend"
            >
              <Eye className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="border-l border-gray-300 h-6 mx-2" />

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={layout.viewSettings.showFloat}
            onChange={(e) => updateViewSettings({ showFloat: e.target.checked })}
            className="rounded border-gray-300"
          />
          Show Float
        </label>

        <div className="flex items-center gap-2">
          <Link className="w-4 h-4 text-gray-500" />
          <select
            value={layout.viewSettings.showRelationships}
            onChange={(e) => updateViewSettings({ showRelationships: e.target.value as 'none' | 'all' | 'selected' })}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded"
          >
            <option value="none">No Relationships</option>
            <option value="all">All Relationships</option>
            <option value="selected">Selected Activity Only</option>
          </select>
        </div>

        {layout.viewSettings.showRelationships !== 'none' && (
          <label className="flex items-center gap-2 text-sm text-gray-500 ml-2">
            <input
              type="checkbox"
              checked={layout.viewSettings.showDrivingOnly}
              onChange={(e) => updateViewSettings({ showDrivingOnly: e.target.checked })}
              className="rounded border-gray-300"
            />
            Driving Only
          </label>
        )}

        <div className="ml-auto"></div>
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
    </>
  );
}
