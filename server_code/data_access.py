"""
===============================================================================
 MODULE: data_access.py
 Description:  Data retrieval endpoints for the Excel Gantt chart front-end.
               Queries P6 tables (PROJWBS, TASK, ACTVCODE, UDFVALUE, etc.)
               and returns structured data that VBA can consume as 2D arrays.

 HTTP Endpoints (called by VBA via HTTPS POST):
   /_/api/get_gantt_data     - main dataset: WBS tree + tasks + column data
                                Also returns activity detail cache for the
                                frmActivityDetails form (predecessors,
                                successors, codes, UDFs, notebooks, general
                                and status fields per activity).
   /_/api/get_activity_codes - activity code types and values for filtering
   /_/api/get_calendars      - calendar definitions
   /_/api/get_import_info    - metadata about the current import

 All endpoints require a valid session token and check OBS-based access.

 Architecture Notes:
   - WBS hierarchy is built by querying p6_projwbs and traversing depth-first
     using seq_num for sibling ordering and proj_node_flag='Y' for root
   - Tasks are indexed by wbs_id for fast lookup during traversal
   - Activity codes and UDFs are pre-fetched into lookup dicts to avoid
     per-row queries
   - Predecessor/successor relationships, notebook entries, and other detail
     data are pre-fetched and returned as a separate "detail_cache" dict
     keyed by task_id so VBA can serve frmActivityDetails instantly without
     round-tripping back to the server
   - Response payload uses pipe-delimited flat strings instead of JSON arrays
     to avoid VBA JSON parsing issues with multi-MB responses

 Performance Optimizations (v2):
   - Combined project query: proj_id + critical_path_type in one SELECT
   - task_lookup built during initial task indexing pass (no second loop)
   - Timescale date range via SQL MIN/MAX (eliminates ~376K strptime calls)
   - _date_to_col() accepts native date/datetime objects (no str->parse)
   - _format_date() fast-path for native date/datetime (no format guessing)
   - _build_task_row() passes native date objects directly (no str() wrapper)
   - _to_native_date() helper for safe date conversion with type checking
===============================================================================
"""

import anvil.server
import json
from datetime import datetime, date, timedelta
from . import db
from . import auth


# ===========================================================================
#  LOCAL QUERY HELPER
#  The db.query() function uses a @_with_connection decorator that opens
#  and closes its own connection per call.  For endpoints that need multiple
#  queries on one connection (like get_gantt_data with ~10 queries), we
#  use db.get_connection() directly and run queries with this helper.
# ===========================================================================

def _query(conn, sql, params=None):
  """
  Execute a SELECT on an existing connection.  Returns list of dicts.
  Bypasses db.query()'s decorator so we reuse one connection.
  """
  import psycopg2.extras
  with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
    cur.execute(sql, params or [])
    rows = cur.fetchall()
    return [dict(row) for row in rows]


# ===========================================================================
#  HTTP ENDPOINT HELPERS
#  NOTE: Anvil's HttpResponse does NOT accept content_type= keyword.
#        Use headers={"Content-Type": ...} instead.
# ===========================================================================

def _success_response(data_dict):
  """Build a standard success JSON response."""
  data_dict["status"] = "ok"
  return anvil.server.HttpResponse(
    200,
    json.dumps(data_dict, default=str),
    headers={"Content-Type": "application/json"}
  )


def _error_response(message, status_code=400):
  """Build a standard error JSON response."""
  return anvil.server.HttpResponse(
    status_code,
    json.dumps({"status": "error", "message": str(message)}),
    headers={"Content-Type": "application/json"}
  )


# ===========================================================================
#  DATE HELPERS
#  OPTIMIZATION: psycopg2 returns native date/datetime objects from
#  PostgreSQL.  These helpers detect native types first and only fall
#  back to string parsing when necessary.  This eliminates hundreds of
#  thousands of unnecessary strptime calls on large datasets.
# ===========================================================================

def _to_native_date(val):
  """
  Convert a value to a Python date object.  Handles:
    - None -> None
    - datetime.date -> pass through
    - datetime.datetime -> .date()
    - string "YYYY-MM-DD..." -> parse (fallback only, rare with psycopg2)
  """
  if val is None:
    return None
  if isinstance(val, date) and not isinstance(val, datetime):
    return val
  if isinstance(val, datetime):
    return val.date()
  # String fallback (shouldn't happen with psycopg2, but defensive)
  try:
    return datetime.strptime(str(val)[:10], "%Y-%m-%d").date()
  except (ValueError, TypeError):
    return None


def _format_date(val):
  """
  Format a date value as MM/DD/YYYY for Excel display.
  OPTIMIZATION: Detects native date/datetime objects first and calls
  strftime directly.  Only falls back to string parsing for unexpected
  formats.  With psycopg2, the fast path handles 99%+ of calls.
  """
  if val is None:
    return ""
  # -- Native datetime: fast path (most common from psycopg2) --
  if isinstance(val, datetime):
    return val.strftime("%m/%d/%Y")
  # -- Native date: fast path --
  if isinstance(val, date):
    return val.strftime("%m/%d/%Y")
  # -- String: slow path (fallback) --
  s = str(val)
  if not s or s == "None":
    return ""
  for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
              "%Y-%m-%d", "%d-%b-%y", "%d-%b-%Y"):
    try:
      dt = datetime.strptime(s[:19], fmt)
      return dt.strftime("%m/%d/%Y")
    except ValueError:
      continue
  return s


# ===========================================================================
#  DEFAULT COLUMN CONFIGURATION
#  These are the standard Gantt chart columns.  VBA can override by sending
#  a custom column_config in the POST body.
#
#  Column types:
#    source="TASK"     - direct field from p6_task table
#    source="PROJWBS"  - field from p6_projwbs table
#    source="ACTVCODE" - activity code (field = code type name)
#    source="UDF"      - user defined field (field = udf type name)
#    source="CALC"     - calculated field (computed server-side)
#
#  Special column flags:
#    "is_checkbox": true  - VBA renders as a checkbox column
#    "duration_field": true - value is in hours, VBA converts to days
# ===========================================================================

