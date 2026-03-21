import { useState, useRef, useEffect } from 'react';
import { Save, Plus, Trash2, Lock, Unlock, ChevronDown, Check } from 'lucide-react';
import { useGanttLayout } from '../../contexts/GanttLayoutContext';
import { useLayouts } from '../../hooks/useLayouts';
import { SaveLayoutModal } from './SaveLayoutModal';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

interface LayoutManagerProps {
  projectId: string;
  scheduleVersionId: string;
  companyId: string;
}

export function LayoutManager({ projectId, scheduleVersionId, companyId }: LayoutManagerProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { layout, activeLayoutId, activeLayoutName, isDirty, loadLayout, loadDefault, markClean } = useGanttLayout();
  const {
    projectLayouts,
    userLayouts,
    createLayout,
    updateLayout,
    toggleLock,
    deleteLayout,
  } = useLayouts(projectId, companyId);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const allLayouts = [...projectLayouts, ...userLayouts];
  const currentLayout = allLayouts.find(l => l.id === activeLayoutId);
  const isCreator = currentLayout?.created_by === user?.id;

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setDeleteConfirmId(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  const handleLayoutChange = (layoutId: string) => {
    if (layoutId === 'default') {
      loadDefault();
    } else {
      const selectedLayout = allLayouts.find(l => l.id === layoutId);
      if (selectedLayout) {
        loadLayout(layoutId, selectedLayout.layout_name, selectedLayout.definition);
      }
    }
    setShowDropdown(false);
    setDeleteConfirmId(null);
  };

  const handleSave = async () => {
    if (!activeLayoutId) {
      setShowSaveModal(true);
      return;
    }

    const success = await updateLayout(activeLayoutId, {
      ...layout,
      quickFilters: layout.quickFilters || null,
    });

    if (success) {
      markClean();
      showToast('Layout saved successfully', 'success');
    } else {
      showToast('This layout is locked by its owner', 'error');
    }
  };

  const handleSaveAs = async (name: string, description: string | null, scope: 'project' | 'user') => {
    const newLayout = await createLayout(name, description, scope, {
      ...layout,
      quickFilters: layout.quickFilters || null,
    });

    if (newLayout) {
      loadLayout(newLayout.id, newLayout.layout_name, newLayout.definition);
      showToast('Layout created successfully', 'success');
    } else {
      showToast('Failed to create layout', 'error');
    }
  };

  const handleDeleteFromList = async (layoutId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (deleteConfirmId !== layoutId) {
      // First click — show confirm state
      setDeleteConfirmId(layoutId);
      return;
    }

    // Second click — actually delete
    const success = await deleteLayout(layoutId);
    if (success) {
      if (activeLayoutId === layoutId) {
        loadDefault();
      }
      showToast('Layout deleted', 'success');
      setDeleteConfirmId(null);
    } else {
      showToast('Failed to delete layout', 'error');
    }
  };

  const handleToggleLock = async () => {
    if (!activeLayoutId) return;

    const success = await toggleLock(activeLayoutId);
    if (success) {
      showToast(currentLayout?.is_locked ? 'Layout unlocked' : 'Layout locked', 'success');
    } else {
      showToast('Failed to toggle lock', 'error');
    }
  };

  /** Render a layout row in the dropdown */
  function renderLayoutRow(l: any) {
    const isActive = activeLayoutId === l.id;
    const canDelete = l.created_by === user?.id;
    const isConfirming = deleteConfirmId === l.id;

    return (
      <div
        key={l.id}
        className={`flex items-center gap-1 px-2 py-1.5 text-xs cursor-pointer group ${
          isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        <div
          className="flex-1 flex items-center gap-1.5 min-w-0"
          onClick={() => handleLayoutChange(l.id)}
        >
          {isActive && <Check className="w-3 h-3 flex-shrink-0 text-blue-600" />}
          <span className="truncate">{l.layout_name}</span>
          {l.is_locked && <Lock className="w-3 h-3 flex-shrink-0 text-gray-400" />}
        </div>
        {canDelete && (
          <button
            onClick={(e) => handleDeleteFromList(l.id, e)}
            className={`flex-shrink-0 p-0.5 rounded transition-colors ${
              isConfirming
                ? 'bg-red-100 text-red-600'
                : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500'
            }`}
            title={isConfirming ? "Click again to confirm delete" : "Delete layout"}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {/* Custom dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => { setShowDropdown(!showDropdown); setDeleteConfirmId(null); }}
            className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 min-w-[100px] max-w-[180px]"
          >
            <span className="truncate">{activeLayoutName || 'Default'}</span>
            <ChevronDown className="w-3 h-3 flex-shrink-0 text-gray-400" />
          </button>

          {showDropdown && (
            <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
              {/* Default option */}
              <div
                className={`flex items-center gap-1.5 px-2 py-1.5 text-xs cursor-pointer ${
                  !activeLayoutId ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                }`}
                onClick={() => handleLayoutChange('default')}
              >
                {!activeLayoutId && <Check className="w-3 h-3 flex-shrink-0 text-blue-600" />}
                <span>Default</span>
              </div>

              {/* Project layouts */}
              {projectLayouts.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-t border-gray-100 mt-1">
                    Project
                  </div>
                  {projectLayouts.map(renderLayoutRow)}
                </>
              )}

              {/* User layouts */}
              {userLayouts.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-t border-gray-100 mt-1">
                    My Layouts
                  </div>
                  {userLayouts.map(renderLayoutRow)}
                </>
              )}
            </div>
          )}
        </div>

        {/* Save / Save As / Lock buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleSave}
            disabled={!activeLayoutId}
            className="p-1 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed relative"
            title={activeLayoutId ? "Save" : "No layout selected"}
          >
            <Save className="w-3.5 h-3.5 text-gray-500" />
            {isDirty && activeLayoutId && (
              <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
            )}
          </button>

          <button
            onClick={() => setShowSaveModal(true)}
            className="p-1 hover:bg-gray-100 rounded"
            title="Save As New Layout"
          >
            <div className="relative w-3.5 h-3.5">
              <Save className="w-3.5 h-3.5 text-gray-500" />
              <Plus className="w-2 h-2 absolute -bottom-0.5 -right-0.5 bg-white text-gray-500" />
            </div>
          </button>

          {isCreator && activeLayoutId && (
            <button
              onClick={handleToggleLock}
              className="p-1 hover:bg-gray-100 rounded"
              title={currentLayout?.is_locked ? "Unlock" : "Lock"}
            >
              {currentLayout?.is_locked ? (
                <Lock className="w-3.5 h-3.5 text-gray-500" />
              ) : (
                <Unlock className="w-3.5 h-3.5 text-gray-500" />
              )}
            </button>
          )}
        </div>
      </div>

      <SaveLayoutModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSave={handleSaveAs}
      />
    </>
  );
}
