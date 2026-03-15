export interface ColumnDefinition {
  id: string;
  label: string;
  field: string;
  width: number;
  visible: boolean;
  dataType: 'string' | 'number' | 'date' | 'boolean' | 'duration';
  source: 'activity' | 'code' | 'custom';
  sourceId?: string;
}

export interface SortConfig {
  field: string;
  direction: 'asc' | 'desc';
}

export interface FilterCondition {
  id: string;
  field: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan' | 'between' | 'isBlank' | 'isNotBlank';
  value: any;
  value2?: any;
  combinator: 'AND' | 'OR';
}

export interface GroupConfig {
  type: 'none' | 'wbs' | 'code';
  codeTypeId?: string;
  showSummaryBars: boolean;
}

export interface ViewSettings {
  showFloat: boolean;
  showRelationships: 'none' | 'all' | 'selected';
  showDrivingOnly: boolean;
  timescale: 'year-month' | 'year-month-week' | 'month-week-day' | 'quarter-month';
  colorByCodeTypeId?: string;
  zoom: number;
}

export interface GanttLayoutState {
  columns: ColumnDefinition[];
  sorts: SortConfig[];
  filters: FilterCondition[];
  grouping: GroupConfig;
  viewSettings: ViewSettings;
}
