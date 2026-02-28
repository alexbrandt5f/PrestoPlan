import anvil.tables as tables
import anvil.tables.query as q
from anvil.tables import app_tables
import anvil.users
import anvil.stripe
"""
===============================================================================
 MODULE: auth.py
 Description:  Authentication and OBS-based authorization for the Anvil server.
               Handles user login, session tokens, and P6-style OBS rights.

 Rights Model (P6-style):
   - Each project is linked to an OBS node.
   - Users are assigned rights at OBS nodes: superuser, editor, reader.
   - If a user has access to a parent OBS node, they inherit access to
     all child OBS nodes.

 HTTP Endpoints (called by VBA via HTTPS POST):
   /_/api/login              - authenticate user, return session token
   /_/api/validate_session   - check if a token is still valid
   /_/api/logout             - invalidate a session token

 Internal Functions (called by other Python modules only):
   validate_session(token)      - returns user dict or None
   check_project_access(...)    - returns access dict
   resolve_obs_rights(...)      - returns effective right level

 Usage from other Anvil modules:
   from . import auth
   user = auth.validate_session(token)
   access = auth.check_project_access(token, project_id, "editor")
===============================================================================
"""

import anvil.server
import json
import hashlib
import secrets
from datetime import datetime, timedelta
from . import db


# ===========================================================================
#  PASSWORD HASHING
#  NOTE: For production, replace with bcrypt. Using SHA256 + salt for now
#  because bcrypt requires pip install on Anvil.
# ===========================================================================

def _hash_password(password, salt=None):
  """Hash a password with a salt. Returns 'salt:hash' string."""
  if salt is None:
    salt = secrets.token_hex(16)
  hashed = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
  return f"{salt}:{hashed}"


def _verify_password(password, stored_hash):
  """Verify a password against a stored 'salt:hash' string."""
  # Handle legacy unsalted hashes (from db_init default user)
  if ":" not in stored_hash:
    return hashlib.sha256(password.encode()).hexdigest() == stored_hash

  salt, _ = stored_hash.split(":", 1)
  return _hash_password(password, salt) == stored_hash

# ===========================================================================
#  CALLABLE FUNCTIONS — Called by Anvil client-side forms (not VBA)
# ===========================================================================

@anvil.server.callable
def login(email, password):
  """
    Authenticate a user from the Anvil frontend.
    Called by Form1 login button.
    
    Args:
      email:    user's email address
      password: plain text password
      
    Returns:
      dict: {success, token, user, message}
    """
  try:
    email = email.strip().lower()

    if not email or not password:
      return {"success": False, "message": "Email and password are required."}

      # -- Look up user --
    user = db.query_one(
      "SELECT user_id, display_name, password_hash, is_superuser, is_active "
      "FROM app_user WHERE email = %s",
      [email]
    )

    if not user:
      return {"success": False, "message": "Invalid email or password."}

    if not user["is_active"]:
      return {"success": False, "message": "Your account has been disabled."}

      # -- Verify password --
    if not _verify_password(password, user["password_hash"]):
      return {"success": False, "message": "Invalid email or password."}

      # -- Get session timeout from settings --
    timeout_setting = db.query_one(
      "SELECT setting_value FROM app_setting "
      "WHERE setting_key = 'session_timeout_hours'"
    )
    timeout_hours = int(timeout_setting["setting_value"]) if timeout_setting else 24

    # -- Create session token --
    token = secrets.token_urlsafe(48)
    expires_at = datetime.utcnow() + timedelta(hours=timeout_hours)

    db.execute(
      "INSERT INTO user_session (user_id, token, expires_at) "
      "VALUES (%s, %s, %s)",
      [user["user_id"], token, expires_at]
    )

    # -- Update last login --
    db.execute(
      "UPDATE app_user SET last_login = %s WHERE user_id = %s",
      [datetime.utcnow(), user["user_id"]]
    )

    return {
      "success": True,
      "token": token,
      "user": {
        "user_id": user["user_id"],
        "display_name": user["display_name"],
        "is_superuser": user["is_superuser"]
      }
    }

  except Exception as e:
    print(f"[auth.login] ERROR: {e}")
    return {"success": False, "message": f"Login error: {str(e)}"}

