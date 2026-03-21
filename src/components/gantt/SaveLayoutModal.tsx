import { useState } from 'react';
import { X } from 'lucide-react';

interface SaveLayoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, description: string | null, scope: 'project' | 'user') => Promise<void>;
}

export function SaveLayoutModal({ isOpen, onClose, onSave }: SaveLayoutModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'project' | 'user'>('project');
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!name.trim()) return;

    setSaving(true);
    try {
      await onSave(name.trim(), description.trim() || null, scope);
      setName('');
      setDescription('');
      setScope('project');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setScope('project');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Save Layout As</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Layout Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter layout name"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Optional description"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Scope
            </label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="project"
                  checked={scope === 'project'}
                  onChange={(e) => setScope(e.target.value as 'project' | 'user')}
                  className="mr-2"
                />
                <span className="text-sm">
                  <span className="font-medium">Project Layout</span>
                  <span className="text-gray-500 ml-1">(visible to all team members)</span>
                </span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="user"
                  checked={scope === 'user'}
                  onChange={(e) => setScope(e.target.value as 'project' | 'user')}
                  className="mr-2"
                />
                <span className="text-sm">
                  <span className="font-medium">My Layout</span>
                  <span className="text-gray-500 ml-1">(private)</span>
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
