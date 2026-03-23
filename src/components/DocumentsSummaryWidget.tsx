import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, ArrowRight, Loader2, FileText } from 'lucide-react';
import { useProjectDocuments } from '../hooks/useProjectDocuments';
import { useScheduleVersions } from '../hooks/useScheduleVersions';
import { UploadDocumentModal } from './UploadDocumentModal';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import {
  getFileIcon,
  getFileColorClass,
  getDocumentTypeBadgeColor,
} from '../utils/fileTypeUtils';

interface Props {
  projectId: string;
  companyId: string;
  companyPlan: string;
}

export function DocumentsSummaryWidget({ projectId, companyId, companyPlan }: Props) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { documents, loading, refetch } = useProjectDocuments(projectId);
  const { versions } = useScheduleVersions(projectId);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'viewer' | 'editor' | 'admin' | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string>(companyPlan);

  const isPaidPlan = currentPlan === 'paid';

  useEffect(() => {
    const fetchCompanyPlan = async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('plan')
        .eq('id', companyId)
        .single();

      if (data && !error) {
        setCurrentPlan(data.plan);
      }
    };

    fetchCompanyPlan();
  }, [companyId]);

  useEffect(() => {
    const fetchUserRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('company_memberships')
        .select('role')
        .eq('company_id', companyId)
        .eq('user_id', user.id)
        .single();

      if (data) {
        setUserRole(data.role as 'viewer' | 'editor' | 'admin');
      }
    };

    fetchUserRole();
  }, [companyId]);

  const recentDocuments = documents.slice(0, 5);
  const canManage = userRole === 'editor' || userRole === 'admin';

  const handleDownload = async (doc: typeof documents[0]) => {
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
      console.error('[DocumentsSummaryWidget] Download error:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Documents</h2>
            {isPaidPlan ? (
              <p className="text-sm text-gray-600 mt-1">
                {documents.length} document{documents.length !== 1 ? 's' : ''}
              </p>
            ) : (
              <p className="text-sm text-gray-600 mt-1">Upgrade to upload documents</p>
            )}
          </div>
          <button
            onClick={() => navigate(`/projects/${projectId}/documents`)}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            View All
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          {documents.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-10 h-10 mx-auto mb-3 text-gray-400" />
              {canManage && isPaidPlan ? (
                <p className="text-gray-600">
                  No documents yet. Upload your first document.
                </p>
              ) : (
                <p className="text-gray-600">No documents have been uploaded yet.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3 mb-4">
              {recentDocuments.map((doc) => {
                const Icon = getFileIcon(doc.mime_type);
                const colorClass = getFileColorClass(doc.mime_type);
                const badgeColor = getDocumentTypeBadgeColor(
                  doc.document_type?.name || 'Unknown'
                );
                const truncatedName =
                  doc.file_name.length > 30
                    ? doc.file_name.substring(0, 30) + '...'
                    : doc.file_name;

                return (
                  <button
                    key={doc.id}
                    onClick={() => handleDownload(doc)}
                    disabled={downloadingId === doc.id}
                    className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors text-left disabled:opacity-50"
                  >
                    <Icon className={`w-5 h-5 flex-shrink-0 ${colorClass}`} />
                    <div className="flex-1 min-w-0">
                      {downloadingId === doc.id ? (
                        <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {truncatedName}
                        </span>
                      ) : (
                        <span className="text-sm font-medium text-gray-900">
                          {truncatedName}
                        </span>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${badgeColor}`}>
                      {doc.document_type?.name || 'Unknown'}
                    </span>
                    <span className="text-xs text-gray-500 flex-shrink-0">
                      {new Date(doc.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {canManage && isPaidPlan && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Upload className="w-4 h-4" />
              Upload Document
            </button>
          )}

          {!canManage && isPaidPlan && documents.length > 0 && (
            <p className="text-xs text-gray-500 text-center mt-4">
              Editors and admins can manage documents
            </p>
          )}
        </div>
      </div>

      {showUploadModal && (
        <UploadDocumentModal
          projectId={projectId}
          companyId={companyId}
          scheduleVersions={versions}
          onClose={() => setShowUploadModal(false)}
          onSuccess={refetch}
        />
      )}
    </>
  );
}
