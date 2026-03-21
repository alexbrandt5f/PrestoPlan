import { useState, useEffect } from 'react';
import { X, Group, Palette, Eye, Link, ZoomIn, ZoomOut } from 'lucide-react';
import { useGanttLayout, DEFAULT_WBS_BAND_COLORS } from '../../contexts/GanttLayoutContext';
import { supabase } from '../../lib/supabase';

interface SettingsPanelProps {
  scheduleVersionId: string;
  onClose: () => void;
  onToggleColorLegend?: () => void;
}

interface CodeType {
  id: string;
  code_type_name: string;
}

export default function SettingsPanel({ scheduleVersionId, onClose, onToggleColorLegend }: SettingsPanelProps) {
  const { layout, updateGrouping, updateViewSettings } = useGanttLayout();
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">View Settings</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Grouping</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Group className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <label className="text-sm text-gray-700 w-24 flex-shrink-0">Group By</label>
                <select
                  value={
                    layout.grouping.type === 'none'
                      ? 'none'
                      : layout.grouping.type === 'wbs'
                        ? 'wbs'
                        : layout.grouping.codeTypeId
                  }
                  onChange={(e) => handleGroupByChange(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="none">No Grouping</option>
                  <option value="wbs">WBS</option>
                  {codeTypes.map(ct => (
                    <option key={ct.id} value={ct.id}>{ct.code_type_name}</option>
                  ))}
                </select>
              </div>

              {layout.grouping.type !== 'none' && (
                <div className="ml-7 pl-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={layout.grouping.showSummaryBars}
                      onChange={(e) => updateGrouping({ ...layout.grouping, showSummaryBars: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    Show Summary Bars
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Timescale & Zoom</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-700 w-24 flex-shrink-0">Timescale</label>
                <select
                  value={layout.viewSettings.timescale}
                  onChange={(e) => handleTimescaleChange(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="year-month">Year & Month</option>
                  <option value="year-month-week">Year/Month/Week</option>
                  <option value="month-week-day">Month/Week/Day</option>
                  <option value="quarter-month">Quarter & Month</option>
                </select>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-700 w-24 flex-shrink-0">Zoom</label>
                <div className="flex items-center gap-2 flex-1">
                  <button
                    onClick={() => handleZoom('out')}
                    className="p-2 text-gray-700 hover:bg-gray-100 rounded border border-gray-300"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-700 w-16 text-center">
                    {Math.round(layout.viewSettings.zoom * 100)}%
                  </span>
                  <button
                    onClick={() => handleZoom('in')}
                    className="p-2 text-gray-700 hover:bg-gray-100 rounded border border-gray-300"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Color Coding</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Palette className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <label className="text-sm text-gray-700 w-24 flex-shrink-0">Color By</label>
                <select
                  value={layout.viewSettings.colorByCodeTypeId || 'none'}
                  onChange={(e) => updateViewSettings({ colorByCodeTypeId: e.target.value === 'none' ? undefined : e.target.value })}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="none">No Color Coding</option>
                  {codeTypes.map(ct => (
                    <option key={ct.id} value={ct.id}>{ct.code_type_name}</option>
                  ))}
                </select>
                {layout.viewSettings.colorByCodeTypeId && onToggleColorLegend && (
                  <button
                    onClick={onToggleColorLegend}
                    className="p-2 text-gray-700 hover:bg-gray-100 rounded border border-gray-300"
                    title="Show Color Legend"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Display Options</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={layout.viewSettings.showFloat}
                  onChange={(e) => updateViewSettings({ showFloat: e.target.checked })}
                  className="rounded border-gray-300"
                />
                Show Float
              </label>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">WBS Band Colors</h3>
              <button
                onClick={() => updateViewSettings({ wbsBandColors: DEFAULT_WBS_BAND_COLORS })}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Reset to Default
              </button>
            </div>
            <div className="space-y-2">
              {(layout.viewSettings.wbsBandColors || DEFAULT_WBS_BAND_COLORS).map((color, index) => (
                <div key={index} className="flex items-center gap-3">
                  <label className="text-sm text-gray-700 w-16 flex-shrink-0">Level {index}</label>
                  <div
                    className="w-8 h-8 rounded border border-gray-300 flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => {
                      const newColors = [...(layout.viewSettings.wbsBandColors || DEFAULT_WBS_BAND_COLORS)];
                      newColors[index] = e.target.value;
                      updateViewSettings({ wbsBandColors: newColors });
                    }}
                    className="flex-1 h-8 rounded border border-gray-300 cursor-pointer"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Relationships</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Link className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <label className="text-sm text-gray-700 w-24 flex-shrink-0">Show</label>
                <select
                  value={layout.viewSettings.showRelationships}
                  onChange={(e) => updateViewSettings({ showRelationships: e.target.value as 'none' | 'all' | 'selected' })}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="none">No Relationships</option>
                  <option value="all">All Relationships</option>
                  <option value="selected">Selected Activity Only</option>
                </select>
              </div>

              {layout.viewSettings.showRelationships !== 'none' && (
                <div className="ml-7 pl-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={layout.viewSettings.showDrivingOnly}
                      onChange={(e) => updateViewSettings({ showDrivingOnly: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    Driving Only
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
