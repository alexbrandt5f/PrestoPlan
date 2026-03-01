"""
===============================================================================
 MODULE: data_access.py
 Description:  Server-callable data access functions for the Anvil frontend.
               Queries P6 tables (PROJWBS, TASK, ACTVCODE, UDFVALUE, etc.)
               and returns structured data for the Gantt chart and detail pane.

 Architecture:
   - All functions use @anvil.server.callable (not http_endpoint)
   - Parameters passed as direct function arguments (not request.body_json)
   - WBS hierarchy built by querying p6_projwbs, depth-first traversal
   - Activity codes, UDFs, relationships pre-fetched into lookup dicts
   - Detail data (predecessors, codes, UDFs, notebooks) returned with
     Gantt data so activity details pane is instant with no round-trips

 Performance Notes:
   - Combined project query: proj_id + critical_path_type in one SELECT
   - Timescale date range via SQL MIN/MAX (eliminates large numbers of
     strptime calls on large datasets)
   - _date_to_col() accepts native date/datetime objects from psycopg2
   - All helper maps built in one pass each, not per-row queries
   - Large payloads (>500KB) returned as BlobMedia to avoid Anvil
     serialisation limit errors

 v6 Changes:
   - _get_relationship_map: enhanced SQL pulls remain_drtn_hr_cnt and
     start/finish dates for both pred and succ tasks. Each entry now
     includes rel_ff_days, rem_dur_days, start_date, finish_date.
   - get_gantt_data: return wrapped in BlobMedia when JSON > 500KB.
===============================================================================
"""

import anvil.server
import json as _json
from datetime import datetime, date, timedelta
from . import db
from . import auth


# ===========================================================================
#  LOCAL QUERY HELPER
#  Uses an existing connection rather than opening a new one per call.
#  This lets get_gantt_data run ~10 queries on one connection.
# ===========================================================================

def _query(conn, sql, params=None):
  """
  Execute a SELECT on an existing psycopg2 connection.
  Returns list of dicts. Bypasses db.query() decorator to reuse connection.
  """
  import psycopg2.extras
  with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
    cur.execute(sql, params or [])
    rows = cur.fetchall()
    return [dict(row) for row in rows]


# ===========================================================================
#  DATE HELPERS
# ===========================================================================

def _to_native_date(val):
  """
  Convert a value to a Python date object.
  Handles None, datetime.date, datetime.datetime, and string fallback.
  """
  if val is None:
    return None
  if isinstance(val, date) and not isinstance(val, datetime):
    return val
  if isinstance(val, datetime):
    return val.date()
  try:
    return datetime.strptime(str(val)[:10], "%Y-%m-%d").date()
  except (ValueError, TypeError):
    return None


def _format_date(val):
  """
  Format a date value as MM/DD/YYYY for display.
  Fast path for native date/datetime objects from psycopg2.
  """
  if val is None:
    return ""
  if isinstance(val, datetime):
    return val.strftime("%m/%d/%Y")
  if isinstance(val, date):
    return val.strftime("%m/%d/%Y")
  s = str(val)
  if not s or s == "None":
    return ""
  for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
    try:
      return datetime.strptime(s[:19], fmt).strftime("%m/%d/%Y")
    except ValueError:
      continue
  return s


# ===========================================================================
#  DEFAULT COLUMN CONFIGURATION
# ===========================================================================

def _default_columns():
  """
  Return the default Gantt chart columns.
  Activity ID, Activity Name, Orig Dur, Rem Dur,
  Start Date, AS checkbox, Finish Date, AF checkbox, Total Float.
  """
  return [
    {"source": "TASK", "field": "task_code",         "label": "Activity ID",   "width": 14},
    {"source": "TASK", "field": "task_name",          "label": "Activity Name", "width": 40},
    {"source": "TASK", "field": "target_drtn_hr_cnt", "label": "Orig Dur",      "width": 9,  "duration_field": True},
    {"source": "TASK", "field": "remain_drtn_hr_cnt", "label": "Rem Dur",       "width": 9,  "duration_field": True},
    {"source": "CALC", "field": "start_date",         "label": "Start Date",    "width": 12, "is_date": True},
    {"source": "CALC", "field": "actual_start_flag",  "label": "AS",            "width": 4,  "is_checkbox": True},
    {"source": "CALC", "field": "finish_date",        "label": "Finish Date",   "width": 12, "is_date": True},
    {"source": "CALC", "field": "actual_finish_flag", "label": "AF",            "width": 4,  "is_checkbox": True},
    {"source": "TASK", "field": "total_float_hr_cnt", "label": "Total Float",   "width": 10, "duration_field": True},
  ]


# ===========================================================================
#  LOOKUP MAP BUILDERS
#  Each builds a dict from one query, used during WBS traversal.
# ===========================================================================

def _get_calendar_hours_map(conn, import_id):
  """Build {clndr_id: hours_per_day} from p6_calendar. Falls back to 8.0."""
  cal_map = {}
  try:
    rows = _query(conn,
                  "SELECT clndr_id, day_hr_cnt FROM p6_calendar WHERE import_id = %s",
                  [import_id])
    for row in rows:
      try:
        cal_map[row["clndr_id"]] = float(row.get("day_hr_cnt") or 8.0)
      except (ValueError, TypeError):
        cal_map[row["clndr_id"]] = 8.0
  except Exception:
    pass
  return cal_map


