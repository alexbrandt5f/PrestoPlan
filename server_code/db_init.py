import anvil.tables as tables
import anvil.tables.query as q
from anvil.tables import app_tables
import anvil.users
import anvil.stripe
"""
===============================================================================
 MODULE: db_init.py
 Description:  Database initialization script.
               Creates all system tables (users, OBS, rights, projects, imports)
               and pre-seeds common P6 XER data tables.

               Safe to run multiple times — uses CREATE TABLE IF NOT EXISTS.

 Usage (from Anvil server):
   from . import db_init
   db_init.initialize_database()

 Usage (as Anvil callable):
   Call "initialize_database" from VBA or Anvil forms.
===============================================================================
"""

import anvil.server
from datetime import datetime

# Import our db abstraction layer
from . import db


# ===========================================================================
#  SYSTEM TABLE DDL
# ===========================================================================

SYSTEM_TABLES_DDL = """

-- -----------------------------------------------------------------------
--  APP_USER — User accounts
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user (
    user_id       SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    display_name  VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_superuser  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    last_login    TIMESTAMP
);

-- -----------------------------------------------------------------------
--  OBS — Organizational Breakdown Structure (hierarchical)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS obs (
    obs_id         SERIAL PRIMARY KEY,
    obs_name       VARCHAR(255) NOT NULL,
    obs_short_name VARCHAR(50),
    parent_obs_id  INTEGER REFERENCES obs(obs_id) ON DELETE CASCADE,
    seq_num        INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_obs_parent ON obs (parent_obs_id);

-- -----------------------------------------------------------------------
--  OBS_USER_RIGHT — Links users to OBS nodes with right levels
--  right_level: 'superuser', 'editor', 'reader'
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS obs_user_right (
    obs_right_id  SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    obs_id        INTEGER NOT NULL REFERENCES obs(obs_id) ON DELETE CASCADE,
    right_level   VARCHAR(20) NOT NULL CHECK (right_level IN ('superuser', 'editor', 'reader')),
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, obs_id)
);
CREATE INDEX IF NOT EXISTS idx_obs_right_user ON obs_user_right (user_id);
CREATE INDEX IF NOT EXISTS idx_obs_right_obs ON obs_user_right (obs_id);

-- -----------------------------------------------------------------------
--  PROJECT — Projects linked to an OBS node
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project (
    project_id    SERIAL PRIMARY KEY,
    project_name  VARCHAR(500) NOT NULL,
    project_short VARCHAR(100),
    obs_id        INTEGER NOT NULL REFERENCES obs(obs_id),
    description   TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_by    INTEGER REFERENCES app_user(user_id),
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_obs ON project (obs_id);

-- -----------------------------------------------------------------------
--  IMPORT_LOG — Tracks every XER/XML file imported
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_log (
    import_id     SERIAL PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
    file_name     VARCHAR(500),
    file_type     VARCHAR(10) DEFAULT 'XER',
    import_date   TIMESTAMP NOT NULL DEFAULT NOW(),
    label         VARCHAR(255),
    notes         TEXT,
    data_date     TIMESTAMP,
    xer_version   VARCHAR(20),
    export_user   VARCHAR(255),
    record_count  INTEGER DEFAULT 0,
    imported_by   INTEGER REFERENCES app_user(user_id),
    table_summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_import_project ON import_log (project_id);

-- -----------------------------------------------------------------------
--  VERSION_COMPARE — Baseline + 3 compare slots per project
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS version_compare (
    vc_id         SERIAL PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
    slot_name     VARCHAR(50) NOT NULL,
    import_id     INTEGER REFERENCES import_log(import_id) ON DELETE SET NULL,
    UNIQUE(project_id, slot_name)
);

-- -----------------------------------------------------------------------
--  PROJECT_INFO — Flexible key/value metadata per project
--  Categories: 'Project', 'Team', 'Setting'
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_info (
    info_id       SERIAL PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
    info_key      VARCHAR(100) NOT NULL,
    info_value    TEXT,
    info_category VARCHAR(50) DEFAULT 'Project',
    sort_order    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_projinfo_project ON project_info (project_id);

-- -----------------------------------------------------------------------
--  XER_TABLE_REGISTRY — Tracks which P6 tables exist in the DB
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS xer_table_registry (
    table_name    VARCHAR(100) PRIMARY KEY,
    column_names  TEXT NOT NULL,
    description   VARCHAR(500),
    is_preseeded  BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------
--  APP_SETTING — System-wide settings (key/value)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_setting (
    setting_key   VARCHAR(100) PRIMARY KEY,
    setting_value TEXT,
    description   VARCHAR(500),
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------
--  AUDIT_LOG — Tracks who did what and when
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    log_id        SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES app_user(user_id),
    action        VARCHAR(100) NOT NULL,
    detail        TEXT,
    project_id    INTEGER REFERENCES project(project_id),
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log (project_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log (created_at);

-- -----------------------------------------------------------------------
--  SESSION — API session tokens for VBA authentication
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_session (
    session_id    SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    token         VARCHAR(255) NOT NULL UNIQUE,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMP NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_session_token ON user_session (token);
CREATE INDEX IF NOT EXISTS idx_session_user ON user_session (user_id);

"""