@anvil.server.callable
def validate_and_refresh_session(token):
  """
  Validate a saved session token from localStorage.
  If valid, extends the expiry so active users stay logged in.
  Called by LoginForm on startup to skip the login screen.

  Args:
    token: session token string from localStorage

  Returns:
    dict: {success: True, user: {...}} if valid
    dict: {success: False} if invalid or expired
  """
  try:
    user = validate_session(token)

    if not user:
      return {'success': False}

    # Extend session expiry so active users don't get kicked out
    timeout_setting = db.query_one(
      "SELECT setting_value FROM app_setting "
      "WHERE setting_key = 'session_timeout_hours'"
    )
    timeout_hours = int(timeout_setting['setting_value']) if timeout_setting else 24
    new_expiry = datetime.utcnow() + timedelta(hours=timeout_hours)

    db.execute(
      "UPDATE user_session SET expires_at = %s WHERE token = %s",
      [new_expiry, token]
    )

    return {'success': True, 'user': user}

  except Exception as e:
    print(f'[auth.validate_and_refresh_session] ERROR: {e}')
    return {'success': False}
    
# ===========================================================================
#  HTTP ENDPOINT HELPERS
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
#  LOGIN / SESSION MANAGEMENT — HTTP ENDPOINTS (called by VBA)
# ===========================================================================

@anvil.server.http_endpoint("/login", methods=["POST"])
def api_login(**kwargs):
  """
    Authenticate a user and return a session token.

    VBA URL: {base}/_/api/login
    POST body: {"email": "...", "password": "..."}

    Returns JSON:
      Success: {status, token, user_id, display_name, is_superuser, expires_at}
      Failure: {status: "error", message: "..."}
    """
  result = {"status": "error", "message": "Invalid credentials"}

  try:
    body = anvil.server.request.body_json

    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    if not email or not password:
      return _error_response("Email and password are required", 400)

      # -- Look up user --
    user = db.query_one(
      "SELECT user_id, display_name, password_hash, is_superuser, is_active "
      "FROM app_user WHERE email = %s",
      [email]
    )

    if not user:
      return _error_response("Invalid credentials", 401)

    if not user["is_active"]:
      return _error_response("Account is disabled", 401)

      # -- Verify password --
    if not _verify_password(password, user["password_hash"]):
      return _error_response("Invalid credentials", 401)

      # -- Get session timeout from settings --
    timeout_setting = db.query_one(
      "SELECT setting_value FROM app_setting "
      "WHERE setting_key = 'session_timeout_hours'"
    )
    timeout_hours = int(timeout_setting["setting_value"]) if timeout_setting else 24

    # -- Create session token --
    token = secrets.token_urlsafe(48)
    expires_at = datetime.utcnow() + timedelta(hours=timeout_hours)

    db.execute(
      "INSERT INTO user_session (user_id, token, expires_at) "
      "VALUES (%s, %s, %s)",
      [user["user_id"], token, expires_at]
    )

    # -- Update last login --
    db.execute(
      "UPDATE app_user SET last_login = %s WHERE user_id = %s",
      [datetime.utcnow(), user["user_id"]]
    )

    # -- Audit log --
    db.log_audit(user["user_id"], "login", "Login from VBA client")

    return _success_response({
      "token": token,
      "user_id": user["user_id"],
      "display_name": user["display_name"],
      "is_superuser": user["is_superuser"],
      "expires_at": expires_at.isoformat()
    })

  except Exception as e:
    return _error_response(f"Login error: {e}", 500)


@anvil.server.http_endpoint("/validate_session", methods=["POST"])
def api_validate_session(**kwargs):
  """
    Validate a session token and return user info.

    VBA URL: {base}/_/api/validate_session
    POST body: {"token": "..."}

    Returns JSON:
      Valid:   {status: "ok", user_id, display_name, is_superuser}
      Invalid: {status: "error", message: "..."}
    """
  try:
    body = anvil.server.request.body_json
    token = body.get("token", "")

    user = validate_session(token)

    if user:
      return _success_response({
        "user_id": user["user_id"],
        "display_name": user["display_name"],
        "email": user.get("email", ""),
        "is_superuser": user["is_superuser"]
      })
    else:
      return _error_response("Invalid or expired session", 401)

  except Exception as e:
    return _error_response(f"Validation error: {e}", 500)


@anvil.server.http_endpoint("/logout", methods=["POST"])
def api_logout(**kwargs):
  """
    Invalidate a session token.

    VBA URL: {base}/_/api/logout
    POST body: {"token": "..."}
    """
  try:
    body = anvil.server.request.body_json
    token = body.get("token", "")

    if token:
      db.execute(
        "UPDATE user_session SET is_active = FALSE WHERE token = %s",
        [token]
      )

    return _success_response({"message": "Logged out"})

  except Exception as e:
    return _error_response(f"Logout error: {e}", 500)


# ===========================================================================
#  SESSION VALIDATION — Internal function (called by other Python modules)
# ===========================================================================