def _get_activity_code_map(conn, import_id):
  """
  Build {task_id: {type_name: value_short_name}} from TASKACTV/ACTVCODE/ACTVTYPE.
  Used for Gantt column values and filter matching.
  """
  code_map = {}
  try:
    rows = _query(conn, """
      SELECT ta.task_id,
             at2.actv_code_type AS type_name,
             ac.short_name      AS value_name
      FROM p6_taskactv ta
      JOIN p6_actvcode ac
        ON ac.actv_code_id = ta.actv_code_id
       AND ac.import_id    = ta.import_id
      JOIN p6_actvtype at2
        ON at2.actv_code_type_id = ac.actv_code_type_id
       AND at2.import_id         = ta.import_id
      WHERE ta.import_id = %s
    """, [import_id])
    for row in rows:
      tid = row["task_id"]
      if tid not in code_map:
        code_map[tid] = {}
      code_map[tid][row["type_name"]] = row.get("value_name", "")
  except Exception:
    pass
  return code_map


def _get_udf_map(conn, import_id):
  """
  Build {task_id: {udf_label: display_value}} from UDFVALUE/UDFTYPE.
  Handles text, number, date, and code_id field types.
  """
  udf_map = {}
  try:
    rows = _query(conn, """
      SELECT uv.fk_id AS task_id,
             ut.udf_type_label,
             uv.udf_text,
             uv.udf_number,
             uv.udf_date,
             uv.udf_code_id
      FROM p6_udfvalue uv
      JOIN p6_udftype ut
        ON ut.udf_type_id = uv.udf_type_id
       AND ut.import_id   = uv.import_id
      WHERE uv.import_id = %s
        AND ut.table_name = 'TASK'
    """, [import_id])
    for row in rows:
      tid   = row["task_id"]
      label = row.get("udf_type_label", "")
      val   = (str(row["udf_text"])    if row.get("udf_text")              else
               str(row["udf_number"])  if row.get("udf_number") is not None else
               str(row["udf_date"])    if row.get("udf_date")              else
               str(row["udf_code_id"]) if row.get("udf_code_id")           else "")
      if tid not in udf_map:
        udf_map[tid] = {}
      udf_map[tid][label] = val
  except Exception:
    pass
  return udf_map


# ===========================================================================
#  RELATIONSHIP MAP  (v6 — enhanced with rem_dur, dates, rel_ff_days)
# ===========================================================================

