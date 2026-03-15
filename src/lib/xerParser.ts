interface XERTable {
  name: string;
  fields: string[];
  rows: string[][];
}

export function parseXER(content: string): XERTable[] {
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

async function transformTasksInWorker(
  table: XERTable,
  versionId: string,
  companyId: string,
  wbsIdMap: Map<string, string>,
  calendarIdMap: Map<string, string>
): Promise<{ records: any[], idMap: Map<string, string> }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/taskTransform.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e) => {
      if (e.data.type === 'transform_result') {
        const idMap = new Map<string, string>(Object.entries(e.data.idMap));
        resolve({ records: e.data.records, idMap });
        worker.terminate();
      }
    };

    worker.onerror = (error) => {
      reject(error);
      worker.terminate();
    };

    const wbsIdMapObj = Object.fromEntries(wbsIdMap);
    const calendarIdMapObj = Object.fromEntries(calendarIdMap);

    worker.postMessage({
      type: 'transform_tasks',
      table,
      versionId,
      companyId,
      wbsIdMap: wbsIdMapObj,
      calendarIdMap: calendarIdMapObj,
    });
  });
}

async function transformRelationshipsInWorker(
  table: XERTable,
  versionId: string,
  companyId: string,
  activityIdMap: Map<string, string>
): Promise<{ records: any[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/relationshipTransform.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e) => {
      if (e.data.type === 'transform_result') {
        resolve({ records: e.data.records });
        worker.terminate();
      }
    };

    worker.onerror = (error) => {
      reject(error);
      worker.terminate();
    };

    const activityIdMapObj = Object.fromEntries(activityIdMap);

    worker.postMessage({
      type: 'transform_relationships',
      table,
      versionId,
      companyId,
      activityIdMap: activityIdMapObj,
    });
  });
}

