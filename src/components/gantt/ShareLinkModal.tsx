import { useState, useEffect, useRef } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import QRCode from 'qrcode';

interface ShareLinkModalProps {
  projectId: string;
  scheduleVersionId: string;
  companyId: string;
  versionLabel: string;
  layouts: Array<{ id: string; name: string; is_default: boolean; user_id: string | null }>;
  onClose: () => void;
}

export function ShareLinkModal({
  projectId,
  scheduleVersionId,
  companyId,
  versionLabel,
  layouts,
  onClose
}: ShareLinkModalProps) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [linkName, setLinkName] = useState('');
  const [description, setDescription] = useState('');
  const [versionMode, setVersionMode] = useState<'evergreen' | 'pinned'>('evergreen');
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    if (createdUrl) {
      QRCode.toDataURL(createdUrl, { width: 200, margin: 1 })
        .then(url => setQrCodeDataUrl(url))
        .catch(err => console.error('QR code generation error:', err));
    }
  }, [createdUrl]);

  async function generateUniqueShortcode(): Promise<string | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: shortcode, error } = await supabase.rpc('generate_shortcode');

      if (error || !shortcode) {
        console.error('Error generating shortcode:', error);
        continue;
      }

      const { data: existing } = await supabase
        .from('shared_links')
        .select('id')
        .eq('shortcode', shortcode)
        .maybeSingle();

      if (!existing) {
        return shortcode;
      }
    }

    return null;
  }

  async function handleCreate() {
    if (!linkName.trim()) {
      showToast('Please enter a link name', 'error');
      return;
    }

    setCreating(true);

    try {
      const shortcode = await generateUniqueShortcode();

      if (!shortcode) {
        showToast('Failed to generate unique shortcode. Please try again.', 'error');
        setCreating(false);
        return;
      }

      const { error } = await supabase
        .from('shared_links')
        .insert({
          shortcode,
          project_id: projectId,
          company_id: companyId,
          created_by: user?.id,
          schedule_version_id: versionMode === 'pinned' ? scheduleVersionId : null,
          layout_id: selectedLayoutId,
          link_name: linkName.trim(),
          description: description.trim() || null,
          is_active: true
        });

      if (error) {
        throw error;
      }

      const fullUrl = `${window.location.origin}/v/${shortcode}`;
      setCreatedUrl(fullUrl);
      showToast('Share link created successfully', 'success');
    } catch (error) {
      console.error('Error creating share link:', error);
      showToast('Failed to create share link', 'error');
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!createdUrl) return;

    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
      showToast('Link copied to clipboard', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      showToast('Failed to copy link', 'error');
    }
  }

  const projectLayouts = layouts.filter(l => l.user_id === null);
  const userLayouts = layouts.filter(l => l.user_id === user?.id);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold">Create Share Link</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!createdUrl ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Link Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value)}
                  placeholder="e.g., Owner 3-Week Lookahead"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Version Mode
                </label>
                <div className="space-y-2">
                  <label className="flex items-start">
                    <input
                      type="radio"
                      value="evergreen"
                      checked={versionMode === 'evergreen'}
                      onChange={() => setVersionMode('evergreen')}
                      className="mt-1 mr-3"
                    />
                    <div>
                      <div className="text-sm font-medium">Always show latest version</div>
                      <div className="text-xs text-gray-500">
                        Link will open the most recently uploaded schedule version
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start">
                    <input
                      type="radio"
                      value="pinned"
                      checked={versionMode === 'pinned'}
                      onChange={() => setVersionMode('pinned')}
                      className="mt-1 mr-3"
                    />
                    <div>
                      <div className="text-sm font-medium">Pin to current version: {versionLabel}</div>
                      <div className="text-xs text-gray-500">
                        Link will always open this specific version
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Layout
                </label>
                <select
                  value={selectedLayoutId || ''}
                  onChange={(e) => setSelectedLayoutId(e.target.value || null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Viewer's default</option>
                  {projectLayouts.length > 0 && (
                    <optgroup label="Project Layouts">
                      {projectLayouts.map(layout => (
                        <option key={layout.id} value={layout.id}>
                          {layout.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {userLayouts.length > 0 && (
                    <optgroup label="My Layouts">
                      {userLayouts.map(layout => (
                        <option key={layout.id} value={layout.id}>
                          {layout.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !linkName.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? 'Creating...' : 'Create Link'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-green-50 border border-green-200 rounded p-4">
                <p className="text-sm text-green-800 font-medium mb-2">
                  Share link created successfully!
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={createdUrl}
                    readOnly
                    className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded text-sm"
                  />
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>

              {qrCodeDataUrl && (
                <div className="flex flex-col items-center py-4">
                  <p className="text-sm text-gray-700 mb-3">Scan QR Code</p>
                  <img src={qrCodeDataUrl} alt="QR Code" className="border border-gray-300 rounded" />
                </div>
              )}

              <div className="flex justify-end pt-4">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