def _get_relationship_map(conn, import_id, cal_map):
  """
  Build {task_id: {predecessors: [...], successors: [...]}} from TASKPRED.

  Each predecessor/successor entry contains:
    task_id, task_code, task_name, rel_type, lag_days, rel_ff_days,
    driving, rem_dur_days, start_date, finish_date

  Lag, relationship free float, and remaining duration are converted from
  hours to days using the appropriate calendar (predecessor's calendar for
  lag/float, each task's own calendar for remaining duration).

  Start/finish dates use the "effective" date: actual if available,
  otherwise early start/finish, formatted as YYYY-MM-DD strings.

  Driving flag uses rel_ff_days < 0.5 threshold to handle rounding.
  """
  rel_map = {}
  try:
    rows = _query(conn, """
      SELECT tp.task_id                AS succ_task_id,
             tp.pred_task_id,
             tp.pred_type,
             tp.lag_hr_cnt,
             tp.float_path,
             t_pred.task_code          AS pred_task_code,
             t_pred.task_name          AS pred_task_name,
             t_pred.clndr_id           AS pred_clndr_id,
             t_pred.remain_drtn_hr_cnt AS pred_rem_dur_hrs,
             t_pred.act_start_date     AS pred_act_start,
             t_pred.act_end_date       AS pred_act_end,
             t_pred.early_start_date   AS pred_early_start,
             t_pred.early_end_date     AS pred_early_end,
             t_succ.task_code          AS succ_task_code,
             t_succ.task_name          AS succ_task_name,
             t_succ.clndr_id           AS succ_clndr_id,
             t_succ.remain_drtn_hr_cnt AS succ_rem_dur_hrs,
             t_succ.act_start_date     AS succ_act_start,
             t_succ.act_end_date       AS succ_act_end,
             t_succ.early_start_date   AS succ_early_start,
             t_succ.early_end_date     AS succ_early_end
      FROM p6_taskpred tp
      JOIN p6_task t_pred
        ON t_pred.task_id   = tp.pred_task_id
       AND t_pred.import_id = tp.import_id
      JOIN p6_task t_succ
        ON t_succ.task_id   = tp.task_id
       AND t_succ.import_id = tp.import_id
      WHERE tp.import_id = %s
    """, [import_id])

    for row in rows:
      succ_id  = row["succ_task_id"]
      pred_id  = row["pred_task_id"]

      # -- Relationship type (strip PR_ prefix) --
      raw_type = row.get("pred_type") or ""
      rel_type = raw_type.replace("PR_", "") if raw_type.startswith("PR_") else raw_type

      # -- Hours-per-day from predecessor's calendar (used for lag & float) --
      pred_cal    = row.get("pred_clndr_id", "")
      pred_hpd    = cal_map.get(pred_cal, 8.0)

      # -- Hours-per-day from successor's calendar (used for succ rem dur) --
      succ_cal    = row.get("succ_clndr_id", "")
      succ_hpd    = cal_map.get(succ_cal, 8.0)

      # -- Helper: convert hours to days safely --
      def _hrs_to_days(hrs, hpd):
        try:
          return round(float(hrs or 0) / hpd, 1)
        except (ValueError, TypeError, ZeroDivisionError):
          return 0

      # -- Helper: pick effective date (actual > early), return as string --
      def _eff_date(act_val, early_val):
        d = _to_native_date(act_val) or _to_native_date(early_val)
        return d.strftime("%Y-%m-%d") if d else ""

      # -- Lag and relationship free float in days --
      lag_days    = _hrs_to_days(row.get("lag_hr_cnt"),  pred_hpd)
      rel_ff_days = _hrs_to_days(row.get("float_path"), pred_hpd)
      is_driving  = (rel_ff_days < 0.5)

      # -- Predecessor remaining duration, dates --
      pred_rem_days = _hrs_to_days(row.get("pred_rem_dur_hrs"), pred_hpd)
      pred_start    = _eff_date(row.get("pred_act_start"), row.get("pred_early_start"))
      pred_finish   = _eff_date(row.get("pred_act_end"),   row.get("pred_early_end"))

      # -- Successor remaining duration, dates --
      succ_rem_days = _hrs_to_days(row.get("succ_rem_dur_hrs"), succ_hpd)
      succ_start    = _eff_date(row.get("succ_act_start"), row.get("succ_early_start"))
      succ_finish   = _eff_date(row.get("succ_act_end"),   row.get("succ_early_end"))

      # -- Predecessor entry (shown in successor's predecessor table) --
      pred_entry = {
        "task_id":      pred_id,
        "task_code":    row.get("pred_task_code", ""),
        "task_name":    row.get("pred_task_name", ""),
        "rel_type":     rel_type,
        "lag_days":     lag_days,
        "rel_ff_days":  rel_ff_days,
        "driving":      is_driving,
        "rem_dur_days": pred_rem_days,
        "start_date":   pred_start,
        "finish_date":  pred_finish,
      }

      # -- Successor entry (shown in predecessor's successor table) --
      succ_entry = {
        "task_id":      succ_id,
        "task_code":    row.get("succ_task_code", ""),
        "task_name":    row.get("succ_task_name", ""),
        "rel_type":     rel_type,
        "lag_days":     lag_days,
        "rel_ff_days":  rel_ff_days,
        "driving":      is_driving,
        "rem_dur_days": succ_rem_days,
        "start_date":   succ_start,
        "finish_date":  succ_finish,
      }

      # -- Add to maps --
      if succ_id not in rel_map:
        rel_map[succ_id] = {"predecessors": [], "successors": []}
      rel_map[succ_id]["predecessors"].append(pred_entry)

      if pred_id not in rel_map:
        rel_map[pred_id] = {"predecessors": [], "successors": []}
      rel_map[pred_id]["successors"].append(succ_entry)

  except Exception:
    pass
  return rel_map


# ===========================================================================
#  DETAIL MAP BUILDERS  (codes, notebooks, UDFs, task general/status)
# ===========================================================================

def _get_code_detail_map(conn, import_id):
  """
  Build {task_id: [[type_name, value_name, description], ...]}
  for the Codes tab of the activity details pane.
  """
  detail_map = {}
  try:
    rows = _query(conn, """
      SELECT ta.task_id,
             at2.actv_code_type AS type_name,
             ac.short_name      AS value_name,
             ac.actv_code_name  AS description
      FROM p6_taskactv ta
      JOIN p6_actvcode ac
        ON ac.actv_code_id    = ta.actv_code_id
       AND ac.import_id       = ta.import_id
      JOIN p6_actvtype at2
        ON at2.actv_code_type_id = ac.actv_code_type_id
       AND at2.import_id         = ta.import_id
      WHERE ta.import_id = %s
      ORDER BY at2.actv_code_type
    """, [import_id])
    for row in rows:
      tid = row["task_id"]
      if tid not in detail_map:
        detail_map[tid] = []
      detail_map[tid].append([
        row.get("type_name", ""),
        row.get("value_name", ""),
        row.get("description", ""),
      ])
  except Exception:
    pass
  return detail_map


def _get_notebook_map(conn, import_id):
  """
  Build {task_id: [[topic_name, plain_text_content], ...]}
  for the Notebook tab. Strips HTML tags from content.
  """
  nb_map = {}
  try:
    rows = _query(conn, """
      SELECT tm.task_id,
             COALESCE(mt.memo_type, tm.memo_type_id) AS topic_name,
             tm.task_memo AS content
      FROM p6_taskmemo tm
      LEFT JOIN p6_memotype mt
        ON mt.memo_type_id = tm.memo_type_id
       AND mt.import_id    = tm.import_id
      WHERE tm.import_id = %s
    """, [import_id])
    for row in rows:
      tid = row["task_id"]
      if tid not in nb_map:
        nb_map[tid] = []
      nb_map[tid].append([
        row.get("topic_name", ""),
        _strip_html(row.get("content", "") or ""),
      ])
  except Exception:
    pass
  return nb_map


