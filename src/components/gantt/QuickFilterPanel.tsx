import { useState, useMemo, useRef, useEffect } from 'react';
import { Pin, PinOff, ChevronRight, ChevronDown, X } from 'lucide-react';
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
  onClose
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

  if (!isOpen && !isPinned) return null;

  return (
    <div
      ref={panelRef}
      className={`fixed top-0 left-0 h-full bg-white shadow-lg z-30 flex flex-col border-r border-gray-300 transition-transform duration-200 ${
        isOpen || isPinned ? 'translate-x-0' : '-translate-x-full'
      }`}
      style={{ width: '280px' }}
    >
      <div className="flex items-center justify-between p-2 border-b bg-gray-50">
        <span className="text-sm font-semibold">Filters</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsPinned(!isPinned)}
            className="p-1 hover:bg-gray-200 rounded"
            title={isPinned ? "Unpin" : "Pin"}
          >
            {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
          {!isPinned && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-200 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-gray-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-700">WBS</span>
            {qf.selectedWbsIds.length > 0 && (
              <button
                onClick={() => updateQuickFilters({ selectedWbsIds: [] })}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Clear
              </button>
            )}
          </div>
          <div className="text-xs text-gray-500 mb-2">
            {filteredActivityCount} activities
          </div>
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded">
            {wbsHierarchy.map(renderWbsNode)}
          </div>
        </div>

        <div className="border-b border-gray-200 p-3">
          <div className="text-xs font-semibold text-gray-700 mb-2">Status</div>
          <div className="space-y-1">
            {[
              { value: 'all', label: 'All' },
              { value: 'not_completed', label: 'Not Completed' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'completed', label: 'Completed' },
              { value: 'not_started', label: 'Not Started' }
            ].map(option => (
              <label key={option.value} className="flex items-center text-xs">
                <input
                  type="radio"
                  name="status"
                  value={option.value}
                  checked={qf.activityStatus === option.value}
                  onChange={(e) => updateQuickFilters({ activityStatus: e.target.value as any })}
                  className="mr-2"
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        <div className="border-b border-gray-200 p-3">
          <div className="text-xs font-semibold text-gray-700 mb-2">Criticality</div>
          <div className="space-y-1">
            {[
              { value: 'all', label: 'All' },
              { value: 'critical', label: 'Critical' },
              { value: 'crit_and_near_critical', label: 'Critical & Near Critical' },
              { value: 'non_critical', label: 'Non-Critical' }
            ].map(option => (
              <label key={option.value} className="flex items-center text-xs">
                <input
                  type="radio"
                  name="criticality"
                  value={option.value}
                  checked={qf.criticality === option.value}
                  onChange={(e) => updateQuickFilters({ criticality: e.target.value as any })}
                  className="mr-2"
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        <div className="border-b border-gray-200 p-3">
          <div className="text-xs font-semibold text-gray-700 mb-2">Timeframe</div>
          <div className="space-y-1">
            {[
              { value: 'all', label: 'All', disabled: false },
              { value: '3_week_lookahead', label: '3-Week Lookahead (1 wk lookback)', disabled: !dataDate },
              { value: '3_month_lookahead', label: '3-Month Lookahead (2 wk lookback)', disabled: !dataDate },
              { value: '1_month_lookback', label: '1-Month Lookback', disabled: !dataDate }
            ].map(option => (
              <label
                key={option.value}
                className={`flex items-center text-xs ${option.disabled ? 'text-gray-400' : ''}`}
                title={option.disabled ? 'No data date available' : ''}
              >
                <input
                  type="radio"
                  name="timeframe"
                  value={option.value}
                  checked={qf.timeframe === option.value}
                  onChange={(e) => updateQuickFilters({ timeframe: e.target.value as any })}
                  disabled={option.disabled}
                  className="mr-2"
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        <div className="p-3">
          <div className="text-xs font-semibold text-gray-700 mb-2">Activity Code</div>
          <select
            value={qf.activityCodeTypeId || ''}
            onChange={(e) => updateQuickFilters({
              activityCodeTypeId: e.target.value || null,
              selectedCodeValueIds: []
            })}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1 mb-2"
          >
            <option value="">Select code type...</option>
            {codeTypes.map(ct => (
              <option key={ct.id} value={ct.id}>{ct.code_type_name}</option>
            ))}
          </select>

          {qf.activityCodeTypeId && (
            <>
              {loadingCodeValues ? (
                <div className="text-xs text-gray-500">Loading...</div>
              ) : (
                <>
                  {qf.selectedCodeValueIds.length > 0 && (
                    <button
                      onClick={() => updateQuickFilters({ selectedCodeValueIds: [] })}
                      className="text-xs text-blue-600 hover:text-blue-800 mb-1"
                    >
                      Clear
                    </button>
                  )}
                  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded">
                    {codeValueHierarchy.map(renderCodeValueNode)}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
