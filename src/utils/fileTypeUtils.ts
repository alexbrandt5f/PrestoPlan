import {
  FileText,
  FileSpreadsheet,
  Presentation,
  Image,
  File,
  type LucideIcon,
} from 'lucide-react';

export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export const SUPPORTED_EXTENSIONS =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp';

export const MAX_FILE_SIZE_BYTES = 10485760;

export function getFileIcon(mimeType: string): LucideIcon {
  if (mimeType === 'application/pdf') {
    return FileText;
  }
  if (
    mimeType === 'application/msword' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return FileText;
  }
  if (
    mimeType === 'application/vnd.ms-excel' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return FileSpreadsheet;
  }
  if (
    mimeType === 'application/vnd.ms-powerpoint' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return Presentation;
  }
  if (isImageType(mimeType)) {
    return Image;
  }
  return File;
}

export function getFileColorClass(mimeType: string): string {
  if (mimeType === 'application/pdf') {
    return 'text-rose-600';
  }
  if (
    mimeType === 'application/msword' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'text-blue-600';
  }
  if (
    mimeType === 'application/vnd.ms-excel' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'text-green-600';
  }
  if (
    mimeType === 'application/vnd.ms-powerpoint' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return 'text-orange-500';
  }
  if (isImageType(mimeType)) {
    return 'text-purple-600';
  }
  return 'text-gray-500';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1048576) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function getSupportedMimeTypes(): string[] {
  return [...SUPPORTED_MIME_TYPES];
}

export function getSupportedExtensions(): string {
  return SUPPORTED_EXTENSIONS;
}

export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function getDocumentTypeBadgeColor(typeName: string): string {
  const hash = typeName.split('').reduce((acc, char) => {
    return acc + char.charCodeAt(0);
  }, 0);

  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-green-100 text-green-700',
    'bg-yellow-100 text-yellow-700',
    'bg-red-100 text-red-700',
    'bg-purple-100 text-purple-700',
    'bg-pink-100 text-pink-700',
    'bg-indigo-100 text-indigo-700',
    'bg-gray-100 text-gray-700',
  ];

  return colors[hash % colors.length];
}
