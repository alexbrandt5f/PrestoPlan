import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Project {
  id: string;
  name: string;
  project_code?: string;
  description?: string;
  status: string;
  created_at: string;
  schedule_version_count: number;
}

export function useProjects(companyId?: string) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('id, name, project_code, description, status, created_at')
        .eq('company_id', companyId)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false });

      if (projectsError) throw projectsError;

      const projectIds = (projectsData || []).map((p) => p.id);

      let versionCounts: Record<string, number> = {};

      if (projectIds.length > 0) {
        const { data: versionsData, error: versionsError } = await supabase
          .from('schedule_versions')
          .select('project_id')
          .in('project_id', projectIds);

        if (versionsError) throw versionsError;

        versionCounts = (versionsData || []).reduce((acc, version) => {
          acc[version.project_id] = (acc[version.project_id] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
      }

      const projectsWithCounts = (projectsData || []).map((project) => ({
        ...project,
        schedule_version_count: versionCounts[project.id] || 0,
      }));

      setProjects(projectsWithCounts);
      setError(null);
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [companyId]);

  return { projects, loading, error, refetch: fetchProjects };
}