def _default_columns():
  """
  Return the default set of columns for the Gantt chart.
  Matches user spec: Activity ID, Activity Name, Orig Dur, Rem Dur,
  Start Date, AS checkbox, Finish Date, AF checkbox, Total Float.
  """
  return [
    {
      "source": "TASK",
      "field": "task_code",
      "label": "Activity ID",
      "width": 14
    },
    {
      "source": "TASK",
      "field": "task_name",
      "label": "Activity Name",
      "width": 40
    },
    {
      "source": "TASK",
      "field": "target_drtn_hr_cnt",
      "label": "Orig Dur",
      "width": 9,
      "duration_field": True
    },
    {
      "source": "TASK",
      "field": "remain_drtn_hr_cnt",
      "label": "Rem Dur",
      "width": 9,
      "duration_field": True
    },
    {
      "source": "CALC",
      "field": "start_date",
      "label": "Start Date",
      "width": 12,
      "is_date": True
    },
    {
      "source": "CALC",
      "field": "actual_start_flag",
      "label": "AS",
      "width": 4,
      "is_checkbox": True
    },
    {
      "source": "CALC",
      "field": "finish_date",
      "label": "Finish Date",
      "width": 12,
      "is_date": True
    },
    {
      "source": "CALC",
      "field": "actual_finish_flag",
      "label": "AF",
      "width": 4,
      "is_checkbox": True
    },
    {
      "source": "TASK",
      "field": "total_float_hr_cnt",
      "label": "Total Float",
      "width": 10,
      "duration_field": True
    },
  ]


# ===========================================================================
#  HELPER: Get calendar hours/day lookup
#  Returns dict of {clndr_id: hours_per_day} for converting hour-based
#  durations to days.
# ===========================================================================

def _get_calendar_hours_map(conn, import_id):
  """
  Build a lookup dict of calendar_id -> hours_per_day.
  Uses day_hr_cnt from p6_calendar table.
  Falls back to 8.0 if not found.
  """
  cal_map = {}
  try:
    rows = _query(
      conn,
      "SELECT clndr_id, day_hr_cnt FROM p6_calendar WHERE import_id = %s",
      [import_id]
    )
    for row in rows:
      clndr_id = row.get("clndr_id", "")
      hrs = row.get("day_hr_cnt")
      try:
        cal_map[clndr_id] = float(hrs) if hrs else 8.0
      except (ValueError, TypeError):
        cal_map[clndr_id] = 8.0
  except Exception:
    pass
  return cal_map


# ===========================================================================
#  HELPER: Build activity code lookup
#  Returns dict of {task_id: {code_type_name: code_value_short_name}}
# ===========================================================================

def _get_activity_code_map(conn, import_id):
  """
  Pre-fetch all activity code assignments for this import.
  Joins TASKACTV -> ACTVCODE -> ACTVTYPE to get human-readable names.
  Returns nested dict: {task_id: {type_name: value_short_name, ...}, ...}
  """
  code_map = {}
  try:
    sql = """
          SELECT ta.task_id,
                  at2.actv_code_type AS type_name,
                  ac.short_name AS value_name,
                  ac.actv_code_name AS value_description
          FROM p6_taskactv ta
          JOIN p6_actvcode ac
            ON ac.actv_code_id = ta.actv_code_id
            AND ac.import_id = ta.import_id
          JOIN p6_actvtype at2
            ON at2.actv_code_type_id = ac.actv_code_type_id
            AND at2.import_id = ta.import_id
          WHERE ta.import_id = %s
      """
    rows = _query(conn, sql, [import_id])
    for row in rows:
      tid = row["task_id"]
      tname = row["type_name"]
      vname = row["value_name"] or ""
      if tid not in code_map:
        code_map[tid] = {}
      code_map[tid][tname] = vname
  except Exception:
    pass
  return code_map


# ===========================================================================
#  HELPER: Build UDF lookup
#  Returns dict of {task_id: {udf_type_label: value_string}}
# ===========================================================================

def _get_udf_map(conn, import_id):
  """
  Pre-fetch all UDF values for tasks in this import.
  Joins UDFVALUE -> UDFTYPE to get the UDF label.
  Handles multiple UDF data types (text, number, date, code_id).
  Returns nested dict: {task_id: {udf_label: display_value, ...}, ...}
  """
  udf_map = {}
  try:
    sql = """
          SELECT uv.fk_id AS task_id,
                  ut.udf_type_label,
                  uv.udf_text,
                  uv.udf_number,
                  uv.udf_date,
                  uv.udf_code_id
          FROM p6_udfvalue uv
          JOIN p6_udftype ut
            ON ut.udf_type_id = uv.udf_type_id
            AND ut.import_id = uv.import_id
          WHERE uv.import_id = %s
            AND ut.table_name = 'TASK'
      """
    rows = _query(conn, sql, [import_id])
    for row in rows:
      tid = row["task_id"]
      label = row["udf_type_label"] or ""
      # -- Determine display value from whichever field is populated --
      val = ""
      if row.get("udf_text"):
        val = str(row["udf_text"])
      elif row.get("udf_number") is not None:
        val = str(row["udf_number"])
      elif row.get("udf_date"):
        val = str(row["udf_date"])
      elif row.get("udf_code_id"):
        val = str(row["udf_code_id"])
      if tid not in udf_map:
        udf_map[tid] = {}
      udf_map[tid][label] = val
  except Exception:
    pass
  return udf_map


# ===========================================================================
#  HELPER: Build predecessor/successor lookup for detail cache
#  Returns dict of {task_id: {"predecessors": [...], "successors": [...]}}
# ===========================================================================