# ===========================================================================
#  P6 TABLE DEFINITIONS
#  Each entry: (table_name, description, [column_names])
#  All columns stored as TEXT.  The table will also get:
#    pk SERIAL, import_id INT FK, project_id INT FK
# ===========================================================================

P6_TABLES = [
  ("PROJECT", "P6 Project header", [
    "proj_id", "proj_short_name", "proj_long_name", "task_code_base",
    "task_code_step", "priority_num", "wbs_max_sum_level",
    "strgy_priority_num", "last_recalc_date", "plan_start_date",
    "plan_end_date", "scd_end_date", "add_date", "last_tasksum_date",
    "fcst_start_date", "def_complete_pct_type", "task_code_prefix",
    "guid", "def_cost_per_qty", "def_duration_type", "def_qty_type",
    "def_task_type", "act_pct_link_flag", "add_act_remain_flag",
    "allow_complete_flag", "allow_neg_act_flag", "batch_sum_flag",
    "chng_eff_cmp_pct_flag", "checkout_date", "checkout_flag",
    "critical_drtn_hr_cnt", "critical_path_type",
    "def_rollup_dates_flag", "last_baseline_update_date",
    "last_fin_dates_id", "last_schedule_date", "name_sep_char",
    "neg_total_float_hr_cnt", "rem_target_link_flag",
    "reset_planned_flag", "rsrc_self_add_flag", "step_complete_flag",
    "sum_assign_level", "sum_base_proj_id", "sum_only_flag",
    "sum_task_flag", "task_code_prefix_flag", "def_rollup_dates_type",
    "location_id", "loaded_scope"
  ]),

  ("PROJWBS", "P6 Work Breakdown Structure", [
    "wbs_id", "proj_id", "obs_id", "seq_num", "est_wt",
    "proj_node_flag", "sum_data_flag", "status_code",
    "wbs_short_name", "wbs_name", "phase_id", "parent_wbs_id",
    "ev_user_pct", "ev_etc_user_value", "orig_cost",
    "indep_remain_total_cost", "ann_dscnt_rate_pct",
    "dscnt_period_type", "indep_remain_work_qty",
    "anticip_start_date", "anticip_end_date", "ev_compute_type",
    "ev_etc_compute_type", "guid", "tmpl_guid",
    "plan_open_state", "memo_assignment_image"
  ]),

  ("TASK", "P6 Activities", [
    "task_id", "proj_id", "wbs_id", "clndr_id", "phys_complete_pct",
    "rev_fdbk_flag", "est_wt", "lock_plan_flag", "auto_compute_act_flag",
    "complete_pct_type", "task_type", "duration_type", "status_code",
    "task_code", "task_name", "rsrc_id", "total_float_hr_cnt",
    "free_float_hr_cnt", "remain_drtn_hr_cnt", "act_work_qty",
    "remain_work_qty", "target_work_qty", "target_drtn_hr_cnt",
    "target_equip_qty", "act_equip_qty", "remain_equip_qty",
    "cstr_date", "act_start_date", "act_end_date",
    "late_start_date", "late_end_date", "expect_end_date",
    "early_start_date", "early_end_date", "restart_date",
    "reend_date", "target_start_date", "target_end_date",
    "rem_late_start_date", "rem_late_end_date",
    "cstr_type", "priority_type", "suspend_date", "resume_date",
    "float_path", "float_path_order", "guid",
    "tmpl_guid", "cstr_date2", "cstr_type2",
    "driving_path_flag", "act_this_per_work_qty",
    "act_this_per_equip_qty", "external_early_start_date",
    "external_late_end_date", "create_date", "update_date",
    "create_user", "update_user", "location_id", "sofq_id"
  ]),

  ("TASKPRED", "P6 Activity Relationships", [
    "task_pred_id", "task_id", "pred_task_id", "proj_id",
    "pred_proj_id", "pred_type", "lag_hr_cnt", "float_path",
    "aref", "arls", "comments"
  ]),

  ("CALENDAR", "P6 Calendars", [
    "clndr_id", "default_flag", "clndr_name", "proj_id",
    "base_clndr_id", "last_chng_date", "clndr_type",
    "day_hr_cnt", "week_hr_cnt", "month_hr_cnt", "year_hr_cnt",
    "rsrc_private", "clndr_data"
  ]),

  ("ACTVTYPE", "P6 Activity Code Types", [
    "actv_code_type_id", "actv_code_type", "actv_code_type_scope",
    "seq_num", "actv_short_len", "super_flag", "proj_id",
    "wbs_id", "memo_assignment_image"
  ]),

  ("ACTVCODE", "P6 Activity Code Values", [
    "actv_code_id", "parent_actv_code_id", "actv_code_type_id",
    "actv_code_name", "short_name", "seq_num", "color",
    "total_assignments"
  ]),

  ("TASKACTV", "P6 Activity Code Assignments", [
    "task_id", "actv_code_type_id", "actv_code_id", "proj_id"
  ]),

  ("UDFTYPE", "P6 User Defined Field Types", [
    "udf_type_id", "table_name", "udf_type_name", "udf_type_label",
    "logical_data_type", "super_flag", "indicator_expression",
    "summary_indicator_expression"
  ]),

  ("UDFVALUE", "P6 User Defined Field Values", [
    "udf_type_id", "fk_id", "proj_id", "udf_date", "udf_number",
    "udf_text", "udf_code_id"
  ]),

  ("RSRC", "P6 Resources", [
    "rsrc_id", "parent_rsrc_id", "clndr_id", "role_id",
    "rsrc_seq_num", "email_addr", "employee_code", "guid",
    "rsrc_name", "rsrc_short_name", "rsrc_title_name",
    "def_qty_per_hr", "cost_qty_type", "ot_factor",
    "active_flag", "auto_compute_act_flag", "def_cost_qty_link_flag",
    "ot_flag", "curr_id", "unit_id", "rsrc_type",
    "location_id", "rsrc_notes"
  ]),

  ("RSRCRATE", "P6 Resource Rates/Prices", [
    "rsrc_rate_id", "rsrc_id", "cost_per_qty", "cost_per_qty2",
    "cost_per_qty3", "cost_per_qty4", "cost_per_qty5",
    "max_qty_per_hr", "start_date", "shift_period_id"
  ]),

  ("TASKRSRC", "P6 Activity Resource Assignments", [
    "taskrsrc_id", "task_id", "proj_id", "rsrc_id", "acct_id",
    "role_id", "guid", "remain_qty", "target_qty",
    "remain_cost", "act_reg_qty", "act_ot_qty", "act_reg_cost",
    "act_ot_cost", "act_start_date", "act_end_date",
    "restart_date", "reend_date", "target_start_date",
    "target_end_date", "rem_late_start_date", "rem_late_end_date",
    "target_qty_per_hr", "target_lag_drtn_hr_cnt",
    "target_crv", "actual_crv", "remain_crv",
    "act_this_per_cost", "act_this_per_qty",
    "curv_id", "rsrc_type", "cost_per_qty",
    "cost_per_qty_source_type", "create_date", "create_user",
    "pend_act_ot_qty", "pend_act_reg_qty",
    "ts_pend_act_end_flag", "cost_qty_link_flag",
    "has_rsrchours", "rollup_dates_flag"
  ]),

  ("MEMOTYPE", "P6 Notebook Topics", [
    "memo_type_id", "memo_type", "proj_id", "wbs_id",
    "seq_num", "memo_cat_flag"
  ]),

  ("TASKMEMO", "P6 Activity Notebook Entries", [
    "memo_id", "task_id", "memo_type_id", "proj_id",
    "task_memo"
  ]),

  ("PCATTYPE", "P6 Project Code Types", [
    "proj_catg_type_id", "proj_catg_short_len", "seq_num",
    "proj_catg_type", "super_flag"
  ]),

  ("PCATVAL", "P6 Project Code Values", [
    "proj_catg_id", "proj_catg_type_id", "parent_proj_catg_id",
    "proj_catg_name", "proj_catg_short_name", "seq_num"
  ]),

  ("PROJPCAT", "P6 Project Code Assignments", [
    "proj_id", "proj_catg_type_id", "proj_catg_id"
  ]),

  ("ACCOUNT", "P6 Cost Accounts", [
    "acct_id", "parent_acct_id", "acct_seq_num", "acct_name",
    "acct_short_name", "acct_descr"
  ]),

  ("COSTTYPE", "P6 Expense Categories", [
    "cost_type_id", "seq_num", "cost_type", "cost_type_short_name"
  ]),

  ("CURRTYPE", "P6 Currency Types", [
    "curr_id", "decimal_digit_cnt", "decimal_symbol",
    "digit_group_symbol", "neg_curr_fmt_type",
    "pos_curr_fmt_type", "curr_short_name",
    "curr_symbol", "curr_type", "group_digit_cnt",
    "base_exch_rate"
  ]),

  ("SCHEDOPTIONS", "P6 Schedule Options", [
    "schedoptions_id", "proj_id", "sched_outer_depend_type",
    "sched_open_critical_flag", "sched_lag_early_start_flag",
    "sched_retained_logic", "sched_setplantoforecast",
    "sched_float_type", "sched_calendar_on_relationship_lag",
    "sched_out_of_sequence_type", "sched_progress_override",
    "sched_type", "sched_use_expect_end_flag",
    "sched_use_project_end_date_for_float",
    "enable_multiple_longest_path_calc",
    "limit_multiple_longest_path_calc",
    "max_multiple_longest_path", "use_total_float_multiple_longest_paths",
    "key_activity_for_multiple_longest_paths",
    "LevelPriorityList"
  ]),

  ("OBS_P6", "P6 OBS (organizational breakdown from XER)", [
    "obs_id", "parent_obs_id", "seq_num", "obs_name",
    "obs_short_name", "guid"
  ]),

  ("TASKPROC", "P6 Activity Steps", [
    "proc_id", "task_id", "proj_id", "seq_num",
    "proc_name", "proc_descr", "complete_flag",
    "complete_pct", "proc_wt"
  ]),

  ("TASKFIN", "P6 Activity Past Period Actuals", [
    "taskfin_id", "task_id", "proj_id", "fin_dates_id",
    "act_cost", "act_qty", "bcwp", "bcws",
    "target_cost", "target_qty"
  ]),

  ("TRSRCFIN", "P6 Activity Resource Past Period Actuals", [
    "trsrcfin_id", "taskrsrc_id", "task_id", "proj_id",
    "fin_dates_id", "act_cost", "act_qty"
  ]),

  ("ROLES", "P6 Roles", [
    "role_id", "parent_role_id", "seq_num", "role_name",
    "role_short_name", "role_descr", "def_cost_qty_link_flag",
    "cost_qty_type"
  ]),

  ("RSRCROLE", "P6 Resource Role Assignments", [
    "rsrc_id", "role_id", "def_flag"
  ]),

  ("ROLERATE", "P6 Role Rates", [
    "role_rate_id", "role_id", "cost_per_qty",
    "cost_per_qty2", "cost_per_qty3", "cost_per_qty4",
    "cost_per_qty5", "start_date"
  ]),

  ("FINDATES", "P6 Financial Period Dates", [
    "fin_dates_id", "fin_dates_name", "start_date", "end_date"
  ]),
]