export async function processXERTables(
  supabase: any,
  tables: XERTable[],
  versionId: string,
  companyId: string,
  onProgress?: (message: string) => void
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

  // ============================================================
  // PHASE 1: No dependencies — run PROJECT, CALENDAR, WBS in parallel
  // These tables don't reference each other, so they can all insert simultaneously.
  // ============================================================
  onProgress?.('Phase 1: Saving project, calendars, and WBS structure...');

  const calendarIdMap = new Map<string, string>();
  const wbsIdMap = new Map<string, string>();

  const phase1Promises: Promise<void>[] = [];

  if (projectTable) {
    phase1Promises.push(
      processPROJECT(supabase, projectTable, versionId, companyId)
    );
  }

  const calendarTable = tableMap.get('CALENDAR');
  if (calendarTable) {
    phase1Promises.push(
      (async () => {
        const totalCalendars = calendarTable.rows.length;
        onProgress?.(`Saving calendars (0/${totalCalendars})...`);
        const newIds = await processCALENDAR(supabase, calendarTable, versionId, companyId, (saved: number) => {
          onProgress?.(`Saving calendars (${saved}/${totalCalendars})...`);
        });
        newIds.forEach((newId, oldId) => calendarIdMap.set(oldId, newId));
      })()
    );
  }

  const wbsTable = tableMap.get('PROJWBS');
  if (wbsTable) {
    phase1Promises.push(
      (async () => {
        const totalWBS = wbsTable.rows.length;
        onProgress?.(`Saving WBS structure (0/${totalWBS})...`);
        const newIds = await processPROJWBS(supabase, wbsTable, versionId, companyId, (saved: number) => {
          onProgress?.(`Saving WBS structure (${saved}/${totalWBS})...`);
        });
        newIds.forEach((newId, oldId) => wbsIdMap.set(oldId, newId));
      })()
    );
  }

  await Promise.all(phase1Promises);

  // ============================================================
  // PHASE 2: Transform and save activities (needs WBS + Calendar ID maps)
  // Activities must complete before anything that references activity IDs.
  // ============================================================
  const taskTable = tableMap.get('TASK');
  const activityIdMap = new Map<string, string>();
  if (taskTable) {
    const totalActivities = taskTable.rows.length;

    onProgress?.(`Transforming activities (0/${totalActivities})...`);
    const { records, idMap } = await transformTasksInWorker(
      taskTable,
      versionId,
      companyId,
      wbsIdMap,
      calendarIdMap
    );

    onProgress?.(`Saving activities (0/${totalActivities})...`);
    await batchInsert(supabase, 'cpm_activities', records, (saved: number) => {
      onProgress?.(`Saving activities (${saved}/${totalActivities})...`);
    });

    idMap.forEach((newId, oldId) => activityIdMap.set(oldId, newId));
  }

  // ============================================================
  // PHASE 3: Process tables that need activity IDs but NOT each other's IDs.
  // These can all run in parallel:
  //   - TASKPRED (relationships) — needs activityIdMap
  //   - ACTVTYPE (code types) — no activity dependency, but needed by ACTVCODE
  //   - RSRC (resources) — no activity dependency, but needed by TASKRSRC
  //   - UDFTYPE (custom field types) — no activity dependency, but needed by UDFVALUE
  //   - MEMOTYPE (note topics) — no activity dependency, but needed by TASKMEMO
  // ============================================================
  onProgress?.('Phase 3: Saving relationships, codes, resources, custom fields...');

  const codeTypeIdMap = new Map<string, string>();
  const resourceIdMap = new Map<string, string>();
  const fieldTypeIdMap = new Map<string, string>();
  const topicIdMap = new Map<string, string>();

  const phase3Promises: Promise<void>[] = [];

  // Relationships
  const taskPredTable = tableMap.get('TASKPRED');
  if (taskPredTable) {
    phase3Promises.push(
      (async () => {
        const totalRels = taskPredTable.rows.length;
        onProgress?.(`Transforming relationships (0/${totalRels})...`);
        const { records } = await transformRelationshipsInWorker(
          taskPredTable,
          versionId,
          companyId,
          activityIdMap
        );
        onProgress?.(`Saving relationships (0/${totalRels})...`);
        await batchInsert(supabase, 'cpm_relationships', records, (saved: number) => {
          onProgress?.(`Saving relationships (${saved}/${totalRels})...`);
        });
      })()
    );
  }

  // Code types
  const actvTypeTable = tableMap.get('ACTVTYPE');
  if (actvTypeTable) {
    phase3Promises.push(
      (async () => {
        const totalTypes = actvTypeTable.rows.length;
        onProgress?.(`Saving code types (0/${totalTypes})...`);
        const newIds = await processACTVTYPE(supabase, actvTypeTable, versionId, companyId, (saved: number) => {
          onProgress?.(`Saving code types (${saved}/${totalTypes})...`);
        });
        newIds.forEach((newId, oldId) => codeTypeIdMap.set(oldId, newId));
      })()
    );
  }

  // Resources
  const rsrcTable = tableMap.get('RSRC');
  if (rsrcTable) {
    phase3Promises.push(
      (async () => {
        const totalResources = rsrcTable.rows.length;
        onProgress?.(`Saving resources (0/${totalResources})...`);
        const newIds = await processRSRC(supabase, rsrcTable, versionId, companyId, (saved: number) => {
          onProgress?.(`Saving resources (${saved}/${totalResources})...`);
        });
        newIds.forEach((newId, oldId) => resourceIdMap.set(oldId, newId));
      })()
    );
  }

  // Custom field types
  const udfTypeTable = tableMap.get('UDFTYPE');
  if (udfTypeTable) {
    phase3Promises.push(
      (async () => {
        const totalFieldTypes = udfTypeTable.rows.length;
        onProgress?.(`Saving custom field types (0/${totalFieldTypes})...`);
        const newIds = await processUDFTYPE(supabase, udfTypeTable, versionId, companyId, (saved: number) => {
          onProgress?.(`Saving custom field types (${saved}/${totalFieldTypes})...`);
        });
        newIds.forEach((newId, oldId) => fieldTypeIdMap.set(oldId, newId));
      })()
    );
  }

  // Note topics
  const memoTypeTable = tableMap.get('MEMOTYPE');
  if (memoTypeTable) {
    phase3Promises.push(
      (async () => {
        const totalTopics = memoTypeTable.rows.length;
        onProgress?.(`Saving note topics (0/${totalTopics})...`);
        const newIds = await processMEMOTYPE(supabase, memoTypeTable, versionId, companyId, (saved: number) => {
          onProgress?.(`Saving note topics (${saved}/${totalTopics})...`);
        });
        newIds.forEach((newId, oldId) => topicIdMap.set(oldId, newId));
      })()
    );
  }

  await Promise.all(phase3Promises);

  // ============================================================
  // PHASE 4: Process tables that need Phase 3 ID maps.
  // These can all run in parallel with each other:
  //   - ACTVCODE (needs codeTypeIdMap) → then TASKACTV (needs codeValueIdMap + activityIdMap)
  //   - TASKRSRC (needs resourceIdMap + activityIdMap)
  //   - UDFVALUE (needs fieldTypeIdMap + activityIdMap)
  //   - TASKMEMO (needs topicIdMap + activityIdMap)
  //   - Driving relationship analysis (needs relationship data from Phase 3)
  // Note: ACTVCODE → TASKACTV is a two-step chain, so we handle it as one async block.
  // ============================================================
  onProgress?.('Phase 4: Saving assignments and analyzing driving paths...');

  const phase4Promises: Promise<void>[] = [];

  // Code values → Code assignments (chained: ACTVCODE then TASKACTV)
  const actvCodeTable = tableMap.get('ACTVCODE');
  const taskActvTable = tableMap.get('TASKACTV');
  if (actvCodeTable || taskActvTable) {
    phase4Promises.push(
      (async () => {
        const codeValueIdMap = new Map<string, string>();
        if (actvCodeTable) {
          const totalCodes = actvCodeTable.rows.length;
          onProgress?.(`Saving code values (0/${totalCodes})...`);
          const newIds = await processACTVCODE(supabase, actvCodeTable, versionId, companyId, codeTypeIdMap, (saved: number) => {
            onProgress?.(`Saving code values (${saved}/${totalCodes})...`);
          });
          newIds.forEach((newId, oldId) => codeValueIdMap.set(oldId, newId));
        }
        if (taskActvTable) {
          const totalAssignments = taskActvTable.rows.length;
          onProgress?.(`Saving code assignments (0/${totalAssignments})...`);
          await processTASKACTV(supabase, taskActvTable, versionId, companyId, activityIdMap, codeValueIdMap, (saved: number) => {
            onProgress?.(`Saving code assignments (${saved}/${totalAssignments})...`);
          });
        }
      })()
    );
  }

  // Resource assignments
  const taskRsrcTable = tableMap.get('TASKRSRC');
  if (taskRsrcTable) {
    phase4Promises.push(
      (async () => {
        const totalRsrcAssignments = taskRsrcTable.rows.length;
        onProgress?.(`Saving resource assignments (0/${totalRsrcAssignments})...`);
        await processTASKRSRC(supabase, taskRsrcTable, versionId, companyId, activityIdMap, resourceIdMap, (saved: number) => {
          onProgress?.(`Saving resource assignments (${saved}/${totalRsrcAssignments})...`);
        });
      })()
    );
  }

  // Custom field values
  const udfValueTable = tableMap.get('UDFVALUE');
  if (udfValueTable) {
    phase4Promises.push(
      (async () => {
        const totalFieldValues = udfValueTable.rows.length;
        onProgress?.(`Saving custom field values (0/${totalFieldValues})...`);
        await processUDFVALUE(supabase, udfValueTable, versionId, companyId, activityIdMap, fieldTypeIdMap, (saved: number) => {
          onProgress?.(`Saving custom field values (${saved}/${totalFieldValues})...`);
        });
      })()
    );
  }

  // Activity notes
  const taskMemoTable = tableMap.get('TASKMEMO');
  if (taskMemoTable) {
    phase4Promises.push(
      (async () => {
        const totalNotes = taskMemoTable.rows.length;
        onProgress?.(`Saving activity notes (0/${totalNotes})...`);
        await processTASKMEMO(supabase, taskMemoTable, versionId, companyId, activityIdMap, topicIdMap, (saved: number) => {
          onProgress?.(`Saving activity notes (${saved}/${totalNotes})...`);
        });
      })()
    );
  }

  // Driving relationship analysis
  if (taskPredTable) {
    phase4Promises.push(
      (async () => {
        await updateDrivingRelationships(supabase, versionId, (processed: number, total: number) => {
          onProgress?.(`Analyzing driving paths (${processed}/${total})...`);
        });
      })()
    );
  }

  await Promise.all(phase4Promises);

  // ============================================================
  // PHASE 5: Store any unrecognized tables as raw data
  // ============================================================
  const knownTables = [
    'ERMHDR', 'PROJECT', 'PROJWBS', 'TASK', 'TASKPRED', 'CALENDAR',
    'ACTVTYPE', 'ACTVCODE', 'TASKACTV', 'RSRC', 'TASKRSRC',
    'UDFTYPE', 'UDFVALUE', 'MEMOTYPE', 'TASKMEMO'
  ];

  for (const table of tables) {
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
  companyId: string,
  onProgress?: (saved: number) => void
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

  await batchInsert(supabase, 'cpm_calendars', records, onProgress);
  return idMap;
}

async function processPROJWBS(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  onProgress?: (saved: number) => void
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

  await batchInsert(supabase, 'cpm_wbs', records, onProgress);

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


async function updateDrivingRelationships(
  supabase: any,
  versionId: string,
  onProgress?: (processed: number, total: number) => void
) {
  // The relationship_float_hours field was already computed by the relationship
  // transform worker from P6's aref (Relationship Early Finish) and arls
  // (Relationship Late Start) dates: relationship_total_float = arls - aref.
  //
  // P6 computed these dates during its scheduling calculation using the correct
  // predecessor/successor calendars, so this is calendar-aware without us needing
  // to parse P6's calendar format.
  //
  // The driving predecessor for each successor is the relationship with the
  // minimum relationship_float_hours that equals zero (or effectively zero).
  // Reference: Planning Planet forum and Tom Boyle's blog on driving logic -
  // "a driving relationship is identified when the Relationship Successor
  // Free Float equals zero."

  // Step 1: Load all relationships that have relationship_float_hours computed
  let allRelationships: any[] = [];
  const REL_BATCH = 1000;
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: relBatch, error: relError } = await supabase
      .from('cpm_relationships')
      .select('id, successor_activity_id, relationship_float_hours')
      .eq('schedule_version_id', versionId)
      .range(from, from + REL_BATCH - 1);

    if (relError) {
      console.error('Error loading relationships for driving calc:', relError);
      break;
    }

    if (relBatch && relBatch.length > 0) {
      allRelationships = allRelationships.concat(relBatch);
      from += REL_BATCH;
      hasMore = relBatch.length === REL_BATCH;
    } else {
      hasMore = false;
    }
  }

  if (allRelationships.length === 0) return;

  const total = allRelationships.length;
  onProgress?.(0, total);

  // Step 2: Group relationships by successor activity
  const relsBySuccessor = new Map<string, any[]>();
  allRelationships.forEach(rel => {
    if (!rel.successor_activity_id) return;
    if (!relsBySuccessor.has(rel.successor_activity_id)) {
      relsBySuccessor.set(rel.successor_activity_id, []);
    }
    relsBySuccessor.get(rel.successor_activity_id)!.push(rel);
  });

  // Step 3: For each successor, find the driving predecessor.
  // The driving relationship has the minimum relationship_float_hours = 0.
  // If relationship_float_hours is null (aref/arls not in XER), we can't determine
  // driving status and leave is_driving as null.
  const drivingIds = new Set<string>();
  const nonDrivingIds = new Set<string>();

  relsBySuccessor.forEach((rels) => {
    // Separate rels with computed float vs null float
    const withFloat = rels.filter((r: any) => r.relationship_float_hours !== null && r.relationship_float_hours !== undefined);
    const withoutFloat = rels.filter((r: any) => r.relationship_float_hours === null || r.relationship_float_hours === undefined);

    if (withFloat.length === 0) {
      // No float data available — can't determine driving, leave as null
      return;
    }

    // Sort by float ascending — lowest float first
    withFloat.sort((a: any, b: any) => a.relationship_float_hours - b.relationship_float_hours);

    // The first one (lowest float) is driving if its float is effectively zero
    const lowestFloat = withFloat[0].relationship_float_hours;
    if (Math.abs(lowestFloat) < 0.01) {
      drivingIds.add(withFloat[0].id);
    } else {
      nonDrivingIds.add(withFloat[0].id);
    }

    // All others for this successor are non-driving
    for (let i = 1; i < withFloat.length; i++) {
      nonDrivingIds.add(withFloat[i].id);
    }

    // Relationships without float data remain null (not added to either set)
  });

  // Step 4: Batch update is_driving in the database
  // Use two bulk updates: one for driving=true, one for driving=false
  const UPDATE_BATCH = 200;
  let processed = 0;

  // Update driving relationships
  const drivingArray = Array.from(drivingIds);
  for (let i = 0; i < drivingArray.length; i += UPDATE_BATCH) {
    const batch = drivingArray.slice(i, i + UPDATE_BATCH);
    const { error } = await supabase
      .from('cpm_relationships')
      .update({ is_driving: true })
      .in('id', batch);

    if (error) {
      console.error('Error setting driving relationships:', error);
    }

    processed += batch.length;
    onProgress?.(processed, total);
  }

  // Update non-driving relationships
  const nonDrivingArray = Array.from(nonDrivingIds);
  for (let i = 0; i < nonDrivingArray.length; i += UPDATE_BATCH) {
    const batch = nonDrivingArray.slice(i, i + UPDATE_BATCH);
    const { error } = await supabase
      .from('cpm_relationships')
      .update({ is_driving: false })
      .in('id', batch);

    if (error) {
      console.error('Error setting non-driving relationships:', error);
    }

    processed += batch.length;
    onProgress?.(processed, total);
  }
}