def _get_relationship_map(conn, import_id, cal_map):
  """
  Pre-fetch all task relationships (TASKPRED) for this import.
  For each relationship, includes: related task_id, task_code, task_name,
  relationship type (FS/FF/SS/SF), lag in days, relationship free float,
  and driving flag (rel_free_float == 0).

  Lag and free float are converted from hours to days using the
  predecessor's calendar.

  Returns nested dict:
    {task_id: {"predecessors": [list of dicts], "successors": [list of dicts]}}
  """
  rel_map = {}
  try:
    # -- Query relationships with task info for both pred and succ sides --
    sql = """
            SELECT tp.task_id AS succ_task_id,
                   tp.pred_task_id,
                   tp.pred_type,
                   tp.lag_hr_cnt,
                   tp.float_path,
                   t_pred.task_code AS pred_task_code,
                   t_pred.task_name AS pred_task_name,
                   t_pred.clndr_id AS pred_clndr_id,
                   t_succ.task_code AS succ_task_code,
                   t_succ.task_name AS succ_task_name
            FROM p6_taskpred tp
            JOIN p6_task t_pred
              ON t_pred.task_id = tp.pred_task_id
             AND t_pred.import_id = tp.import_id
            JOIN p6_task t_succ
              ON t_succ.task_id = tp.task_id
             AND t_succ.import_id = tp.import_id
            WHERE tp.import_id = %s
        """
    rows = _query(conn, sql, [import_id])

    for row in rows:
      succ_id = row["succ_task_id"]
      pred_id = row["pred_task_id"]

      # -- Convert P6 pred_type codes (PR_FS, PR_FF, etc.) to short form --
      raw_type = (row.get("pred_type") or "")
      rel_type = raw_type.replace("PR_", "") if raw_type.startswith("PR_") else raw_type

      # -- Convert lag from hours to days using predecessor's calendar --
      pred_cal = row.get("pred_clndr_id", "")
      hrs_per_day = cal_map.get(pred_cal, 8.0)
      lag_hrs = row.get("lag_hr_cnt") or 0
      try:
        lag_days = round(float(lag_hrs) / hrs_per_day, 1)
      except (ValueError, TypeError, ZeroDivisionError):
        lag_days = 0

      # -- Relationship free float (float_path from TASKPRED) --
      # Note: P6 stores this in hours; convert to days
      ff_hrs = row.get("float_path") or 0
      try:
        rel_ff_days = round(float(ff_hrs) / hrs_per_day, 1)
      except (ValueError, TypeError, ZeroDivisionError):
        rel_ff_days = 0

      is_driving = (rel_ff_days == 0)

      # -- Build predecessor entry (from successor's perspective) --
      pred_entry = {
        "task_id": pred_id,
        "task_code": row.get("pred_task_code", ""),
        "task_name": row.get("pred_task_name", ""),
        "rel_type": rel_type,
        "lag_days": lag_days,
        "rel_ff_days": rel_ff_days,
        "driving": is_driving
      }

      # -- Build successor entry (from predecessor's perspective) --
      succ_entry = {
        "task_id": succ_id,
        "task_code": row.get("succ_task_code", ""),
        "task_name": row.get("succ_task_name", ""),
        "rel_type": rel_type,
        "lag_days": lag_days,
        "rel_ff_days": rel_ff_days,
        "driving": is_driving
      }

      # -- Add to successor's predecessor list --
      if succ_id not in rel_map:
        rel_map[succ_id] = {"predecessors": [], "successors": []}
      rel_map[succ_id]["predecessors"].append(pred_entry)

      # -- Add to predecessor's successor list --
      if pred_id not in rel_map:
        rel_map[pred_id] = {"predecessors": [], "successors": []}
      rel_map[pred_id]["successors"].append(succ_entry)

  except Exception:
    pass
  return rel_map


# ===========================================================================
#  HELPER: Build activity code detail lookup (full detail for Codes tab)
#  Returns dict of {task_id: [[type_name, value_name, description], ...]}
# ===========================================================================

def _get_code_detail_map(conn, import_id):
  """
  Pre-fetch full activity code detail for the Codes tab of
  frmActivityDetails.  Returns all three columns: code type name,
  selected value short_name, and value description.
  """
  detail_map = {}
  try:
    sql = """
          SELECT ta.task_id,
                  at2.actv_code_type AS type_name,
                  ac.short_name AS value_name,
                  ac.actv_code_name AS description
          FROM p6_taskactv ta
          JOIN p6_actvcode ac
            ON ac.actv_code_id = ta.actv_code_id
            AND ac.import_id = ta.import_id
          JOIN p6_actvtype at2
            ON at2.actv_code_type_id = ac.actv_code_type_id
            AND at2.import_id = ta.import_id
          WHERE ta.import_id = %s
          ORDER BY at2.actv_code_type
      """
    rows = _query(conn, sql, [import_id])
    for row in rows:
      tid = row["task_id"]
      entry = [
        row.get("type_name", ""),
        row.get("value_name", ""),
        row.get("description", "")
      ]
      if tid not in detail_map:
        detail_map[tid] = []
      detail_map[tid].append(entry)
  except Exception:
    pass
  return detail_map


# ===========================================================================
#  HELPER: Build notebook lookup
#  Returns dict of {task_id: [[topic_name, content_text], ...]}
# ===========================================================================

def _get_notebook_map(conn, import_id):
  """
  Pre-fetch notebook (TASKMEMO) entries for the Notebook tab.
  Joins TASKMEMO -> MEMOTYPE to get the topic name.
  HTML tags are stripped server-side for clean display.
  """
  nb_map = {}
  try:
    sql = """
          SELECT tm.task_id,
                  COALESCE(mt.memo_type, tm.memo_type_id) AS topic_name,
                  tm.task_memo AS content
          FROM p6_taskmemo tm
          LEFT JOIN p6_memotype mt
            ON mt.memo_type_id = tm.memo_type_id
            AND mt.import_id = tm.import_id
          WHERE tm.import_id = %s
      """
    rows = _query(conn, sql, [import_id])
    for row in rows:
      tid = row["task_id"]
      topic = row.get("topic_name", "")
      content = _strip_html(row.get("content", "") or "")
      if tid not in nb_map:
        nb_map[tid] = []
      nb_map[tid].append([topic, content])
  except Exception:
    pass
  return nb_map


def _strip_html(html_str):
  """
  Basic HTML tag stripper for notebook content.
  Converts common HTML entities and tags to plain text equivalents.
  """
  if not html_str:
    return ""
  s = html_str
  # -- Replace common entities --
  s = s.replace("&amp;", "&")
  s = s.replace("&lt;", "<")
  s = s.replace("&gt;", ">")
  s = s.replace("&nbsp;", " ")
  s = s.replace("&quot;", '"')
  # -- Replace line-break tags with newlines --
  for br_tag in ["<br>", "<br/>", "<br />", "<BR>", "<BR/>", "<BR />"]:
    s = s.replace(br_tag, "\n")
  for p_tag in ["<p>", "<P>"]:
    s = s.replace(p_tag, "\n")
  for close_tag in ["</p>", "</P>"]:
    s = s.replace(close_tag, "")
  # -- Strip remaining tags --
  result = []
  in_tag = False
  for ch in s:
    if ch == "<":
      in_tag = True
    elif ch == ">":
      in_tag = False
    elif not in_tag:
      result.append(ch)
  return "".join(result).strip()


# ===========================================================================
#  HELPER: Build UDF detail lookup (full detail for UDFs tab)
#  Returns dict of {task_id: [[udf_label, display_value], ...]}
# ===========================================================================

