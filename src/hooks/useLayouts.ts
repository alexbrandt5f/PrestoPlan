import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface Layout {
  id: string;
  layout_name: string;
  description: string | null;
  scope: 'project' | 'user';
  is_locked: boolean;
  created_by: string;
  definition: any;
  created_at: string;
  updated_at: string;
}

export function useLayouts(projectId: string, companyId: string) {
  const { user } = useAuth();
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('basic');

  const fetchLayouts = useCallback(async () => {
    if (!projectId || !companyId) return;

    const { data, error } = await supabase
      .from('layouts')
      .select('*')
      .eq('project_id', projectId)
      .order('layout_name');

    if (error) {
      console.error('Error fetching layouts:', error);
    } else {
      setLayouts(data || []);
    }
    setLoading(false);
  }, [projectId, companyId]);

  useEffect(() => {
    fetchLayouts();
  }, [fetchLayouts]);

  useEffect(() => {
    async function fetchRole() {
      if (!user?.id || !companyId) return;
      const { data } = await supabase
        .from('company_memberships')
        .select('role')
        .eq('user_id', user.id)
        .eq('company_id', companyId)
        .maybeSingle();
      if (data) setUserRole(data.role);
    }
    fetchRole();
  }, [user?.id, companyId]);

  const projectLayouts = layouts.filter(l => l.scope === 'project');
  const userLayouts = layouts.filter(l => l.scope === 'user' && l.created_by === user?.id);

  async function createLayout(
    name: string,
    description: string | null,
    scope: 'project' | 'user',
    definition: any,
    targetUserId?: string
  ): Promise<Layout | null> {
    const { data, error } = await supabase
      .from('layouts')
      .insert({
        project_id: projectId,
        company_id: companyId,
        created_by: targetUserId || user?.id,
        layout_name: name,
        description,
        scope,
        definition,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating layout:', error);
      return null;
    }

    await fetchLayouts();
    return data;
  }

  async function updateLayout(layoutId: string, definition: any): Promise<boolean> {
    const layout = layouts.find(l => l.id === layoutId);
    if (!layout) return false;

    // Basic users can only update their own layouts
    if (userRole === 'basic' && layout.scope === 'project' && layout.created_by !== user?.id) {
      return false;
    }

    // Lock check: only creator can update a locked layout (even pro users)
    if (layout.is_locked && layout.created_by !== user?.id) {
      return false;
    }

    const { error } = await supabase
      .from('layouts')
      .update({ definition })
      .eq('id', layoutId);

    if (error) {
      console.error('Error updating layout:', error);
      return false;
    }

    await fetchLayouts();
    return true;
  }

  async function toggleLock(layoutId: string): Promise<boolean> {
    const layout = layouts.find(l => l.id === layoutId);
    if (!layout || layout.created_by !== user?.id) return false;

    const { error } = await supabase
      .from('layouts')
      .update({ is_locked: !layout.is_locked })
      .eq('id', layoutId);

    if (error) {
      console.error('Error toggling lock:', error);
      return false;
    }

    await fetchLayouts();
    return true;
  }

  async function deleteLayout(layoutId: string): Promise<boolean> {
    const layout = layouts.find(l => l.id === layoutId);
    if (!layout) return false;

    // Basic users can only delete their own layouts
    if (userRole === 'basic' && layout.scope === 'project' && layout.created_by !== user?.id) {
      return false;
    }

    // Pro/admin can delete any project layout, but only their own user layouts
    if (layout.scope === 'user' && layout.created_by !== user?.id) {
      return false;
    }

    const { error } = await supabase
      .from('layouts')
      .delete()
      .eq('id', layoutId);

    if (error) {
      console.error('Error deleting layout:', error);
      return false;
    }

    await fetchLayouts();
    return true;
  }

  async function updateLayoutMeta(
    layoutId: string,
    updates: { layout_name?: string; description?: string; scope?: 'project' | 'user' }
  ): Promise<boolean> {
    const layout = layouts.find(l => l.id === layoutId);
    if (!layout || layout.created_by !== user?.id) return false;

    const { error } = await supabase
      .from('layouts')
      .update(updates)
      .eq('id', layoutId);

    if (error) {
      console.error('Error updating layout meta:', error);
      return false;
    }

    await fetchLayouts();
    return true;
  }

  return {
    layouts,
    projectLayouts,
    userLayouts,
    loading,
    userRole,
    createLayout,
    updateLayout,
    toggleLock,
    deleteLayout,
    updateLayoutMeta,
    refresh: fetchLayouts,
  };
}
