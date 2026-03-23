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

// NOTE: mapTaskType and mapStatusCode were previously defined here but were
// dead code (defined but never called — the worker does the actual mapping).
// They now live in activityUtils.ts as the single source of truth.

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


// Structured progress reporting for the import process.
// Each stage has a key, label, total count, and current progress.
export interface ImportStageProgress {
  key: string;
  label: string;
  total: number;
  current: number;
  status: 'pending' | 'active' | 'complete';
}

export interface ImportProgressReport {
  stages: ImportStageProgress[];
}

export async function processXERTables(
  supabase: any,
  tables: XERTable[],
  versionId: string,
  companyId: string,
  onProgress?: (message: string) => void,
  onStructuredProgress?: (report: ImportProgressReport) => void
) {
  const tableMap = new Map<string, XERTable>();
  tables.forEach(table => tableMap.set(table.name, table));

  // ============================================================
  // STEP 0: Count everything upfront so all progress bars show immediately
  // ============================================================
  const calendarTable = tableMap.get('CALENDAR');
  const wbsTable = tableMap.get('PROJWBS');
  const taskTable = tableMap.get('TASK');
  const taskPredTable = tableMap.get('TASKPRED');
  const actvTypeTable = tableMap.get('ACTVTYPE');
  const actvCodeTable = tableMap.get('ACTVCODE');
  const taskActvTable = tableMap.get('TASKACTV');
  const rsrcTable = tableMap.get('RSRC');
  const taskRsrcTable = tableMap.get('TASKRSRC');
  const udfTypeTable = tableMap.get('UDFTYPE');
  const udfValueTable = tableMap.get('UDFVALUE');
  const memoTypeTable = tableMap.get('MEMOTYPE');
  const taskMemoTable = tableMap.get('TASKMEMO');
  const projectTable = tableMap.get('PROJECT');

  const stages: ImportStageProgress[] = [
    { key: 'calendars', label: 'Calendars', total: calendarTable?.rows.length || 0, current: 0, status: 'pending' },
    { key: 'wbs', label: 'WBS Structure', total: wbsTable?.rows.length || 0, current: 0, status: 'pending' },
    { key: 'activities', label: 'Activities', total: taskTable?.rows.length || 0, current: 0, status: 'pending' },
    { key: 'relationships', label: 'Relationships', total: taskPredTable?.rows.length || 0, current: 0, status: 'pending' },
    { key: 'codeTypes', label: 'Code Types & Values', total: (actvTypeTable?.rows.length || 0) + (actvCodeTable?.rows.length || 0), current: 0, status: 'pending' },
    { key: 'codeAssignments', label: 'Code Assignments', total: taskActvTable?.rows.length || 0, current: 0, status: 'pending' },
    { key: 'resources', label: 'Resources & Assignments', total: (rsrcTable?.rows.length || 0) + (taskRsrcTable?.rows.length || 0), current: 0, status: 'pending' },
    { key: 'customFields', label: 'Custom Fields', total: (udfTypeTable?.rows.length || 0) + (udfValueTable?.rows.length || 0), current: 0, status: 'pending' },
    { key: 'notes', label: 'Activity Notes', total: (memoTypeTable?.rows.length || 0) + (taskMemoTable?.rows.length || 0), current: 0, status: 'pending' },
    { key: 'driving', label: 'Driving Path Analysis', total: taskPredTable?.rows.length || 0, current: 0, status: 'pending' },
  ];

  const activeStages = stages.filter(s => s.total > 0);

  function updateStage(key: string, updates: Partial<ImportStageProgress>) {
    const stage = activeStages.find(s => s.key === key);
    if (stage) {
      Object.assign(stage, updates);
      onStructuredProgress?.({ stages: [...activeStages] });
    }
  }

  // Emit initial state with all totals known
  onStructuredProgress?.({ stages: [...activeStages] });

  // ============================================================
  // Project metadata
  // ============================================================
  let p6Version = '';
  let dataDate: string | null = null;

  const ermhdrTable = tables.find(t => t.name === 'ERMHDR');
  if (ermhdrTable && ermhdrTable.rows.length > 0) {
    const versionIndex = ermhdrTable.fields.indexOf('version');
    if (versionIndex >= 0) {
      p6Version = ermhdrTable.rows[0][versionIndex] || '';
    }
  }

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
      .update({ source_tool_version: p6Version || null, data_date: dataDate })
      .eq('id', versionId);
  }

  // ============================================================
  // PHASE 1: PROJECT + CALENDAR + WBS in parallel
  // ============================================================
  const calendarIdMap = new Map<string, string>();
  const wbsIdMap = new Map<string, string>();
  const phase1: Promise<void>[] = [];

  if (projectTable) {
    phase1.push(processPROJECT(supabase, projectTable, versionId, companyId));
  }
  if (calendarTable) {
    phase1.push((async () => {
      updateStage('calendars', { status: 'active' });
      const ids = await processCALENDAR(supabase, calendarTable, versionId, companyId, (n) => {
        updateStage('calendars', { current: n });
        onProgress?.(`Saving calendars (${n}/${calendarTable.rows.length})...`);
      });
      ids.forEach((v, k) => calendarIdMap.set(k, v));
      updateStage('calendars', { status: 'complete', current: calendarTable.rows.length });
    })());
  }
  if (wbsTable) {
    phase1.push((async () => {
      updateStage('wbs', { status: 'active' });
      const ids = await processPROJWBS(supabase, wbsTable, versionId, companyId, (n) => {
        updateStage('wbs', { current: n });
        onProgress?.(`Saving WBS (${n}/${wbsTable.rows.length})...`);
      });
      ids.forEach((v, k) => wbsIdMap.set(k, v));
      updateStage('wbs', { status: 'complete', current: wbsTable.rows.length });
    })());
  }
  await Promise.all(phase1);

  // ============================================================
  // PHASE 2: Activities (needs WBS + Calendar IDs)
  // ============================================================
  const activityIdMap = new Map<string, string>();
  if (taskTable) {
    updateStage('activities', { status: 'active' });
    const { records, idMap } = await transformTasksInWorker(taskTable, versionId, companyId, wbsIdMap, calendarIdMap);
    await batchInsert(supabase, 'cpm_activities', records, (n) => {
      updateStage('activities', { current: n });
      onProgress?.(`Saving activities (${n}/${taskTable.rows.length})...`);
    });
    idMap.forEach((v, k) => activityIdMap.set(k, v));
    updateStage('activities', { status: 'complete', current: taskTable.rows.length });
  }

  // ============================================================
  // PHASE 3: Tables needing activity IDs but not each other
  // ============================================================
  const codeTypeIdMap = new Map<string, string>();
  const codeValueIdMap = new Map<string, string>();
  const resourceIdMap = new Map<string, string>();
  const fieldTypeIdMap = new Map<string, string>();
  const topicIdMap = new Map<string, string>();
  const phase3: Promise<void>[] = [];

  if (taskPredTable) {
    phase3.push((async () => {
      updateStage('relationships', { status: 'active' });
      const { records } = await transformRelationshipsInWorker(taskPredTable, versionId, companyId, activityIdMap);
      await batchInsert(supabase, 'cpm_relationships', records, (n) => {
        updateStage('relationships', { current: n });
        onProgress?.(`Saving relationships (${n}/${taskPredTable.rows.length})...`);
      });
      updateStage('relationships', { status: 'complete', current: taskPredTable.rows.length });
    })());
  }

  if (actvTypeTable || actvCodeTable) {
    phase3.push((async () => {
      updateStage('codeTypes', { status: 'active' });
      let processed = 0;
      if (actvTypeTable) {
        const ids = await processACTVTYPE(supabase, actvTypeTable, versionId, companyId, (n) => {
          processed = n;
          updateStage('codeTypes', { current: n });
        });
        ids.forEach((v, k) => codeTypeIdMap.set(k, v));
        processed = actvTypeTable.rows.length;
      }
      if (actvCodeTable) {
        const ids = await processACTVCODE(supabase, actvCodeTable, versionId, companyId, codeTypeIdMap, (n) => {
          updateStage('codeTypes', { current: processed + n });
        });
        ids.forEach((v, k) => codeValueIdMap.set(k, v));
      }
      const total = (actvTypeTable?.rows.length || 0) + (actvCodeTable?.rows.length || 0);
      updateStage('codeTypes', { status: 'complete', current: total });
    })());
  }

  if (rsrcTable) {
    phase3.push((async () => {
      updateStage('resources', { status: 'active' });
      const ids = await processRSRC(supabase, rsrcTable, versionId, companyId, (n) => {
        updateStage('resources', { current: n });
      });
      ids.forEach((v, k) => resourceIdMap.set(k, v));
      updateStage('resources', { current: rsrcTable.rows.length });
    })());
  }

  if (udfTypeTable) {
    phase3.push((async () => {
      updateStage('customFields', { status: 'active' });
      const ids = await processUDFTYPE(supabase, udfTypeTable, versionId, companyId, (n) => {
        updateStage('customFields', { current: n });
      });
      ids.forEach((v, k) => fieldTypeIdMap.set(k, v));
      updateStage('customFields', { current: udfTypeTable.rows.length });
    })());
  }

  if (memoTypeTable) {
    phase3.push((async () => {
      updateStage('notes', { status: 'active' });
      const ids = await processMEMOTYPE(supabase, memoTypeTable, versionId, companyId, (n) => {
        updateStage('notes', { current: n });
      });
      ids.forEach((v, k) => topicIdMap.set(k, v));
      updateStage('notes', { current: memoTypeTable.rows.length });
    })());
  }

  await Promise.all(phase3);

  // ============================================================
  // PHASE 4: Assignment tables + driving analysis
  // ============================================================
  const phase4: Promise<void>[] = [];

  if (taskActvTable) {
    phase4.push((async () => {
      updateStage('codeAssignments', { status: 'active' });
      await processTASKACTV(supabase, taskActvTable, versionId, companyId, activityIdMap, codeValueIdMap, (n) => {
        updateStage('codeAssignments', { current: n });
      });
      updateStage('codeAssignments', { status: 'complete', current: taskActvTable.rows.length });
    })());
  }

  if (taskRsrcTable) {
    phase4.push((async () => {
      const offset = rsrcTable?.rows.length || 0;
      await processTASKRSRC(supabase, taskRsrcTable, versionId, companyId, activityIdMap, resourceIdMap, (n) => {
        updateStage('resources', { current: offset + n });
      });
      updateStage('resources', { status: 'complete', current: offset + taskRsrcTable.rows.length });
    })());
  } else if (rsrcTable) {
    updateStage('resources', { status: 'complete' });
  }

  if (udfValueTable) {
    phase4.push((async () => {
      const offset = udfTypeTable?.rows.length || 0;
      await processUDFVALUE(supabase, udfValueTable, versionId, companyId, activityIdMap, fieldTypeIdMap, (n) => {
        updateStage('customFields', { current: offset + n });
      });
      updateStage('customFields', { status: 'complete', current: offset + udfValueTable.rows.length });
    })());
  } else if (udfTypeTable) {
    updateStage('customFields', { status: 'complete' });
  }

  if (taskMemoTable) {
    phase4.push((async () => {
      const offset = memoTypeTable?.rows.length || 0;
      await processTASKMEMO(supabase, taskMemoTable, versionId, companyId, activityIdMap, topicIdMap, (n) => {
        updateStage('notes', { current: offset + n });
      });
      updateStage('notes', { status: 'complete', current: offset + taskMemoTable.rows.length });
    })());
  } else if (memoTypeTable) {
    updateStage('notes', { status: 'complete' });
  }

  if (taskPredTable) {
    phase4.push((async () => {
      updateStage('driving', { status: 'active' });
      await updateDrivingRelationships(supabase, versionId, (processed, total) => {
        updateStage('driving', { current: processed, total: total > 0 ? total : taskPredTable.rows.length });
      });
      updateStage('driving', { status: 'complete', current: taskPredTable.rows.length });
    })());
  }

  await Promise.all(phase4);

  // ============================================================
  // PHASE 5: Raw tables
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

  // First pass: create UUIDs for all WBS nodes so we can resolve parent references
  const wbsIdIndex = table.fields.indexOf('wbs_id');
  const parentIdIndex = table.fields.indexOf('parent_wbs_id');

  table.rows.forEach(row => {
    if (wbsIdIndex >= 0) {
      const originalId = row[wbsIdIndex];
      if (originalId) {
        idMap.set(originalId, crypto.randomUUID());
      }
    }
  });

  // Second pass: build records with parent_wbs_id already resolved
  // This avoids the slow individual UPDATE calls after insert
  const records = table.rows.map(row => {
    const originalWbsId = wbsIdIndex >= 0 ? row[wbsIdIndex] : null;
    const newId = originalWbsId ? idMap.get(originalWbsId)! : crypto.randomUUID();

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
      } else if (field === 'wbs_short_name' || field === 'wbs_name') {
        record.wbs_name = value;
      } else if (field === 'wbs_code') {
        record.wbs_code = value;
      } else if (field === 'seq_num') {
        record.sort_order = parseInt(value) || 0;
      } else if (field === 'parent_wbs_id' && value) {
        // Resolve parent reference using the ID map from first pass
        record.parent_wbs_id = idMap.get(value) || null;
      }
    });

    return record;
  });

  // Compute WBS levels from parent-child hierarchy
  // Build a lookup map and walk from roots to compute levels
  const recordMap = new Map<string, any>();
  records.forEach(r => recordMap.set(r.id, r));

  function setLevel(record: any, level: number) {
    record.level = level;
    // Find children of this record
    records.forEach(r => {
      if (r.parent_wbs_id === record.id) {
        setLevel(r, level + 1);
      }
    });
  }

  // Start from root nodes (no parent)
  records.forEach(r => {
    if (!r.parent_wbs_id) {
      setLevel(r, 0);
    }
  });

  // Single batch insert with parent_wbs_id and level already set
  await batchInsert(supabase, 'cpm_wbs', records, onProgress);

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
      } else if (field === 'parent_actv_code_id' && value) {
        record.original_parent_code_value_id = value;
      } else if (field === 'color' && value) {
        const colorInt = parseInt(value);
        if (!isNaN(colorInt)) {
          record.code_value_color = colorInt;
        }
      }
    });

    return record;
  });

  await batchInsert(supabase, 'cpm_code_values', records, onProgress);

  const parentUpdates: Array<{ id: string; parent_code_value_id: string }> = [];

  records.forEach(record => {
    if (record.original_parent_code_value_id) {
      const parentUuid = idMap.get(record.original_parent_code_value_id);
      if (parentUuid) {
        parentUpdates.push({
          id: record.id,
          parent_code_value_id: parentUuid,
        });
      }
    }
  });

  if (parentUpdates.length > 0) {
    const BATCH_SIZE = 100;
    for (let i = 0; i < parentUpdates.length; i += BATCH_SIZE) {
      const batch = parentUpdates.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(update =>
          supabase
            .from('cpm_code_values')
            .update({ parent_code_value_id: update.parent_code_value_id })
            .eq('id', update.id)
        )
      );
    }
    console.log(`Resolved ${parentUpdates.length} activity code parent references`);
  }

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
