import { supabase } from './supabase';
import { parseXER, processXERTables, ImportProgressReport } from './xerParser';

export type { ImportProgressReport, ImportStageProgress } from './xerParser';

export interface ParseProgress {
  stage: string;
  current: number;
  total: number;
  percent: number;
}

interface UploadScheduleFileParams {
  file: File;
  projectId: string;
  companyId: string;
  versionLabel: string;
  onProgress?: (progress: number) => void;
  onStatusChange?: (status: 'uploading' | 'parsing' | 'complete' | 'error', message?: string) => void;
  onParseProgress?: (progress: ParseProgress) => void;
  onStructuredProgress?: (report: ImportProgressReport) => void;
}

interface UploadScheduleFileResult {
  versionId: string;
  parsePromise: Promise<void>;
}

export async function uploadScheduleFile({
  file,
  projectId,
  companyId,
  versionLabel,
  onProgress,
  onStatusChange,
  onParseProgress,
  onStructuredProgress,
}: UploadScheduleFileParams): Promise<UploadScheduleFileResult> {
  const versionId = crypto.randomUUID();
  const storagePath = `${companyId}/${projectId}/${versionId}.xer`;

  console.log('[Upload] Starting upload process:', {
    versionId,
    fileName: file.name,
    fileSize: file.size,
    projectId,
    companyId,
    versionLabel,
    storagePath,
  });

  try {
    onStatusChange?.('uploading', 'Uploading file...');

    console.log('[Upload] Creating schedule_versions record...');
    const { data: versionData, error: versionError } = await supabase
      .from('schedule_versions')
      .insert({
        id: versionId,
        project_id: projectId,
        company_id: companyId,
        version_label: versionLabel,
        source_format: 'xer',
        source_blob_path: storagePath,
        parse_status: 'pending',
      })
      .select();

    if (versionError) {
      console.error('[Upload] Failed to create schedule_versions record:', versionError);
      throw versionError;
    }

    console.log('[Upload] Schedule version record created successfully:', versionData);

    console.log('[Upload] Using standard upload for all file sizes');
    await uploadStandard(file, storagePath, onProgress);

    console.log('[Upload] File uploaded successfully to storage');

    onStatusChange?.('parsing', 'Reading XER file...');

    const parsePromise = (async () => {
      try {
        console.log('[Upload] Reading file content...');
        const fileContent = await file.text();
        console.log('[Upload] File content length:', fileContent.length, 'characters');

        onStatusChange?.('parsing', 'Parsing XER...');
        console.log('[Upload] Parsing XER format...');
        const tables = parseXER(fileContent);

        if (!tables || tables.length === 0) {
          console.error('[Upload] No tables found in XER file');
          throw new Error('Invalid XER file format: No tables found');
        }

        console.log('[Upload] Parsed', tables.length, 'tables:', tables.map(t => t.name).join(', '));

        console.log('[Upload] Updating parse status to "parsing"...');
        await supabase
          .from('schedule_versions')
          .update({ parse_status: 'parsing' })
          .eq('id', versionId);

        console.log('[Upload] Processing XER tables into database...');
        await processXERTables(supabase, tables, versionId, companyId, (message) => {
          onStatusChange?.('parsing', message);

          const match = message.match(/^Saving (\w+.*?) \((\d+)\/(\d+)\)\.\.\./);
          if (match) {
            const stage = match[1];
            const current = parseInt(match[2]);
            const total = parseInt(match[3]);
            const percent = Math.round((current / total) * 100);
            onParseProgress?.({ stage, current, total, percent });
          }
        }, onStructuredProgress);

        // ============================================================
        // After all XER table inserts are complete, call the server-side
        // calendar decoder and relationship free float calculator.
        // This decodes the P6 clndr_data strings, expands the calendar
        // lookup table, and calculates working-day relationship free float.
        // ============================================================
        try {
          console.log('[XER Parser] Calling server-side calendar decode and float calculation...');
          onStatusChange?.('parsing', 'Decoding calendars and calculating relationship floats...');

          const { data: decodeResult, error: decodeError } = await supabase.rpc(
            'decode_calendars_and_calc_floats',
            { p_schedule_version_id: versionId }
          );

          if (decodeError) {
            console.error('[XER Parser] Calendar decode RPC error:', decodeError);
            // Don't fail the entire parse — the raw data is already saved.
            // Log the error but still mark parse as complete.
          } else {
            console.log('[XER Parser] Calendar decode results:', decodeResult);

            // Check if the function itself reported an error
            if (decodeResult?.status === 'error') {
              console.error('[XER Parser] Calendar decode internal error:', decodeResult.error_message);
            } else {
              console.log(
                `[XER Parser] Decoded ${decodeResult?.calendars_decoded} calendars, ` +
                `expanded ${decodeResult?.calendar_date_rows} date rows, ` +
                `processed ${decodeResult?.relationships_processed} relationships`
              );
            }
          }
        } catch (err) {
          console.error('[XER Parser] Unexpected error calling calendar decode:', err);
          // Non-fatal — raw data is already persisted
        }

        console.log('[Upload] Updating parse status to "complete"...');
        await supabase
          .from('schedule_versions')
          .update({ parse_status: 'complete' })
          .eq('id', versionId);

        console.log('[Upload] Parse completed successfully');
        onStatusChange?.('complete', 'Complete');
      } catch (err) {
        console.error('[Upload] Error parsing XER:', err);
        const errorMessage = err instanceof Error ? err.message : 'Parse failed';

        await supabase
          .from('schedule_versions')
          .update({
            parse_status: 'error',
            parse_error_details: errorMessage,
          })
          .eq('id', versionId);

        onStatusChange?.('error', `Error: ${errorMessage}`);
        throw err;
      }
    })();

    console.log('[Upload] Upload process completed successfully');
    return { versionId, parsePromise };
  } catch (error) {
    console.error('[Upload] Upload failed, cleaning up schedule_versions record:', error);
    await supabase.from('schedule_versions').delete().eq('id', versionId);

    const errorMessage = error instanceof Error ? error.message : 'Upload failed';
    onStatusChange?.('error', `Error: ${errorMessage}`);
    throw error;
  }
}

async function uploadStandard(
  file: File,
  path: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  console.log('[Upload Standard] Starting standard upload:', {
    fileName: file.name,
    fileSize: file.size,
    path,
    bucket: 'schedule-files',
  });

  if (onProgress) onProgress(0);

  console.log('[Upload Standard] Calling supabase.storage.from("schedule-files").upload()...');
  const { data, error } = await supabase.storage
    .from('schedule-files')
    .upload(path, file, {
      upsert: true,
    });

  if (error) {
    console.error('[Upload Standard] Storage upload failed:', {
      error,
      message: error.message,
      statusCode: error.statusCode,
    });
    throw error;
  }

  console.log('[Upload Standard] Storage upload successful:', data);

  if (onProgress) onProgress(100);
}
