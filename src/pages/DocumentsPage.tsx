import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Upload, FileText, Search, Download, Trash2, CreditCard as Edit2, Check, X, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useProjectDocuments, ProjectDocument } from '../hooks/useProjectDocuments';
import { useDocumentTypes } from '../hooks/useDocumentTypes';
import { useScheduleVersions } from '../hooks/useScheduleVersions';
import { useCompany } from '../hooks/useCompany';
import { useProjects } from '../hooks/useProjects';
import { UploadDocumentModal } from '../components/UploadDocumentModal';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import {
  getFileIcon,
  getFileColorClass,
  formatFileSize,
  getDocumentTypeBadgeColor,
} from '../utils/fileTypeUtils';

type TabType = 'by-version' | 'project-wide';

export function DocumentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { company } = useCompany();
  const { projects } = useProjects();
  const { documents, loading, error, refetch, deleteDocument, updateDescription } =
    useProjectDocuments(projectId!);
  const { documentTypes } = useDocumentTypes();
  const { versions } = useScheduleVersions(projectId!);

  const [activeTab, setActiveTab] = useState<TabType>('by-version');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedVersions, setCollapsedVersions] = useState<Set<string>>(new Set());
  const [editingDescriptionId, setEditingDescriptionId] = useState<string | null>(null);
  const [editingDescriptionValue, setEditingDescriptionValue] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'viewer' | 'editor' | 'admin' | null>(null);

  const project = projects.find((p) => p.id === projectId);

  useEffect(() => {
    const fetchUserRole = async () => {
      if (!company?.id) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('company_memberships')
        .select('role')
        .eq('company_id', company.id)
        .eq('user_id', user.id)
        .single();

      if (data) {
        setUserRole(data.role as 'viewer' | 'editor' | 'admin');
      }
    };

    fetchUserRole();
  }, [company?.id]);

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      const matchesType = !selectedTypeFilter || doc.document_type_id === selectedTypeFilter;
      const matchesSearch =
        !searchQuery ||
        doc.file_name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [documents, selectedTypeFilter, searchQuery]);

  const { versionScoped, projectWide } = useMemo(() => {
    const versionScoped: Record<string, ProjectDocument[]> = {};
    const projectWide: ProjectDocument[] = [];

    filteredDocuments.forEach((doc) => {
      if (doc.schedule_version_id) {
        if (!versionScoped[doc.schedule_version_id]) {
          versionScoped[doc.schedule_version_id] = [];
        }
        versionScoped[doc.schedule_version_id].push(doc);
      } else {
        projectWide.push(doc);
      }
    });

    Object.keys(versionScoped).forEach((versionId) => {
      versionScoped[versionId].sort((a, b) => {
        const typeCompare =
          (a.document_type?.sort_order || 0) - (b.document_type?.sort_order || 0);
        if (typeCompare !== 0) return typeCompare;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    });

    projectWide.sort((a, b) => {
      const typeCompare =
        (a.document_type?.sort_order || 0) - (b.document_type?.sort_order || 0);
      if (typeCompare !== 0) return typeCompare;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return { versionScoped, projectWide };
  }, [filteredDocuments]);

  const sortedVersions = useMemo(() => {
    return [...versions].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [versions]);

  const toggleVersionCollapse = (versionId: string) => {
    setCollapsedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(versionId)) {
        next.delete(versionId);
      } else {
        next.add(versionId);
      }
      return next;
    });
  };

  const handleDownload = async (doc: ProjectDocument) => {
    try {
      setDownloadingId(doc.id);

      const { data, error } = await supabase.storage
        .from('project-documents')
        .createSignedUrl(doc.file_path, 3600);

      if (error || !data?.signedUrl) {
        throw new Error('Could not generate download link');
      }

      window.open(data.signedUrl, '_blank');
    } catch (err) {
      showToast('Could not generate download link. Please try again.', 'error');
      console.error('[DocumentsPage] Download error:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (doc: ProjectDocument) => {
    if (!window.confirm(`Delete ${doc.file_name}? This cannot be undone.`)) {
      return;
    }

    try {
      setDeletingId(doc.id);
      await deleteDocument(doc.id, doc.file_path);
      showToast('Document deleted successfully', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to delete document',
        'error'
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartEditDescription = (doc: ProjectDocument) => {
    setEditingDescriptionId(doc.id);
    setEditingDescriptionValue(doc.description || '');
  };

  const handleSaveDescription = async (docId: string) => {
    try {
      await updateDescription(docId, editingDescriptionValue);
      setEditingDescriptionId(null);
      showToast('Description updated', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to update description',
        'error'
      );
    }
  };

  const handleCancelEditDescription = () => {
    setEditingDescriptionId(null);
    setEditingDescriptionValue('');
  };

  const canManage = userRole === 'editor' || userRole === 'admin';
  const isPaidPlan = company?.plan === 'paid';
  const storageUsed = company?.storage_used_bytes || 0;
  const storageLimit = company?.storage_limit_bytes || 10737418240;
  const storagePercent = (storageUsed / storageLimit) * 100;
  const isStorageFull = storageUsed >= storageLimit;

  const renderDocumentRow = (doc: ProjectDocument) => {
    const Icon = getFileIcon(doc.mime_type);
    const colorClass = getFileColorClass(doc.mime_type);
    const badgeColor = getDocumentTypeBadgeColor(doc.document_type?.name || 'Unknown');
    const isEditing = editingDescriptionId === doc.id;

    return (
      <div
        key={doc.id}
        className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 border-b border-gray-100"
      >
        <Icon className={`w-5 h-5 flex-shrink-0 ${colorClass}`} />

        <button
          onClick={() => handleDownload(doc)}
          disabled={downloadingId === doc.id}
          className="font-medium text-gray-900 hover:text-blue-600 text-left flex-shrink-0 max-w-xs truncate disabled:opacity-50"
        >
          {downloadingId === doc.id ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {doc.file_name}
            </span>
          ) : (
            doc.file_name
          )}
        </button>

        <span className={`text-xs px-2 py-1 rounded-full ${badgeColor} flex-shrink-0`}>
          {doc.document_type?.name || 'Unknown'}
        </span>

        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editingDescriptionValue}
                onChange={(e) => setEditingDescriptionValue(e.target.value)}
                className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                placeholder="Add description..."
              />
              <button
                onClick={() => handleSaveDescription(doc.id)}
                className="text-green-600 hover:text-green-700"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={handleCancelEditDescription}
                className="text-gray-600 hover:text-gray-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 truncate">
                {doc.description || 'No description'}
              </span>
              {canManage && (
                <button
                  onClick={() => handleStartEditDescription(doc)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        <span className="text-sm text-gray-500 flex-shrink-0">
          {formatFileSize(doc.file_size_bytes)}
        </span>

        <span className="text-sm text-gray-500 flex-shrink-0">
          {new Date(doc.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>

        <span className="text-sm text-gray-500 flex-shrink-0">
          {doc.uploader?.display_name || 'Unknown'}
        </span>

        {canManage && (
          <button
            onClick={() => handleDelete(doc)}
            disabled={deletingId === doc.id}
            className="text-red-600 hover:text-red-700 flex-shrink-0 disabled:opacity-50"
          >
            {deletingId === doc.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600">Error loading documents: {error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Project Documents</h1>
                <p className="text-sm text-gray-600 mt-1">{project?.project_name}</p>
              </div>
              <div className="flex items-center gap-3">
                {!isPaidPlan && (
                  <p className="text-sm text-gray-600">
                    Document uploads are available on the paid plan.
                  </p>
                )}
                {isPaidPlan && isStorageFull && (
                  <p className="text-sm text-orange-600">
                    Storage limit reached (10GB). Delete files to free space.
                  </p>
                )}
                {canManage && isPaidPlan && !userRole?.includes('viewer') && (
                  <button
                    onClick={() => setShowUploadModal(true)}
                    disabled={isStorageFull}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Upload className="w-4 h-4" />
                    Upload Document
                  </button>
                )}
              </div>
            </div>

            {isPaidPlan && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">
                    {formatFileSize(storageUsed)} of {formatFileSize(storageLimit)} used
                  </span>
                  <span className="text-sm text-gray-600">{storagePercent.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      storagePercent > 95
                        ? 'bg-red-600'
                        : storagePercent > 80
                        ? 'bg-orange-500'
                        : 'bg-blue-600'
                    }`}
                    style={{ width: `${Math.min(storagePercent, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="border-b border-gray-200">
            <div className="flex">
              <button
                onClick={() => setActiveTab('by-version')}
                className={`px-6 py-3 font-medium text-sm ${
                  activeTab === 'by-version'
                    ? 'border-b-2 border-blue-600 text-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                By Version
              </button>
              <button
                onClick={() => setActiveTab('project-wide')}
                className={`px-6 py-3 font-medium text-sm ${
                  activeTab === 'project-wide'
                    ? 'border-b-2 border-blue-600 text-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Project-Wide
              </button>
            </div>
          </div>

          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by file name..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <select
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Types</option>
              {documentTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <span className="text-sm text-gray-600">
              Showing {filteredDocuments.length} of {documents.length} documents
            </span>
          </div>

          <div className="min-h-[400px]">
            {activeTab === 'by-version' && (
              <div>
                {sortedVersions.length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p>No schedule versions found</p>
                  </div>
                ) : Object.keys(versionScoped).length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p>No version documents uploaded yet</p>
                  </div>
                ) : (
                  sortedVersions.map((version) => {
                    const versionDocs = versionScoped[version.id] || [];
                    if (versionDocs.length === 0) return null;

                    const isCollapsed = collapsedVersions.has(version.id);

                    return (
                      <div key={version.id} className="border-b border-gray-200">
                        <button
                          onClick={() => toggleVersionCollapse(version.id)}
                          className="w-full flex items-center gap-2 px-6 py-3 bg-gray-50 hover:bg-gray-100 text-left"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                          <span className="font-medium text-gray-900">
                            {version.version_name}
                          </span>
                          <span className="text-sm text-gray-600">
                            ({versionDocs.length} document{versionDocs.length !== 1 ? 's' : ''})
                          </span>
                        </button>
                        {!isCollapsed && (
                          <div>{versionDocs.map((doc) => renderDocumentRow(doc))}</div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {activeTab === 'project-wide' && (
              <div>
                {projectWide.length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p>No project-wide documents uploaded yet</p>
                  </div>
                ) : (
                  projectWide.map((doc) => renderDocumentRow(doc))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showUploadModal && (
        <UploadDocumentModal
          projectId={projectId!}
          companyId={company!.id}
          scheduleVersions={versions}
          onClose={() => setShowUploadModal(false)}
          onSuccess={refetch}
        />
      )}
    </div>
  );
}
