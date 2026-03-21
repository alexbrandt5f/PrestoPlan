import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function SharedLinkResolver() {
  const { shortcode } = useParams<{ shortcode: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      const returnUrl = `/v/${shortcode}`;
      navigate(`/login?returnTo=${encodeURIComponent(returnUrl)}`);
      return;
    }

    resolveLink();
  }, [user, shortcode]);

  async function resolveLink() {
    if (!shortcode) {
      setError('Invalid link');
      setLoading(false);
      return;
    }

    try {
      const { data: link, error: linkError } = await supabase
        .from('shared_links')
        .select('*')
        .eq('shortcode', shortcode)
        .eq('is_active', true)
        .maybeSingle();

      if (linkError) throw linkError;

      if (!link) {
        setError('Link not found or has been deactivated');
        setLoading(false);
        return;
      }

      let targetVersionId = link.schedule_version_id;

      if (!targetVersionId) {
        const { data: latestVersion, error: versionError } = await supabase
          .from('schedule_versions')
          .select('id')
          .eq('project_id', link.project_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (versionError) throw versionError;

        if (!latestVersion) {
          setError('No versions found for this project');
          setLoading(false);
          return;
        }

        targetVersionId = latestVersion.id;
      }

      let targetUrl = `/project/${link.project_id}/gantt/${targetVersionId}`;

      if (link.layout_id) {
        targetUrl += `?layout=${link.layout_id}`;
      }

      navigate(targetUrl);
    } catch (error) {
      console.error('Error resolving link:', error);
      setError('An error occurred while resolving the link');
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <div className="bg-red-100 border border-red-300 rounded-lg p-6 mb-4">
            <h2 className="text-lg font-semibold text-red-800 mb-2">Link Not Found</h2>
            <p className="text-red-700">{error}</p>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return null;
}
