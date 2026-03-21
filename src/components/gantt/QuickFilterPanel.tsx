import { useState, useMemo, useRef, useEffect } from 'react';
import { Pin, PinOff, ChevronRight, ChevronDown, X, RotateCcw } from 'lucide-react';
import { useGanttLayout } from '../../contexts/GanttLayoutContext';
import { supabase } from '../../lib/supabase';

interface QuickFilterPanelProps {
  wbsMap: Map<string, any>;
  activities: any[];
  calendars: any[];
  scheduleVersionId: string;
  dataDate: string | null;
  nearCriticalThreshold: number;
  onCodeAssignmentsLoaded: (assignments: Map<string, Set<string>>) => void;
  isOpen: boolean;
  onClose: () => void;
  onPinnedChange?: (pinned: boolean) => void;
}

interface CodeValue {
  id: string;
  code_value_name: string;
  parent_code_value_id: string | null;
  sort_order: number;
}

interface CodeType {
  id: string;
  code_type_name: string;
}

export function QuickFilterPanel({
  wbsMap,
  activities,
  calendars,
  scheduleVersionId,
  dataDate,
  nearCriticalThreshold,
  onCodeAssignmentsLoaded,
  isOpen,
  onClose,
  onPinnedChange
}: QuickFilterPanelProps) {
  const { layout, updateQuickFilters } = useGanttLayout();
  const qf = layout.quickFilters;

  const [isPinned, setIsPinned] = useState(false);
  const [expandedWbs, setExpandedWbs] = useState<Set<string>>(new Set());
  const [lastSelectedWbs, setLastSelectedWbs] = useState<string | null>(null);
  const [codeTypes, setCodeTypes] = useState<CodeType[]>([]);
  const [codeValues, setCodeValues] = useState<CodeValue[]>([]);
  const [loadingCodeValues, setLoadingCodeValues] = useState(false);
  const [lastSelectedCode, setLastSelectedCode] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const codeValueCacheRef = useRef<Map<string, CodeValue[]>>(new Map());
  const codeAssignmentCacheRef = useRef<Map<string, Map<string, Set<string>>>>(new Map());

  useEffect(() => {
    loadCodeTypes();
  }, [scheduleVersionId]);

  useEffect(() => {
    if (qf.activityCodeTypeId) {
      loadCodeValues(qf.activityCodeTypeId);
    } else {
      setCodeValues([]);
      onCodeAssignmentsLoaded(new Map());
    }
  }, [qf.activityCodeTypeId]);

  useEffect(() => {
    const topLevelWbs = Array.from(wbsMap.values())
      .filter(w => !w.parent_wbs_id || !wbsMap.has(w.parent_wbs_id))
      .slice(0, 2)
      .map(w => w.id);

    const newExpanded = new Set(expandedWbs);
    topLevelWbs.forEach(id => {
      newExpanded.add(id);
      const children = Array.from(wbsMap.values()).filter(w => w.parent_wbs_id === id);
      children.forEach(child => newExpanded.add(child.id));
    });
    setExpandedWbs(newExpanded);
  }, [wbsMap]);

  useEffect(() => {
    if (!isOpen || isPinned) return;

    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isPinned, onClose]);

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

  async function loadCodeValues(codeTypeId: string) {
    if (codeValueCacheRef.current.has(codeTypeId)) {
      setCodeValues(codeValueCacheRef.current.get(codeTypeId)!);

      if (codeAssignmentCacheRef.current.has(codeTypeId)) {
        onCodeAssignmentsLoaded(codeAssignmentCacheRef.current.get(codeTypeId)!);
      }
      return;
    }

    setLoadingCodeValues(true);

    const { data: values } = await supabase
      .from('cpm_code_values')
      .select('id, code_value_name, parent_code_value_id, sort_order')
      .eq('code_type_id', codeTypeId)
      .eq('schedule_version_id', scheduleVersionId)
      .order('sort_order');

    if (values) {
      codeValueCacheRef.current.set(codeTypeId, values);
      setCodeValues(values);

      const valueIds = values.map(v => v.id);
      const assignments = new Map<string, Set<string>>();

      const PAGE_SIZE = 1000;
      for (let i = 0; i < valueIds.length; i += PAGE_SIZE) {
        const batch = valueIds.slice(i, i + PAGE_SIZE);
        const { data: assignmentData } = await supabase
          .from('cpm_code_assignments')
          .select('activity_id, code_value_id')
          .eq('schedule_version_id', scheduleVersionId)
          .in('code_value_id', batch);

        if (assignmentData) {
          assignmentData.forEach(a => {
            if (!assignments.has(a.code_value_id)) {
              assignments.set(a.code_value_id, new Set());
            }
            assignments.get(a.code_value_id)!.add(a.activity_id);
          });
        }
      }

      codeAssignmentCacheRef.current.set(codeTypeId, assignments);
      onCodeAssignmentsLoaded(assignments);
    }

    setLoadingCodeValues(false);
  }

  const wbsHierarchy = useMemo(() => {
    const buildTree = (parentId: string | null, level: number = 0): any[] => {
      return Array.from(wbsMap.values())
        .filter(w => (parentId ? w.parent_wbs_id === parentId : !w.parent_wbs_id || !wbsMap.has(w.parent_wbs_id)))
        .sort((a, b) => (a.wbs_short_name || '').localeCompare(b.wbs_short_name || ''))
        .map(wbs => ({
          ...wbs,
          level,
          children: buildTree(wbs.id, level + 1)
        }));
    };
    return buildTree(null);
  }, [wbsMap]);

  const codeValueHierarchy = useMemo(() => {
    const buildTree = (parentId: string | null, level: number = 0): any[] => {
      return codeValues
        .filter(cv => cv.parent_code_value_id === parentId)
        .map(cv => ({
          ...cv,
          level,
          children: buildTree(cv.id, level + 1)
        }));
    };
    return buildTree(null);
  }, [codeValues]);

  const filteredActivityCount = useMemo(() => {
    if (qf.selectedWbsIds.length === 0) return activities.length;

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

    return activities.filter(a => a.wbs_id && selectedWbsSet.has(a.wbs_id)).length;
  }, [activities, qf.selectedWbsIds, wbsMap]);

  function toggleWbsExpand(wbsId: string) {
    const newExpanded = new Set(expandedWbs);
    if (newExpanded.has(wbsId)) {
      newExpanded.delete(wbsId);
    } else {
      newExpanded.add(wbsId);
    }
    setExpandedWbs(newExpanded);
  }

  function handleWbsClick(wbsId: string, event: React.MouseEvent) {
    if (event.ctrlKey || event.metaKey) {
      const selected = new Set(qf.selectedWbsIds);
      if (selected.has(wbsId)) {
        selected.delete(wbsId);
      } else {
        selected.add(wbsId);
      }
      updateQuickFilters({ selectedWbsIds: Array.from(selected) });
      setLastSelectedWbs(wbsId);
    } else if (event.shiftKey && lastSelectedWbs) {
      const allWbs = Array.from(wbsMap.keys());
      const lastIndex = allWbs.indexOf(lastSelectedWbs);
      const currentIndex = allWbs.indexOf(wbsId);
      const start = Math.min(lastIndex, currentIndex);
      const end = Math.max(lastIndex, currentIndex);
      const range = allWbs.slice(start, end + 1);
      const selected = new Set([...qf.selectedWbsIds, ...range]);
      updateQuickFilters({ selectedWbsIds: Array.from(selected) });
    } else {
      updateQuickFilters({ selectedWbsIds: [wbsId] });
      setLastSelectedWbs(wbsId);
    }
  }

  function handleCodeClick(codeValueId: string, event: React.MouseEvent) {
    if (event.ctrlKey || event.metaKey) {
      const selected = new Set(qf.selectedCodeValueIds);
      if (selected.has(codeValueId)) {
        selected.delete(codeValueId);
      } else {
        selected.add(codeValueId);
      }
      updateQuickFilters({ selectedCodeValueIds: Array.from(selected) });
      setLastSelectedCode(codeValueId);
    } else if (event.shiftKey && lastSelectedCode) {
      const allCodes = codeValues.map(cv => cv.id);
      const lastIndex = allCodes.indexOf(lastSelectedCode);
      const currentIndex = allCodes.indexOf(codeValueId);
      const start = Math.min(lastIndex, currentIndex);
      const end = Math.max(lastIndex, currentIndex);
      const range = allCodes.slice(start, end + 1);
      const selected = new Set([...qf.selectedCodeValueIds, ...range]);
      updateQuickFilters({ selectedCodeValueIds: Array.from(selected) });
    } else {
      updateQuickFilters({ selectedCodeValueIds: [codeValueId] });
      setLastSelectedCode(codeValueId);
    }
  }

  function renderWbsNode(node: any) {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedWbs.has(node.id);
    const isSelected = qf.selectedWbsIds.includes(node.id);

    return (
      <div key={node.id}>
        <div
          className={`flex items-center py-0.5 px-2 cursor-pointer hover:bg-gray-100 ${isSelected ? 'bg-blue-100' : ''}`}
          style={{ paddingLeft: `${8 + node.level * 16}px` }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleWbsExpand(node.id); }}
              className="mr-1 flex-shrink-0"
            >
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-4 mr-1"></span>
          )}
          <span
            className="text-xs truncate flex-1"
            onClick={(e) => handleWbsClick(node.id, e)}
          >
            {node.wbs_short_name || node.wbs_name}
          </span>
        </div>
        {isExpanded && node.children.map(renderWbsNode)}
      </div>
    );
  }

  function renderCodeValueNode(node: any) {
    const hasChildren = node.children.length > 0;
    const isSelected = qf.selectedCodeValueIds.includes(node.id);

    return (
      <div key={node.id}>
        <div
          className={`flex items-center py-0.5 px-2 cursor-pointer hover:bg-gray-100 ${isSelected ? 'bg-blue-100' : ''}`}
          style={{ paddingLeft: `${8 + node.level * 16}px` }}
          onClick={(e) => handleCodeClick(node.id, e)}
        >
          <span className="text-xs truncate flex-1">{node.code_value_name}</span>
        </div>
        {hasChildren && node.children.map(renderCodeValueNode)}
      </div>
    );
  }

  const hasAnyFilter = qf.selectedWbsIds.length > 0 ||
    qf.activityStatus !== 'all' ||
    qf.criticality !== 'all' ||
    qf.timeframe !== 'all' ||
    qf.activityCodeTypeId !== null ||
    qf.selectedCodeValueIds.length > 0;

  function clearAllFilters() {
    updateQuickFilters({
      selectedWbsIds: [],
      activityStatus: 'all',
      criticality: 'all',
      timeframe: 'all',
      activityCodeTypeId: null,
      selectedCodeValueIds: [],
    });
  }

  if (!isOpen && !isPinned) return null;

  /** Compact pill button for radio-style options */
  const pillClass = (active: boolean) =>
    `px-2.5 py-1 text-[11px] rounded-full cursor-pointer transition-colors whitespace-nowrap ${
      active
        ? 'bg-blue-600 text-white font-medium'
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
    }`;

  /** Disabled pill */
  const pillDisabledClass = 'px-2.5 py-1 text-[11px] rounded-full bg-gray-50 text-gray-300 cursor-not-allowed whitespace-nowrap';

  return (
    <div
      ref={panelRef}
      className={`fixed top-0 left-0 h-full bg-white shadow-xl z-30 flex flex-col border-r border-gray-200 transition-transform duration-200 ${
        isOpen || isPinned ? 'translate-x-0' : '-translate-x-full'
      }`}
      style={{ width: '272px' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/80">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Filters</span>
        <div className="flex items-center gap-1">
          {hasAnyFilter && (
            <button
              onClick={clearAllFilters}
              className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 transition-colors"
              title="Clear all filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => {
              const newPinned = !isPinned;
              setIsPinned(newPinned);
              onPinnedChange?.(newPinned);
            }}
            className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 transition-colors"
            title={isPinned ? "Unpin panel" : "Pin panel open"}
          >
            {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
          {!isPinned && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* WBS Section */}
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">WBS</span>
            <span className="text-[10px] text-gray-400">{filteredActivityCount} activities</span>
          </div>
          <div className="max-h-52 overflow-y-auto border border-gray-200 rounded-lg bg-gray-50/50">
            {wbsHierarchy.map(renderWbsNode)}
          </div>
        </div>

        {/* Status Section */}
        <div className="px-3 py-2 border-t border-gray-100">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Status</div>
          <div className="flex flex-wrap gap-1">
            {[
              { value: 'all', label: 'All' },
              { value: 'not_completed', label: 'Not Complete' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'completed', label: 'Complete' },
              { value: 'not_started', label: 'Not Started' }
            ].map(option => (
              <span
                key={option.value}
                className={pillClass(qf.activityStatus === option.value)}
                onClick={() => updateQuickFilters({ activityStatus: option.value as any })}
              >
                {option.label}
              </span>
            ))}
          </div>
        </div>

        {/* Criticality Section */}
        <div className="px-3 py-2 border-t border-gray-100">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Criticality</div>
          <div className="flex flex-wrap gap-1">
            {[
              { value: 'all', label: 'All' },
              { value: 'critical', label: 'Critical' },
              { value: 'crit_and_near_critical', label: 'Crit & Near' },
              { value: 'non_critical', label: 'Non-Critical' }
            ].map(option => (
              <span
                key={option.value}
                className={pillClass(qf.criticality === option.value)}
                onClick={() => updateQuickFilters({ criticality: option.value as any })}
              >
                {option.label}
              </span>
            ))}
          </div>
        </div>

        {/* Timeframe Section */}
        <div className="px-3 py-2 border-t border-gray-100">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Timeframe</div>
          <div className="flex flex-wrap gap-1">
            {[
              { value: 'all', label: 'All', disabled: false },
              { value: '3_week_lookahead', label: '3-Wk Lookahead', disabled: !dataDate },
              { value: '3_month_lookahead', label: '3-Mo Lookahead', disabled: !dataDate },
              { value: '1_month_lookback', label: '1-Mo Lookback', disabled: !dataDate }
            ].map(option => (
              <span
                key={option.value}
                className={option.disabled ? pillDisabledClass : pillClass(qf.timeframe === option.value)}
                onClick={() => { if (!option.disabled) updateQuickFilters({ timeframe: option.value as any }); }}
                title={option.disabled ? 'No data date available' : ''}
              >
                {option.label}
              </span>
            ))}
          </div>
        </div>

        {/* Activity Code Section */}
        <div className="px-3 py-2 border-t border-gray-100">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Activity Code</div>
          <select
            value={qf.activityCodeTypeId || ''}
            onChange={(e) => updateQuickFilters({
              activityCodeTypeId: e.target.value || null,
              selectedCodeValueIds: []
            })}
            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 mb-2"
          >
            <option value="">Select code type...</option>
            {codeTypes.map(ct => (
              <option key={ct.id} value={ct.id}>{ct.code_type_name}</option>
            ))}
          </select>

          {qf.activityCodeTypeId && (
            <>
              {loadingCodeValues ? (
                <div className="text-[11px] text-gray-400 py-2 text-center">Loading...</div>
              ) : (
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg bg-gray-50/50">
                  {codeValueHierarchy.map(renderCodeValueNode)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
