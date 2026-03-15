import React, { useState } from 'react';
import { X, Upload, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { uploadScheduleFile, ParseProgress } from '../lib/storage';
import { useToast } from '../contexts/ToastContext';
import { ParseProgressDisplay } from './ParseProgressDisplay';

interface FileUpload {
  id: string;
  file: File;
  versionLabel: string;
  progress: number;
  status: 'pending' | 'uploading' | 'parsing' | 'complete' | 'error';
  error?: string;
  statusMessage?: string;
  parseProgress?: ParseProgress;
}

interface UploadScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  companyId: string;
  onUploadComplete: () => void;
}

export function UploadScheduleModal({
  isOpen,
  onClose,
  projectId,
  companyId,
  onUploadComplete,
}: UploadScheduleModalProps) {
  const [files, setFiles] = useState<FileUpload[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const { showToast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const xerFiles = selectedFiles.filter(f => f.name.toLowerCase().endsWith('.xer'));

    if (xerFiles.length === 0) {
      showToast('Please select .xer files', 'error');
      return;
    }

    const newFiles: FileUpload[] = xerFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      versionLabel: file.name.replace(/\.xer$/i, ''),
      progress: 0,
      status: 'pending',
    }));

    setFiles(prev => [...prev, ...newFiles]);
  };

  const handleLabelChange = (fileId: string, label: string) => {
    setFiles(prev =>
      prev.map(f => (f.id === fileId ? { ...f, versionLabel: label } : f))
    );
  };

  const handleRemoveFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const handleUploadAll = async () => {
    if (files.length === 0) return;

    setIsUploading(true);

    const uploadPromises = files.map(async fileUpload => {
      try {
        const { parsePromise } = await uploadScheduleFile({
          file: fileUpload.file,
          projectId,
          companyId,
          versionLabel: fileUpload.versionLabel,
          onProgress: (progress) => {
            setFiles(prev =>
              prev.map(f =>
                f.id === fileUpload.id ? { ...f, progress } : f
              )
            );
          },
          onStatusChange: (status, message) => {
            setFiles(prev =>
              prev.map(f =>
                f.id === fileUpload.id
                  ? { ...f, status, statusMessage: message }
                  : f
              )
            );
          },
          onParseProgress: (parseProgress) => {
            setFiles(prev =>
              prev.map(f =>
                f.id === fileUpload.id ? { ...f, parseProgress } : f
              )
            );
          },
        });

        await parsePromise;
      } catch (error) {
        console.error('Upload error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        setFiles(prev =>
          prev.map(f =>
            f.id === fileUpload.id
              ? {
                  ...f,
                  status: 'error' as const,
                  error: errorMessage,
                  statusMessage: `Error: ${errorMessage}`,
                }
              : f
          )
        );
      }
    });

    await Promise.all(uploadPromises);

    setIsUploading(false);

    const successCount = files.filter(f => f.status === 'complete').length;
    const errorCount = files.filter(f => f.status === 'error').length;

    if (successCount > 0) {
      showToast(
        `${successCount} file${successCount > 1 ? 's' : ''} parsed successfully`,
        'success'
      );
      onUploadComplete();
    }

    if (errorCount > 0) {
      showToast(`${errorCount} file${errorCount > 1 ? 's' : ''} failed`, 'error');
    }

    if (errorCount === 0) {
      setTimeout(() => {
        onClose();
        setFiles([]);
      }, 1500);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Upload Schedule Version</h2>
          <button
            onClick={onClose}
            disabled={isUploading}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-6">
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#2E86C1] hover:bg-gray-50 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="w-10 h-10 text-gray-400 mb-2" />
                <p className="mb-2 text-sm text-gray-600">
                  <span className="font-semibold">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-gray-500">XER files only (multiple files supported)</p>
              </div>
              <input
                type="file"
                className="hidden"
                accept=".xer"
                multiple
                onChange={handleFileSelect}
                disabled={isUploading}
              />
            </label>
          </div>

          {files.length > 0 && (
            <div className="space-y-4">
              {files.map(fileUpload => (
                <div
                  key={fileUpload.id}
                  className="border border-gray-200 rounded-lg p-4 bg-gray-50"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-gray-700">
                          {fileUpload.file.name}
                        </span>
                        {fileUpload.status === 'complete' && (
                          <CheckCircle className="w-4 h-4 text-green-600" />
                        )}
                        {fileUpload.status === 'error' && (
                          <AlertCircle className="w-4 h-4 text-red-600" />
                        )}
                        {(fileUpload.status === 'uploading' || fileUpload.status === 'parsing') && (
                          <Loader2 className="w-4 h-4 text-[#2E86C1] animate-spin" />
                        )}
                      </div>
                      <input
                        type="text"
                        value={fileUpload.versionLabel}
                        onChange={e => handleLabelChange(fileUpload.id, e.target.value)}
                        disabled={isUploading}
                        placeholder="Version label"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2E86C1] focus:border-transparent disabled:opacity-50 disabled:bg-gray-100"
                      />
                      {fileUpload.statusMessage && (
                        <p
                          className={`text-xs mt-2 font-medium ${
                            fileUpload.status === 'error'
                              ? 'text-red-600'
                              : fileUpload.status === 'complete'
                              ? 'text-green-600'
                              : 'text-[#2E86C1]'
                          }`}
                        >
                          {fileUpload.statusMessage}
                        </p>
                      )}
                    </div>
                    {!isUploading && fileUpload.status === 'pending' && (
                      <button
                        onClick={() => handleRemoveFile(fileUpload.id)}
                        className="text-gray-400 hover:text-red-600 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {(fileUpload.status === 'uploading' || fileUpload.status === 'parsing') && (
                    <ParseProgressDisplay
                      uploadProgress={fileUpload.progress}
                      parseProgress={fileUpload.parseProgress}
                      isUploading={fileUpload.status === 'uploading'}
                      isParsing={fileUpload.status === 'parsing'}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={isUploading}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleUploadAll}
            disabled={files.length === 0 || isUploading}
            className="flex-1 px-4 py-2 bg-[#2E86C1] text-white rounded-lg hover:bg-[#1B4F72] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              'Upload All'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