def _get_udf_detail_map(conn, import_id):
  """
  Pre-fetch full UDF detail for the UDFs tab of frmActivityDetails.
  Handles multiple data types (text, number, date, code_id, integer, cost).
  """
  detail_map = {}
  try:
    sql = """
          SELECT uv.fk_id AS task_id,
                  ut.udf_type_label,
                  ut.logical_data_type,
                  uv.udf_text,
                  uv.udf_number,
                  uv.udf_date,
                  uv.udf_code_id
          FROM p6_udfvalue uv
          JOIN p6_udftype ut
            ON ut.udf_type_id = uv.udf_type_id
            AND ut.import_id = uv.import_id
          WHERE uv.import_id = %s
            AND ut.table_name = 'TASK'
          ORDER BY ut.udf_type_label
      """
    rows = _query(conn, sql, [import_id])
    for row in rows:
      tid = row["task_id"]
      label = row.get("udf_type_label", "")
      # -- Pick value from whichever typed field is populated --
      val = ""
      data_type = (row.get("logical_data_type") or "").upper()
      if data_type in ("UDF_DT_TEXT", "TEXT"):
        val = str(row.get("udf_text") or "")
      elif data_type in ("UDF_DT_DOUBLE", "UDF_DT_INTEGER", "UDF_DT_COST",
                         "DOUBLE", "INTEGER", "COST"):
        val = str(row.get("udf_number") or "")
      elif data_type in ("UDF_DT_START_DATE", "UDF_DT_FINISH_DATE", "DATE"):
        val = str(row.get("udf_date") or "")
      elif data_type in ("UDF_DT_CODE", "CODE"):
        val = str(row.get("udf_code_id") or "")
      else:
        # Fallback: try each field
        val = str(row.get("udf_text") or
                  row.get("udf_number") or
                  row.get("udf_date") or
                  row.get("udf_code_id") or "")
      if tid not in detail_map:
        detail_map[tid] = []
      detail_map[tid].append([label, val])
  except Exception:
    pass
  return detail_map


# ===========================================================================
#  HELPER: Build general/status detail lookup
#  Returns dict of {task_id: {field: value, ...}} with all fields needed
#  for the General and Status tabs of frmActivityDetails.
# ===========================================================================

def _to_days(hr_val, hrs_per_day):
  """Convert a duration in hours to days. Returns None if empty/invalid."""
  if hr_val is None:
    return None
  try:
    return round(float(hr_val) / hrs_per_day, 1)
  except (ValueError, TypeError, ZeroDivisionError):
    return None


def _get_task_detail_map(conn, import_id, cal_map):
  """
  Pre-fetch extended task fields for the General and Status tabs.
  Includes calendar name, activity type, duration type, percent complete
  type, all duration fields, float fields, dates, and actual flags.

  Duration/float values are converted from hours to days using the
  task's assigned calendar.
  """
  detail_map = {}
  try:
    sql = """
          SELECT t.task_id,
                  t.clndr_id,
                  c.clndr_name,
                  t.task_type,
                  t.duration_type,
                  t.complete_pct_type,
                  t.phys_complete_pct,
                  t.target_drtn_hr_cnt,
                  t.act_drtn_hr_cnt,
                  t.remain_drtn_hr_cnt,
                  t.at_comp_drtn_hr_cnt,
                  t.total_float_hr_cnt,
                  t.free_float_hr_cnt,
                  t.target_start_date,
                  t.target_end_date,
                  t.act_start_date,
                  t.act_end_date,
                  t.early_start_date,
                  t.early_end_date,
                  t.late_start_date,
                  t.late_end_date,
                  t.status_code
          FROM p6_task t
          LEFT JOIN p6_calendar c
            ON c.clndr_id = t.clndr_id
            AND c.import_id = t.import_id
          WHERE t.import_id = %s
      """
    rows = _query(conn, sql, [import_id])
    for row in rows:
      tid = row["task_id"]
      cal_id = row.get("clndr_id", "")
      hrs_per_day = cal_map.get(cal_id, 8.0)

      # -- Determine display start/finish dates --
      act_start = row.get("act_start_date")
      act_finish = row.get("act_end_date")
      start_date = act_start if act_start else row.get("early_start_date") or row.get("target_start_date")
      finish_date = act_finish if act_finish else row.get("early_end_date") or row.get("target_end_date")

      detail_map[tid] = {
        "calendar_name": row.get("clndr_name", ""),
        "task_type": _format_task_type(row.get("task_type", "")),
        "duration_type": _format_duration_type(row.get("duration_type", "")),
        "complete_pct_type": _format_pct_type(row.get("complete_pct_type", "")),
        "phys_complete_pct": row.get("phys_complete_pct"),
        "orig_dur_days": _to_days(row.get("target_drtn_hr_cnt"), hrs_per_day),
        "act_dur_days": _to_days(row.get("act_drtn_hr_cnt"), hrs_per_day),
        "rem_dur_days": _to_days(row.get("remain_drtn_hr_cnt"), hrs_per_day),
        "at_comp_dur_days": _to_days(row.get("at_comp_drtn_hr_cnt"), hrs_per_day),
        "total_float_days": _to_days(row.get("total_float_hr_cnt"), hrs_per_day),
        "free_float_days": _to_days(row.get("free_float_hr_cnt"), hrs_per_day),
        "start_date": str(start_date) if start_date else "",
        "finish_date": str(finish_date) if finish_date else "",
        "act_start_date": str(act_start) if act_start else "",
        "act_end_date": str(act_finish) if act_finish else "",
        "target_start_date": str(row.get("target_start_date") or ""),
        "target_end_date": str(row.get("target_end_date") or ""),
        "early_start_date": str(row.get("early_start_date") or ""),
        "early_end_date": str(row.get("early_end_date") or ""),
        "late_start_date": str(row.get("late_start_date") or ""),
        "late_end_date": str(row.get("late_end_date") or ""),
        "has_actual_start": bool(act_start),
        "has_actual_finish": bool(act_finish),
        "status_code": row.get("status_code", ""),
      }
  except Exception:
    pass
  return detail_map


def _format_task_type(code):
  """Convert P6 task_type codes to human-readable names."""
  mapping = {
    "TT_Task": "Task Dependent",
    "TT_Rsrc": "Resource Dependent",
    "TT_Mile": "Level of Effort",
    "TT_LOE": "Level of Effort",
    "TT_FinMile": "Finish Milestone",
    "TT_StartMile": "Start Milestone",
    "TT_WBS": "WBS Summary",
  }
  return mapping.get(code, code or "")


def _format_duration_type(code):
  """Convert P6 duration_type codes to human-readable names."""
  mapping = {
    "DT_FixedDUR": "Fixed Duration & Units",
    "DT_FixedDrtn": "Fixed Duration & Units/Time",
    "DT_FixedRate": "Fixed Units/Time",
    "DT_FixedQty": "Fixed Units",
  }
  return mapping.get(code, code or "")


def _format_pct_type(code):
  """Convert P6 complete_pct_type codes to human-readable names."""
  mapping = {
    "CP_Drtn": "Duration",
    "CP_Units": "Units",
    "CP_Phys": "Physical",
  }
  return mapping.get(code, code or "")


# ===========================================================================
#  WBS TREE BUILDER
# ===========================================================================

