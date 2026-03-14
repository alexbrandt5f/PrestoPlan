import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface ParseRequest {
  schedule_version_id: string;
  file_path: string;
  company_id: string;
}

interface XERTable {
  name: string;
  fields: string[];
  rows: string[][];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  console.log('[Parse XER] Received parse request');

  let requestBody: ParseRequest | null = null;

  try {
    requestBody = await req.json();
    const { schedule_version_id, file_path, company_id } = requestBody;

    console.log('[Parse XER] Request details:', {
      schedule_version_id,
      file_path,
      company_id,
    });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Parse XER] Updating parse status to "parsing"...');
    const { error: updateError } = await supabase
      .from('schedule_versions')
      .update({ parse_status: 'parsing' })
      .eq('id', schedule_version_id);

    if (updateError) {
      console.error('[Parse XER] Failed to update status to parsing:', updateError);
      throw updateError;
    }

    console.log('[Parse XER] Downloading file from storage bucket "schedule-files"...');
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('schedule-files')
      .download(file_path);

    if (downloadError) {
      console.error('[Parse XER] Failed to download file:', downloadError);
      throw new Error(`Failed to download file from storage: ${downloadError.message}`);
    }

    if (!fileData) {
      console.error('[Parse XER] File data is null');
      throw new Error('Failed to download file from storage: No data returned');
    }

    console.log('[Parse XER] File downloaded successfully, size:', fileData.size);

    console.log('[Parse XER] Reading file content...');
    const fileContent = await fileData.text();
    console.log('[Parse XER] File content length:', fileContent.length, 'characters');

    console.log('[Parse XER] Parsing XER format...');
    const tables = parseXER(fileContent);

    if (!tables || tables.length === 0) {
      console.error('[Parse XER] No tables found in XER file');
      throw new Error('Invalid XER file format: No tables found');
    }

    console.log('[Parse XER] Parsed', tables.length, 'tables:', tables.map(t => t.name).join(', '));

    console.log('[Parse XER] Processing XER tables into database...');
    await processXERTables(supabase, tables, schedule_version_id, company_id);

    console.log('[Parse XER] Updating parse status to "complete"...');
    await supabase
      .from('schedule_versions')
      .update({ parse_status: 'complete' })
      .eq('id', schedule_version_id);

    console.log('[Parse XER] Parse completed successfully');

