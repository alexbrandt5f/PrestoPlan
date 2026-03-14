interface XERTable {
  name: string;
  fields: string[];
  rows: string[][];
}

interface TransformMessage {
  type: 'transform_tasks';
  table: XERTable;
  versionId: string;
  companyId: string;
  wbsIdMap: Record<string, string>;
  calendarIdMap: Record<string, string>;
}

interface TransformResultMessage {
  type: 'transform_result';
  records: any[];
  idMap: Record<string, string>;
}

self.onmessage = (e: MessageEvent<TransformMessage>) => {
  if (e.data.type === 'transform_tasks') {
    const { table, versionId, companyId, wbsIdMap, calendarIdMap } = e.data;
    const idMap: Record<string, string> = {};

    const records = table.rows.map(row => {
      const newId = crypto.randomUUID();
      const record: any = {
        id: newId,
        schedule_version_id: versionId,
        company_id: companyId,
        is_critical: false,
        original_data: {},
      };

      table.fields.forEach((field, index) => {
        const value = row[index];
        record.original_data[field] = value;

        if (field === 'task_id') {
          record.original_activity_id = value;
          idMap[value] = newId;
        } else if (field === 'task_code') {
          record.activity_id_display = value;
        } else if (field === 'task_name') {
          record.activity_name = value;
        } else if (field === 'wbs_id' && value) {
          record.wbs_id = wbsIdMap[value] || null;
        } else if (field === 'task_type') {
          record.activity_type = mapTaskType(value);
        } else if (field === 'status_code') {
          record.activity_status = mapStatusCode(value);
        } else if (field === 'crit_drv_flag' || field === 'driving_path_flag') {
          record.is_critical = value === 'Y' || value === '1';
        } else if (field === 'clndr_id' && value) {
          record.calendar_id = calendarIdMap[value] || null;
        } else if (field === 'target_drtn_hr_cnt') {
          record.original_duration_hours = parseFloat(value) || null;
        } else if (field === 'remain_drtn_hr_cnt') {
          record.remaining_duration_hours = parseFloat(value) || null;
        } else if (field === 'act_work_qty' || field === 'act_drtn_hr_cnt') {
          record.actual_duration_hours = parseFloat(value) || null;
        } else if (field === 'early_start_date') {
          record.early_start = value || null;
        } else if (field === 'early_end_date') {
          record.early_finish = value || null;
        } else if (field === 'late_start_date') {
          record.late_start = value || null;
        } else if (field === 'late_end_date') {
          record.late_finish = value || null;
        } else if (field === 'act_start_date') {
          record.actual_start = value || null;
        } else if (field === 'act_end_date') {
          record.actual_finish = value || null;
        } else if (field === 'total_float_hr_cnt') {
          record.total_float_hours = parseFloat(value) || null;
        } else if (field === 'free_float_hr_cnt') {
          record.free_float_hours = parseFloat(value) || null;
        } else if (field === 'phys_complete_pct') {
          record.physical_percent_complete = parseFloat(value) || null;
        } else if (field === 'complete_pct') {
          record.duration_percent_complete = parseFloat(value) || null;
        }
      });

      return record;
    });

    const result: TransformResultMessage = {
      type: 'transform_result',
      records,
      idMap,
    };
    self.postMessage(result);
  }
};

function mapTaskType(xerType: string): string {
  const mapping: Record<string, string> = {
    'TT_Task': 'task_dependent',
    'TT_Rsrc': 'resource_dependent',
    'TT_LOE': 'level_of_effort',
    'TT_Mile': 'finish_milestone',
    'TT_FinMile': 'finish_milestone',
    'TT_WBS': 'wbs_summary',
  };
  return mapping[xerType] || 'task_dependent';
}

function mapStatusCode(xerStatus: string): string {
  const mapping: Record<string, string> = {
    'TK_NotStart': 'not_started',
    'TK_Active': 'in_progress',
    'TK_Complete': 'complete',
  };
  return mapping[xerStatus] || 'not_started';
}