def _build_wbs_tree(conn, import_id, proj_id):
  """
  Query p6_projwbs and build a hierarchical tree structure.
  Root node is identified by proj_node_flag = 'Y'.
  Children are sorted by seq_num within each parent.

  Returns: (root_node, all_nodes_dict)
    root_node: dict with "children" list, each child is also a dict
    all_nodes_dict: flat dict of {wbs_id: node_dict} for fast lookup
  """
  sql = """
      SELECT wbs_id, parent_wbs_id, wbs_short_name, wbs_name,
              seq_num, proj_node_flag, obs_id
      FROM p6_projwbs
      WHERE import_id = %s AND proj_id = %s
      ORDER BY seq_num
  """
  rows = _query(conn, sql, [import_id, proj_id])

  nodes = {}
  root = None

  # -- First pass: create all nodes --
  for row in rows:
    wbs_id = row["wbs_id"]
    nodes[wbs_id] = {
      "wbs_id": wbs_id,
      "parent_wbs_id": row.get("parent_wbs_id"),
      "wbs_short_name": row.get("wbs_short_name", ""),
      "wbs_name": row.get("wbs_name", ""),
      "seq_num": row.get("seq_num", 0),
      "proj_node_flag": row.get("proj_node_flag", "N"),
      "children": []
    }
    if row.get("proj_node_flag") == "Y":
      root = nodes[wbs_id]

  # -- Second pass: link children to parents --
  for wbs_id, node in nodes.items():
    parent_id = node["parent_wbs_id"]
    if parent_id and parent_id in nodes and node is not root:
      nodes[parent_id]["children"].append(node)

  # -- Sort children by seq_num at every level --
  def _sort_children(node):
    node["children"].sort(key=lambda n: n.get("seq_num", 0))
    for child in node["children"]:
      _sort_children(child)

  if root:
    _sort_children(root)

  return root, nodes


# ===========================================================================
#  WBS TREE TRAVERSAL (depth-first)
# ===========================================================================

def _traverse_wbs(node, tasks_by_wbs, columns, code_map, udf_map,
                  cal_map, depth=0):
  """
  Depth-first traversal of WBS tree, producing rows in display order.

  For each WBS node, emits a WBS summary row, then all tasks under that
  WBS node, then recurses into child WBS nodes.

  Args:
      node:          Current WBS node dict
      tasks_by_wbs:  Dict of {wbs_id: [list of task row dicts]}
      columns:       List of column config dicts
      code_map:      Activity code lookup {task_id: {type: value}}
      udf_map:       UDF lookup {task_id: {label: value}}
      cal_map:       Calendar hours/day lookup {clndr_id: hours}
      depth:         Current indent depth (0 = root)

  Returns:
      List of tuples: (row_data_list, row_type, indent_level, task_id)
      row_type is "WBS" or "TASK"
      task_id is the P6 task_id string for TASK rows, empty for WBS rows
  """
  result_rows = []

  # -- Emit WBS summary row (skip the root project node at depth 0) --
  if depth > 0:
    wbs_row = []
    for col in columns:
      if col["field"] == "task_code":
        wbs_row.append(node.get("wbs_short_name", ""))
      elif col["field"] == "task_name":
        wbs_row.append(node.get("wbs_name", ""))
      else:
        wbs_row.append("")
    result_rows.append((wbs_row, "WBS", depth, ""))

  # -- Emit task rows under this WBS node --
  wbs_tasks = tasks_by_wbs.get(node["wbs_id"], [])
  for task in wbs_tasks:
    task_row = _build_task_row(task, columns, code_map, udf_map, cal_map)
    tid = str(task.get("task_id", ""))
    result_rows.append((task_row, "TASK", depth + 1 if depth > 0 else 1, tid))
    # -- Blank row after each task (reserved for baseline bar) --
    blank_row = [""] * len(columns)
    result_rows.append((blank_row, "BLANK", depth + 1 if depth > 0 else 1, ""))

  # -- Recurse into children --
  for child in node.get("children", []):
    child_rows = _traverse_wbs(child, tasks_by_wbs, columns,
                               code_map, udf_map, cal_map, depth + 1)
    result_rows.extend(child_rows)

  return result_rows


def _build_task_row(task, columns, code_map, udf_map, cal_map):
  """
  Build a single task's data row based on the column configuration.
  Handles TASK fields, CALC fields, ACTVCODE lookups, and UDF lookups.
  Duration fields are converted from hours to days.

  OPTIMIZATION: CALC date fields pass native date/datetime objects
  directly to _format_date() instead of wrapping in str() first.
  """
  tid = task.get("task_id", "")
  cal_id = task.get("clndr_id", "")
  hrs_per_day = cal_map.get(cal_id, 8.0)

  # -- Determine display dates (native date objects from psycopg2) --
  act_start = task.get("act_start_date")
  act_finish = task.get("act_end_date")
  display_start = act_start or task.get("early_start_date") or task.get("target_start_date")
  display_finish = act_finish or task.get("early_end_date") or task.get("target_end_date")

  row = []
  for col in columns:
    source = col.get("source", "TASK")
    field = col.get("field", "")
    is_duration = col.get("duration_field", False)
    is_checkbox = col.get("is_checkbox", False)
    is_date = col.get("is_date", False)

    val = ""

    if source == "TASK":
      val = task.get(field, "")
      if is_duration and val is not None and val != "":
        try:
          val = round(float(val) / hrs_per_day, 1)
        except (ValueError, TypeError, ZeroDivisionError):
          val = ""
      elif is_date:
        val = _format_date(val)

    elif source == "CALC":
      if field == "start_date":
        # OPTIMIZATION #6: pass native object directly, not str(...)
        val = _format_date(display_start) if display_start else ""
      elif field == "finish_date":
        val = _format_date(display_finish) if display_finish else ""
      elif field == "actual_start_flag":
        val = "Y" if act_start else ""
      elif field == "actual_finish_flag":
        val = "Y" if act_finish else ""

    elif source == "ACTVCODE":
      task_codes = code_map.get(tid, {})
      val = task_codes.get(field, "")

    elif source == "UDF":
      task_udfs = udf_map.get(tid, {})
      val = task_udfs.get(field, "")

    row.append(val if val is not None else "")

  return row


# ===========================================================================
#  HTTP ENDPOINT — Ping (server wake-up)
# ===========================================================================

@anvil.server.http_endpoint("/ping", methods=["POST"])
def api_ping(**kwargs):
  """Lightweight endpoint to wake the Anvil server runtime on cold starts."""
  return _success_response({"ping": "pong"})


# ===========================================================================
#  HTTP ENDPOINT — Get Gantt Data (main dataset + detail cache)
# ===========================================================================