    return new Response(
      JSON.stringify({ success: true, message: 'XER file parsed successfully' }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('[Parse XER] Parse error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (requestBody) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        console.log('[Parse XER] Updating parse status to "error"...');
        await supabase
          .from('schedule_versions')
          .update({
            parse_status: 'error',
            parse_error_details: errorMessage,
          })
          .eq('id', requestBody.schedule_version_id);
      } catch (updateError) {
        console.error('[Parse XER] Failed to update error status:', updateError);
      }
    }

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

function parseXER(content: string): XERTable[] {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line);
  const tables: XERTable[] = [];
  let currentTable: XERTable | null = null;

  for (const line of lines) {
    if (line.startsWith('%T\t')) {
      if (currentTable) {
        tables.push(currentTable);
      }
      const tableName = line.split('\t')[1];
      currentTable = { name: tableName, fields: [], rows: [] };
    } else if (line.startsWith('%F\t') && currentTable) {
      currentTable.fields = line.split('\t').slice(1);
    } else if (line.startsWith('%R\t') && currentTable) {
      currentTable.rows.push(line.split('\t').slice(1));
    }
  }

  if (currentTable) {
    tables.push(currentTable);
  }

  return tables;
}

async function processXERTables(
  supabase: any,
  tables: XERTable[],
  versionId: string,
  companyId: string
) {
  const tableMap = new Map<string, XERTable>();
  tables.forEach(table => tableMap.set(table.name, table));

  let p6Version = '';
  let dataDate: string | null = null;

  const ermhdrTable = tables.find(t => t.name === 'ERMHDR');
  if (ermhdrTable && ermhdrTable.rows.length > 0) {
    const versionIndex = ermhdrTable.fields.indexOf('version');
    if (versionIndex >= 0) {
      p6Version = ermhdrTable.rows[0][versionIndex] || '';
    }
  }

  const projectTable = tableMap.get('PROJECT');
  if (projectTable) {
    await processPROJECT(supabase, projectTable, versionId, companyId);
    const dataDateField = projectTable.fields.findIndex(f =>
      f.toLowerCase().includes('last_recalc_date') || f.toLowerCase().includes('data_date')
    );
    if (dataDateField >= 0 && projectTable.rows.length > 0) {
      dataDate = projectTable.rows[0][dataDateField] || null;
    }
  }

  if (p6Version || dataDate) {
    await supabase
      .from('schedule_versions')
      .update({
        source_tool_version: p6Version || null,
        data_date: dataDate,
      })
      .eq('id', versionId);
  }

  const calendarTable = tableMap.get('CALENDAR');
  const calendarIdMap = new Map<string, string>();
  if (calendarTable) {
    const newIds = await processCALENDAR(supabase, calendarTable, versionId, companyId);
    newIds.forEach((newId, oldId) => calendarIdMap.set(oldId, newId));
  }

  const wbsTable = tableMap.get('PROJWBS');
  const wbsIdMap = new Map<string, string>();
  if (wbsTable) {
    const newIds = await processPROJWBS(supabase, wbsTable, versionId, companyId);
    newIds.forEach((newId, oldId) => wbsIdMap.set(oldId, newId));
  }

  const taskTable = tableMap.get('TASK');
  const activityIdMap = new Map<string, string>();
  if (taskTable) {
    const newIds = await processTASK(
      supabase,
      taskTable,
      versionId,
      companyId,
      wbsIdMap,
      calendarIdMap
    );
    newIds.forEach((newId, oldId) => activityIdMap.set(oldId, newId));
  }

  const taskPredTable = tableMap.get('TASKPRED');
  if (taskPredTable) {
    await processTASKPRED(supabase, taskPredTable, versionId, companyId, activityIdMap);
  }

  const actvTypeTable = tableMap.get('ACTVTYPE');
  const codeTypeIdMap = new Map<string, string>();
  if (actvTypeTable) {
    const newIds = await processACTVTYPE(supabase, actvTypeTable, versionId, companyId);
    newIds.forEach((newId, oldId) => codeTypeIdMap.set(oldId, newId));
  }

  const actvCodeTable = tableMap.get('ACTVCODE');
  const codeValueIdMap = new Map<string, string>();
  if (actvCodeTable) {
    const newIds = await processACTVCODE(supabase, actvCodeTable, versionId, companyId, codeTypeIdMap);
    newIds.forEach((newId, oldId) => codeValueIdMap.set(oldId, newId));
  }

  const taskActvTable = tableMap.get('TASKACTV');
  if (taskActvTable) {
    await processTASKACTV(supabase, taskActvTable, versionId, companyId, activityIdMap, codeValueIdMap);
  }

  const rsrcTable = tableMap.get('RSRC');
  const resourceIdMap = new Map<string, string>();
  if (rsrcTable) {
    const newIds = await processRSRC(supabase, rsrcTable, versionId, companyId);
    newIds.forEach((newId, oldId) => resourceIdMap.set(oldId, newId));
  }

  const taskRsrcTable = tableMap.get('TASKRSRC');
  if (taskRsrcTable) {
    await processTASKRSRC(supabase, taskRsrcTable, versionId, companyId, activityIdMap, resourceIdMap);
  }

  const udfTypeTable = tableMap.get('UDFTYPE');
  const fieldTypeIdMap = new Map<string, string>();
  if (udfTypeTable) {
    const newIds = await processUDFTYPE(supabase, udfTypeTable, versionId, companyId);
    newIds.forEach((newId, oldId) => fieldTypeIdMap.set(oldId, newId));
  }

  const udfValueTable = tableMap.get('UDFVALUE');
  if (udfValueTable) {
    await processUDFVALUE(supabase, udfValueTable, versionId, companyId, activityIdMap, fieldTypeIdMap);
  }

  const memoTypeTable = tableMap.get('MEMOTYPE');
  const topicIdMap = new Map<string, string>();
  if (memoTypeTable) {
    const newIds = await processMEMOTYPE(supabase, memoTypeTable, versionId, companyId);
    newIds.forEach((newId, oldId) => topicIdMap.set(oldId, newId));
  }

  const taskMemoTable = tableMap.get('TASKMEMO');
  if (taskMemoTable) {
    await processTASKMEMO(supabase, taskMemoTable, versionId, companyId, activityIdMap, topicIdMap);
  }

  for (const table of tables) {
    const knownTables = [
      'ERMHDR', 'PROJECT', 'PROJWBS', 'TASK', 'TASKPRED', 'CALENDAR',
      'ACTVTYPE', 'ACTVCODE', 'TASKACTV', 'RSRC', 'TASKRSRC',
      'UDFTYPE', 'UDFVALUE', 'MEMOTYPE', 'TASKMEMO'
    ];

    if (!knownTables.includes(table.name)) {
      await processRawTable(supabase, table, versionId, companyId);
    }
  }
}

async function processPROJECT(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string
) {
  const records = table.rows.map(row => {
    const record: any = {
      schedule_version_id: versionId,
      company_id: companyId,
      original_data: {},
    };

    table.fields.forEach((field, index) => {
      const value = row[index];
      record.original_data[field] = value;

      if (field === 'proj_short_name' || field === 'proj_name') {
        record.project_name = value;
      } else if (field === 'last_recalc_date' || field === 'data_date') {
        record.data_date = value || null;
      } else if (field === 'plan_end_date' || field === 'must_fin_by_date') {
        record.must_finish_date = value || null;
      } else if (field === 'plan_start_date') {
        record.planned_start = value || null;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_projects', records);
}

async function processCALENDAR(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  const records = table.rows.map(row => {
    const newId = crypto.randomUUID();
    const record: any = {
      id: newId,
      schedule_version_id: versionId,
      company_id: companyId,
      hours_per_day: 8.0,
    };

    table.fields.forEach((field, index) => {
      const value = row[index];

      if (field === 'clndr_id') {
        record.original_calendar_id = value;
        idMap.set(value, newId);
      } else if (field === 'clndr_name') {
        record.calendar_name = value;
      } else if (field === 'clndr_type') {
        record.calendar_type = value;
      } else if (field === 'day_hr_cnt') {
        record.hours_per_day = parseFloat(value) || 8.0;
      } else if (field === 'clndr_data') {
        record.raw_calendar_data = value;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_calendars', records);
  return idMap;
}

async function processPROJWBS(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  const records = table.rows.map(row => {
    const newId = crypto.randomUUID();
    const record: any = {
      id: newId,
      schedule_version_id: versionId,
      company_id: companyId,
      sort_order: 0,
      level: 0,
    };

    table.fields.forEach((field, index) => {
      const value = row[index];

      if (field === 'wbs_id') {
        record.original_wbs_id = value;
        idMap.set(value, newId);
      } else if (field === 'wbs_short_name' || field === 'wbs_name') {
        record.wbs_name = value;
      } else if (field === 'seq_num') {
        record.sort_order = parseInt(value) || 0;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_wbs', records);

  for (const row of table.rows) {
    const wbsIdIndex = table.fields.indexOf('wbs_id');
    const parentIdIndex = table.fields.indexOf('parent_wbs_id');

    if (wbsIdIndex >= 0 && parentIdIndex >= 0) {
      const wbsId = row[wbsIdIndex];
      const parentId = row[parentIdIndex];

      if (parentId && idMap.has(parentId) && idMap.has(wbsId)) {
        await supabase
          .from('cpm_wbs')
          .update({ parent_wbs_id: idMap.get(parentId) })
          .eq('id', idMap.get(wbsId));
      }
    }
  }

  return idMap;
}

async function processTASK(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  wbsIdMap: Map<string, string>,
  calendarIdMap: Map<string, string>
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

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
        idMap.set(value, newId);
      } else if (field === 'task_code') {
        record.activity_id_display = value;
      } else if (field === 'task_name') {
        record.activity_name = value;
      } else if (field === 'wbs_id' && value) {
        record.wbs_id = wbsIdMap.get(value) || null;
      } else if (field === 'task_type') {
        record.activity_type = mapTaskType(value);
      } else if (field === 'status_code') {
        record.activity_status = mapStatusCode(value);
      } else if (field === 'crit_drv_flag' || field === 'driving_path_flag') {
        record.is_critical = value === 'Y' || value === '1';
      } else if (field === 'clndr_id' && value) {
        record.calendar_id = calendarIdMap.get(value) || null;
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

  await batchInsert(supabase, 'cpm_activities', records);
  return idMap;
}

async function processTASKPRED(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  activityIdMap: Map<string, string>
) {
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
        record.successor_activity_id = activityIdMap.get(value) || null;
      } else if (field === 'pred_task_id' && value) {
        record.predecessor_activity_id = activityIdMap.get(value) || null;
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

  await batchInsert(supabase, 'cpm_relationships', records);

  const { data: activities } = await supabase
    .from('cpm_activities')
    .select('id')
    .eq('schedule_version_id', versionId);

  if (activities) {
    for (const activity of activities) {
      const { data: relationships } = await supabase
        .from('cpm_relationships')
        .select('id, relationship_float_hours')
        .eq('successor_activity_id', activity.id)
        .not('relationship_float_hours', 'is', null)
        .order('relationship_float_hours', { ascending: true });

      if (relationships && relationships.length > 0) {
        const drivingRel = relationships[0];
        if (drivingRel.relationship_float_hours !== null && drivingRel.relationship_float_hours >= 0) {
          await supabase
            .from('cpm_relationships')
            .update({ is_driving: true })
            .eq('id', drivingRel.id);

          await supabase
            .from('cpm_relationships')
            .update({ is_driving: false })
            .eq('successor_activity_id', activity.id)
            .neq('id', drivingRel.id);
        }
      }
    }
  }
}

async function processACTVTYPE(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  const records = table.rows.map(row => {
    const newId = crypto.randomUUID();
    const record: any = {
      id: newId,
      schedule_version_id: versionId,
      company_id: companyId,
    };

    table.fields.forEach((field, index) => {
      const value = row[index];

      if (field === 'actv_code_type_id') {
        record.original_code_type_id = value;
        idMap.set(value, newId);
      } else if (field === 'actv_code_type') {
        record.code_type_name = value;
      } else if (field === 'actv_code_type_scope' || field === 'scope') {
        record.code_type_scope = value;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_code_types', records);
  return idMap;
}

async function processACTVCODE(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  codeTypeIdMap: Map<string, string>
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  const records = table.rows.map(row => {
    const newId = crypto.randomUUID();
    const record: any = {
      id: newId,
      schedule_version_id: versionId,
      company_id: companyId,
      sort_order: 0,
    };

    table.fields.forEach((field, index) => {
      const value = row[index];

      if (field === 'actv_code_id') {
        record.original_code_value_id = value;
        idMap.set(value, newId);
      } else if (field === 'actv_code_type_id' && value) {
        record.code_type_id = codeTypeIdMap.get(value) || null;
      } else if (field === 'actv_code_name' || field === 'short_name') {
        record.code_value_name = value;
      } else if (field === 'actv_code_desc') {
        record.code_value_description = value;
      } else if (field === 'seq_num') {
        record.sort_order = parseInt(value) || 0;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_code_values', records);
  return idMap;
}

async function processTASKACTV(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  activityIdMap: Map<string, string>,
  codeValueIdMap: Map<string, string>
) {
  const records = table.rows.map(row => {
    const record: any = {
      schedule_version_id: versionId,
      company_id: companyId,
    };

    table.fields.forEach((field, index) => {
      const value = row[index];

      if (field === 'task_id' && value) {
        record.activity_id = activityIdMap.get(value) || null;
      } else if (field === 'actv_code_id' && value) {
        record.code_value_id = codeValueIdMap.get(value) || null;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_code_assignments', records);
}

async function processRSRC(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  const records = table.rows.map(row => {
    const newId = crypto.randomUUID();
    const record: any = {
      id: newId,
      schedule_version_id: versionId,
      company_id: companyId,
      original_data: {},
    };

    table.fields.forEach((field, index) => {
      const value = row[index];
      record.original_data[field] = value;

      if (field === 'rsrc_id') {
        record.original_resource_id = value;
        idMap.set(value, newId);
      } else if (field === 'rsrc_name') {
        record.resource_name = value;
      } else if (field === 'rsrc_short_name') {
        record.resource_short_name = value;
      } else if (field === 'rsrc_type') {
        record.resource_type = value;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_resources', records);
  return idMap;
}

async function processTASKRSRC(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  activityIdMap: Map<string, string>,
  resourceIdMap: Map<string, string>
) {
  const records = table.rows.map(row => {
    const record: any = {
      schedule_version_id: versionId,
      company_id: companyId,
      original_data: {},
    };

    table.fields.forEach((field, index) => {
      const value = row[index];
      record.original_data[field] = value;

      if (field === 'task_id' && value) {
        record.activity_id = activityIdMap.get(value) || null;
      } else if (field === 'rsrc_id' && value) {
        record.resource_id = resourceIdMap.get(value) || null;
      } else if (field === 'target_qty') {
        record.budgeted_units = parseFloat(value) || null;
      } else if (field === 'target_cost') {
        record.budgeted_cost = parseFloat(value) || null;
      } else if (field === 'act_reg_qty' || field === 'act_ot_qty') {
        const current = record.actual_units || 0;
        record.actual_units = current + (parseFloat(value) || 0);
      } else if (field === 'act_reg_cost' || field === 'act_ot_cost') {
        const current = record.actual_cost || 0;
        record.actual_cost = current + (parseFloat(value) || 0);
      } else if (field === 'remain_qty') {
        record.remaining_units = parseFloat(value) || null;
      } else if (field === 'remain_cost') {
        record.remaining_cost = parseFloat(value) || null;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_resource_assignments', records);
}

async function processUDFTYPE(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  const records = table.rows.map(row => {
    const newId = crypto.randomUUID();
    const record: any = {
      id: newId,
      schedule_version_id: versionId,
      company_id: companyId,
    };

    table.fields.forEach((field, index) => {
      const value = row[index];

      if (field === 'udf_type_id') {
        record.original_field_type_id = value;
        idMap.set(value, newId);
      } else if (field === 'udf_type_name' || field === 'udf_type_label') {
        record.field_name = value;
      } else if (field === 'logical_data_type') {
        record.field_data_type = value;
      } else if (field === 'table_name') {
        record.field_scope = value;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_custom_field_types', records);
  return idMap;
}

async function processUDFVALUE(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  activityIdMap: Map<string, string>,
  fieldTypeIdMap: Map<string, string>
) {
  const records = table.rows.map(row => {
    const record: any = {
      schedule_version_id: versionId,
      company_id: companyId,
    };

    table.fields.forEach((field, index) => {
      const value = row[index];

      if (field === 'fk_id' && value) {
        record.activity_id = activityIdMap.get(value) || null;
      } else if (field === 'udf_type_id' && value) {
        record.field_type_id = fieldTypeIdMap.get(value) || null;
      } else if (field === 'udf_text' || field === 'udf_code_id') {
        record.field_value = value;
      } else if (field === 'udf_number') {
        record.field_value_numeric = parseFloat(value) || null;
      } else if (field === 'udf_date') {
        record.field_value_date = value || null;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_custom_field_values', records);
}

async function processMEMOTYPE(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  const records = table.rows.map(row => {
    const newId = crypto.randomUUID();
    const record: any = {
      id: newId,
      schedule_version_id: versionId,
      company_id: companyId,
    };

    table.fields.forEach((field, index) => {
      const value = row[index];

      if (field === 'memo_type_id') {
        record.original_topic_id = value;
        idMap.set(value, newId);
      } else if (field === 'memo_type') {
        record.topic_name = value;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_note_topics', records);
  return idMap;
}

async function processTASKMEMO(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  activityIdMap: Map<string, string>,
  topicIdMap: Map<string, string>
) {
  const records = table.rows.map(row => {
    const record: any = {
      schedule_version_id: versionId,
      company_id: companyId,
    };

    table.fields.forEach((field, index) => {
      const value = row[index];

      if (field === 'task_id' && value) {
        record.activity_id = activityIdMap.get(value) || null;
      } else if (field === 'memo_type_id' && value) {
        record.topic_id = topicIdMap.get(value) || null;
      } else if (field === 'task_memo') {
        record.note_content = value;
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_activity_notes', records);
}

async function processRawTable(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string
) {
  const record = {
    schedule_version_id: versionId,
    company_id: companyId,
    table_name: table.name,
    field_names: table.fields,
    records: table.rows.map(row => {
      const obj: any = {};
      table.fields.forEach((field, index) => {
        obj[field] = row[index];
      });
      return obj;
    }),
  };

  await supabase.from('cpm_raw_tables').insert(record);
}

async function batchInsert(supabase: any, tableName: string, records: any[]) {
  const batchSize = 500;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await supabase.from(tableName).insert(batch);

    if (error) {
      console.error(`Error inserting batch into ${tableName}:`, error);
      throw error;
    }
  }
}

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
