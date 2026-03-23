/**
 * taskTransform.worker.ts
 *
 * Web Worker that transforms raw XER (Extended Exchange Resource) TASK table
 * rows into cpm_activities records ready for Supabase insert.
 *
 * Runs off the main thread to avoid blocking the UI during large schedule
 * imports (tested with 9,346+ activities).
 *
 * IMPORTANT: Web Workers cannot access the Supabase client or browser APIs.
 * They transform data and post it back to the main thread, which handles
 * the actual database inserts.
 *
 * Message protocol:
 *   Main → Worker:  { type: 'transform_tasks', table, versionId, companyId, wbsIdMap, calendarIdMap }
 *   Worker → Main:  { type: 'transform_result', records: any[], idMap: Record<string, string> }
 */

import { mapTaskType, mapStatusCode } from '../lib/activityUtils';

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
  /** Maps original P6 wbs_id → new UUID */
  wbsIdMap: Record<string, string>;
  /** Maps original P6 clndr_id → new UUID */
  calendarIdMap: Record<string, string>;
}

interface TransformResultMessage {
  type: 'transform_result';
  records: any[];
  /** Maps original P6 task_id → new UUID */
  idMap: Record<string, string>;
}

self.onmessage = (e: MessageEvent<TransformMessage>) => {
  if (e.data.type !== 'transform_tasks') return;

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

      switch (field) {
        case 'task_id':
          record.original_activity_id = value;
          idMap[value] = newId;
          break;
        case 'task_code':
          record.activity_id_display = value;
          break;
        case 'task_name':
          record.activity_name = value;
          break;
        case 'wbs_id':
          if (value) record.wbs_id = wbsIdMap[value] || null;
          break;
        case 'task_type':
          record.activity_type = mapTaskType(value);
          break;
        case 'status_code':
          record.activity_status = mapStatusCode(value);
          break;
        case 'crit_drv_flag':
        case 'driving_path_flag':
          record.is_critical = value === 'Y' || value === '1';
          break;
        case 'clndr_id':
          if (value) record.calendar_id = calendarIdMap[value] || null;
          break;
        case 'target_drtn_hr_cnt':
          record.original_duration_hours = parseFloat(value) || null;
          break;
        case 'remain_drtn_hr_cnt':
          record.remaining_duration_hours = parseFloat(value) || null;
          break;
        case 'act_work_qty':
        case 'act_drtn_hr_cnt':
          record.actual_duration_hours = parseFloat(value) || null;
          break;
        case 'early_start_date':
          record.early_start = value || null;
          break;
        case 'early_end_date':
          record.early_finish = value || null;
          break;
        case 'late_start_date':
          record.late_start = value || null;
          break;
        case 'late_end_date':
          record.late_finish = value || null;
          break;
        case 'act_start_date':
          record.actual_start = value || null;
          break;
        case 'act_end_date':
          record.actual_finish = value || null;
          break;
        case 'total_float_hr_cnt':
          record.total_float_hours = parseFloat(value) || null;
          break;
        case 'free_float_hr_cnt':
          record.free_float_hours = parseFloat(value) || null;
          break;
        case 'phys_complete_pct':
          record.physical_percent_complete = parseFloat(value) || null;
          break;
        case 'complete_pct':
          record.duration_percent_complete = parseFloat(value) || null;
          break;
        // All other fields are captured in original_data above
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
};