@anvil.server.http_endpoint("/get_gantt_data", methods=["POST"])
def api_get_gantt_data(**kwargs):
  """
  Get the full Gantt chart dataset for a given project and import version.
  Returns a 2D array ordered by WBS hierarchy (depth-first, seq_num sorted),
  PLUS bar data in sparse format for Gantt bar rendering.

  POST body (JSON):
    token:          session token
    import_id:      import version ID (P6 proj_id is looked up automatically)
    column_config:  (optional) list of column dicts; uses defaults if omitted

  Response (JSON):
    status:           "ok"
    headers_flat:     pipe-delimited header labels
    widths_flat:      pipe-delimited column widths
    column_config:    the full column config used
    data_flat:        pipe-delimited rows (pipe=col, LF=row)
    row_types_flat:   pipe-delimited row types
    indent_levels_flat: pipe-delimited indent depths
    task_ids_flat:    pipe-delimited task IDs
    bar_sparse_flat:  sparse bar data (semicolons within row, LF between rows)
    bar_col_count:    total bar columns
    timescale_start:  ISO date string
    timescale_end:    ISO date string
    data_date:        ISO date string
    cols_per_week:    columns per calendar week
  """
  try:
    # -- Parse request body --
    body = anvil.server.request.body_json or {}
    token = body.get("token", "")
    import_id = body.get("import_id")
    column_config = body.get("column_config")

    # -- Validate session --
    user_info = auth.validate_session(token)
    if not user_info:
      return _error_response("Invalid or expired session", 401)

    if not import_id:
      return _error_response("import_id is required")

    # -- Use default columns if none specified --
    columns = column_config if column_config else _default_columns()

    # -- Open DB connection --
    conn = db.get_connection()
    try:
      # ==============================================================
      #  OPTIMIZATION #1: Combined project query
      #  Was TWO separate queries:
      #    SELECT proj_id FROM p6_project WHERE import_id = %s
      #    SELECT critical_path_type, critical_drtn_hr_cnt, last_recalc_date ...
      #  Now ONE query fetching everything at once.
      # ==============================================================
      proj_rows = _query(
        conn,
        """SELECT proj_id, critical_path_type, critical_drtn_hr_cnt,
                  last_recalc_date
           FROM p6_project WHERE import_id = %s LIMIT 1""",
        [import_id]
      )
      if not proj_rows:
        return _error_response("No P6 project found for this import")
      proj_info = proj_rows[0]
      project_id = proj_info["proj_id"]
      crit_type = proj_info.get("critical_path_type", "CT_TotFloat")
      crit_hrs = 0
      try:
        crit_hrs = float(proj_info.get("critical_drtn_hr_cnt") or 0)
      except (ValueError, TypeError):
        crit_hrs = 0
      data_date = _to_native_date(proj_info.get("last_recalc_date"))

      # -- Build lookup maps (one query each, not per-row) --
      cal_map = _get_calendar_hours_map(conn, import_id)
      code_map = _get_activity_code_map(conn, import_id)
      udf_map = _get_udf_map(conn, import_id)

      # -- Build WBS tree --
      root, all_wbs = _build_wbs_tree(conn, import_id, project_id)
      if not root:
        return _error_response("No WBS hierarchy found for this project")

      # ==============================================================
      #  OPTIMIZATION #2: Build task_lookup DURING initial indexing
      #  Was: build tasks_by_wbs first, then loop tasks_by_wbs AGAIN
      #  to build task_lookup.  Now done in ONE pass.
      # ==============================================================
      task_sql = """
                SELECT * FROM p6_task
                WHERE import_id = %s AND proj_id = %s
                ORDER BY task_code
            """
      task_rows = _query(conn, task_sql, [import_id, project_id])
      tasks_by_wbs = {}
      task_lookup = {}       # <-- built simultaneously, no second loop
      for t in task_rows:
        wbs_id = t.get("wbs_id", "")
        if wbs_id not in tasks_by_wbs:
          tasks_by_wbs[wbs_id] = []
        tasks_by_wbs[wbs_id].append(t)
        task_lookup[str(t.get("task_id", ""))] = t

      # -- Traverse WBS tree to build ordered data array --
      traversal = _traverse_wbs(root, tasks_by_wbs, columns,
                                code_map, udf_map, cal_map)

      # -- Unpack traversal into parallel lists --
      data_rows = []
      row_types = []
      indent_levels = []
      task_ids = []
      for (row_data, rtype, indent, tid) in traversal:
        data_rows.append(row_data)
        row_types.append(rtype)
        indent_levels.append(indent)
        task_ids.append(tid)

      # ---------------------------------------------------------------
      #  DETAIL CACHE — temporarily disabled to avoid response size
      #  limit.  Will be fetched on-demand or via separate endpoint.
      # ---------------------------------------------------------------
      detail_cache = {}

      # ---------------------------------------------------------------
      #  BAR DATA CALCULATION (SPARSE FORMAT)
      #  Instead of a full 2D array (mostly empty), we send compact
      #  bar segments per row.  Each row's bar data is a semicolon-
      #  separated list of segments:
      #    "code,startcol,endcol;code,startcol,endcol;L,col,text"
      #  where L = label (activity name after the bar).
      #  Empty rows = empty string.
      #  This reduces payload from ~50MB to ~2MB for large schedules.
      # ---------------------------------------------------------------

      # -- Near-critical definition (passed from VBA, default 10) --
      near_crit_days = int(body.get("near_critical_days", 10))

      # -- Milestone task types --
      milestone_types = {"TT_Mile", "TT_FinMile", "TT_StartMile"}

      # ==============================================================
      #  OPTIMIZATION #3: Get timescale date range from SQL MIN/MAX
      #  Was: Python loop over 47K tasks x 8 date fields doing strptime
      #  (= ~376K string-to-date conversions).
      #  Now: ONE SQL query using LEAST/GREATEST, zero Python parsing.
      # ==============================================================
      date_range_sql = """
          SELECT
            LEAST(
              MIN(act_start_date), MIN(early_start_date),
              MIN(target_start_date), MIN(restart_date)
            ) AS earliest,
            GREATEST(
              MAX(act_end_date), MAX(early_end_date),
              MAX(target_end_date), MAX(reend_date)
            ) AS latest
          FROM p6_task
          WHERE import_id = %s AND proj_id = %s
      """
      dr_rows = _query(conn, date_range_sql, [import_id, project_id])
      dr = dr_rows[0] if dr_rows else {}

      earliest = _to_native_date(dr.get("earliest"))
      latest = _to_native_date(dr.get("latest"))

      if not earliest or not latest:
        ts_start = data_date or date.today()
        ts_end = ts_start + timedelta(days=30)
      else:
        # Round to surrounding Sundays (Sunday = weekday 6)
        ts_start = earliest - timedelta(days=(earliest.weekday() + 1) % 7)
        ts_end = latest + timedelta(days=(6 - latest.weekday()) % 7)
        if ts_end <= latest:
          ts_end += timedelta(days=7)

      cols_per_week = int(body.get("cols_per_week", 7))
      total_days = (ts_end - ts_start).days
      total_bar_cols = int(total_days * cols_per_week / 7)

      # ==============================================================
      #  OPTIMIZATION #4: _date_to_col accepts native date objects
      #  Was: every call did isinstance check + str()[:10] + strptime
      #  Now: pre-computes ordinal and divisor; native dates use fast
      #  integer arithmetic with .toordinal().
      # ==============================================================
      ts_start_ordinal = ts_start.toordinal()     # pre-compute once
      cpw_div_7 = cols_per_week / 7.0             # pre-compute divisor

      def _date_to_col(d):
        """Convert a date to bar column index.  Native dates use fast path."""
        if d is None:
          return None
        # -- Native datetime -> date --
        if isinstance(d, datetime):
          return int((d.toordinal() - ts_start_ordinal) * cpw_div_7)
        # -- Native date (most common from psycopg2) --
        if isinstance(d, date):
          return int((d.toordinal() - ts_start_ordinal) * cpw_div_7)
        # -- String fallback (rare with psycopg2) --
        try:
          d2 = datetime.strptime(str(d)[:10], "%Y-%m-%d").date()
          return int((d2.toordinal() - ts_start_ordinal) * cpw_div_7)
        except (ValueError, TypeError):
          return None

      # -- Helper: determine bar color code for remaining work --
      def _remaining_code(task):
        """Determine bar code: 2=normal, 3=near-critical, 4=critical."""
        # Critical (4) overrides near-critical (3)
        if crit_type == "CT_DrivPath":
          if task.get("driving_path_flag") == "Y":
            return 4
        else:
          tf_hrs = 0
          try:
            tf_hrs = float(task.get("total_float_hr_cnt") or 0)
          except (ValueError, TypeError):
            tf_hrs = 0
          if tf_hrs <= crit_hrs:
            return 4

        # Near-critical (3)
        tf_hrs = 0
        try:
          tf_hrs = float(task.get("total_float_hr_cnt") or 0)
        except (ValueError, TypeError):
          tf_hrs = 0
        cal_id = task.get("clndr_id", "")
        hrs_per_day = cal_map.get(cal_id, 8.0)
        tf_work_days = tf_hrs / hrs_per_day if hrs_per_day > 0 else 0
        if tf_work_days <= near_crit_days:
          return 3

        return 2

      # ==============================================================
      #  Build sparse bar data: one compact string per row
      #
      #  OPTIMIZATION #5 (inside loop): Pre-convert each task's date
      #  fields to native date objects ONCE using _to_native_date(),
      #  then pass native objects to _date_to_col().
      #  Was: _date_to_col received raw values and re-parsed strings
      #  on every call (~5 calls per task = ~235K strptime calls).
      #  Now: zero strptime in the bar loop.
      # ==============================================================
      bar_sparse_rows = []

      for idx, tid in enumerate(task_ids):
        rtype = row_types[idx]

        if rtype in ("WBS", "BLANK") or not tid:
          bar_sparse_rows.append("")
          continue

        task = task_lookup.get(tid, {})
        task_name = task.get("task_name", "")
        task_type = task.get("task_type", "")
        is_milestone = task_type in milestone_types

        # -- Pre-convert dates ONCE per task (native date objects) --
        act_start = _to_native_date(task.get("act_start_date"))
        act_end = _to_native_date(task.get("act_end_date"))
        restart = _to_native_date(task.get("restart_date"))
        reend = _to_native_date(task.get("reend_date"))
        early_start = _to_native_date(task.get("early_start_date"))
        early_end = _to_native_date(task.get("early_end_date"))
        target_start = _to_native_date(task.get("target_start_date"))
        target_end = _to_native_date(task.get("target_end_date"))

        segments = []
        last_bar_col = -1

        if is_milestone:
          code = _remaining_code(task)
          if act_end:
            col = _date_to_col(act_end)
            if col is not None and 0 <= col < total_bar_cols:
              segments.append(f"M1,{col},{col}")
              last_bar_col = col
          elif act_start:
            col = _date_to_col(act_start)
            if col is not None and 0 <= col < total_bar_cols:
              segments.append(f"M1,{col},{col}")
              last_bar_col = col
          else:
            ms_date = restart or early_start or target_start
            col = _date_to_col(ms_date)
            if col is not None and 0 <= col < total_bar_cols:
              segments.append(f"M{code},{col},{col}")
              last_bar_col = col
        else:
          rem_code = _remaining_code(task)

          # Actual portion
          if act_start:
            a_start_col = _date_to_col(act_start)
            if act_end:
              a_end_col = _date_to_col(act_end)
            else:
              a_end_col = _date_to_col(data_date) if data_date else None

            if a_start_col is not None and a_end_col is not None:
              c_start = max(0, a_start_col)
              c_end = min(total_bar_cols - 1, a_end_col)
              if c_start <= c_end:
                segments.append(f"1,{c_start},{c_end}")
                last_bar_col = max(last_bar_col, c_end)

          # Forecast/remaining portion (only if not complete)
          if not act_end and restart and reend:
            r_start_col = _date_to_col(restart)
            r_end_col = _date_to_col(reend)
            if r_start_col is not None and r_end_col is not None:
              c_start = max(0, r_start_col)
              c_end = min(total_bar_cols - 1, r_end_col)
              if c_start <= c_end:
                segments.append(f"{rem_code},{c_start},{c_end}")
                last_bar_col = max(last_bar_col, c_end)

          # Not-started activities
          if not act_start:
            ns_start = restart or early_start or target_start
            ns_end = reend or early_end or target_end
            if ns_start and ns_end:
              ns_start_col = _date_to_col(ns_start)
              ns_end_col = _date_to_col(ns_end)
              if ns_start_col is not None and ns_end_col is not None:
                c_start = max(0, ns_start_col)
                c_end = min(total_bar_cols - 1, ns_end_col)
                if c_start <= c_end:
                  segments.append(f"{rem_code},{c_start},{c_end}")
                  last_bar_col = max(last_bar_col, c_end)

        # Activity name label after bar (1 col buffer)
        if last_bar_col >= 0:
          label_col = last_bar_col + 2
          if label_col < total_bar_cols:
            # Escape pipe and semicolon in task name
            safe_name = task_name.replace("|", "/").replace(";", ",")
            segments.append(f"L,{label_col},{safe_name}")

        bar_sparse_rows.append(";".join(segments))

    finally:
      conn.close()

    # -- Build response --
    headers = [c["label"] for c in columns]
    widths = [c.get("width", 12) for c in columns]

    # -- Flatten 2D grid data into pipe-delimited rows --
    flat_lines = []
    for row in data_rows:
      cleaned = [str(v).replace("|", "/") if v is not None else "" for v in row]
      flat_lines.append("|".join(cleaned))
    data_flat = "\n".join(flat_lines)

    # -- Bar sparse data: one row per line --
    bar_sparse_flat = "\n".join(bar_sparse_rows)

    return _success_response({
      "headers_flat": "|".join(headers),
      "widths_flat": "|".join(str(w) for w in widths),
      "column_config": columns,
      "data_flat": data_flat,
      "row_types_flat": "|".join(row_types),
      "indent_levels_flat": "|".join(str(x) for x in indent_levels),
      "task_ids_flat": "|".join(str(x) for x in task_ids),
      "row_count": len(data_rows),
      "col_count": len(headers),
      "bar_sparse_flat": bar_sparse_flat,
      "bar_col_count": total_bar_cols,
      "timescale_start": ts_start.isoformat(),
      "timescale_end": ts_end.isoformat(),
      "data_date": data_date.isoformat() if data_date else "",
      "cols_per_week": cols_per_week
    })

  except Exception as e:
    return _error_response(f"Server error: {str(e)}", 500)


