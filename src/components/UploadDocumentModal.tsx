import { useState, useRef } from 'react';
import { X, Upload, Loader2, Plus } from 'lucide-react';
import { useDocumentTypes } from '../hooks/useDocumentTypes';
import { useProjectDocuments } from '../hooks/useProjectDocuments';
import {
  getSupportedExtensions,
  formatFileSize,
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_MIME_TYPES,
} from '../utils/fileTypeUtils';
import { useToast } from '../contexts/ToastContext';

interface ScheduleVersion {
  id: string;
  version_label: string;
  created_at: string;
}

interface Props {
  projectId: string;
  companyId: string;
  scheduleVersions: ScheduleVersion[];
  onClose: () => void;
  onSuccess: () => void;
}

export function UploadDocumentModal({
  projectId,
  companyId,
  scheduleVersions,
  onClose,
  onSuccess,
}: Props) {
  const { showToast } = useToast();
  const { documentTypes, loading: typesLoading, createDocumentType } = useDocumentTypes();
  const { uploadDocument } = useProjectDocuments(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [documentTypeId, setDocumentTypeId] = useState<string>('');
  const [scope, setScope] = useState<'version' | 'project'>('version');
  const [versionId, setVersionId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [showCreateType, setShowCreateType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeDescription, setNewTypeDescription] = useState('');
  const [creatingType, setCreatingType] = useState(false);

  const sortedVersions = [...scheduleVersions].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  console.log('[UploadDocumentModal] projectId:', projectId);
  console.log('[UploadDocumentModal] scheduleVersions:', scheduleVersions);
  console.log('[UploadDocumentModal] sortedVersions:', sortedVersions);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError(null);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError('File exceeds 10MB limit. Please choose a smaller file.');
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
      setFileError(
        'File type not supported. Accepted: PDF, Word, Excel, PowerPoint, images.'
      );
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setSelectedFile(file);
  };

  const handleCreateType = async () => {
    if (!newTypeName.trim()) {
      showToast('Please enter a type name', 'error');
      return;
    }

    try {
      setCreatingType(true);
      const newType = await createDocumentType(
        newTypeName.trim(),
        newTypeDescription.trim() || undefined
      );

      if (newType) {
        setDocumentTypeId(newType.id);
        setShowCreateType(false);
        setNewTypeName('');
        setNewTypeDescription('');
        showToast('Document type created successfully', 'success');
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to create document type',
        'error'
      );
    } finally {
      setCreatingType(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedFile || !documentTypeId) {
      return;
    }

    if (scope === 'version' && !versionId) {
      showToast('Please select a schedule version', 'error');
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);

      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      await uploadDocument(
        selectedFile,
        documentTypeId,
        scope,
        companyId,
        scope === 'version' ? versionId : undefined,
        description.trim() || undefined
      );

      clearInterval(progressInterval);
      setUploadProgress(100);

      showToast('Document uploaded successfully', 'success');

      // Wait for parent to refetch documents before closing
      await Promise.resolve(onSuccess());
      onClose();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to upload document',
        'error'
      );
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  };

  const isFormValid =
    selectedFile &&
    documentTypeId &&
    !fileError &&
    (scope === 'project' || versionId) &&
    !uploading;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Upload Document</h2>
          <button
            onClick={onClose}
            disabled={uploading}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              File <span className="text-red-500">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept={getSupportedExtensions()}
              onChange={handleFileChange}
              disabled={uploading}
              className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none disabled:opacity-50"
            />
            {selectedFile && !fileError && (
              <p className="mt-2 text-sm text-gray-600">
                Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </p>
            )}
            {fileError && <p className="mt-2 text-sm text-red-600">{fileError}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Document Type <span className="text-red-500">*</span>
            </label>
            {typesLoading ? (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading document types...</span>
              </div>
            ) : (
              <>
                <select
                  value={documentTypeId}
                  onChange={(e) => {
                    if (e.target.value === '__create_new__') {
                      setShowCreateType(true);
                      setDocumentTypeId('');
                    } else {
                      setDocumentTypeId(e.target.value);
                    }
                  }}
                  disabled={uploading}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="">Select a type...</option>
                  {documentTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                  <option value="__create_new__">+ Create new type</option>
                </select>

                {showCreateType && (
                  <div className="mt-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Type Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={newTypeName}
                          onChange={(e) => setNewTypeName(e.target.value)}
                          disabled={creatingType}
                          placeholder="e.g., Contract, Drawing, Report"
                          className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Description (optional)
                        </label>
                        <input
                          type="text"
                          value={newTypeDescription}
                          onChange={(e) => setNewTypeDescription(e.target.value)}
                          disabled={creatingType}
                          placeholder="Brief description"
                          className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={handleCreateType}
                          disabled={creatingType || !newTypeName.trim()}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {creatingType ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Plus className="w-4 h-4" />
                          )}
                          Create & Select
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowCreateType(false);
                            setNewTypeName('');
                            setNewTypeDescription('');
                          }}
                          disabled={creatingType}
                          className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Scope <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="version"
                  checked={scope === 'version'}
                  onChange={(e) => setScope(e.target.value as 'version' | 'project')}
                  disabled={uploading}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                />
                <span className="text-sm text-gray-700">Attach to a schedule version</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="project"
                  checked={scope === 'project'}
                  onChange={(e) => setScope(e.target.value as 'version' | 'project')}
                  disabled={uploading}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                />
                <span className="text-sm text-gray-700">Project-wide document</span>
              </label>
            </div>

            {scope === 'version' && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Schedule Version <span className="text-red-500">*</span>
                </label>
                <select
                  value={versionId}
                  onChange={(e) => setVersionId(e.target.value)}
                  disabled={uploading}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="">Select a version...</option>
                  {sortedVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.version_label} (
                      {new Date(version.created_at).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => {
                if (e.target.value.length <= 500) {
                  setDescription(e.target.value);
                }
              }}
              disabled={uploading}
              rows={3}
              maxLength={500}
              placeholder="Add notes about this document..."
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-gray-500 text-right">
              {description.length}/500 characters
            </p>
          </div>

          {uploading && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-700">Uploading...</span>
                <span className="text-sm text-gray-700">{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isFormValid}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Upload Document
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
