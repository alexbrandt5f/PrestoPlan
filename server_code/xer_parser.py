import anvil.tables as tables
import anvil.tables.query as q
from anvil.tables import app_tables
import anvil.users
import anvil.stripe
"""
===============================================================================
 MODULE: xer_parser.py
 Description:  Processes XER data that VBA uploaded directly to Supabase.

 Flow:
   1. VBA calls Anvil /import_start    → creates import_log, staging table
   2. VBA POSTs raw XER file chunks directly to Supabase REST API
      (bypasses Anvil entirely — fast, no middleware overhead)
   3. VBA calls Anvil /import_execute  → launches background task
   4. VBA polls Anvil /import_status   → checks completion
   5. Background task: reads staging, parses XER, inserts into p6_* tables

 HTTP Endpoints (Anvil):
   /import_start    POST  {token, project_id, label, ...}
   /import_execute  POST  {token, import_id}
   /import_status   POST  {token, import_id}
   /import_list     POST  {token, project_id}
   /delete_import   POST  {token, import_id}
===============================================================================
"""

import anvil.server
import anvil.secrets
import json
from datetime import datetime

from . import db
from . import auth


# ===========================================================================
#  HELPERS
# ===========================================================================

def _ok(data_dict):
  data_dict["status"] = "ok"
  return anvil.server.HttpResponse(
    200, json.dumps(data_dict, default=str),
    headers={"Content-Type": "application/json"}
  )

def _err(message, code=400):
  return anvil.server.HttpResponse(
    code, json.dumps({"status": "error", "message": str(message)}),
    headers={"Content-Type": "application/json"}
  )


# ===========================================================================
#  /import_start — create import record and ensure staging table exists
# ===========================================================================

@anvil.server.http_endpoint("/import_start", methods=["POST"])
def api_import_start(**kwargs):
  """
    Create import_log record and ensure staging table exists.
    Returns import_id and Supabase connection details for direct upload.

    POST: {token, project_id, label, notes, xer_version,
           data_date, export_user}
    Returns: {status, import_id, supabase_url, supabase_anon_key}
    """
  try:
    body = anvil.server.request.body_json
    token = body.get("token", "")
    project_id = body.get("project_id")

    user = auth.validate_session(token)
    if not user:
      return _err("Invalid session", 401)

    access = auth.check_project_access(token, project_id, "editor")
    if not access["allowed"]:
      return _err(access["message"], 403)

    if not project_id:
      return _err("project_id is required")

      # -- Ensure staging table --
    db.execute_script("""
            CREATE TABLE IF NOT EXISTS import_staging (
                staging_id  SERIAL PRIMARY KEY,
                import_id   INTEGER NOT NULL,
                chunk_seq   INTEGER NOT NULL DEFAULT 0,
                content     TEXT NOT NULL,
                created_at  TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_staging_import
                ON import_staging (import_id, chunk_seq);
        """)

    # -- Create import_log --
    row = db.execute_returning("""
            INSERT INTO import_log
                (project_id, file_name, file_type, label, notes,
                 xer_version, data_date, export_user,
                 imported_by, import_status, status_message)
            VALUES (%s, %s, 'XER', %s, %s, %s, %s, %s, %s,
                    'uploading', 'Waiting for file upload...')
            RETURNING import_id
        """, [
      project_id,
      body.get("label") or "XER Import",
      body.get("label"),
      body.get("notes"),
      body.get("xer_version"),
      body.get("data_date"),
      body.get("export_user"),
      user["user_id"]
    ])

    # -- Return Supabase connection info for direct upload --
    # VBA will POST directly to Supabase REST API
    supabase_url = f"https://{anvil.secrets.get_secret('supabase_project_ref')}.supabase.co"
    supabase_anon_key = anvil.secrets.get_secret('supabase_anon_key')

    return _ok({
      "import_id": row["import_id"],
      "supabase_url": supabase_url,
      "supabase_anon_key": supabase_anon_key
    })

  except Exception as e:
    return _err(f"Failed to start import: {e}", 500)


# ===========================================================================
#  /import_execute — launch background task to process uploaded data
# ===========================================================================

@anvil.server.http_endpoint("/import_execute", methods=["POST"])
def api_import_execute(**kwargs):
  """
    Launch background task to process the staged XER data.
    VBA calls this after uploading all chunks to Supabase.

    POST: {token, import_id}
    """
  try:
    body = anvil.server.request.body_json
    token = body.get("token", "")
    import_id = body.get("import_id")

    user = auth.validate_session(token)
    if not user:
      return _err("Invalid session", 401)

    if not import_id:
      return _err("import_id is required")

    db.execute(
      "UPDATE import_log SET import_status = 'processing', "
      "status_message = 'Processing uploaded data...' "
      "WHERE import_id = %s", [import_id]
    )

    anvil.server.launch_background_task(
      'bg_process_import', import_id, user
    )

    return _ok({"message": "Processing started"})

  except Exception as e:
    return _err(f"Execute error: {e}", 500)


# ===========================================================================
#  /import_status — poll for completion
# ===========================================================================