# ===========================================================================
#  HTTP ENDPOINT — Get Activity Codes (for filter dropdowns)
# ===========================================================================

@anvil.server.http_endpoint("/get_activity_codes", methods=["POST"])
def api_get_activity_codes(**kwargs):
  """
  Get all activity code types and their values for a given import.
  Used by VBA to build filter combo boxes.

  POST body: token, import_id
  Response:  {code_types: [{name, values: [{id, short_name, description}]}]}
  """
  try:
    body = anvil.server.request.body_json or {}
    token = body.get("token", "")
    import_id = body.get("import_id")

    user_info = auth.validate_session(token)
    if not user_info:
      return _error_response("Invalid or expired session", 401)

    if not import_id:
      return _error_response("import_id is required")

    conn = db.get_connection()
    try:
      # -- Get code types --
      type_sql = """
                SELECT actv_code_type_id, actv_code_type, seq_num
                FROM p6_actvtype
                WHERE import_id = %s
                ORDER BY seq_num
            """
      type_rows = _query(conn, type_sql, [import_id])

      code_types = []
      for tr in type_rows:
        type_id = tr["actv_code_type_id"]
        # -- Get values for this code type --
        val_sql = """
                    SELECT actv_code_id, short_name, actv_code_name
                    FROM p6_actvcode
                    WHERE actv_code_type_id = %s AND import_id = %s
                    ORDER BY seq_num
                """
        val_rows = _query(conn, val_sql, [type_id, import_id])
        values = []
        for vr in val_rows:
          values.append({
            "id": vr["actv_code_id"],
            "short_name": vr.get("short_name", ""),
            "description": vr.get("actv_code_name", "")
          })
        code_types.append({
          "name": tr.get("actv_code_type", ""),
          "values": values
        })
    finally:
      conn.close()

    return _success_response({"code_types": code_types})

  except Exception as e:
    return _error_response(f"Server error: {str(e)}", 500)


