import anvil.tables as tables
import anvil.tables.query as q
from anvil.tables import app_tables
import anvil.users
import anvil.stripe
"""
===============================================================================
 MODULE: db.py
 Description:  Database abstraction layer for Anvil server.
               All database access flows through this module.
               Connection string stored in Anvil Secrets — swap providers
               by changing one secret value.

 Provider:     Supabase (PostgreSQL) — or any PostgreSQL-compatible host.
 Dependencies: psycopg2, anvil.secrets

 Usage:
   from . import db
   rows = db.query("SELECT * FROM app_user WHERE email = %s", [email])
   db.execute("INSERT INTO audit_log (action) VALUES (%s)", ["login"])
===============================================================================
"""

import psycopg2
import psycopg2.extras
import anvil.secrets
import anvil.server
import traceback
from datetime import datetime


# ---------------------------------------------------------------------------
#  CONNECTION MANAGEMENT
# ---------------------------------------------------------------------------

def get_connection():
  """
    Returns a new psycopg2 connection using credentials from Anvil Secrets.

    Anvil Secrets required:
      - db_host:     e.g. "db.xxxx.supabase.co"
      - db_port:     e.g. "6543"  (use transaction pooler port for Supabase)
      - db_name:     e.g. "postgres"
      - db_user:     e.g. "postgres"
      - db_password: your database password

    Returns:
      psycopg2 connection object

    Raises:
      Exception if connection fails (logged before re-raising)
    """
  try:
    conn = psycopg2.connect(
      host=anvil.secrets.get_secret('db_host'),
      port=int(anvil.secrets.get_secret('db_port')),
      dbname=anvil.secrets.get_secret('db_name'),
      user=anvil.secrets.get_secret('db_user'),
      password=anvil.secrets.get_secret('db_password'),
      sslmode='require'
    )
    return conn
  except Exception as e:
    print(f"[db.get_connection] ERROR: {e}")
    print(traceback.format_exc())
    raise


def _with_connection(func):
  """
    Decorator that provides a connection and handles commit/rollback/close.
    The decorated function receives 'conn' as its first argument.
    """
  def wrapper(*args, **kwargs):
    conn = None
    try:
      conn = get_connection()
      result = func(conn, *args, **kwargs)
      conn.commit()
      return result
    except Exception as e:
      if conn:
        conn.rollback()
      print(f"[db] ERROR in {func.__name__}: {e}")
      print(traceback.format_exc())
      raise
    finally:
      if conn:
        conn.close()
  return wrapper


# ---------------------------------------------------------------------------
#  CORE QUERY FUNCTIONS
# ---------------------------------------------------------------------------

@_with_connection
def query(conn, sql, params=None):
  """
    Execute a SELECT query and return all rows as a list of dicts.

    Args:
      sql:    SQL string with %s placeholders
      params: list/tuple of parameter values (optional)

    Returns:
      list of dict — one dict per row, keys = column names
    """
  with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
    cur.execute(sql, params or [])
    rows = cur.fetchall()
    # Convert RealDictRow objects to plain dicts for JSON serialization
    return [dict(row) for row in rows]


@_with_connection
def query_one(conn, sql, params=None):
  """
    Execute a SELECT query and return a single row as a dict, or None.

    Args:
      sql:    SQL string with %s placeholders
      params: list/tuple of parameter values (optional)

    Returns:
      dict or None
    """
  with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
    cur.execute(sql, params or [])
    row = cur.fetchone()
    return dict(row) if row else None


@_with_connection
def execute(conn, sql, params=None):
  """
    Execute an INSERT, UPDATE, or DELETE statement.

    Args:
      sql:    SQL string with %s placeholders
      params: list/tuple of parameter values (optional)

    Returns:
      int — number of rows affected
    """
  with conn.cursor() as cur:
    cur.execute(sql, params or [])
    return cur.rowcount


@_with_connection
def execute_returning(conn, sql, params=None):
  """
    Execute an INSERT ... RETURNING statement and return the result.

    Args:
      sql:    SQL string with %s placeholders and RETURNING clause
      params: list/tuple of parameter values (optional)

    Returns:
      dict — the returned row
    """
  with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
    cur.execute(sql, params or [])
    row = cur.fetchone()
    return dict(row) if row else None


@_with_connection
def execute_many(conn, sql, params_list):
  """
    Execute a statement multiple times with different parameter sets.
    Useful for bulk inserts.

    Args:
      sql:         SQL string with %s placeholders
      params_list: list of tuples, each tuple is one set of params

    Returns:
      int — total rows affected
    """
  with conn.cursor() as cur:
    cur.executemany(sql, params_list)
    return cur.rowcount


@_with_connection
def execute_batch(conn, sql, params_list, page_size=1000):
  """
    Execute a statement in batches using psycopg2.extras.execute_batch.
    Much faster than execute_many for large datasets.

    Args:
      sql:         SQL string with %s placeholders
      params_list: list of tuples
      page_size:   number of rows per batch (default 1000)

    Returns:
      None (execute_batch doesn't return rowcount reliably)
    """
  with conn.cursor() as cur:
    psycopg2.extras.execute_batch(cur, sql, params_list, page_size=page_size)


@_with_connection
def execute_script(conn, sql_script):
  """
    Execute a multi-statement SQL script (e.g., for database initialization).
    No parameterization — use only for trusted DDL scripts.

    Args:
      sql_script: string containing multiple SQL statements

    Returns:
      None
    """
  with conn.cursor() as cur:
    cur.execute(sql_script)


