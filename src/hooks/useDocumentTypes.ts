import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useCompany } from './useCompany';

export interface DocumentType {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function useDocumentTypes() {
  const { company } = useCompany();
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocumentTypes = async () => {
    if (!company?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('document_types')
        .select('*')
        .eq('company_id', company.id)
        .order('sort_order', { ascending: true });

      if (fetchError) {
        console.error('[useDocumentTypes] Error fetching document types:', fetchError);
        setError(fetchError.message);
        return;
      }

      setDocumentTypes(data || []);
    } catch (err) {
      console.error('[useDocumentTypes] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load document types');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocumentTypes();
  }, [company?.id]);

  const createDocumentType = async (
    name: string,
    description?: string
  ): Promise<DocumentType | null> => {
    if (!company?.id) {
      throw new Error('No company context available');
    }

    try {
      const maxSortOrder = documentTypes.length > 0
        ? Math.max(...documentTypes.map((t) => t.sort_order))
        : 0;

      const { data, error: insertError } = await supabase
        .from('document_types')
        .insert({
          company_id: company.id,
          name,
          description: description || null,
          is_default: false,
          sort_order: maxSortOrder + 1,
        })
        .select()
        .single();

      if (insertError) {
        console.error('[useDocumentTypes] Error creating document type:', insertError);
        throw new Error(insertError.message);
      }

      await fetchDocumentTypes();
      return data;
    } catch (err) {
      console.error('[useDocumentTypes] Unexpected error creating type:', err);
      throw err;
    }
  };

  return {
    documentTypes,
    loading,
    error,
    createDocumentType,
    refetch: fetchDocumentTypes,
  };
}
