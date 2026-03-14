import { useState, useEffect } from 'react';
import { X, GripVertical, Check } from 'lucide-react';
import { ColumnDefinition } from '../../types/gantt';
import { supabase } from '../../lib/supabase';

interface ColumnPickerProps {
  columns: ColumnDefinition[];
  scheduleVersionId: string;
  onUpdate: (columns: ColumnDefinition[]) => void;
  onClose: () => void;
}

interface AvailableField {
  id: string;
  label: string;
  field: string;
  dataType: 'string' | 'number' | 'date' | 'boolean';
  source: 'activity' | 'code' | 'custom';
  sourceId?: string;
}

const ACTIVITY_FIELDS: AvailableField[] = [
  { id: 'activity_id_display', label: 'Activity ID', field: 'activity_id_display', dataType: 'string', source: 'activity' },
  { id: 'activity_name', label: 'Activity Name', field: 'activity_name', dataType: 'string', source: 'activity' },
  { id: 'activity_type', label: 'Activity Type', field: 'activity_type', dataType: 'string', source: 'activity' },
  { id: 'activity_status', label: 'Status', field: 'activity_status', dataType: 'string', source: 'activity' },
  { id: 'original_duration_hours', label: 'Original Duration', field: 'original_duration_hours', dataType: 'number', source: 'activity' },
  { id: 'remaining_duration_hours', label: 'Remaining Duration', field: 'remaining_duration_hours', dataType: 'number', source: 'activity' },
  { id: 'actual_duration_hours', label: 'Actual Duration', field: 'actual_duration_hours', dataType: 'number', source: 'activity' },
  { id: 'early_start', label: 'Early Start', field: 'early_start', dataType: 'date', source: 'activity' },
  { id: 'early_finish', label: 'Early Finish', field: 'early_finish', dataType: 'date', source: 'activity' },
  { id: 'late_start', label: 'Late Start', field: 'late_start', dataType: 'date', source: 'activity' },
  { id: 'late_finish', label: 'Late Finish', field: 'late_finish', dataType: 'date', source: 'activity' },
  { id: 'actual_start', label: 'Actual Start', field: 'actual_start', dataType: 'date', source: 'activity' },
  { id: 'actual_finish', label: 'Actual Finish', field: 'actual_finish', dataType: 'date', source: 'activity' },
  { id: 'total_float_hours', label: 'Total Float', field: 'total_float_hours', dataType: 'number', source: 'activity' },
  { id: 'free_float_hours', label: 'Free Float', field: 'free_float_hours', dataType: 'number', source: 'activity' },
  { id: 'physical_percent_complete', label: 'Physical % Complete', field: 'physical_percent_complete', dataType: 'number', source: 'activity' },
  { id: 'duration_percent_complete', label: 'Duration % Complete', field: 'duration_percent_complete', dataType: 'number', source: 'activity' },
  { id: 'is_critical', label: 'Critical', field: 'is_critical', dataType: 'boolean', source: 'activity' },
];

export default function ColumnPicker({ columns, scheduleVersionId, onUpdate, onClose }: ColumnPickerProps) {
  const [localColumns, setLocalColumns] = useState<ColumnDefinition[]>(columns);
  const [availableFields, setAvailableFields] = useState<AvailableField[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    loadAvailableFields();
  }, [scheduleVersionId]);

  async function loadAvailableFields() {
    const fields: AvailableField[] = [...ACTIVITY_FIELDS];

    const [codeTypesRes, customFieldsRes] = await Promise.all([
      supabase
        .from('cpm_code_types')
        .select('id, code_type_name, original_code_type_id')
        .eq('schedule_version_id', scheduleVersionId),
      supabase
        .from('cpm_custom_field_types')
        .select('id, field_name, field_data_type, original_field_type_id')
        .eq('schedule_version_id', scheduleVersionId)
    ]);

    if (codeTypesRes.data) {
      codeTypesRes.data.forEach(codeType => {
        fields.push({
          id: `code_${codeType.id}`,
          label: codeType.code_type_name,
          field: `code_${codeType.id}`,
          dataType: 'string',
          source: 'code',
          sourceId: codeType.id
        });
      });
    }

    if (customFieldsRes.data) {
      customFieldsRes.data.forEach(customField => {
        fields.push({
          id: `custom_${customField.id}`,
          label: customField.field_name,
          field: `custom_${customField.id}`,
          dataType: customField.field_data_type === 'number' ? 'number' : customField.field_data_type === 'date' ? 'date' : 'string',
          source: 'custom',
          sourceId: customField.id
        });
      });
    }

    setAvailableFields(fields);

    const newColumns = [...localColumns];
    let modified = false;

    fields.forEach(field => {
      if (!newColumns.find(col => col.id === field.id)) {
        newColumns.push({
          ...field,
          width: 100,
          visible: false
        });
        modified = true;
      }
    });

    if (modified) {
      setLocalColumns(newColumns);
    }
  }

  function handleToggleVisible(id: string) {
    const updated = localColumns.map(col =>
      col.id === id ? { ...col, visible: !col.visible } : col
    );
    setLocalColumns(updated);
    onUpdate(updated);
  }

  function handleUpdateLabel(id: string, label: string) {
    const updated = localColumns.map(col =>
      col.id === id ? { ...col, label } : col
    );
    setLocalColumns(updated);
    onUpdate(updated);
  }

  function handleUpdateWidth(id: string, width: number) {
    const updated = localColumns.map(col =>
      col.id === id ? { ...col, width: Math.max(60, width) } : col
    );
    setLocalColumns(updated);
    onUpdate(updated);
  }

  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const updated = [...localColumns];
    const [draggedItem] = updated.splice(draggedIndex, 1);
    updated.splice(index, 0, draggedItem);
    setLocalColumns(updated);
    setDraggedIndex(index);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
    onUpdate(localColumns);
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Columns</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-2">
            {localColumns.map((column, index) => (
              <div
                key={column.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-3 p-3 bg-gray-50 rounded border ${
                  draggedIndex === index ? 'opacity-50' : ''
                }`}
              >
                <button className="cursor-move text-gray-400 hover:text-gray-600">
                  <GripVertical className="w-5 h-5" />
                </button>

                <button
                  onClick={() => handleToggleVisible(column.id)}
                  className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${
                    column.visible
                      ? 'bg-blue-600 border-blue-600'
                      : 'bg-white border-gray-300'
                  }`}
                >
                  {column.visible && <Check className="w-3 h-3 text-white" />}
                </button>

                <input
                  type="text"
                  value={column.label}
                  onChange={(e) => handleUpdateLabel(column.id, e.target.value)}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={column.width}
                    onChange={(e) => handleUpdateWidth(column.id, parseInt(e.target.value) || 60)}
                    min={60}
                    className="w-20 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-500">px</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
