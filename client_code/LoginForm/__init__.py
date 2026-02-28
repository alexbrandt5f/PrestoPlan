from ._anvil_designer import LoginFormTemplate
from anvil import *
import anvil.server
import anvil.js
from .. import client_globals


class LoginForm(LoginFormTemplate):
  """
  Login form - entry point for the PrestoPlan application.
  Handles user authentication and navigates to GanttForm on success.
  Remember Me stores email and session token in browser localStorage
  so the user is not prompted to log in again on subsequent visits.
  """

  def __init__(self, **properties):
    self.init_components(**properties)

    # Check for a saved session token and skip login if still valid
    try:
      saved_token = anvil.js.window.localStorage.getItem('prestoplan_token')
      if saved_token:
        result = anvil.server.call('validate_and_refresh_session', saved_token)
        if result and result.get('success'):
          client_globals.set_session(saved_token, result.get('user'))
          open_form('GanttForm')
          return
        else:
          # Token expired or invalid - clear it and show login
          anvil.js.window.localStorage.removeItem('prestoplan_token')
    except Exception:
      pass

    # Restore remembered email if previously saved
    try:
      remembered_email = anvil.js.window.localStorage.getItem('prestoplan_email')
      if remembered_email:
        self.txt_email.text = remembered_email
        self.chk_remember_me.checked = True
        self.txt_password.focus()
      else:
        self.txt_email.focus()
    except Exception:
      self.txt_email.focus()

  # ==========================================================================
  #  EVENT: Login button clicked
  # ==========================================================================

  @handle("btn_login", "click")
  def btn_login_click(self, **event_args):
    """
    Validates inputs, calls auth.login on the server, and navigates to
    GanttForm on success. Shows error message on failure.
    """
    # Clear any previous error
    self._show_error('')

    # Basic input validation
    email    = self.txt_email.text.strip()
    password = self.txt_password.text

    if not email:
      self._show_error('Please enter your email address.')
      self.txt_email.focus()
      return

    if not password:
      self._show_error('Please enter your password.')
      self.txt_password.focus()
      return

    # Disable button while logging in to prevent double-clicks
    self.btn_login.enabled = False
    self.btn_login.text    = 'Logging in...'

    try:
      result = anvil.server.call('login', email, password)

      if result.get('success'):

        # Save or clear localStorage based on Remember Me
        try:
          if self.chk_remember_me.checked:
            anvil.js.window.localStorage.setItem('prestoplan_email', email)
            anvil.js.window.localStorage.setItem(
              'prestoplan_token', result.get('token', '')
            )
          else:
            anvil.js.window.localStorage.removeItem('prestoplan_email')
            anvil.js.window.localStorage.removeItem('prestoplan_token')
        except Exception:
          pass  # localStorage not critical - ignore if unavailable

        # Store session state in client_globals
        client_globals.set_session(
          result.get('token'),
          result.get('user')
        )

        open_form('GanttForm')

      else:
        self._show_error(
          result.get('message', 'Login failed. Please try again.')
        )
        self.txt_password.text = ''
        self.txt_password.focus()

    except Exception as e:
      self._show_error(f'Connection error: {str(e)}')

    finally:
      # Re-enable button regardless of outcome
      self.btn_login.enabled = True
      self.btn_login.text    = 'Log In'

  # ==========================================================================
  #  EVENT: Enter key shortcuts
  # ==========================================================================

  @handle("txt_password", "pressed_enter")
  def txt_password_pressed_enter(self, **event_args):
    """Pressing Enter in the password field triggers login."""
    self.btn_login_click()

  @handle("txt_email", "pressed_enter")
  def txt_email_pressed_enter(self, **event_args):
    """Pressing Enter in the email field moves focus to password."""
    self.txt_password.focus()

  # ==========================================================================
  #  EVENT: Remember Me checkbox
  # ==========================================================================

  @handle("chk_remember_me", "change")
  def chk_remember_me_change(self, **event_args):
    """If Remember Me is unchecked, immediately clear saved credentials."""
    if not self.chk_remember_me.checked:
      try:
        anvil.js.window.localStorage.removeItem('prestoplan_email')
        anvil.js.window.localStorage.removeItem('prestoplan_token')
      except Exception:
        pass

  # ==========================================================================
  #  HELPER
  # ==========================================================================

  def _show_error(self, message):
    """Shows error label with message, or hides it if message is empty."""
    if message:
      self.lbl_error.text    = message
      self.lbl_error.visible = True
    else:
      self.lbl_error.text    = ''
      self.lbl_error.visible = False