@anvil.server.http_endpoint("/import_status", methods=["POST"])
def api_import_status(**kwargs):
  try:
    body = anvil.server.request.body_json
    token = body.get("token", "")
    import_id = body.get("import_id")

    user = auth.validate_session(token)
    if not user:
      return _err("Invalid session", 401)

    row = db.query_one("""
            SELECT import_status, record_count, table_summary,
                   status_message
            FROM import_log WHERE import_id = %s
        """, [import_id])

    if not row:
      return _err("Import not found", 404)

    state = row.get("import_status", "processing")

    if state == "completed":
      return _ok({
        "state": "completed",
        "import_id": import_id,
        "record_count": row.get("record_count", 0),
        "table_summary": row.get("table_summary", ""),
        "total_records": row.get("record_count", 0)
      })
    elif state == "failed":
      return _ok({
        "state": "failed",
        "error": row.get("status_message", "Unknown error")
      })
    else:
      return _ok({
        "state": state,
        "progress": row.get("status_message", "Working...")
      })

  except Exception as e:
    return _err(f"Status check error: {e}", 500)


# ===========================================================================
#  /import_list
# ===========================================================================

@anvil.server.http_endpoint("/import_list", methods=["POST"])
def api_get_import_list(**kwargs):
  try:
    body = anvil.server.request.body_json
    token = body.get("token", "")
    project_id = body.get("project_id")

    user = auth.validate_session(token)
    if not user:
      return _err("Invalid session", 401)

    access = auth.check_project_access(token, project_id, "reader")
    if not access["allowed"]:
      return _err(access["message"], 403)

    imports = db.query("""
            SELECT import_id, file_name, file_type, import_date,
                   label, notes, data_date, xer_version,
                   export_user, record_count, table_summary,
                   import_status
            FROM import_log WHERE project_id = %s
            ORDER BY import_date DESC
        """, [project_id])

    return _ok({"imports": imports})

  except Exception as e:
    return _err(f"Error: {e}", 500)


# ===========================================================================
#  /delete_import
# ===========================================================================

@anvil.server.http_endpoint("/delete_import", methods=["POST"])
def api_delete_import(**kwargs):
  try:
    body = anvil.server.request.body_json
    token = body.get("token", "")
    import_id = body.get("import_id")

    user = auth.validate_session(token)
    if not user:
      return _err("Invalid session", 401)

    imp = db.query_one(
      "SELECT project_id FROM import_log WHERE import_id = %s",
      [import_id]
    )
    if not imp:
      return _err("Import not found", 404)

    access = auth.check_project_access(
      token, imp["project_id"], "editor"
    )
    if not access["allowed"]:
      return _err(access["message"], 403)

    db.execute("DELETE FROM import_staging WHERE import_id = %s",
               [import_id])
    db.execute("DELETE FROM import_log WHERE import_id = %s",
               [import_id])

    db.log_audit(user["user_id"], "delete_import",
                 f"Deleted import {import_id}", imp["project_id"])

    return _ok({"message": f"Import {import_id} deleted"})

  except Exception as e:
    return _err(f"Delete error: {e}", 500)


# ===========================================================================
#  BACKGROUND TASK — parse and insert all XER data
# ===========================================================================

