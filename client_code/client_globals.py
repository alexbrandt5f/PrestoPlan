# ===========================================================================
#  client_globals.py
#  Global client-side state shared across all forms.
#  Avoids circular imports by giving all forms a neutral place
#  to read/write session data.
# ===========================================================================

session_token = None
current_user = None

def set_session(token, user):
  """Called by LoginForm after successful login."""
  global session_token, current_user
  session_token = token
  current_user = user

def clear_session():
  """Called on logout."""
  global session_token, current_user
  session_token = None
  current_user = None