def validate_session(token):
  """
    Validate a session token and return user info dict, or None.

    This is an INTERNAL function — called by other Python modules (like
    data_access.py), NOT directly by VBA. VBA calls the /validate_session
    HTTP endpoint above, which in turn calls this function.

    Args:
      token: session token string

    Returns:
      dict with user info if valid, or None if invalid/expired
    """
  if not token:
    return None

  try:
    row = db.query_one("""
            SELECT s.user_id, s.expires_at, s.is_active,
                   u.display_name, u.email, u.is_superuser
            FROM user_session s
            JOIN app_user u ON s.user_id = u.user_id
            WHERE s.token = %s
        """, [token])

    if not row:
      return None

    if not row["is_active"]:
      return None

    if row["expires_at"] < datetime.utcnow():
      # Expire the session
      db.execute(
        "UPDATE user_session SET is_active = FALSE WHERE token = %s",
        [token]
      )
      return None

    return {
      "user_id": row["user_id"],
      "email": row["email"],
      "display_name": row["display_name"],
      "is_superuser": row["is_superuser"]
    }

  except Exception as e:
    print(f"[auth.validate_session] ERROR: {e}")
    return None


# ===========================================================================
#  OBS-BASED AUTHORIZATION — Internal functions
# ===========================================================================

def _get_obs_ancestors(obs_id):
  """
    Walk up the OBS tree and return a list of all ancestor obs_ids
    (including the given obs_id itself).
    """
  ancestors = []
  current_id = obs_id
  visited = set()

  while current_id and current_id not in visited:
    visited.add(current_id)
    ancestors.append(current_id)
    row = db.query_one(
      "SELECT parent_obs_id FROM obs WHERE obs_id = %s",
      [current_id]
    )
    current_id = row["parent_obs_id"] if row else None

  return ancestors


# Right level hierarchy: superuser > editor > reader
_RIGHT_LEVELS = {"superuser": 3, "editor": 2, "reader": 1}


def resolve_obs_rights(user_id, obs_id):
  """
    Determine the effective right level a user has at a given OBS node.
    Checks the node itself and all ancestors (inheritance).

    Args:
      user_id: the user to check
      obs_id:  the OBS node to check

    Returns:
      str or None — "superuser", "editor", "reader", or None (no access)
    """
  # Check if user is a global superuser
  user = db.query_one(
    "SELECT is_superuser FROM app_user WHERE user_id = %s",
    [user_id]
  )
  if user and user["is_superuser"]:
    return "superuser"

    # Get all OBS ancestors
  ancestors = _get_obs_ancestors(obs_id)
  if not ancestors:
    return None

    # Check rights at each ancestor
  placeholders = ",".join(["%s"] * len(ancestors))
  rights = db.query(
    f"SELECT obs_id, right_level FROM obs_right "
    f"WHERE user_id = %s AND obs_id IN ({placeholders})",
    [user_id] + ancestors
  )

  if not rights:
    return None

    # Return the highest right level found
  best_level = 0
  best_right = None
  for r in rights:
    level = _RIGHT_LEVELS.get(r["right_level"], 0)
    if level > best_level:
      best_level = level
      best_right = r["right_level"]

  return best_right


def check_project_access(token, project_id, required_level):
  """
    Check if the user (identified by token) has at least the required
    access level to a project.

    Args:
      token:          session token
      project_id:     project to check
      required_level: "reader", "editor", or "superuser"

    Returns:
      dict: {"allowed": True/False, "message": "...", "effective_level": "..."}
    """
  user = validate_session(token)
  if not user:
    return {"allowed": False, "message": "Invalid session"}

    # Global superusers have access to everything
  if user["is_superuser"]:
    return {"allowed": True, "message": "Superuser access",
            "effective_level": "superuser"}

    # Get the project's OBS node
  project = db.query_one(
    "SELECT obs_id FROM project WHERE project_id = %s",
    [project_id]
  )
  if not project or not project.get("obs_id"):
    return {"allowed": False,
            "message": "Project not found or has no OBS assignment"}

    # Check the user's effective rights at this OBS node
  effective = resolve_obs_rights(user["user_id"], project["obs_id"])
  if not effective:
    return {"allowed": False, "message": "No access to this project",
            "effective_level": None}

  required_num = _RIGHT_LEVELS.get(required_level, 0)
  effective_num = _RIGHT_LEVELS.get(effective, 0)

  if effective_num >= required_num:
    return {"allowed": True, "message": f"Access granted ({effective})",
            "effective_level": effective}
  else:
    return {"allowed": False,
            "message": f"Requires {required_level}, you have {effective}",
            "effective_level": effective}