@anvil.server.background_task
def bg_process_import(import_id, user):
  """
    Background task: read raw XER content from staging, parse it,
    and insert into p6_* tables. No timeout limit.
    """
  def _progress(msg):
    try:
      db.execute(
        "UPDATE import_log SET status_message = %s "
        "WHERE import_id = %s", [msg, import_id]
      )
    except Exception:
      pass

  try:
    # -- Get project_id --
    imp = db.query_one(
      "SELECT project_id FROM import_log WHERE import_id = %s",
      [import_id]
    )
    if not imp:
      raise Exception(f"Import {import_id} not found")
    project_id = imp["project_id"]

    # -- Read all staged chunks and reassemble --
    _progress("Reading uploaded file...")
    chunks = db.query("""
            SELECT content FROM import_staging
            WHERE import_id = %s
            ORDER BY chunk_seq
        """, [import_id])

    if not chunks:
      raise Exception("No uploaded data found in staging")

    file_content = "".join(c["content"] for c in chunks)
    _progress(f"Parsing XER ({len(file_content):,} characters)...")

    # -- Parse XER --
    parsed = _parse_xer_content(file_content)
    del file_content  # free memory

    if parsed["error"]:
      raise Exception(parsed["error"])

      # -- Update header info --
    xer_info = parsed.get("xer_info", {})
    db.execute("""
            UPDATE import_log
            SET data_date = %s, xer_version = %s, export_user = %s
            WHERE import_id = %s
        """, [xer_info.get("data_date"), xer_info.get("version"),
              xer_info.get("export_user"), import_id])

    # -- Cache existing schema (2 queries) --
    _progress("Checking database schema...")
    existing_tables = set()
    for r in db.query(
      "SELECT table_name FROM information_schema.tables "
      "WHERE table_schema = 'public'"
    ):
      existing_tables.add(r["table_name"])

    existing_columns = {}
    for r in db.query(
      "SELECT table_name, column_name "
      "FROM information_schema.columns "
      "WHERE table_schema = 'public'"
    ):
      t = r["table_name"]
      if t not in existing_columns:
        existing_columns[t] = set()
      existing_columns[t].add(r["column_name"].lower())

      # -- Process each table --
    total_records = 0
    summary_parts = []
    tables_done = 0
    tables_total = len(parsed["tables"])

    for table_name, table_data in parsed["tables"].items():
      columns = table_data["columns"]
      rows = table_data["rows"]
      if not columns or not rows:
        continue

      tables_done += 1
      _progress(f"Inserting {table_name} ({len(rows)} rows) "
                f"[{tables_done}/{tables_total}]...")

      safe_name = table_name.lower()
      db_table = f"p6_{safe_name}"
      safe_cols = [c.lower().strip() for c in columns if c.strip()]

      # Ensure table
      if db_table not in existing_tables:
        db.create_p6_table(table_name, columns)
        existing_tables.add(db_table)
      else:
        # Add missing columns
        known = existing_columns.get(db_table, set())
        for col in safe_cols:
          if col and col not in known:
            try:
              db.execute(
                f'ALTER TABLE "{db_table}" '
                f'ADD COLUMN IF NOT EXISTS '
                f'"{col}" TEXT'
              )
            except Exception:
              pass
            known.add(col)

            # Build INSERT
      all_cols = ["import_id", "project_id"] + safe_cols
      col_str = ", ".join([f'"{c}"' for c in all_cols])
      placeholders = ", ".join(["%s"] * len(all_cols))
      sql = (f'INSERT INTO "{db_table}" ({col_str}) '
             f'VALUES ({placeholders})')

      params_list = []
      for row in rows:
        padded = list(row)
        while len(padded) < len(safe_cols):
          padded.append(None)
        padded = padded[:len(safe_cols)]
        padded = [v if v else None for v in padded]
        params_list.append(
          tuple([import_id, project_id] + padded)
        )

      db.execute_batch(sql, params_list, page_size=1000)

      total_records += len(params_list)
      summary_parts.append(f"{table_name}: {len(params_list)}")

      # -- Mark completed --
    db.execute("""
            UPDATE import_log
            SET import_status = 'completed',
                record_count = %s,
                table_summary = %s,
                status_message = 'Complete'
            WHERE import_id = %s
        """, [total_records, "; ".join(summary_parts), import_id])

    # -- Clean up staging --
    _progress("Cleaning up...")
    db.execute(
      "DELETE FROM import_staging WHERE import_id = %s",
      [import_id]
    )

    # -- Audit --
    db.log_audit(
      user["user_id"], "import_xer",
      f"Imported {total_records} records across "
      f"{tables_done} tables",
      project_id
    )

  except Exception as e:
    try:
      db.execute(
        "UPDATE import_log SET import_status = 'failed', "
        "status_message = %s WHERE import_id = %s",
        [str(e), import_id]
      )
    except Exception:
      pass


# ===========================================================================
#  INTERNAL: Parse XER content
# ===========================================================================

def _parse_xer_content(file_content):
  """Parse raw XER text into structured data. Skips POBS table."""
  parsed = {"xer_info": {}, "tables": {}, "error": None}

  if not file_content or not file_content.strip():
    parsed["error"] = "Empty file content"
    return parsed

  current_table = None
  current_columns = []
  skip_table = False

  for line in file_content.splitlines():
    line = line.replace("\r", "")
    if not line.strip():
      continue

    fields = line.split("\t")
    marker = fields[0].strip()

    if marker == "ERMHDR":
      parsed["xer_info"]["version"] = (
        fields[1].strip() if len(fields) > 1 else "")
      parsed["xer_info"]["data_date"] = (
        _parse_date(fields[2].strip()) if len(fields) > 2 else None)
      parsed["xer_info"]["export_user"] = (
        fields[5].strip() if len(fields) > 5 else "")

    elif marker == "%T":
      if len(fields) > 1:
        tname = fields[1].strip()
        # Skip POBS (useless, causes massive bloat)
        if tname.upper() == "POBS":
          skip_table = True
          current_table = None
          continue
        skip_table = False
        current_table = tname
        current_columns = []
        if current_table not in parsed["tables"]:
          parsed["tables"][current_table] = {
            "columns": [], "rows": []
          }

    elif marker == "%F" and not skip_table:
      if current_table and len(fields) > 1:
        current_columns = [
          f.strip() for f in fields[1:] if f.strip()
        ]
        parsed["tables"][current_table]["columns"] = (
          current_columns
        )

    elif marker == "%R" and not skip_table:
      if current_table and current_columns:
        row_values = []
        for i in range(1, len(fields)):
          val = fields[i].strip() if i < len(fields) else ""
          row_values.append(val if val else None)
        while len(row_values) < len(current_columns):
          row_values.append(None)
        row_values = row_values[:len(current_columns)]
        parsed["tables"][current_table]["rows"].append(
          row_values
        )

    elif marker == "%E":
      break

  return parsed


def _parse_date(date_str):
  if not date_str:
    return None
  for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d",
              "%d-%b-%y", "%d-%b-%Y"):
    try:
      return datetime.strptime(date_str, fmt)
    except ValueError:
      continue
  return None