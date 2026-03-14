import React, { useState } from 'react';
import { Navbar } from '../components/Navbar';
import { ProjectCard } from '../components/ProjectCard';
import { CreateProjectModal, ProjectFormData } from '../components/CreateProjectModal';
import { useCompany } from '../hooks/useCompany';
import { useProjects } from '../hooks/useProjects';
import { useWorkspaceSetup } from '../hooks/useWorkspaceSetup';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { Loader2, FolderOpen, Plus, Info } from 'lucide-react';

export function Dashboard() {
  const { company, loading: companyLoading } = useCompany();
  const { isSettingUp } = useWorkspaceSetup();
  const { projects, loading: projectsLoading, refetch } = useProjects(company?.id);
  const { showToast } = useToast();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const activeProjectCount = projects.filter((p) => p.status === 'active').length;
  const isFreeTierLimit = company?.plan_type === 'free' && activeProjectCount >= 5;

  if (isSettingUp || companyLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-[#2E86C1] animate-spin mx-auto mb-4" />
            <p className="text-gray-600">Setting up your workspace...</p>
          </div>
        </div>
      </div>
    );
  }

  const handleCreateProject = async (formData: ProjectFormData) => {
    if (!company) return;

    try {
      const { error } = await supabase.from('projects').insert({
        company_id: company.id,
        name: formData.name,
        project_code: formData.project_code || null,
        description: formData.description || null,
        status: 'active',
        settings: formData.settings,
      });

      if (error) throw error;

      showToast('Project created', 'success');
      refetch();
    } catch (error) {
      console.error('Error creating project:', error);
      throw new Error('Failed to create project');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome to PrestoPlan
          </h1>
          {company && (
            <p className="text-gray-600">
              Workspace: <span className="font-medium text-gray-800">{company.name}</span>
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200">
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center">
              <FolderOpen className="w-6 h-6 text-[#1B4F72] mr-2" />
              <h2 className="text-xl font-semibold text-gray-800">My Projects</h2>
            </div>
            <div className="relative group">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                disabled={isFreeTierLimit}
                className="flex items-center gap-2 px-4 py-2 bg-[#2E86C1] text-white rounded-lg hover:bg-[#1B4F72] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                New Project
              </button>
              {isFreeTierLimit && (
                <div className="invisible group-hover:visible absolute right-0 top-full mt-2 w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg z-10">
                  Free tier limit: 5 projects
                </div>
              )}
            </div>
          </div>

          <div className="p-6">
            {projectsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="bg-gray-100 rounded-lg h-48 animate-pulse"
                  />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-12">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                  <FolderOpen className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-600 mb-2">No projects yet</p>
                <p className="text-sm text-gray-500 mb-4">
                  Create your first project to get started!
                </p>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#2E86C1] text-white rounded-lg hover:bg-[#1B4F72] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  New Project
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    id={project.id}
                    name={project.name}
                    project_code={project.project_code}
                    description={project.description}
                    status={project.status}
                    created_at={project.created_at}
                    schedule_version_count={project.schedule_version_count}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <CreateProjectModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateProject}
      />
    </div>
  );
}
