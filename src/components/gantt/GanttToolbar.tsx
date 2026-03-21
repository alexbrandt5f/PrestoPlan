import { useState } from 'react';
import { Columns2 as Columns, Filter as FilterIcon, Settings, Share2 } from 'lucide-react';
import { useGanttLayout } from '../../contexts/GanttLayoutContext';
import ColumnPicker from './ColumnPicker';
import FilterBuilder from './FilterBuilder';
import SettingsPanel from './SettingsPanel';
import { LayoutManager } from './LayoutManager';
import { ShareLinkModal } from './ShareLinkModal';
import { ManageLinksModal } from './ManageLinksModal';

interface GanttToolbarProps {
  scheduleVersionId: string;
  projectId: string;
  companyId: string;
  onGoToDataDate: () => void;
  dataDate: string | null;
  onToggleColorLegend?: () => void;
  onToggleQuickFilters: () => void;
  versionLabel: string;
  layouts: Array<{ id: string; name: string; is_default: boolean; user_id: string | null }>;
}

export default function GanttToolbar({ scheduleVersionId, projectId, companyId, onGoToDataDate, dataDate, onToggleColorLegend, onToggleQuickFilters, versionLabel, layouts }: GanttToolbarProps) {
  const { layout, updateColumns, updateFilters } = useGanttLayout();
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showManageLinks, setShowManageLinks] = useState(false);

  const activeFilterCount = layout.filters.length;
  const qf = layout.quickFilters;
  const hasActiveQuickFilters = qf.selectedWbsIds.length > 0 ||
    qf.activityStatus !== 'all' ||
    qf.criticality !== 'all' ||
    qf.timeframe !== 'all' ||
    qf.selectedCodeValueIds.length > 0;

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
          onClick={onToggleQuickFilters}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 relative"
        >
          <FilterIcon className="w-4 h-4" />
          Filters
          {hasActiveQuickFilters && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full"></span>
          )}
        </button>

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

        <div className="h-6 w-px bg-gray-300 mx-1"></div>

        <button
          onClick={() => setShowShareModal(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
        >
          <Share2 className="w-4 h-4" />
          Share
        </button>

        <button
          onClick={() => setShowManageLinks(true)}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
        >
          Manage Links
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

      {showShareModal && (
        <ShareLinkModal
          projectId={projectId}
          scheduleVersionId={scheduleVersionId}
          companyId={companyId}
          versionLabel={versionLabel}
          layouts={layouts}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {showManageLinks && (
        <ManageLinksModal
          projectId={projectId}
          onClose={() => setShowManageLinks(false)}
        />
      )}
    </>
  );
}
