import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { useCompany } from '../hooks/useCompany';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { Loader2, ChevronRight, CreditCard as Edit2, Trash2, FileText, ArrowLeft, Upload, Calendar, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { CreateProjectModal, ProjectFormData } from '../components/CreateProjectModal';
import { UploadScheduleModal } from '../components/UploadScheduleModal';
import { useScheduleVersions } from '../hooks/useScheduleVersions';

interface Project {
  id: string;
  name: string;
  project_code?: string;
  description?: string;
  status: string;
  settings: {
    near_critical_float_threshold: number;
  };
  created_at: string;
}

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { company } = useCompany();
  const { showToast } = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState<string | null>(null);

  const { versions, loading: versionsLoading, deleteVersion, refresh } = useScheduleVersions(
    projectId || '',
    company?.id || ''
  );

  useEffect(() => {
    if (!projectId || !company) return;

    const fetchProject = async () => {
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .eq('id', projectId)
          .eq('company_id', company.id)
          .neq('status', 'deleted')
          .maybeSingle();

        if (error) throw error;

        if (!data) {
          showToast('Project not found', 'error');
          navigate('/dashboard');
          return;
        }

        setProject(data as Project);
      } catch (error) {
        console.error('Error fetching project:', error);
        showToast('Failed to load project', 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchProject();
  }, [projectId, company, navigate, showToast]);

  const handleEdit = async (formData: ProjectFormData) => {
    if (!project || !company) return;

    try {
      const { error } = await supabase
        .from('projects')
        .update({
          name: formData.name,
          project_code: formData.project_code || null,
          description: formData.description || null,
          settings: formData.settings,
          updated_at: new Date().toISOString(),
        })
        .eq('id', project.id)
        .eq('company_id', company.id);

      if (error) throw error;

      setProject({
        ...project,
        name: formData.name,
        project_code: formData.project_code,
        description: formData.description,
        settings: formData.settings,
      });

      showToast('Project updated', 'success');
    } catch (error) {
      console.error('Error updating project:', error);
      throw new Error('Failed to update project');
    }
  };

  const handleDelete = async () => {
    if (!project || !company) return;

    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('projects')
        .update({
          status: 'deleted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', project.id)
        .eq('company_id', company.id);

      if (error) throw error;

      showToast('Project deleted', 'success');
      navigate('/dashboard');
    } catch (error) {
      console.error('Error deleting project:', error);
      showToast('Failed to delete project', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteVersion = async () => {
    if (!versionToDelete || !company) return;

    try {
      await deleteVersion(versionToDelete);
      showToast('Schedule version deleted', 'success');
    } catch (error) {
      console.error('Error deleting version:', error);
      showToast('Failed to delete version', 'error');
    } finally {
      setVersionToDelete(null);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'complete':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'parsing':
      case 'pending':
        return <Loader2 className="w-4 h-4 text-[#2E86C1] animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'complete':
        return 'Complete';
      case 'error':
        return 'Error';
      case 'parsing':
        return 'Parsing...';
      case 'pending':
        return 'Pending';
      default:
        return 'Unknown';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <Loader2 className="w-12 h-12 text-[#2E86C1] animate-spin" />
        </div>
      </div>
    );
  }

  if (!project) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center text-sm text-gray-500 mb-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="hover:text-[#2E86C1] transition-colors"
          >
            Dashboard
          </button>
          <ChevronRight className="w-4 h-4 mx-2" />
          <span className="text-gray-900 font-medium">{project.name}</span>
        </div>

        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-gray-600 hover:text-[#2E86C1] transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </button>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{project.name}</h1>
              {project.project_code && (
                <p className="text-sm text-gray-500 font-mono mb-3">{project.project_code}</p>
              )}
              {project.description && (
                <p className="text-gray-600 mb-4">{project.description}</p>
              )}
            </div>
            <span
              className={`ml-4 px-3 py-1 rounded-full text-sm font-medium ${
                project.status === 'active'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {project.status === 'active' ? 'Active' : 'Archived'}
            </span>
          </div>

          <div className="border-t border-gray-200 pt-4 mb-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Settings</h3>
            <div className="text-sm text-gray-600">
              <span className="font-medium">Near-Critical Float Threshold:</span>{' '}
              {project.settings.near_critical_float_threshold} days
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Edit2 className="w-4 h-4" />
              Edit
            </button>
            <button
              onClick={() => setIsDeleteDialogOpen(true)}
              className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#1B4F72]" />
              <h2 className="text-xl font-semibold text-gray-900">Schedule Versions</h2>
            </div>
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#2E86C1] text-white rounded-lg hover:bg-[#1B4F72] transition-colors"
            >
              <Upload className="w-4 h-4" />
              Upload Schedule Version
            </button>
          </div>

          {versionsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-[#2E86C1] animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                <FileText className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-600 mb-2">No schedule versions uploaded yet</p>
              <p className="text-sm text-gray-500">
                Upload an XER file to get started
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map(version => (
                <div
                  key={version.id}
                  className="border border-gray-200 rounded-lg p-4 hover:border-[#2E86C1] transition-colors cursor-pointer"
                  onClick={() => {
                    if (version.parse_status === 'complete') {
                      navigate(`/project/${projectId}/version/${version.id}`);
                    }
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {version.version_label}
                        </h3>
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded uppercase">
                          {version.source_format}
                        </span>
                        <div
                          className="flex items-center gap-1 text-sm"
                          title={version.parse_error_details || ''}
                        >
                          {getStatusIcon(version.parse_status)}
                          <span className={`${
                            version.parse_status === 'complete'
                              ? 'text-green-600'
                              : version.parse_status === 'error'
                              ? 'text-red-600'
                              : 'text-gray-600'
                          }`}>
                            {getStatusText(version.parse_status)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span>Data Date: {formatDate(version.data_date)}</span>
                        </div>
                        <div>Uploaded: {formatDate(version.upload_date)}</div>
                        {version.source_tool_version && (
                          <div>P6 Version: {version.source_tool_version}</div>
                        )}
                      </div>
                      {version.parse_error_details && (
                        <p className="mt-2 text-sm text-red-600">
                          {version.parse_error_details}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setVersionToDelete(version.id);
                      }}
                      className="text-gray-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isEditModalOpen && (
        <CreateProjectModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSubmit={handleEdit}
          initialData={{
            name: project.name,
            project_code: project.project_code || '',
            description: project.description || '',
            settings: project.settings,
          }}
          isEdit={true}
        />
      )}

      {isDeleteDialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Delete Project</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <span className="font-semibold">{project.name}</span>?
              Your data will be retained but the project will be hidden.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setIsDeleteDialogOpen(false)}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {versionToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Delete Schedule Version</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this schedule version? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setVersionToDelete(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteVersion}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {isUploadModalOpen && company && projectId && (
        <UploadScheduleModal
          isOpen={isUploadModalOpen}
          onClose={() => setIsUploadModalOpen(false)}
          projectId={projectId}
          companyId={company.id}
          onUploadComplete={() => {
            setIsUploadModalOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
