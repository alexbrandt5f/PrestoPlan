import { X } from 'lucide-react';

interface ColorLegendProps {
  codeColors: Map<string, string>;
  codeTypeName: string;
  onClose: () => void;
}

export default function ColorLegend({ codeColors, codeTypeName, onClose }: ColorLegendProps) {
  const entries = Array.from(codeColors.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) return null;

  return (
    <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg border border-gray-200 p-4 max-w-xs z-20">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">{codeTypeName}</h3>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {entries.map(([value, color]) => (
          <div key={value} className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded border border-gray-300 flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs text-gray-700 truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
