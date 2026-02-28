# ===========================================================================
#  client_globals.py
#  Client-side session state for PrestoPlan.
#  Stores session token, current user, and UI state that persists
#  across form reloads within a session.
# ===========================================================================

# -- Session --
session_token = None
current_user  = None

# -- Collapse state: {layout_id: {wbs_id: bool}}
#    True = expanded, False = collapsed
wbs_collapse_state = {}


def set_session(token, user):
  """Store session token and user dict after successful login."""
  global session_token, current_user
  session_token = token
  current_user  = user


def clear_session():
  """Clear all session state on logout."""
  global session_token, current_user, wbs_collapse_state
  session_token      = None
  current_user       = None
  wbs_collapse_state = {}


def get_collapse_state(layout_id):
  """Return collapse dict for a layout, creating it if needed."""
  if layout_id not in wbs_collapse_state:
    wbs_collapse_state[layout_id] = {}
  return wbs_collapse_state[layout_id]


def set_collapse_state(layout_id, wbs_id, expanded):
  """Record expanded/collapsed state for one WBS node."""
  if layout_id not in wbs_collapse_state:
    wbs_collapse_state[layout_id] = {}
  wbs_collapse_state[layout_id][wbs_id] = expanded