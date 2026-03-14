import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { FilterCondition, ColumnDefinition } from '../../types/gantt';

interface FilterBuilderProps {
  filters: FilterCondition[];
  columns: ColumnDefinition[];
  onUpdate: (filters: FilterCondition[]) => void;
  onClose: () => void;
}

const OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'greaterThan', label: 'Greater Than' },
  { value: 'lessThan', label: 'Less Than' },
  { value: 'between', label: 'Between' },
  { value: 'isBlank', label: 'Is Blank' },
  { value: 'isNotBlank', label: 'Is Not Blank' },
];

export default function FilterBuilder({ filters, columns, onUpdate, onClose }: FilterBuilderProps) {
  const [localFilters, setLocalFilters] = useState<FilterCondition[]>(
    filters.length > 0 ? filters : [createNewFilter()]
  );

  function createNewFilter(): FilterCondition {
    return {
      id: Math.random().toString(36).substr(2, 9),
      field: columns[0]?.field || '',
      operator: 'equals',
      value: '',
      combinator: 'AND'
    };
  }

  function handleAddFilter() {
    setLocalFilters([...localFilters, createNewFilter()]);
  }

  function handleRemoveFilter(id: string) {
    setLocalFilters(localFilters.filter(f => f.id !== id));
  }

  function handleUpdateFilter(id: string, updates: Partial<FilterCondition>) {
    setLocalFilters(localFilters.map(f => f.id === id ? { ...f, ...updates } : f));
  }

  function handleApply() {
    onUpdate(localFilters.filter(f => f.field && (f.operator === 'isBlank' || f.operator === 'isNotBlank' || f.value)));
    onClose();
  }

  function handleClearAll() {
    setLocalFilters([createNewFilter()]);
    onUpdate([]);
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Filter Activities</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-3">
            {localFilters.map((filter, index) => (
              <div key={filter.id} className="border border-gray-200 rounded-lg p-4">
                {index > 0 && (
                  <div className="flex items-center gap-2 mb-3">
                    <select
                      value={filter.combinator}
                      onChange={(e) => handleUpdateFilter(filter.id, { combinator: e.target.value as 'AND' | 'OR' })}
                      className="px-2 py-1 text-sm font-medium border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="AND">AND</option>
                      <option value="OR">OR</option>
                    </select>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <select
                    value={filter.field}
                    onChange={(e) => handleUpdateFilter(filter.id, { field: e.target.value })}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {columns.filter(c => c.visible).map(col => (
                      <option key={col.id} value={col.field}>{col.label}</option>
                    ))}
                  </select>

                  <select
                    value={filter.operator}
                    onChange={(e) => handleUpdateFilter(filter.id, { operator: e.target.value as any })}
                    className="px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {OPERATORS.map(op => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>

                  {filter.operator !== 'isBlank' && filter.operator !== 'isNotBlank' && (
                    <>
                      <input
                        type="text"
                        value={filter.value}
                        onChange={(e) => handleUpdateFilter(filter.id, { value: e.target.value })}
                        placeholder="Value"
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />

                      {filter.operator === 'between' && (
                        <input
                          type="text"
                          value={filter.value2 || ''}
                          onChange={(e) => handleUpdateFilter(filter.id, { value2: e.target.value })}
                          placeholder="Value 2"
                          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      )}
                    </>
                  )}

                  <button
                    onClick={() => handleRemoveFilter(filter.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleAddFilter}
            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded"
          >
            <Plus className="w-4 h-4" />
            Add Condition
          </button>
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
          <button
            onClick={handleClearAll}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded"
          >
            Clear All Filters
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
