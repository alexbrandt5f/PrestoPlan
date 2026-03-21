import { useState } from 'react';
import { Save, Plus, Trash2, Lock, Unlock } from 'lucide-react';
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const currentLayout = [...projectLayouts, ...userLayouts].find(l => l.id === activeLayoutId);
  const isCreator = currentLayout?.created_by === user?.id;

  const handleLayoutChange = (layoutId: string) => {
    if (layoutId === 'default') {
      loadDefault();
    } else {
      const selectedLayout = [...projectLayouts, ...userLayouts].find(l => l.id === layoutId);
      if (selectedLayout) {
        loadLayout(layoutId, selectedLayout.layout_name, selectedLayout.definition);
      }
    }
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

  const handleDelete = async () => {
    if (!activeLayoutId) return;

    const success = await deleteLayout(activeLayoutId);
    if (success) {
      loadDefault();
      showToast('Layout deleted', 'success');
      setShowDeleteConfirm(false);
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

  return (
    <>
      <div className="flex items-center gap-2">
        <select
          value={activeLayoutId || 'default'}
          onChange={(e) => handleLayoutChange(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="default">Default</option>

          {projectLayouts.length > 0 && (
            <>
              <option disabled>─── Project Layouts ───</option>
              {projectLayouts.map(layout => (
                <option key={layout.id} value={layout.id}>
                  {layout.layout_name} {layout.is_locked ? '🔒' : ''}
                </option>
              ))}
            </>
          )}

          {userLayouts.length > 0 && (
            <>
              <option disabled>─── My Layouts ───</option>
              {userLayouts.map(layout => (
                <option key={layout.id} value={layout.id}>
                  {layout.layout_name} {layout.is_locked ? '🔒' : ''}
                </option>
              ))}
            </>
          )}
        </select>

        <div className="flex items-center gap-1 border-l pl-2">
          <button
            onClick={handleSave}
            disabled={!activeLayoutId}
            className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed relative"
            title={activeLayoutId ? "Save" : "Save As"}
          >
            <Save className="w-4 h-4" />
            {isDirty && activeLayoutId && (
              <span className="absolute top-0 right-0 w-2 h-2 bg-blue-500 rounded-full"></span>
            )}
          </button>

          <button
            onClick={() => setShowSaveModal(true)}
            className="p-1.5 hover:bg-gray-100 rounded"
            title="Save As"
          >
            <div className="relative w-4 h-4">
              <Save className="w-4 h-4" />
              <Plus className="w-2 h-2 absolute -bottom-0.5 -right-0.5 bg-white" />
            </div>
          </button>

          {isCreator && activeLayoutId && (
            <>
              <button
                onClick={handleToggleLock}
                className="p-1.5 hover:bg-gray-100 rounded"
                title={currentLayout?.is_locked ? "Unlock" : "Lock"}
              >
                {currentLayout?.is_locked ? (
                  <Lock className="w-4 h-4" />
                ) : (
                  <Unlock className="w-4 h-4" />
                )}
              </button>

              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-1.5 hover:bg-gray-100 rounded text-red-600"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <SaveLayoutModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSave={handleSaveAs}
      />

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm">
            <h3 className="text-lg font-semibold mb-2">Delete Layout?</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete "{currentLayout?.layout_name}"? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