@_with_connection
def table_exists(conn, table_name):
  """
    Check if a table exists in the public schema.

    Args:
      table_name: name of the table to check

    Returns:
      bool
    """
  with conn.cursor() as cur:
    cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = %s
            )
        """, [table_name.lower()])
    return cur.fetchone()[0]


@_with_connection
def get_table_columns(conn, table_name):
  """
    Get the list of column names for a table.

    Args:
      table_name: name of the table

    Returns:
      list of str — column names in ordinal order
    """
  with conn.cursor() as cur:
    cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = %s
            ORDER BY ordinal_position
        """, [table_name.lower()])
    return [row[0] for row in cur.fetchall()]


# ---------------------------------------------------------------------------
#  AUDIT LOGGING
# ---------------------------------------------------------------------------

@_with_connection
def log_audit(conn, user_id, action, detail=None, project_id=None):
  """
    Write an entry to the audit_log table.

    Args:
      user_id:    ID of the user performing the action
      action:     short action name (e.g., "import_xer", "login", "delete_import")
      detail:     optional longer description
      project_id: optional project context
    """
  with conn.cursor() as cur:
    cur.execute("""
            INSERT INTO audit_log (user_id, action, detail, project_id, created_at)
            VALUES (%s, %s, %s, %s, %s)
        """, [user_id, action, detail, project_id, datetime.utcnow()])


# ---------------------------------------------------------------------------
#  UTILITY: Dynamic table creation for XER import
# ---------------------------------------------------------------------------

@_with_connection
def create_p6_table(conn, table_name, column_names):
  """
    Dynamically create a P6 data table if it doesn't already exist.
    All P6 XER columns are stored as TEXT (matching XER export format).
    Adds system columns: pk (serial PK), import_id (FK), project_id (FK).

    Also registers the table in xer_table_registry.

    Args:
      table_name:   P6 table name (e.g., "TASKFDBK")
      column_names: list of P6 column names from the %F line

    Returns:
      None
    """
  safe_name = table_name.lower().replace('"', '')

  # Build column definitions — all TEXT
  col_defs = []
  for col in column_names:
    safe_col = col.lower().replace('"', '').strip()
    if safe_col:
      col_defs.append(f'    "{safe_col}" TEXT')

  col_defs_str = ",\n".join(col_defs)

  ddl = f"""
        CREATE TABLE IF NOT EXISTS "p6_{safe_name}" (
            pk SERIAL PRIMARY KEY,
            import_id INTEGER NOT NULL REFERENCES import_log(import_id) ON DELETE CASCADE,
            project_id INTEGER NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
        {col_defs_str}
        );
        CREATE INDEX IF NOT EXISTS idx_p6_{safe_name}_import ON "p6_{safe_name}" (import_id);
        CREATE INDEX IF NOT EXISTS idx_p6_{safe_name}_project ON "p6_{safe_name}" (project_id);
    """

  with conn.cursor() as cur:
    cur.execute(ddl)

    # Register in xer_table_registry
    cur.execute("""
            INSERT INTO xer_table_registry (table_name, column_names, created_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (table_name) DO UPDATE SET column_names = EXCLUDED.column_names
        """, [safe_name, ",".join(column_names), datetime.utcnow()])


# ---------------------------------------------------------------------------
#  BULK XER IMPORT — Single connection for all operations
# ---------------------------------------------------------------------------

def bulk_import_xer(table_inserts, alter_statements=None):
  """
    Execute the entire XER import in a SINGLE database connection:
      1. Run any ALTER TABLE statements to add missing columns
      2. Run all INSERT statements across all tables

    This avoids the overhead of 30+ connection open/close cycles.

    Args:
      table_inserts:    list of dicts, each with:
                          - sql:         INSERT statement with %s placeholders
                          - params_list: list of tuples (one per row)
                          - page_size:   batch size (default 1000)
      alter_statements: optional list of ALTER TABLE SQL strings to run first

    Returns:
      dict of table_index -> row_count inserted
    """
  conn = None
  try:
    conn = get_connection()
    results = {}

    # -- Step 1: Add any missing columns --
    if alter_statements:
      with conn.cursor() as cur:
        for alter_sql in alter_statements:
          try:
            cur.execute(alter_sql)
          except Exception as e:
            # Column might already exist — safe to ignore
            conn.rollback()
            conn = get_connection()
            print(f"[db.bulk_import_xer] ALTER warning: {e}")

      conn.commit()

      # -- Step 2: Bulk insert all table data --
    for i, item in enumerate(table_inserts):
      sql = item["sql"]
      params_list = item["params_list"]
      page_size = item.get("page_size", 1000)

      if params_list:
        with conn.cursor() as cur:
          psycopg2.extras.execute_batch(
            cur, sql, params_list, page_size=page_size
          )
        results[i] = len(params_list)
      else:
        results[i] = 0

    conn.commit()
    return results

  except Exception as e:
    if conn:
      conn.rollback()
    print(f"[db.bulk_import_xer] ERROR: {e}")
    print(traceback.format_exc())
    raise
  finally:
    if conn:
      conn.close()


# ---------------------------------------------------------------------------
#  CALLABLE TEST (for verifying connectivity from VBA or Anvil forms)
# ---------------------------------------------------------------------------

@anvil.server.http_endpoint("/test_db_connection", methods=["POST"])
def test_db_connection():
  """
    Quick connectivity test. Returns a dict with status and server version.
    Callable from VBA via Anvil API.
    """
  try:
    result = query_one("SELECT version() as ver")
    return {"status": "ok", "version": result["ver"]}
  except Exception as e:
    return {"status": "error", "message": str(e)}