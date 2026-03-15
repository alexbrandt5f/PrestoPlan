import { CheckCircle } from 'lucide-react';
import { ParseProgress } from '../lib/storage';

interface ParseStageConfig {
  key: string;
  label: string;
  matchPattern: (stage: string) => boolean;
}

interface ParseProgressDisplayProps {
  uploadProgress: number;
  parseProgress?: ParseProgress;
  isUploading: boolean;
  isParsing: boolean;
}

const STAGE_CONFIGS: ParseStageConfig[] = [
  {
    key: 'upload',
    label: 'Uploading file',
    matchPattern: () => false,
  },
  {
    key: 'calendars',
    label: 'Saving calendars',
    matchPattern: (stage) => stage.toLowerCase().includes('calendar'),
  },
  {
    key: 'wbs',
    label: 'Saving WBS structure',
    matchPattern: (stage) => stage.toLowerCase().includes('wbs'),
  },
  {
    key: 'tasks',
    label: 'Saving activities',
    matchPattern: (stage) => stage.toLowerCase().includes('task'),
  },
  {
    key: 'relationships',
    label: 'Saving relationships',
    matchPattern: (stage) => stage.toLowerCase().includes('relationship'),
  },
  {
    key: 'code_types',
    label: 'Saving code types & values',
    matchPattern: (stage) => stage.toLowerCase().includes('code'),
  },
  {
    key: 'resources',
    label: 'Saving resources',
    matchPattern: (stage) => stage.toLowerCase().includes('resource'),
  },
  {
    key: 'custom_fields',
    label: 'Saving custom fields',
    matchPattern: (stage) => stage.toLowerCase().includes('custom') || stage.toLowerCase().includes('udf'),
  },
];

export function ParseProgressDisplay({
  uploadProgress,
  parseProgress,
  isUploading,
  isParsing,
}: ParseProgressDisplayProps) {
  const getStageStatus = (config: ParseStageConfig): 'pending' | 'active' | 'complete' => {
    if (config.key === 'upload') {
      return isUploading ? 'active' : isParsing || parseProgress ? 'complete' : 'pending';
    }

    if (!parseProgress) return 'pending';

    if (config.matchPattern(parseProgress.stage)) {
      return 'active';
    }

    const currentStageIndex = STAGE_CONFIGS.findIndex((s) =>
      s.matchPattern(parseProgress.stage)
    );
    const targetStageIndex = STAGE_CONFIGS.findIndex((s) => s.key === config.key);

    if (currentStageIndex > targetStageIndex) {
      return 'complete';
    }

    return 'pending';
  };

  const getStageProgress = (config: ParseStageConfig): { current?: number; total?: number } => {
    if (config.key === 'upload' || !parseProgress) {
      return {};
    }

    if (config.matchPattern(parseProgress.stage)) {
      return {
        current: parseProgress.current,
        total: parseProgress.total,
      };
    }

    return {};
  };

  return (
    <div className="space-y-3 mt-3">
      {STAGE_CONFIGS.map((config) => {
        const status = getStageStatus(config);
        if (status === 'pending') return null;

        const { current, total } = getStageProgress(config);
        const progressPercent =
          config.key === 'upload'
            ? uploadProgress
            : current && total
            ? Math.round((current / total) * 100)
            : 100;

        return (
          <div key={config.key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">{config.label}</span>
                {status === 'complete' && (
                  <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                )}
              </div>
              {current !== undefined && total !== undefined && (
                <span className="text-gray-500 tabular-nums">
                  {current.toLocaleString()} of {total.toLocaleString()}
                </span>
              )}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  status === 'active'
                    ? 'bg-[#2E86C1] animate-pulse'
                    : 'bg-green-600'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