def _strip_html(html_str):
  """Strip HTML tags and convert common entities to plain text."""
  if not html_str:
    return ""
  s = (html_str
    .replace("&amp;",  "&").replace("&lt;",   "<").replace("&gt;",  ">")
    .replace("&nbsp;", " ").replace("&quot;", '"')
    .replace("<br>",  "\n").replace("<br/>", "\n").replace("<br />", "\n")
    .replace("<p>",   "\n").replace("</p>",   ""))
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


def _get_udf_detail_map(conn, import_id):
  """
  Build {task_id: [[udf_label, display_value], ...]}
  for the UDFs tab. Handles all P6 UDF data types.
  """
  detail_map = {}
  try:
    rows = _query(conn, """
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
       AND ut.import_id   = uv.import_id
      WHERE uv.import_id = %s
        AND ut.table_name = 'TASK'
      ORDER BY ut.udf_type_label
    """, [import_id])
    for row in rows:
      tid   = row["task_id"]
      label = row.get("udf_type_label", "")
      dtype = (row.get("logical_data_type") or "").upper()
      if "TEXT" in dtype:
        val = str(row.get("udf_text") or "")
      elif any(t in dtype for t in ("DOUBLE", "INTEGER", "COST")):
        val = str(row.get("udf_number") or "")
      elif "DATE" in dtype:
        val = str(row.get("udf_date") or "")
      elif "CODE" in dtype:
        val = str(row.get("udf_code_id") or "")
      else:
        val = str(row.get("udf_text")    or row.get("udf_number") or
                  row.get("udf_date")    or row.get("udf_code_id") or "")
      if tid not in detail_map:
        detail_map[tid] = []
      detail_map[tid].append([label, val])
  except Exception:
    pass
  return detail_map


def _get_task_detail_map(conn, import_id, cal_map):
  """
  Build {task_id: {field: value}} with extended fields for General/Status tabs.
  Includes calendar name, duration type, percent complete, all dates, float values.
  """
  detail_map = {}
  try:
    rows = _query(conn, """
      SELECT t.task_id, t.clndr_id, c.clndr_name,
             t.task_type, t.duration_type, t.complete_pct_type,
             t.phys_complete_pct,
             t.target_drtn_hr_cnt, t.act_drtn_hr_cnt,
             t.remain_drtn_hr_cnt, t.at_comp_drtn_hr_cnt,
             t.total_float_hr_cnt, t.free_float_hr_cnt,
             t.target_start_date, t.target_end_date,
             t.act_start_date,    t.act_end_date,
             t.early_start_date,  t.early_end_date,
             t.late_start_date,   t.late_end_date,
             t.status_code
      FROM p6_task t
      LEFT JOIN p6_calendar c
        ON c.clndr_id  = t.clndr_id
       AND c.import_id = t.import_id
      WHERE t.import_id = %s
    """, [import_id])

    def _hrs_to_days(hrs, hpd):
      try:
        return round(float(hrs) / hpd, 1) if hrs is not None else None
      except (ValueError, TypeError, ZeroDivisionError):
        return None

    for row in rows:
      tid        = row["task_id"]
      hpd        = cal_map.get(row.get("clndr_id", ""), 8.0)
      act_start  = row.get("act_start_date")
      act_finish = row.get("act_end_date")
      start      = act_start  or row.get("early_start_date") or row.get("target_start_date")
      finish     = act_finish or row.get("early_end_date")   or row.get("target_end_date")

      detail_map[tid] = {
        "calendar_name":     row.get("clndr_name", ""),
        "task_type":         _format_task_type(row.get("task_type", "")),
        "duration_type":     _format_duration_type(row.get("duration_type", "")),
        "complete_pct_type": _format_pct_type(row.get("complete_pct_type", "")),
        "phys_complete_pct": row.get("phys_complete_pct"),
        "orig_dur_days":     _hrs_to_days(row.get("target_drtn_hr_cnt"), hpd),
        "act_dur_days":      _hrs_to_days(row.get("act_drtn_hr_cnt"),    hpd),
        "rem_dur_days":      _hrs_to_days(row.get("remain_drtn_hr_cnt"), hpd),
        "at_comp_dur_days":  _hrs_to_days(row.get("at_comp_drtn_hr_cnt"), hpd),
        "total_float_days":  _hrs_to_days(row.get("total_float_hr_cnt"), hpd),
        "free_float_days":   _hrs_to_days(row.get("free_float_hr_cnt"),  hpd),
        "start_date":        str(start)      if start      else "",
        "finish_date":       str(finish)     if finish     else "",
        "act_start_date":    str(act_start)  if act_start  else "",
        "act_end_date":      str(act_finish) if act_finish else "",
        "target_start_date": str(row.get("target_start_date") or ""),
        "target_end_date":   str(row.get("target_end_date")   or ""),
        "early_start_date":  str(row.get("early_start_date")  or ""),
        "early_end_date":    str(row.get("early_end_date")    or ""),
        "late_start_date":   str(row.get("late_start_date")   or ""),
        "late_end_date":     str(row.get("late_end_date")     or ""),
        "has_actual_start":  bool(act_start),
        "has_actual_finish": bool(act_finish),
        "status_code":       row.get("status_code", ""),
      }
  except Exception:
    pass
  return detail_map


