import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface ScheduleVersion {
  id: string;
  project_id: string;
  company_id: string;
  version_label: string;
  upload_date: string;
  data_date: string | null;
  source_blob_path: string | null;
  source_format: string;
  source_tool_version: string | null;
  is_baseline: boolean;
  parse_status: 'pending' | 'parsing' | 'complete' | 'error';
  parse_error_details: string | null;
  created_at: string;
  updated_at: string;
}

export function useScheduleVersions(projectId: string, companyId: string) {
  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !companyId) return;

    let channel: RealtimeChannel | null = null;

    const fetchVersions = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('schedule_versions')
          .select('*')
          .eq('project_id', projectId)
          .eq('company_id', companyId)
          .order('upload_date', { ascending: false });

        if (fetchError) throw fetchError;

        setVersions(data || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching schedule versions:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch versions');
      } finally {
        setLoading(false);
      }
    };

    fetchVersions();

    channel = supabase
      .channel(`schedule_versions:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'schedule_versions',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setVersions(prev => [payload.new as ScheduleVersion, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setVersions(prev =>
              prev.map(v => (v.id === payload.new.id ? (payload.new as ScheduleVersion) : v))
            );
          } else if (payload.eventType === 'DELETE') {
            setVersions(prev => prev.filter(v => v.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [projectId, companyId]);

  const deleteVersion = async (versionId: string) => {
    try {
      const { error: deleteError } = await supabase
        .from('schedule_versions')
        .delete()
        .eq('id', versionId)
        .eq('company_id', companyId);

      if (deleteError) throw deleteError;

      return true;
    } catch (err) {
      console.error('Error deleting version:', err);
      throw err;
    }
  };

  const refresh = async () => {
    if (!projectId || !companyId) return;

    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('schedule_versions')
        .select('*')
        .eq('project_id', projectId)
        .eq('company_id', companyId)
        .order('upload_date', { ascending: false });

      if (fetchError) throw fetchError;

      setVersions(data || []);
      setError(null);
    } catch (err) {
      console.error('Error refreshing schedule versions:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh versions');
    } finally {
      setLoading(false);
    }
  };

  return { versions, loading, error, deleteVersion, refresh };
}