# ===========================================================================
#  HTTP ENDPOINT — Get Calendars
# ===========================================================================

@anvil.server.http_endpoint("/get_calendars", methods=["POST"])
def api_get_calendars(**kwargs):
  """
  Get calendar definitions for a given import.
  Used by VBA for bar date calculations.

  POST body: token, import_id
  Response:  {calendars: [{clndr_id, clndr_name, day_hr_cnt, clndr_data}]}
  """
  try:
    body = anvil.server.request.body_json or {}
    token = body.get("token", "")
    import_id = body.get("import_id")

    user_info = auth.validate_session(token)
    if not user_info:
      return _error_response("Invalid or expired session", 401)

    if not import_id:
      return _error_response("import_id is required")

    conn = db.get_connection()
    try:
      sql = """
                SELECT clndr_id, clndr_name, day_hr_cnt,
                       week_hr_cnt, month_hr_cnt, year_hr_cnt,
                       clndr_data
                FROM p6_calendar
                WHERE import_id = %s
                ORDER BY clndr_name
            """
      rows = _query(conn, sql, [import_id])
      calendars = []
      for row in rows:
        calendars.append({
          "clndr_id": row["clndr_id"],
          "clndr_name": row.get("clndr_name", ""),
          "day_hr_cnt": row.get("day_hr_cnt"),
          "week_hr_cnt": row.get("week_hr_cnt"),
          "month_hr_cnt": row.get("month_hr_cnt"),
          "year_hr_cnt": row.get("year_hr_cnt"),
          "clndr_data": row.get("clndr_data", "")
        })
    finally:
      conn.close()

    return _success_response({"calendars": calendars})

  except Exception as e:
    return _error_response(f"Server error: {str(e)}", 500)


# ===========================================================================
#  HTTP ENDPOINT — Get Import Info
# ===========================================================================

@anvil.server.http_endpoint("/get_import_info", methods=["POST"])
def api_get_import_info(**kwargs):
  """
  Get metadata about a specific import version.
  Used by VBA to display data date, version label, etc.

  POST body: token, import_id
  Response:  {import_info: {data_date, label, imported_at, ...}}
  """
  try:
    body = anvil.server.request.body_json or {}
    token = body.get("token", "")
    import_id = body.get("import_id")

    user_info = auth.validate_session(token)
    if not user_info:
      return _error_response("Invalid or expired session", 401)

    if not import_id:
      return _error_response("import_id is required")

    conn = db.get_connection()
    try:
      sql = """
                SELECT il.import_id, il.label, il.import_date, il.file_name,
                       il.data_date, il.xer_version, il.import_status,
                       p.proj_short_name, p.last_recalc_date
                FROM import_log il
                LEFT JOIN p6_project p
                  ON p.import_id = il.import_id
                WHERE il.import_id = %s
                LIMIT 1
            """
      rows = _query(conn, sql, [import_id])
      if not rows:
        return _error_response("Import not found", 404)

      row = rows[0]
      import_info = {
        "import_id": row.get("import_id"),
        "label": row.get("label", ""),
        "imported_at": str(row.get("import_date", "")),
        "file_name": row.get("file_name", ""),
        "project_name": row.get("proj_short_name", ""),
        "data_date": str(row.get("data_date", "")),
        "xer_version": row.get("xer_version", ""),
      }
    finally:
      conn.close()

    return _success_response({"import_info": import_info})

  except Exception as e:
    return _error_response(f"Server error: {str(e)}", 500)