async function processACTVTYPE(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  onProgress?: (saved: number) => void
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

  await batchInsert(supabase, 'cpm_code_types', records, onProgress);
  return idMap;
}

async function processACTVCODE(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  codeTypeIdMap: Map<string, string>,
  onProgress?: (saved: number) => void
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

  await batchInsert(supabase, 'cpm_code_values', records, onProgress);
  return idMap;
}

async function processTASKACTV(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  activityIdMap: Map<string, string>,
  codeValueIdMap: Map<string, string>,
  onProgress?: (saved: number) => void
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

  await batchInsert(supabase, 'cpm_code_assignments', records, onProgress);
}

async function processRSRC(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  onProgress?: (saved: number) => void
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

  await batchInsert(supabase, 'cpm_resources', records, onProgress);
  return idMap;
}

async function processTASKRSRC(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  activityIdMap: Map<string, string>,
  resourceIdMap: Map<string, string>,
  onProgress?: (saved: number) => void
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

  await batchInsert(supabase, 'cpm_resource_assignments', records, onProgress);
}

async function processUDFTYPE(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  onProgress?: (saved: number) => void
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

  await batchInsert(supabase, 'cpm_custom_field_types', records, onProgress);
  return idMap;
}

async function processUDFVALUE(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  activityIdMap: Map<string, string>,
  fieldTypeIdMap: Map<string, string>,
  onProgress?: (saved: number) => void
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

  await batchInsert(supabase, 'cpm_custom_field_values', records, onProgress);
}