def _format_task_type(code):
  mapping = {
    "TT_Task":      "Task Dependent",
    "TT_Rsrc":      "Resource Dependent",
    "TT_Mile":      "Start Milestone",
    "TT_LOE":       "Level of Effort",
    "TT_FinMile":   "Finish Milestone",
    "TT_StartMile": "Start Milestone",
    "TT_WBS":       "WBS Summary",
  }
  return mapping.get(code, code or "")


def _format_duration_type(code):
  mapping = {
    "DT_FixedDUR":  "Fixed Duration & Units",
    "DT_FixedDrtn": "Fixed Duration & Units/Time",
    "DT_FixedRate": "Fixed Units/Time",
    "DT_FixedQty":  "Fixed Units",
  }
  return mapping.get(code, code or "")


def _format_pct_type(code):
  mapping = {
    "CP_Drtn":  "Duration",
    "CP_Units": "Units",
    "CP_Phys":  "Physical",
  }
  return mapping.get(code, code or "")


# ===========================================================================
#  WBS TREE BUILDER AND TRAVERSAL
# ===========================================================================

def _build_wbs_tree(conn, import_id, proj_id):
  """
  Query p6_projwbs and build a hierarchical tree.
  Root identified by proj_node_flag = 'Y'.
  Children sorted by seq_num at every level.
  Returns (root_node, all_nodes_dict).
  """
  rows = _query(conn, """
    SELECT wbs_id, parent_wbs_id, wbs_short_name, wbs_name,
           seq_num, proj_node_flag
    FROM p6_projwbs
    WHERE import_id = %s AND proj_id = %s
    ORDER BY seq_num
  """, [import_id, proj_id])

  nodes = {}
  root  = None

  for row in rows:
    wbs_id = row["wbs_id"]
    nodes[wbs_id] = {
      "wbs_id":         wbs_id,
      "parent_wbs_id":  row.get("parent_wbs_id"),
      "wbs_short_name": row.get("wbs_short_name", ""),
      "wbs_name":       row.get("wbs_name", ""),
      "seq_num":        row.get("seq_num", 0),
      "proj_node_flag": row.get("proj_node_flag", "N"),
      "children":       [],
    }
    if row.get("proj_node_flag") == "Y":
      root = nodes[wbs_id]

  for wbs_id, node in nodes.items():
    parent_id = node["parent_wbs_id"]
    if parent_id and parent_id in nodes and node is not root:
      nodes[parent_id]["children"].append(node)

  def _sort_children(node):
    node["children"].sort(key=lambda n: n.get("seq_num", 0))
    for child in node["children"]:
      _sort_children(child)

  if root:
    _sort_children(root)

  return root, nodes


def _traverse_wbs(node, tasks_by_wbs, columns, code_map, udf_map,
                  cal_map, depth=0):
  """
  Depth-first WBS traversal producing rows in display order.
  Each entry is a 6-tuple:
    (row_data, row_type, indent_level, task_id, wbs_id, parent_wbs_id)
  """
  result_rows = []

  node_wbs_id        = str(node.get("wbs_id", ""))
  node_parent_wbs_id = str(node.get("parent_wbs_id", "") or "")

  # Emit WBS summary row (skip root at depth 0)
  if depth > 0:
    wbs_row = []
    for col in columns:
      if col["field"] == "task_code":
        wbs_row.append(node.get("wbs_short_name", ""))
      elif col["field"] == "task_name":
        wbs_row.append(node.get("wbs_name", ""))
      else:
        wbs_row.append("")
    result_rows.append((
      wbs_row, "WBS", depth, "",
      node_wbs_id, node_parent_wbs_id
    ))

  # Emit task rows under this WBS node
  task_indent = depth + 1 if depth > 0 else 1
  for task in tasks_by_wbs.get(node["wbs_id"], []):
    task_row = _build_task_row(task, columns, code_map, udf_map, cal_map)
    tid      = str(task.get("task_id", ""))
    result_rows.append((
      task_row, "TASK", task_indent, tid,
      node_wbs_id, node_parent_wbs_id
    ))
    # BLANK spacer row (filtered out client-side)
    result_rows.append((
      [""] * len(columns), "BLANK", task_indent, "",
      node_wbs_id, node_parent_wbs_id
    ))

  # Recurse into children
  for child in node.get("children", []):
    result_rows.extend(
      _traverse_wbs(child, tasks_by_wbs, columns,
                    code_map, udf_map, cal_map, depth + 1)
    )

  return result_rows


