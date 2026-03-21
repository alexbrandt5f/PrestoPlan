import { useState, useEffect, useRef } from 'react';
import { X, Copy, CreditCard as Edit2, Trash2, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

interface SharedLink {
  id: string;
  shortcode: string;
  link_name: string;
  description: string | null;
  schedule_version_id: string | null;
  layout_id: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string;
  version_label?: string;
  layout_name?: string;
}

interface ManageLinksModalProps {
  projectId: string;
  onClose: () => void;
}

export function ManageLinksModal({ projectId, onClose }: ManageLinksModalProps) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [links, setLinks] = useState<SharedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    loadLinks();
  }, [projectId]);

  async function loadLinks() {
    setLoading(true);

    try {
      const { data: linksData, error } = await supabase
        .from('shared_links')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (linksData && linksData.length > 0) {
        const versionIds = linksData
          .filter(link => link.schedule_version_id)
          .map(link => link.schedule_version_id);

        const layoutIds = linksData
          .filter(link => link.layout_id)
          .map(link => link.layout_id);

        let versionsMap = new Map<string, string>();
        let layoutsMap = new Map<string, string>();

        if (versionIds.length > 0) {
          const { data: versions } = await supabase
            .from('schedule_versions')
            .select('id, version_label')
            .in('id', versionIds);

          if (versions) {
            versions.forEach(v => versionsMap.set(v.id, v.version_label));
          }
        }

        if (layoutIds.length > 0) {
          const { data: layouts } = await supabase
            .from('layouts')
            .select('id, name')
            .in('id', layoutIds);

          if (layouts) {
            layouts.forEach(l => layoutsMap.set(l.id, l.name));
          }
        }

        const enrichedLinks = linksData.map(link => ({
          ...link,
          version_label: link.schedule_version_id ? versionsMap.get(link.schedule_version_id) : undefined,
          layout_name: link.layout_id ? layoutsMap.get(link.layout_id) : undefined
        }));

        setLinks(enrichedLinks);
      } else {
        setLinks([]);
      }
    } catch (error) {
      console.error('Error loading links:', error);
      showToast('Failed to load links', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(shortcode: string, linkId: string) {
    const url = `${window.location.origin}/v/${shortcode}`;

    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(linkId);
      showToast('Link copied to clipboard', 'success');
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      showToast('Failed to copy link', 'error');
    }
  }

  function startEdit(link: SharedLink) {
    setEditingId(link.id);
    setEditName(link.link_name);
    setEditDescription(link.description || '');
  }

  async function saveEdit(linkId: string) {
    if (!editName.trim()) {
      showToast('Link name cannot be empty', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('shared_links')
        .update({
          link_name: editName.trim(),
          description: editDescription.trim() || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', linkId);

      if (error) throw error;

      showToast('Link updated successfully', 'success');
      setEditingId(null);
      loadLinks();
    } catch (error) {
      console.error('Error updating link:', error);
      showToast('Failed to update link', 'error');
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
    setEditDescription('');
  }

  async function toggleActive(linkId: string, currentState: boolean) {
    try {
      const { error } = await supabase
        .from('shared_links')
        .update({
          is_active: !currentState,
          updated_at: new Date().toISOString()
        })
        .eq('id', linkId);

      if (error) throw error;

      showToast(`Link ${!currentState ? 'activated' : 'deactivated'}`, 'success');
      loadLinks();
    } catch (error) {
      console.error('Error toggling link:', error);
      showToast('Failed to update link', 'error');
    }
  }

  async function handleDelete(linkId: string, linkName: string) {
    if (!confirm(`Are you sure you want to delete "${linkName}"? This cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('shared_links')
        .delete()
        .eq('id', linkId);

      if (error) throw error;

      showToast('Link deleted successfully', 'success');
      loadLinks();
    } catch (error) {
      console.error('Error deleting link:', error);
      showToast('Failed to delete link', 'error');
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold">Manage Share Links</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : links.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No share links created yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Link Name</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Version</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Layout</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Created</th>
                    <th className="px-4 py-2 text-center text-sm font-medium text-gray-700">Active</th>
                    <th className="px-4 py-2 text-center text-sm font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map(link => (
                    <tr key={link.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3">
                        {editingId === link.id ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                            />
                            <textarea
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              placeholder="Description"
                              rows={2}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                            />
                          </div>
                        ) : (
                          <div>
                            <div className="text-sm font-medium">{link.link_name}</div>
                            {link.description && (
                              <div className="text-xs text-gray-500 mt-1">{link.description}</div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {link.schedule_version_id ? (
                          <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                            {link.version_label || 'Pinned'}
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                            Latest
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {link.layout_name || 'Default'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {formatDate(link.created_at)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {link.is_active ? (
                          <span className="text-green-600 text-lg">✓</span>
                        ) : (
                          <span className="text-gray-400 text-lg">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === link.id ? (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => saveEdit(link.id)}
                              className="px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-2 py-1 text-xs text-gray-700 bg-gray-200 rounded hover:bg-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleCopy(link.shortcode, link.id)}
                              className="p-1 hover:bg-gray-200 rounded"
                              title="Copy URL"
                            >
                              {copiedId === link.id ? (
                                <Check className="w-4 h-4 text-green-600" />
                              ) : (
                                <Copy className="w-4 h-4 text-gray-600" />
                              )}
                            </button>
                            {link.created_by === user?.id && (
                              <>
                                <button
                                  onClick={() => startEdit(link)}
                                  className="p-1 hover:bg-gray-200 rounded"
                                  title="Edit"
                                >
                                  <Edit2 className="w-4 h-4 text-gray-600" />
                                </button>
                                <button
                                  onClick={() => toggleActive(link.id, link.is_active)}
                                  className="px-2 py-1 text-xs text-gray-700 bg-gray-200 rounded hover:bg-gray-300"
                                  title={link.is_active ? 'Deactivate' : 'Activate'}
                                >
                                  {link.is_active ? 'Deactivate' : 'Activate'}
                                </button>
                                <button
                                  onClick={() => handleDelete(link.id, link.link_name)}
                                  className="p-1 hover:bg-red-100 rounded"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4 text-red-600" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-end p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