# ===========================================================================
#  INITIALIZATION FUNCTION
# ===========================================================================

@anvil.server.callable
def initialize_database(create_default_superuser=True):
  """
    Create all system tables and pre-seeded P6 tables.
    Safe to run multiple times (IF NOT EXISTS on everything).

    Args:
      create_default_superuser: if True, creates a default admin account

    Returns:
      dict with summary of what was created
    """
  results = {
    "system_tables": "created",
    "p6_tables_created": 0,
    "p6_tables_skipped": 0,
    "default_user": None,
    "errors": []
  }

  # -- Step 1: Create system tables --
  try:
    db.execute_script(SYSTEM_TABLES_DDL)
    results["system_tables"] = "ok"
  except Exception as e:
    results["system_tables"] = f"error: {e}"
    results["errors"].append(f"System tables: {e}")

    # -- Step 2: Create pre-seeded P6 tables --
  for table_name, description, columns in P6_TABLES:
    try:
      safe_name = table_name.lower()

      # Build column definitions
      col_defs = []
      for col in columns:
        safe_col = col.lower().strip()
        if safe_col:
          col_defs.append(f'    "{safe_col}" TEXT')

      col_defs_str = ",\n".join(col_defs)

      # P6's OBS table conflicts with our system obs table
      # so we store it as "p6_obs_p6" instead of "p6_obs"
      db_table_name = f"p6_{safe_name}"

      ddl = f"""
            CREATE TABLE IF NOT EXISTS "{db_table_name}" (
                pk SERIAL PRIMARY KEY,
                import_id INTEGER NOT NULL REFERENCES import_log(import_id) ON DELETE CASCADE,
                project_id INTEGER NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
            {col_defs_str}
            );
            CREATE INDEX IF NOT EXISTS idx_{db_table_name}_import ON "{db_table_name}" (import_id);
            CREATE INDEX IF NOT EXISTS idx_{db_table_name}_project ON "{db_table_name}" (project_id);
            """

      db.execute_script(ddl)

      # Register in xer_table_registry
      db.execute("""
                INSERT INTO xer_table_registry (table_name, column_names, description, is_preseeded, created_at)
                VALUES (%s, %s, %s, TRUE, %s)
                ON CONFLICT (table_name) DO UPDATE
                    SET column_names = EXCLUDED.column_names,
                        description = EXCLUDED.description
            """, [safe_name, ",".join(columns), description, datetime.utcnow()])

      results["p6_tables_created"] += 1

    except Exception as e:
      results["errors"].append(f"P6 table {table_name}: {e}")
      results["p6_tables_skipped"] += 1

    # -- Step 3: Create default superuser --
  if create_default_superuser:
    try:
      existing = db.query_one(
        "SELECT user_id FROM app_user WHERE email = %s",
        ["admin@localhost"]
      )
      if not existing:
        import hashlib
        # Simple hash for initial setup — replace with bcrypt in auth.py
        pwd_hash = hashlib.sha256("changeme123".encode()).hexdigest()
        db.execute("""
                    INSERT INTO app_user (email, display_name, password_hash, is_superuser)
                    VALUES (%s, %s, %s, TRUE)
                """, ["admin@localhost", "System Admin", pwd_hash])
        results["default_user"] = "created (admin@localhost / changeme123)"
      else:
        results["default_user"] = "already exists"
    except Exception as e:
      results["errors"].append(f"Default user: {e}")

    # -- Step 4: Insert default version compare slots --
  try:
    # These will be used when a project is created
    db.execute("""
            INSERT INTO app_setting (setting_key, setting_value, description)
            VALUES
                ('version_compare_slots', 'Baseline,Compare1,Compare2,Compare3',
                 'Default slot names for version comparison'),
                ('session_timeout_hours', '24',
                 'Hours before a session token expires'),
                ('app_version', '2.0.0',
                 'Current PrestoPlan application version')
            ON CONFLICT (setting_key) DO NOTHING
        """)
  except Exception as e:
    results["errors"].append(f"Default settings: {e}")

  return results