def _build_task_row(task, columns, code_map, udf_map, cal_map):
  """
  Build one task's data row from the column configuration.
  Handles TASK, CALC, ACTVCODE, and UDF source types.
  Duration fields converted from hours to days.
  """
  tid    = task.get("task_id", "")
  cal_id = task.get("clndr_id", "")
  hpd    = cal_map.get(cal_id, 8.0)

  act_start  = task.get("act_start_date")
  act_finish = task.get("act_end_date")
  disp_start  = act_start  or task.get("early_start_date") or task.get("target_start_date")
  disp_finish = act_finish or task.get("early_end_date")   or task.get("target_end_date")

  row = []
  for col in columns:
    source      = col.get("source", "TASK")
    field       = col.get("field", "")
    is_duration = col.get("duration_field", False)
    is_date     = col.get("is_date", False)
    val         = ""

    if source == "TASK":
      val = task.get(field, "")
      if is_duration and val is not None and val != "":
        try:
          val = round(float(val) / hpd, 1)
        except (ValueError, TypeError, ZeroDivisionError):
          val = ""
      elif is_date:
        val = _format_date(val)

    elif source == "CALC":
      if field == "start_date":
        val = _format_date(disp_start)  if disp_start  else ""
      elif field == "finish_date":
        val = _format_date(disp_finish) if disp_finish else ""
      elif field == "actual_start_flag":
        val = "Y" if act_start  else ""
      elif field == "actual_finish_flag":
        val = "Y" if act_finish else ""

    elif source == "ACTVCODE":
      val = code_map.get(tid, {}).get(field, "")

    elif source == "UDF":
      val = udf_map.get(tid, {}).get(field, "")

    row.append(val if val is not None else "")

  return row


# ===========================================================================
#  CALLABLE: get_gantt_data
#  Main data endpoint called by GanttForm._load_gantt()
# ===========================================================================

