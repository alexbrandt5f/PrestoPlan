import { useState, useRef, useEffect } from 'react';
import { Columns2 as Columns, Filter as FilterIcon, Settings, Share2, SlidersHorizontal, Link, ChevronDown } from 'lucide-react';
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
  const [showShareMenu, setShowShareMenu] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  const activeFilterCount = layout.filters.length;
  const qf = layout.quickFilters;
  const hasActiveQuickFilters = qf.selectedWbsIds.length > 0 ||
    qf.activityStatus !== 'all' ||
    qf.criticality !== 'all' ||
    qf.timeframe !== 'all' ||
    qf.selectedCodeValueIds.length > 0;

  // Close share menu on outside click
  useEffect(() => {
    if (!showShareMenu) return;
    function handleClick(e: MouseEvent) {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showShareMenu]);

  /** Compact icon button style */
  const iconBtn = "p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors relative";
  /** Compact icon+text button style */
  const textBtn = "flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors relative";

  return (
    <>
      <div className="flex items-center gap-1">
        <LayoutManager
          projectId={projectId}
          scheduleVersionId={scheduleVersionId}
          companyId={companyId}
        />

        <div className="h-5 w-px bg-gray-200 mx-0.5"></div>

        {/* Quick Filters toggle */}
        <button
          onClick={onToggleQuickFilters}
          className={textBtn}
          title="Quick Filters"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Filters</span>
          {hasActiveQuickFilters && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
          )}
        </button>

        {/* Columns */}
        <button
          onClick={() => setShowColumnPicker(true)}
          className={iconBtn}
          title="Columns"
        >
          <Columns className="w-3.5 h-3.5" />
        </button>

        {/* Advanced Filter */}
        <button
          onClick={() => setShowFilterBuilder(true)}
          className={iconBtn}
          title="Advanced Filter"
        >
          <FilterIcon className="w-3.5 h-3.5" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold text-white bg-blue-600 rounded-full leading-none px-0.5">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Settings */}
        <button
          onClick={() => setShowSettings(true)}
          className={iconBtn}
          title="Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        <div className="h-5 w-px bg-gray-200 mx-0.5"></div>

        {/* Share dropdown */}
        <div className="relative" ref={shareMenuRef}>
          <button
            onClick={() => setShowShareMenu(!showShareMenu)}
            className={textBtn}
            title="Share & Links"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          {showShareMenu && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
              <button
                onClick={() => { setShowShareModal(true); setShowShareMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Share2 className="w-3.5 h-3.5" />
                Create Link
              </button>
              <button
                onClick={() => { setShowManageLinks(true); setShowShareMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Link className="w-3.5 h-3.5" />
                Manage Links
              </button>
            </div>
          )}
        </div>
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
