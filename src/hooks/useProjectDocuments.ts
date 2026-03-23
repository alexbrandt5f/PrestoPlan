import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { MAX_FILE_SIZE_BYTES, SUPPORTED_MIME_TYPES } from '../utils/fileTypeUtils';

export interface ProjectDocument {
  id: string;
  company_id: string;
  project_id: string;
  schedule_version_id: string | null;
  document_type_id: string;
  file_name: string;
  file_path: string;
  file_size_bytes: number;
  mime_type: string;
  description: string | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  document_type?: {
    name: string;
    sort_order: number;
  };
  uploader?: {
    display_name: string | null;
  };
}

export interface GroupedDocuments {
  versionScoped: Record<string, ProjectDocument[]>;
  projectWide: ProjectDocument[];
}

export function useProjectDocuments(projectId: string) {
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('project_documents')
        .select(
          `
          *,
          document_type:document_types(name, sort_order),
          uploader:user_profiles!project_documents_uploaded_by_fkey(display_name)
        `
        )
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('[useProjectDocuments] Error fetching documents:', fetchError);
        setError(fetchError.message);
        return;
      }

      setDocuments(data || []);
    } catch (err) {
      console.error('[useProjectDocuments] Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [projectId]);

  const uploadDocument = async (
    file: File,
    documentTypeId: string,
    scope: 'version' | 'project',
    companyId: string,
    versionId?: string,
    description?: string
  ): Promise<void> => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error('File exceeds 10MB limit. Please choose a smaller file.');
    }

    if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
      throw new Error(
        'File type not supported. Accepted: PDF, Word, Excel, PowerPoint, images.'
      );
    }

    if (scope === 'version' && !versionId) {
      throw new Error('Version ID is required for version-scoped documents');
    }

    try {
      const fileId = crypto.randomUUID();
      const fileExt = file.name.split('.').pop() || 'bin';

      const storagePath =
        scope === 'version'
          ? `${companyId}/${projectId}/versions/${versionId}/${fileId}.${fileExt}`
          : `${companyId}/${projectId}/project/${fileId}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('project-documents')
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error('[useProjectDocuments] Storage upload error:', uploadError);
        if (uploadError.message.includes('storage limit')) {
          throw new Error('Company storage limit reached. Contact your administrator.');
        }
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        await supabase.storage.from('project-documents').remove([storagePath]);
        throw new Error('User not authenticated');
      }

      const { error: insertError } = await supabase.from('project_documents').insert({
        company_id: companyId,
        project_id: projectId,
        schedule_version_id: scope === 'version' ? versionId : null,
        document_type_id: documentTypeId,
        file_name: file.name,
        file_path: storagePath,
        file_size_bytes: file.size,
        mime_type: file.type,
        description: description || null,
        uploaded_by: user.id,
      });

      if (insertError) {
        console.error('[useProjectDocuments] Database insert error:', insertError);
        await supabase.storage.from('project-documents').remove([storagePath]);
        throw new Error(`Failed to save document record: ${insertError.message}`);
      }

      await fetchDocuments();
    } catch (err) {
      console.error('[useProjectDocuments] Upload error:', err);
      throw err;
    }
  };

  const deleteDocument = async (documentId: string, filePath: string): Promise<void> => {
    try {
      const { error: storageError } = await supabase.storage
        .from('project-documents')
        .remove([filePath]);

      if (storageError) {
        console.error('[useProjectDocuments] Storage delete error:', storageError);
        throw new Error(`Failed to delete file from storage: ${storageError.message}`);
      }

      const { error: deleteError } = await supabase
        .from('project_documents')
        .delete()
        .eq('id', documentId);

      if (deleteError) {
        console.error('[useProjectDocuments] Database delete error:', deleteError);
        throw new Error(`Failed to delete document record: ${deleteError.message}`);
      }

      await fetchDocuments();
    } catch (err) {
      console.error('[useProjectDocuments] Delete error:', err);
      throw err;
    }
  };

  const updateDescription = async (
    documentId: string,
    description: string
  ): Promise<void> => {
    try {
      const { error: updateError } = await supabase
        .from('project_documents')
        .update({ description, updated_at: new Date().toISOString() })
        .eq('id', documentId);

      if (updateError) {
        console.error('[useProjectDocuments] Update description error:', updateError);
        throw new Error(`Failed to update description: ${updateError.message}`);
      }

      await fetchDocuments();
    } catch (err) {
      console.error('[useProjectDocuments] Update error:', err);
      throw err;
    }
  };

  const groupDocuments = (): GroupedDocuments => {
    const versionScoped: Record<string, ProjectDocument[]> = {};
    const projectWide: ProjectDocument[] = [];

    documents.forEach((doc) => {
      if (doc.schedule_version_id) {
        if (!versionScoped[doc.schedule_version_id]) {
          versionScoped[doc.schedule_version_id] = [];
        }
        versionScoped[doc.schedule_version_id].push(doc);
      } else {
        projectWide.push(doc);
      }
    });

    return { versionScoped, projectWide };
  };

  return {
    documents,
    loading,
    error,
    refetch: fetchDocuments,
    uploadDocument,
    deleteDocument,
    updateDescription,
    groupDocuments,
  };
}