@anvil.server.callable
def get_gantt_data(token, project_id, import_id,
                   column_config=None, near_critical_days=10, cols_per_week=7):
  """
  Get the full Gantt dataset for a project/import.

  Returns a dict (or BlobMedia for large payloads) with:
    tasks, columns, timescale_start, timescale_end, data_date,
    bar_col_count, cols_per_week, detail_cache

  Large payloads (>500KB JSON) are wrapped in BlobMedia to avoid
  Anvil's callable serialisation limit.
  """
  user = auth.validate_session(token)
  if not user:
    raise Exception("Invalid or expired session. Please log in again.")

  columns = column_config if column_config else _default_columns()

  conn = db.get_connection()
  try:
    # -- Get P6 project info --
    proj_rows = _query(conn, """
      SELECT proj_id, critical_path_type, critical_drtn_hr_cnt,
             last_recalc_date
      FROM p6_project WHERE import_id = %s LIMIT 1
    """, [import_id])

    if not proj_rows:
      raise Exception("No P6 project found for this import.")

    proj       = proj_rows[0]
    p6_proj_id = proj["proj_id"]
    crit_type  = proj.get("critical_path_type", "CT_TotFloat")
    try:
      crit_hrs = float(proj.get("critical_drtn_hr_cnt") or 0)
    except (ValueError, TypeError):
      crit_hrs = 0
    data_date = _to_native_date(proj.get("last_recalc_date"))

    # -- Build lookup maps --
    cal_map  = _get_calendar_hours_map(conn, import_id)
    code_map = _get_activity_code_map(conn, import_id)
    udf_map  = _get_udf_map(conn, import_id)

    # -- Build WBS tree --
    root, all_wbs = _build_wbs_tree(conn, import_id, p6_proj_id)
    if not root:
      raise Exception("No WBS hierarchy found for this project.")

    # -- Load all tasks, index by wbs_id and task_id --
    task_rows = _query(conn, """
      SELECT * FROM p6_task
      WHERE import_id = %s AND proj_id = %s
      ORDER BY task_code
    """, [import_id, p6_proj_id])

    tasks_by_wbs = {}
    task_lookup  = {}
    for t in task_rows:
      wbs_id = t.get("wbs_id", "")
      if wbs_id not in tasks_by_wbs:
        tasks_by_wbs[wbs_id] = []
      tasks_by_wbs[wbs_id].append(t)
      task_lookup[str(t.get("task_id", ""))] = t

    # -- Traverse WBS tree into ordered rows --
    traversal = _traverse_wbs(root, tasks_by_wbs, columns,
                              code_map, udf_map, cal_map)

    row_data_list  = []
    row_types      = []
    indent_levels  = []
    task_ids       = []
    task_ids_wbs   = []
    parent_wbs_ids = []

    for (row_data, rtype, indent, tid, wbs_id, parent_wbs_id) in traversal:
      row_data_list.append(row_data)
      row_types.append(rtype)
      indent_levels.append(indent)
      task_ids.append(tid)
      task_ids_wbs.append(wbs_id)
      parent_wbs_ids.append(parent_wbs_id)

    # -- Timescale date range from SQL --
    dr = _query(conn, """
      SELECT LEAST(MIN(act_start_date), MIN(early_start_date),
                   MIN(target_start_date), MIN(restart_date)) AS earliest,
             GREATEST(MAX(act_end_date), MAX(early_end_date),
                      MAX(target_end_date), MAX(reend_date))  AS latest
      FROM p6_task WHERE import_id = %s AND proj_id = %s
    """, [import_id, p6_proj_id])

    earliest = _to_native_date(dr[0].get("earliest")) if dr else None
    latest   = _to_native_date(dr[0].get("latest"))   if dr else None

    if not earliest or not latest:
      ts_start = data_date or date.today()
      ts_end   = ts_start + timedelta(days=30)
    else:
      ts_start = earliest - timedelta(days=(earliest.weekday() + 1) % 7)
      ts_end   = latest   + timedelta(days=(6 - latest.weekday()) % 7)
      if ts_end <= latest:
        ts_end += timedelta(days=7)

    total_days     = (ts_end - ts_start).days
    total_bar_cols = int(total_days * cols_per_week / 7)
    ts_start_ord   = ts_start.toordinal()
    cpw_div_7      = cols_per_week / 7.0

    def _date_to_col(d):
      if d is None:
        return None
      if isinstance(d, datetime):
        return int((d.toordinal() - ts_start_ord) * cpw_div_7)
      if isinstance(d, date):
        return int((d.toordinal() - ts_start_ord) * cpw_div_7)
      try:
        d2 = datetime.strptime(str(d)[:10], "%Y-%m-%d").date()
        return int((d2.toordinal() - ts_start_ord) * cpw_div_7)
      except (ValueError, TypeError):
        return None

    milestone_types = {"TT_Mile", "TT_FinMile", "TT_StartMile"}

    def _remaining_code(task):
      """Return bar colour code: 2=normal, 3=near-critical, 4=critical."""
      if crit_type == "CT_DrivPath":
        if task.get("driving_path_flag") == "Y":
          return 4
      else:
        try:
          tf_hrs = float(task.get("total_float_hr_cnt") or 0)
        except (ValueError, TypeError):
          tf_hrs = 0
        if tf_hrs <= crit_hrs:
          return 4

      try:
        tf_hrs = float(task.get("total_float_hr_cnt") or 0)
      except (ValueError, TypeError):
        tf_hrs = 0
      hpd     = cal_map.get(task.get("clndr_id", ""), 8.0)
      tf_days = tf_hrs / hpd if hpd > 0 else 0
      return 3 if tf_days <= near_critical_days else 2

    # -- Build bar segments per row --
    bar_segments = []
    for idx, tid in enumerate(task_ids):
      rtype = row_types[idx]
      if rtype in ("WBS", "BLANK") or not tid:
        bar_segments.append([])
        continue

      task      = task_lookup.get(tid, {})
      task_name = task.get("task_name", "")
      task_type = task.get("task_type", "")
      is_ms     = task_type in milestone_types

      act_start   = _to_native_date(task.get("act_start_date"))
      act_end     = _to_native_date(task.get("act_end_date"))
      restart     = _to_native_date(task.get("restart_date"))
      reend       = _to_native_date(task.get("reend_date"))
      early_start = _to_native_date(task.get("early_start_date"))
      early_end   = _to_native_date(task.get("early_end_date"))
      tgt_start   = _to_native_date(task.get("target_start_date"))
      tgt_end     = _to_native_date(task.get("target_end_date"))

      segs     = []
      last_col = -1
      rem_code = _remaining_code(task)

      if is_ms:
        ms_date = act_end or act_start or restart or early_start or tgt_start
        col     = _date_to_col(ms_date)
        if col is not None and 0 <= col < total_bar_cols:
          code = 1 if act_end else rem_code
          segs.append({"type": f"M{code}", "start": col, "end": col})
          last_col = col
      else:
        # Actual portion
        if act_start:
          a_s = _date_to_col(act_start)
          a_e = _date_to_col(act_end or data_date)
          if a_s is not None and a_e is not None:
            c_s = max(0, a_s)
            c_e = min(total_bar_cols - 1, a_e)
            if c_s <= c_e:
              segs.append({"type": "1", "start": c_s, "end": c_e})
              last_col = max(last_col, c_e)

        # Remaining/forecast portion
        if not act_end:
          rem_start = restart    or early_start or tgt_start
          rem_end   = reend      or early_end   or tgt_end
          if rem_start and rem_end:
            r_s = _date_to_col(rem_start)
            r_e = _date_to_col(rem_end)
            if r_s is not None and r_e is not None:
              c_s = max(0, r_s)
              c_e = min(total_bar_cols - 1, r_e)
              if c_s <= c_e:
                segs.append({"type": str(rem_code), "start": c_s, "end": c_e})
                last_col = max(last_col, c_e)

      # Activity name label after bar
      if last_col >= 0:
        label_col = last_col + 2
        if label_col < total_bar_cols:
          segs.append({"type": "L", "start": label_col, "label": task_name})

      bar_segments.append(segs)

    # -- Build detail cache for activity details pane --
    rel_map         = _get_relationship_map(conn, import_id, cal_map)
    code_detail_map = _get_code_detail_map(conn, import_id)
    nb_map          = _get_notebook_map(conn, import_id)
    udf_detail_map  = _get_udf_detail_map(conn, import_id)
    task_detail_map = _get_task_detail_map(conn, import_id, cal_map)

    def _safe(val):
      """Recursively convert to plain Python types safe for serialisation."""
      if val is None:
        return ''
      if isinstance(val, (datetime, date)):
        return val.isoformat()
      if isinstance(val, dict):
        return {str(k): _safe(v) for k, v in val.items()}
      if isinstance(val, (list, tuple)):
        return [_safe(i) for i in val]
      if isinstance(val, (int, float, bool)):
        return val
      return str(val)

    detail_cache = {}
    for tid, task in task_lookup.items():
      detail_cache[str(tid)] = {
        "general":       _safe(task_detail_map.get(tid, {})),
        "relationships": _safe(rel_map.get(tid, {"predecessors": [], "successors": []})),
        "codes":         _safe(code_detail_map.get(tid, [])),
        "notebook":      _safe(nb_map.get(tid, [])),
        "udfs":          _safe(udf_detail_map.get(tid, [])),
      }

    # -- Build task list for client --
    tasks_out = []
    for idx, tid in enumerate(task_ids):
      tasks_out.append({
        "task_id":       str(tid),
        "row_type":      row_types[idx],
        "indent":        indent_levels[idx],
        "row_data":      [_safe(v) for v in row_data_list[idx]],
        "bar_segments":  bar_segments[idx],
        "wbs_id":        str(task_ids_wbs[idx]),
        "parent_wbs_id": str(parent_wbs_ids[idx]),
      })

    # -- Return result, wrapping in BlobMedia if too large --
    result = {
      "tasks":           tasks_out,
      "columns":         columns,
      "timescale_start": ts_start.isoformat(),
      "timescale_end":   ts_end.isoformat(),
      "data_date":       data_date.isoformat() if data_date else "",
      "bar_col_count":   total_bar_cols,
      "cols_per_week":   cols_per_week,
      "detail_cache":    detail_cache,
    }

    result_json = _json.dumps(result)
    if len(result_json) > 500000:
      import anvil
      return anvil.BlobMedia(
        'application/json',
        result_json.encode('utf-8'),
        name='gantt_data.json'
      )
    return result

  finally:
    conn.close()


