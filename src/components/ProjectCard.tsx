import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, FileText } from 'lucide-react';

interface ProjectCardProps {
  id: string;
  name: string;
  project_code?: string;
  description?: string;
  status: string;
  created_at: string;
  schedule_version_count: number;
}

export function ProjectCard({
  id,
  name,
  project_code,
  description,
  status,
  created_at,
  schedule_version_count,
}: ProjectCardProps) {
  const navigate = useNavigate();

  const truncateDescription = (text: string, lines: number = 2) => {
    const lineHeight = 1.5;
    const maxLength = 120;
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div
      onClick={() => navigate(`/project/${id}`)}
      className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 p-6 flex flex-col h-full"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 truncate mb-1">
            {name}
          </h3>
          {project_code && (
            <p className="text-sm text-gray-500 font-mono">{project_code}</p>
          )}
        </div>
        <span
          className={`ml-3 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
            status === 'active'
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {status === 'active' ? 'Active' : 'Archived'}
        </span>
      </div>

      {description && (
        <p className="text-sm text-gray-600 mb-4 line-clamp-2 flex-1">
          {truncateDescription(description)}
        </p>
      )}

      <div className="flex items-center justify-between text-sm text-gray-500 pt-4 border-t border-gray-100 mt-auto">
        <div className="flex items-center gap-1">
          <FileText className="w-4 h-4" />
          <span>{schedule_version_count} version{schedule_version_count !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-1">
          <Calendar className="w-4 h-4" />
          <span>{formatDate(created_at)}</span>
        </div>
      </div>
    </div>
  );
}
