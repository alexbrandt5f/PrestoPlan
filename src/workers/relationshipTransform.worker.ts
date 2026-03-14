interface XERTable {
  name: string;
  fields: string[];
  rows: string[][];
}

interface TransformMessage {
  type: 'transform_relationships';
  table: XERTable;
  versionId: string;
  companyId: string;
  activityIdMap: Record<string, string>;
}

interface TransformResultMessage {
  type: 'transform_result';
  records: any[];
}

self.onmessage = (e: MessageEvent<TransformMessage>) => {
  if (e.data.type === 'transform_relationships') {
    const { table, versionId, companyId, activityIdMap } = e.data;

    const records = table.rows.map(row => {
      const record: any = {
        schedule_version_id: versionId,
        company_id: companyId,
        lag_hours: 0,
        original_data: {},
      };

      table.fields.forEach((field, index) => {
        const value = row[index];
        record.original_data[field] = value;

        if (field === 'task_id' && value) {
          record.successor_activity_id = activityIdMap[value] || null;
        } else if (field === 'pred_task_id' && value) {
          record.predecessor_activity_id = activityIdMap[value] || null;
        } else if (field === 'pred_type') {
          record.relationship_type = value.startsWith('PR_') ? value.substring(3) : value;
        } else if (field === 'lag_hr_cnt') {
          record.lag_hours = parseFloat(value) || 0;
        } else if (field === 'aref_date') {
          record.aref = value || null;
        } else if (field === 'arls_date') {
          record.arls = value || null;
        }
      });

      if (record.aref && record.arls) {
        const arefDate = new Date(record.aref);
        const arlsDate = new Date(record.arls);
        const diffMs = arlsDate.getTime() - arefDate.getTime();
        record.relationship_float_hours = diffMs / (1000 * 60 * 60);
      }

      return record;
    });

    const result: TransformResultMessage = {
      type: 'transform_result',
      records,
    };
    self.postMessage(result);
  }
};