async function processMEMOTYPE(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  onProgress?: (saved: number) => void
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

  await batchInsert(supabase, 'cpm_note_topics', records, onProgress);
  return idMap;
}

async function processTASKMEMO(
  supabase: any,
  table: XERTable,
  versionId: string,
  companyId: string,
  activityIdMap: Map<string, string>,
  topicIdMap: Map<string, string>,
  onProgress?: (saved: number) => void
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

  await batchInsert(supabase, 'cpm_activity_notes', records, onProgress);
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

function getOptimalBatchSize(tableName: string): number {
  const batchSizes: Record<string, number> = {
    'cpm_activities': 100,
    'cpm_relationships': 500,
    'cpm_code_assignments': 1000,
    'cpm_resource_assignments': 300,
    'cpm_custom_field_values': 500,
    'cpm_activity_notes': 200,
    'cpm_wbs': 300,
    'cpm_calendars': 200,
    'cpm_code_types': 500,
    'cpm_code_values': 500,
    'cpm_resources': 300,
    'cpm_custom_field_types': 500,
    'cpm_note_topics': 500,
  };

  return batchSizes[tableName] || 200;
}

async function batchInsert(
  supabase: any,
  tableName: string,
  records: any[],
  onProgress?: (saved: number) => void
) {
  const batchSize = getOptimalBatchSize(tableName);
  let totalSaved = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await supabase.from(tableName).insert(batch);

    if (error) {
      console.error(`Error inserting batch into ${tableName}:`, error);
      throw error;
    }

    totalSaved += batch.length;
    onProgress?.(totalSaved);
  }
}