# ===========================================================================
#  CALLABLE: get_user_projects
# ===========================================================================

@anvil.server.callable
def get_user_projects(token):
  """
  Returns list of projects the user has access to.
  Superusers see all projects. Others see projects via OBS rights.
  """
  user = auth.validate_session(token)
  if not user:
    raise Exception("Invalid session. Please log in again.")

  try:
    if user["is_superuser"]:
      rows = db.query("""
        SELECT project_id, project_name, description
        FROM project ORDER BY project_name
      """)
    else:
      rows = db.query("""
        SELECT DISTINCT p.project_id, p.project_name, p.description
        FROM project p
        JOIN obs o       ON p.obs_id  = o.obs_id
        JOIN obs_right r ON r.obs_id  = o.obs_id
        WHERE r.user_id = %s
        ORDER BY p.project_name
      """, [user["user_id"]])
    return [dict(r) for r in rows]

  except Exception as e:
    print(f"[get_user_projects] ERROR: {e}")
    raise Exception(f"Error loading projects: {str(e)}")


# ===========================================================================
#  CALLABLE: get_project_imports
# ===========================================================================

@anvil.server.callable
def get_project_imports(token, project_id):
  """
  Returns list of imports for a project, newest first.
  """
  user = auth.validate_session(token)
  if not user:
    raise Exception("Invalid session. Please log in again.")

  try:
    rows = db.query("""
      SELECT import_id, label, file_name,
             import_date::date AS import_date,
             data_date::date   AS data_date,
             import_status
      FROM import_log
      WHERE project_id = %s
      ORDER BY import_date DESC
    """, [project_id])
    return [dict(r) for r in rows]

  except Exception as e:
    print(f"[get_project_imports] ERROR: {e}")
    raise Exception(f"Error loading imports: {str(e)}")


# ===========================================================================
#  CALLABLE: get_actcode_values
# ===========================================================================

@anvil.server.callable
def get_actcode_values(token, import_id, actv_code_type_id):
  """
  Returns activity code values for a given code type and import.
  Used by the filter panel activity code value dropdown.
  """
  user = auth.validate_session(token)
  if not user:
    raise Exception("Invalid session. Please log in again.")

  try:
    rows = db.query("""
      SELECT DISTINCT ac.actv_code_id, ac.short_name, ac.actv_code_name
      FROM p6_actvcode ac
      JOIN p6_taskactv ta ON ta.actv_code_id = ac.actv_code_id
      JOIN p6_task t      ON t.task_id       = ta.task_id
      WHERE ac.actv_code_type_id = %s
        AND t.import_id          = %s
      ORDER BY ac.short_name
    """, [actv_code_type_id, import_id])
    return [dict(r) for r in rows]

  except Exception as e:
    print(f"[get_actcode_values] ERROR: {e}")
    raise Exception(f"Error loading activity code values: {str(e)}")


# ===========================================================================
#  CALLABLE: logout
# ===========================================================================

@anvil.server.callable
def logout(token):
  """Invalidates a session token."""
  if not token:
    return
  try:
    db.execute(
      "UPDATE user_session SET is_active = FALSE WHERE token = %s",
      [token]
    )
  except Exception as e:
    print(f"[logout] ERROR: {e}")