from ._anvil_designer import MainFormTemplate
from anvil import *
import anvil.server
from .. import client_globals


class MainForm(MainFormTemplate):
  """
    Main application form for PrestoPlan.
    Contains the toolbar, collapsible filter panel, Gantt chart area,
    and the activity details pane at the bottom.
    """

  def __init__(self, **properties):
    self.init_components(**properties)

    # -- Internal state --
    self._filters_visible = False
    self._details_visible = True
    self._current_project_id = None
    self._current_import_id = None
    self._active_tab = 'general'
    self._selected_task_id = None

    # -- Verify session is active --
    if not client_globals.session_token:
      open_form('LoginForm')
      return

      # -- Set up nav bar user display --
    user = client_globals.current_user
    if user:
      self.lbl_nav_user.text = user.get('display_name', '')

      # -- Show project selector on load --
    self._open_project_selector()

    # ==========================================================================
    #  TOOLBAR EVENTS
    # ==========================================================================

  @handle("btn_toggle_filters", "click")
  def btn_toggle_filters_click(self, **event_args):
    """Show or hide the filter panel."""
    self._filters_visible = not self._filters_visible
    self.pnl_filters.visible = self._filters_visible
    self.btn_toggle_filters.text = 'Filters' if self._filters_visible else 'Filters'

  @handle("btn_toggle_details", "click")
  def btn_toggle_details_click(self, **event_args):
    """Show or hide the details pane at the bottom."""
    self._details_visible = not self._details_visible
    self.pnl_details.visible = self._details_visible
    self.btn_toggle_details.text = 'Show Details' if not self._details_visible else 'Hide Details'

  @handle("btn_select_project", "click")
  def btn_select_project_click(self, **event_args):
    """Open the project/import selector modal."""
    self._open_project_selector()

    # ==========================================================================
    #  PROJECT SELECTOR
    # ==========================================================================

  def _open_project_selector(self):
    """
        Opens modal alerts to let the user pick a project then an import.
        Loads project list from server, then import list once project is picked.
        """
    try:
      token = client_globals.session_token

      # Get list of projects user has access to
      projects = anvil.server.call('get_user_projects', token)

      if not projects:
        alert('You do not have access to any projects. Please contact your administrator.')
        return

        # Build project picker panel
      project_choices = [(p['project_name'], p['project_id']) for p in projects]
      project_panel = ColumnPanel()
      project_panel.add_component(Label(text='Select Project:', bold=True))
      dd_project = DropDown(items=project_choices, placeholder='Select a project...')
      project_panel.add_component(dd_project)

      if self._current_project_id:
        dd_project.selected_value = self._current_project_id

      result = alert(
        content=project_panel,
        title='Select Project',
        buttons=[('OK', True), ('Cancel', False)]
      )

      if not result or not dd_project.selected_value:
        return

      selected_project_id = dd_project.selected_value
      selected_project_name = next(
        (label for label, val in project_choices if val == dd_project.selected_value),
        'Unknown Project'
      )

      # Get imports for selected project
      imports = anvil.server.call('get_project_imports', token, selected_project_id)

      if not imports:
        alert('No imports found for this project. Please upload an XER file first.')
        return

        # Build import picker panel
      import_choices = [
        (f"{i.get('import_date', '')} - {i.get('label', 'No label')}", i['import_id'])
        for i in imports
      ]
      import_panel = ColumnPanel()
      import_panel.add_component(Label(text='Select Import:', bold=True))
      dd_import = DropDown(items=import_choices, placeholder='Select an import...')
      import_panel.add_component(dd_import)

      if self._current_import_id:
        dd_import.selected_value = self._current_import_id

      result2 = alert(
        content=import_panel,
        title='Select Import',
        buttons=[('OK', True), ('Cancel', False)]
      )

      if not result2 or not dd_import.selected_value:
        return

        # Store selections and update display
      self._current_project_id = selected_project_id
      self._current_import_id = dd_import.selected_value
      self.lbl_project.text = selected_project_name
      selected_import_label = next(
        (label for label, val in import_choices if val == dd_import.selected_value),
        'Unknown Import'
      )
      self.lbl_import.text = f"  {selected_import_label}"

      # Load the Gantt chart
      self._load_gantt()

    except Exception as e:
      alert(f'Error loading projects: {str(e)}')

    # ==========================================================================
    #  GANTT CHART
    # ==========================================================================

  def _load_gantt(self):
    """
        Calls the server to get Gantt data and renders the Plotly chart.
        Shows a loading message while waiting.
        """
    if not self._current_project_id or not self._current_import_id:
      return

    self.lbl_no_data.text = 'Loading Gantt chart...'
    self.lbl_no_data.visible = True
    self.plot_gantt.visible = False

    try:
      token = client_globals.session_token

      gantt_data = anvil.server.call(
        'get_gantt_data',
        token,
        self._current_project_id,
        self._current_import_id
      )

      if not gantt_data or not gantt_data.get('tasks'):
        self.lbl_no_data.text = 'No tasks found for this import.'
        return

      self._render_gantt(gantt_data)

    except Exception as e:
      self.lbl_no_data.text = f'Error loading Gantt: {str(e)}'

  def _render_gantt(self, gantt_data):
    """
        Renders the Plotly horizontal bar chart from gantt_data.
        Placeholder - full Plotly implementation to follow.
        """
    # TODO: Build full Plotly Gantt chart here
    task_count = len(gantt_data.get('tasks', []))
    self.lbl_no_data.text = f'Gantt data loaded: {task_count} tasks. Chart rendering coming soon.'
    self.lbl_no_data.visible = True

    # ==========================================================================
    #  FILTER EVENTS
    # ==========================================================================

  @handle("btn_apply_filters", "click")
  def btn_apply_filters_click(self, **event_args):
    """Re-load the Gantt with current filter settings applied."""
    self._load_gantt()

  @handle("btn_clear_filters", "click")
  def btn_clear_filters_click(self, **event_args):
    """Reset all filters to defaults and reload."""
    self.chk_not_started.checked = True
    self.chk_in_progress.checked = True
    self.chk_complete.checked = True
    self.chk_critical.checked = True
    self.chk_near_critical.checked = True
    self.chk_non_critical.checked = True
    self.dd_actcode_type.selected_value = None
    self.dd_actcode_value.items = []
    self._load_gantt()

  @handle("dd_actcode_type", "change")
  def dd_actcode_type_change(self, **event_args):
    """When activity code type changes, reload the value dropdown."""
    selected_type = self.dd_actcode_type.selected_value
    if not selected_type:
      self.dd_actcode_value.items = []
      return
    try:
      token = client_globals.session_token
      values = anvil.server.call(
        'get_actcode_values',
        token,
        self._current_import_id,
        selected_type
      )
      self.dd_actcode_value.items = [
        (v['short_name'], v['actv_code_id']) for v in values
      ]
    except Exception as e:
      alert(f'Error loading activity code values: {str(e)}')

    # ==========================================================================
    #  DETAILS PANE - TAB EVENTS
    # ==========================================================================

  @handle("tab_general", "click")
  def tab_general_click(self, **event_args):
    self._show_details_tab('general')

  @handle("tab_status", "click")
  def tab_status_click(self, **event_args):
    self._show_details_tab('status')

  @handle("tab_codes", "click")
  def tab_codes_click(self, **event_args):
    self._show_details_tab('codes')

  @handle("tab_relationships", "click")
  def tab_relationships_click(self, **event_args):
    self._show_details_tab('relationships')

  @handle("tab_notebook", "click")
  def tab_notebook_click(self, **event_args):
    self._show_details_tab('notebook')

  @handle("tab_udfs", "click")
  def tab_udfs_click(self, **event_args):
    self._show_details_tab('udfs')

  def _show_details_tab(self, tab_name):
    """Switches the active details tab and highlights the active button."""
    self._active_tab = tab_name

    all_tabs = {
      'general': self.tab_general,
      'status': self.tab_status,
      'codes': self.tab_codes,
      'relationships': self.tab_relationships,
      'notebook': self.tab_notebook,
      'udfs': self.tab_udfs
    }
    for name, btn in all_tabs.items():
      btn.role = 'primary-color' if name == tab_name else ''

    self._render_details_tab(tab_name)

  def _render_details_tab(self, tab_name):
    """
        Renders content of the selected details tab.
        Placeholder - full implementation to follow.
        """
    self.pnl_details_content.clear()

    if not self._selected_task_id:
      self.pnl_details_content.add_component(
        Label(text='Click an activity in the Gantt chart to see details.')
      )
      return

      # TODO: Render actual tab content from cached task data
    self.pnl_details_content.add_component(
      Label(text=f'[{tab_name.upper()} - task {self._selected_task_id} - coming soon]')
    )

    # ==========================================================================
    #  LOGOUT
    # ==========================================================================

  @handle("btn_logout", "click")
  def btn_logout_click(self, **event_args):
    """Log out and return to login form."""
    try:
      token = client_globals.session_token
      if token:
        anvil.server.call('logout', token)
    except Exception:
      pass  # Don't block logout if server call fails
    client_globals.clear_session()
    open_form('LoginForm')