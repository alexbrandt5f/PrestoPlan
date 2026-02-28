from ._anvil_designer import MainFormTemplate
from anvil import *
import anvil.server
import anvil.js
from anvil.js.window import document
from .. import client_globals


# ---------------------------------------------------------------------------
#  Bar colour scheme - matches P6 conventions
#  1 = actual (blue), 2 = normal (green),
#  3 = near-critical (orange), 4 = critical (red)
# ---------------------------------------------------------------------------
BAR_COLOURS = {
  '1': '#1565c0',   # actual - blue
  '2': '#2e7d32',   # normal - green
  '3': '#e65100',   # near-critical - orange
  '4': '#c62828',   # critical - red
}
MILESTONE_COLOURS = {
  'M1': '#1565c0',
  'M2': '#2e7d32',
  'M3': '#e65100',
  'M4': '#c62828',
}

ROW_HEIGHT    = 24    # px per row - columns table and Plotly must match
COL_HEADER_H  = 48    # px for the column header row


class MainForm(MainFormTemplate):
  """
  Main application form for PrestoPlan.

  Layout:
    - Top toolbar: project/import labels, Change Project, Hide/Show Details
    - Left sidebar: layout picker, saved filters, collapsible GFS panel
    - Centre: synced column table (HTML) + Plotly Gantt bars
    - Bottom: fixed Activity Details pane with tabs
  """

  def __init__(self, **properties):
    self.init_components(**properties)

    # -- Internal state --
    self._filters_visible  = False
    self._details_visible  = True
    self._gfs_visible      = False
    self._current_project_id  = None
    self._current_import_id   = None
    self._active_tab       = 'general'
    self._selected_task_id = None
    self._gantt_data       = None   # full response from get_gantt_data
    self._detail_cache     = {}     # task_id -> detail dict

    # -- Verify session is active --
    if not client_globals.session_token:
      open_form('LoginForm')
      return

    # -- Set up nav bar user display --
    user = client_globals.current_user
    if user:
      self.lbl_nav_user.text = user.get('display_name', '')

    # -- Populate sidebar dropdowns with placeholders --
    self.dd_layout.items       = [('Default layout', 'default')]
    self.dd_saved_filters.items = [('No filter applied', None)]

    # -- Show project selector on load --
    self._open_project_selector()

  # ==========================================================================
  #  TOOLBAR EVENTS
  # ==========================================================================

  @handle("btn_toggle_details", "click")
  def btn_toggle_details_click(self, **event_args):
    """Show or hide the details pane at the bottom."""
    self._details_visible = not self._details_visible
    self.pnl_details.visible = self._details_visible
    self.btn_toggle_details.text = (
      'Hide Details' if self._details_visible else 'Show Details'
    )

  @handle("btn_select_project", "click")
  def btn_select_project_click(self, **event_args):
    """Open the project/import selector modal."""
    self._open_project_selector()

  # ==========================================================================
  #  SIDEBAR EVENTS
  # ==========================================================================

  @handle("btn_toggle_gfs", "click")
  def btn_toggle_gfs_click(self, **event_args):
    """Expand or collapse the Grouping/Filtering/Sorting panel."""
    self._gfs_visible = not self._gfs_visible
    self.pnl_gfs.visible = self._gfs_visible
    self.btn_toggle_gfs.text = (
      '▼ Grouping / Filtering / Sorting'
      if self._gfs_visible else
      '▶ Grouping / Filtering / Sorting'
    )

  @handle("dd_layout", "change")
  def dd_layout_change(self, **event_args):
    """Apply selected layout. Placeholder - full implementation in future phase."""
    pass  # TODO: load saved layout config and re-render

  @handle("dd_saved_filters", "change")
  def dd_saved_filters_change(self, **event_args):
    """Apply a saved filter set. Placeholder - full implementation in future phase."""
    pass  # TODO: populate filter controls from saved filter and reload

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
        alert(
          'You do not have access to any projects. '
          'Please contact your administrator.'
        )
        return

      # Build project picker panel
      project_choices = [
        (p['project_name'], p['project_id']) for p in projects
      ]
      project_panel = ColumnPanel()
      project_panel.add_component(Label(text='Select Project:', bold=True))
      dd_project = DropDown(
        items=project_choices, placeholder='Select a project...'
      )
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
        (lbl for lbl, val in project_choices
         if val == dd_project.selected_value),
        'Unknown Project'
      )

      # Get imports for selected project
      imports = anvil.server.call(
        'get_project_imports', token, selected_project_id
      )

      if not imports:
        alert(
          'No imports found for this project. '
          'Please upload an XER file first.'
        )
        return

      # Build import picker panel
      import_choices = [
        (
          f"{i.get('import_date', '')} - {i.get('label', 'No label')}",
          i['import_id']
        )
        for i in imports
      ]
      import_panel = ColumnPanel()
      import_panel.add_component(Label(text='Select Import:', bold=True))
      dd_import = DropDown(
        items=import_choices, placeholder='Select an import...'
      )
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
      self._current_project_id  = selected_project_id
      self._current_import_id   = dd_import.selected_value
      self.lbl_project.text     = selected_project_name
      selected_import_label = next(
        (lbl for lbl, val in import_choices
         if val == dd_import.selected_value),
        'Unknown Import'
      )
      self.lbl_import.text = f"  {selected_import_label}"

      # Load the Gantt chart
      self._load_gantt()

    except Exception as e:
      alert(f'Error loading projects: {str(e)}')

  # ==========================================================================
  #  GANTT - DATA LOAD
  # ==========================================================================

  def _load_gantt(self):
    """
    Calls the server to get Gantt data then renders the chart.
    Shows a loading message while waiting.
    """
    if not self._current_project_id or not self._current_import_id:
      return

    self.lbl_no_data.text    = 'Loading Gantt chart...'
    self.lbl_no_data.visible = True
    self.pnl_gantt_container.clear()

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

      # Store for click handler access
      self._gantt_data   = gantt_data
      self._detail_cache = gantt_data.get('detail_cache', {})

      self.lbl_no_data.visible = False
      self._render_gantt(gantt_data)

    except Exception as e:
      self.lbl_no_data.text    = f'Error loading Gantt: {str(e)}'
      self.lbl_no_data.visible = True

  # ==========================================================================
  #  GANTT - RENDER
  # ==========================================================================

  def _render_gantt(self, gantt_data):
    """
    Renders the full Gantt view:
      - Left: HTML column table (fixed row height, scrollable)
      - Right: Plotly horizontal bar chart (same row height, synced scroll)
    Both are wrapped in a shared horizontally-scrollable flex container.
    A JS scroll-sync listener keeps vertical positions locked together.
    """
    tasks        = gantt_data.get('tasks', [])
    columns      = gantt_data.get('columns', [])
    bar_col_count = gantt_data.get('bar_col_count', 0)
    ts_start     = gantt_data.get('timescale_start', '')
    ts_end       = gantt_data.get('timescale_end', '')
    cols_per_week = gantt_data.get('cols_per_week', 7)

    if not tasks:
      return

    n_rows       = len(tasks)
    chart_height = COL_HEADER_H + (n_rows * ROW_HEIGHT)

    # -- Build the column table HTML --
    col_table_html = self._build_column_table_html(tasks, columns)

    # -- Build Plotly traces --
    plotly_traces, plotly_layout = self._build_plotly_chart(
      tasks, bar_col_count, ts_start, ts_end, cols_per_week, n_rows, chart_height
    )

    # -- Inject into pnl_gantt_container via a single HTML component --
    # The outer wrapper is a flex row. Left = column table. Right = Plotly div.
    # Both scroll together because they share one overflow-y container.
    container_html = f"""
<div id="gantt-wrapper" style="
  display: flex;
  flex-direction: row;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid #ccc;
  font-family: Arial, sans-serif;
  font-size: 12px;
">
  <!-- Left: column table -->
  <div id="gantt-cols" style="
    flex: 0 0 auto;
    overflow-y: auto;
    overflow-x: hidden;
    max-height: 600px;
    border-right: 2px solid #999;
  ">
    {col_table_html}
  </div>

  <!-- Right: Plotly chart -->
  <div id="gantt-plot" style="
    flex: 1 1 auto;
    overflow-y: auto;
    overflow-x: hidden;
    max-height: 600px;
    min-width: 600px;
  ">
    <div id="plotly-div" style="width:100%; height:{chart_height}px;"></div>
  </div>
</div>

<script>
(function() {{
  // Sync vertical scroll between columns and chart
  var cols = document.getElementById('gantt-cols');
  var plot = document.getElementById('gantt-plot');
  if (!cols || !plot) return;

  cols.addEventListener('scroll', function() {{
    plot.scrollTop = cols.scrollTop;
  }});
  plot.addEventListener('scroll', function() {{
    cols.scrollTop = plot.scrollTop;
  }});
}})();
</script>
"""

    html_comp = HtmlTemplate(html=container_html)
    self.pnl_gantt_container.add_component(html_comp)

    # -- Render Plotly into the div after the HTML is in the DOM --
    anvil.js.call_js('_prestoplan_render_plotly',
                     plotly_traces, plotly_layout)

  def _build_column_table_html(self, tasks, columns):
    """
    Build an HTML table for the left-side column panel.
    Fixed row height matches ROW_HEIGHT constant.
    WBS rows are bold+shaded. BLANK rows are empty spacers.
    Activity ID cells formatted as text (preserves leading zeros).
    """
    # Column widths in px - approximate from config 'width' (char units * 7px)
    col_widths = [col.get('width', 10) * 7 for col in columns]
    total_width = sum(col_widths) + 20  # +20 for indent space

    lines = []
    lines.append(
      f'<table id="gantt-col-table" style="'
      f'border-collapse:collapse; width:{total_width}px; '
      f'table-layout:fixed;">'
    )

    # Header row
    lines.append(
      f'<thead><tr style="height:{COL_HEADER_H}px; '
      f'background:#1565c0; color:white; font-weight:bold;">'
    )
    for i, col in enumerate(columns):
      lines.append(
        f'<th style="width:{col_widths[i]}px; padding:2px 4px; '
        f'overflow:hidden; white-space:nowrap; text-align:left; '
        f'border-right:1px solid #0d47a1;">'
        f'{col.get("label","")}</th>'
      )
    lines.append('</tr></thead>')

    # Data rows
    lines.append('<tbody>')
    for task in tasks:
      row_type = task.get('row_type', 'TASK')
      indent   = task.get('indent', 0)
      row_data = task.get('row_data', [])
      task_id  = task.get('task_id', '')

      row_h    = ROW_HEIGHT

      if row_type == 'BLANK':
        # Empty spacer row
        lines.append(
          f'<tr style="height:{row_h}px;">'
          f'<td colspan="{len(columns)}">&nbsp;</td></tr>'
        )
        continue

      if row_type == 'WBS':
        row_bg     = '#e3f2fd'
        row_fw     = 'bold'
        row_colour = '#1565c0'
      else:
        row_bg     = 'white'
        row_fw     = 'normal'
        row_colour = '#222222'

      indent_px = indent * 12

      lines.append(
        f'<tr data-task-id="{task_id}" style="'
        f'height:{row_h}px; background:{row_bg}; color:{row_colour}; '
        f'font-weight:{row_fw}; cursor:pointer;" '
        f'onmouseover="this.style.background=\'#fff9c4\'" '
        f'onmouseout="this.style.background=\'{row_bg}\'">'
      )

      for i, val in enumerate(row_data):
        col      = columns[i] if i < len(columns) else {}
        is_first = (i == 0)
        padding  = f'padding-left:{indent_px + 4}px;' if is_first else 'padding:2px 4px;'
        align    = 'right' if col.get('duration_field') else 'left'
        display  = '' if val is None else str(val)

        lines.append(
          f'<td style="width:{col_widths[i]}px; {padding} '
          f'overflow:hidden; white-space:nowrap; text-align:{align}; '
          f'border-bottom:1px solid #eeeeee; border-right:1px solid #eeeeee;">'
          f'{display}</td>'
        )

      lines.append('</tr>')

    lines.append('</tbody></table>')
    return ''.join(lines)

  def _build_plotly_chart(self, tasks, bar_col_count, ts_start, ts_end,
                          cols_per_week, n_rows, chart_height):
    """
    Build Plotly traces and layout for the Gantt bar chart.

    Y-axis: one position per row (0 = top row), inverted so row 0 is at top.
    X-axis: bar column index (integer), mapped to dates via ticktext/tickvals.
    One trace per bar colour for performance (grouped scatter bars).
    Milestones as a separate scatter trace with diamond markers.
    """
    from datetime import date, timedelta

    # -- Parse timescale dates --
    try:
      ts_s = date.fromisoformat(ts_start)
    except (ValueError, AttributeError):
      ts_s = date.today()

    # -- Build week tick marks for x-axis --
    tick_vals  = []
    tick_texts = []
    days_total = bar_col_count
    for day_offset in range(0, days_total, 7):
      col   = int(day_offset * cols_per_week / 7)
      d     = ts_s + timedelta(days=day_offset)
      tick_vals.append(col)
      tick_texts.append(d.strftime('%d %b'))

    # -- Accumulate bar segments by colour --
    # Each colour gets x_start[], x_end[], y[], hover[]
    bar_data   = {c: {'x': [], 'y': [], 'text': []} for c in BAR_COLOURS}
    ms_data    = {c: {'x': [], 'y': [], 'text': []} for c in MILESTONE_COLOURS}
    label_data = {'x': [], 'y': [], 'text': []}

    for row_idx, task in enumerate(tasks):
      row_type = task.get('row_type', 'TASK')
      if row_type in ('WBS', 'BLANK'):
        continue

      task_id   = task.get('task_id', '')
      segments  = task.get('bar_segments', [])

      for seg in segments:
        seg_type = seg.get('type', '')

        if seg_type == 'L':
          # Activity name label
          label_data['x'].append(seg.get('start', 0))
          label_data['y'].append(row_idx)
          label_data['text'].append(seg.get('label', ''))

        elif seg_type in MILESTONE_COLOURS:
          ms_data[seg_type]['x'].append(seg.get('start', 0))
          ms_data[seg_type]['y'].append(row_idx)
          ms_data[seg_type]['text'].append(
            task.get('row_data', [''])[1] if task.get('row_data') else ''
          )

        elif seg_type in BAR_COLOURS:
          # Horizontal bar: use a wide marker spanning start→end
          s = seg.get('start', 0)
          e = seg.get('end', s)
          # Plotly doesn't do horizontal bars natively with col indices,
          # so we use a scatter line with thick markers
          bar_data[seg_type]['x'].append(s)
          bar_data[seg_type]['x'].append(e)
          bar_data[seg_type]['x'].append(None)  # break line between bars
          bar_data[seg_type]['y'].append(row_idx)
          bar_data[seg_type]['y'].append(row_idx)
          bar_data[seg_type]['y'].append(None)
          bar_data[seg_type]['text'].append(task_id)
          bar_data[seg_type]['text'].append(task_id)
          bar_data[seg_type]['text'].append('')

    # -- Build traces --
    traces = []

    colour_names = {
      '1': 'Actual', '2': 'Remaining',
      '3': 'Near Critical', '4': 'Critical'
    }

    for code, colour in BAR_COLOURS.items():
      d = bar_data[code]
      if not d['x']:
        continue
      traces.append({
        'type':  'scatter',
        'mode':  'lines',
        'name':  colour_names.get(code, code),
        'x':     d['x'],
        'y':     d['y'],
        'text':  d['text'],
        'line':  {'color': colour, 'width': ROW_HEIGHT * 0.6},
        'hovertemplate': '%{text}<extra></extra>',
        'customdata': d['text'],
      })

    ms_names = {
      'M1': 'Actual Milestone', 'M2': 'Milestone',
      'M3': 'Near-Critical Milestone', 'M4': 'Critical Milestone'
    }
    for code, colour in MILESTONE_COLOURS.items():
      d = ms_data[code]
      if not d['x']:
        continue
      traces.append({
        'type':   'scatter',
        'mode':   'markers',
        'name':   ms_names.get(code, code),
        'x':      d['x'],
        'y':      d['y'],
        'text':   d['text'],
        'marker': {
          'symbol': 'diamond',
          'size':   12,
          'color':  colour,
        },
        'hovertemplate': '%{text}<extra></extra>',
      })

    # Activity name labels
    if label_data['x']:
      traces.append({
        'type':   'scatter',
        'mode':   'text',
        'name':   'Labels',
        'x':      label_data['x'],
        'y':      label_data['y'],
        'text':   label_data['text'],
        'textposition': 'middle right',
        'textfont':     {'size': 10, 'color': '#333333'},
        'hoverinfo': 'skip',
        'showlegend': False,
      })

    # -- Layout --
    layout = {
      'height':  chart_height,
      'margin':  {'l': 10, 'r': 20, 't': 10, 'b': 40},
      'xaxis': {
        'range':      [0, bar_col_count],
        'tickvals':   tick_vals,
        'ticktext':   tick_texts,
        'showgrid':   True,
        'gridcolor':  '#eeeeee',
        'zeroline':   False,
        'fixedrange': False,
      },
      'yaxis': {
        'range':      [n_rows, -1],  # inverted: row 0 at top
        'showticklabels': False,
        'showgrid':   True,
        'gridcolor':  '#eeeeee',
        'zeroline':   False,
        'fixedrange': False,
        'dtick':      1,
      },
      'showlegend':   False,
      'plot_bgcolor': 'white',
      'paper_bgcolor': 'white',
      'hovermode':    'closest',
      'clickmode':    'event',
    }

    return traces, layout

  # ==========================================================================
  #  GANTT - CLICK HANDLER
  # ==========================================================================

  def _on_gantt_click(self, point_data):
    """
    Called from JavaScript when a bar is clicked.
    point_data is a dict with x, y, text (task_id) from Plotly.
    Looks up the task in detail_cache and populates the details pane.
    """
    try:
      task_id = str(point_data.get('text', ''))
      if not task_id or task_id not in self._detail_cache:
        return

      # Find task row_data for header labels
      task_info = None
      if self._gantt_data:
        for t in self._gantt_data.get('tasks', []):
          if t.get('task_id') == task_id and t.get('row_type') == 'TASK':
            task_info = t
            break

      self._selected_task_id = task_id

      # Update details header
      if task_info:
        row_data = task_info.get('row_data', [])
        self.lbl_activity_id.text   = str(row_data[0]) if row_data else ''
        self.lbl_activity_name.text = str(row_data[1]) if len(row_data) > 1 else ''

      # Show details pane if hidden
      if not self._details_visible:
        self._details_visible    = True
        self.pnl_details.visible = True
        self.btn_toggle_details.text = 'Hide Details'

      # Render active tab
      self._render_details_tab(self._active_tab)

    except Exception as e:
      print(f'[_on_gantt_click] ERROR: {e}')

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
    self.chk_not_started.checked  = True
    self.chk_in_progress.checked  = True
    self.chk_complete.checked     = True
    self.chk_critical.checked     = True
    self.chk_near_critical.checked = True
    self.chk_non_critical.checked = True
    self.dd_actcode_type.selected_value  = None
    self.dd_actcode_value.items          = []
    self._load_gantt()

  @handle("dd_actcode_type", "change")
  def dd_actcode_type_change(self, **event_args):
    """When activity code type changes, reload the value dropdown."""
    selected_type = self.dd_actcode_type.selected_value
    if not selected_type:
      self.dd_actcode_value.items = []
      return
    try:
      token  = client_globals.session_token
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
    """Switch active details tab with solid background highlight."""
    self._active_tab = tab_name

    all_tabs = {
      'general':       self.tab_general,
      'status':        self.tab_status,
      'codes':         self.tab_codes,
      'relationships': self.tab_relationships,
      'notebook':      self.tab_notebook,
      'udfs':          self.tab_udfs,
    }
    for name, btn in all_tabs.items():
      if name == tab_name:
        btn.background = '#1565c0'
        btn.foreground = 'white'
        btn.bold       = True
      else:
        btn.background = '#e0e0e0'
        btn.foreground = '#333333'
        btn.bold       = False

    self._render_details_tab(tab_name)

  def _render_details_tab(self, tab_name):
    """
    Renders content for the selected details tab from detail_cache.
    Phase 9 will fill these in fully - placeholders for non-General tabs.
    """
    self.pnl_details_content.clear()

    if not self._selected_task_id:
      self.pnl_details_content.add_component(
        Label(text='Click an activity in the Gantt chart to see details.')
      )
      return

    cache = self._detail_cache.get(self._selected_task_id, {})

    if tab_name == 'general':
      self._render_general_tab(cache.get('general', {}))
    elif tab_name == 'status':
      self._render_status_tab(cache.get('general', {}))
    elif tab_name == 'codes':
      self._render_codes_tab(cache.get('codes', []))
    elif tab_name == 'relationships':
      self._render_relationships_tab(cache.get('relationships', {}))
    elif tab_name == 'notebook':
      self._render_notebook_tab(cache.get('notebook', []))
    elif tab_name == 'udfs':
      self._render_udfs_tab(cache.get('udfs', []))

  def _add_detail_row(self, label, value):
    """Add a label+value row to pnl_details_content."""
    row = FlowPanel()
    row.add_component(Label(text=f'{label}:', bold=True, width=180))
    row.add_component(Label(text=str(value) if value is not None else ''))
    self.pnl_details_content.add_component(row)

  def _render_general_tab(self, g):
    """Render General tab: calendar, type, durations, percent complete."""
    self._add_detail_row('Calendar',       g.get('calendar_name', ''))
    self._add_detail_row('Activity Type',  g.get('task_type', ''))
    self._add_detail_row('Duration Type',  g.get('duration_type', ''))
    self._add_detail_row('% Complete Type', g.get('complete_pct_type', ''))
    self._add_detail_row('Orig Duration',  g.get('orig_dur_days', ''))
    self._add_detail_row('Rem Duration',   g.get('rem_dur_days', ''))
    self._add_detail_row('At Comp Duration', g.get('at_comp_dur_days', ''))
    self._add_detail_row('Total Float',    g.get('total_float_days', ''))
    self._add_detail_row('Free Float',     g.get('free_float_days', ''))
    self._add_detail_row('Start',          g.get('start_date', ''))
    self._add_detail_row('Finish',         g.get('finish_date', ''))

  def _render_status_tab(self, g):
    """Render Status tab: actual dates, status code, physical % complete."""
    self._add_detail_row('Status',          g.get('status_code', ''))
    self._add_detail_row('Phys % Complete', g.get('phys_complete_pct', ''))
    self._add_detail_row('Actual Start',    g.get('act_start_date', ''))
    self._add_detail_row('Actual Finish',   g.get('act_end_date', ''))
    self._add_detail_row('Early Start',     g.get('early_start_date', ''))
    self._add_detail_row('Early Finish',    g.get('early_end_date', ''))
    self._add_detail_row('Late Start',      g.get('late_start_date', ''))
    self._add_detail_row('Late Finish',     g.get('late_end_date', ''))
    self._add_detail_row('Target Start',    g.get('target_start_date', ''))
    self._add_detail_row('Target Finish',   g.get('target_end_date', ''))

  def _render_codes_tab(self, codes):
    """Render Codes tab: activity code type/value/description rows."""
    if not codes:
      self.pnl_details_content.add_component(
        Label(text='No activity codes assigned.')
      )
      return
    for code_row in codes:
      type_name = code_row[0] if len(code_row) > 0 else ''
      val_name  = code_row[1] if len(code_row) > 1 else ''
      desc      = code_row[2] if len(code_row) > 2 else ''
      self._add_detail_row(type_name, f'{val_name}  {desc}'.strip())

  def _render_relationships_tab(self, rels):
    """Render Relationships tab: predecessors then successors."""
    preds = rels.get('predecessors', [])
    succs = rels.get('successors', [])

    self.pnl_details_content.add_component(
      Label(text='Predecessors', bold=True, font_size=12)
    )
    if preds:
      for r in preds:
        driving = ' ★' if r.get('driving') else ''
        lag     = f'  lag {r["lag_days"]}d' if r.get('lag_days') else ''
        self._add_detail_row(
          r.get('task_code', ''),
          f'{r.get("rel_type","")} {lag}{driving}  {r.get("task_name","")}'
        )
    else:
      self.pnl_details_content.add_component(Label(text='  None'))

    self.pnl_details_content.add_component(
      Label(text='Successors', bold=True, font_size=12)
    )
    if succs:
      for r in succs:
        driving = ' ★' if r.get('driving') else ''
        lag     = f'  lag {r["lag_days"]}d' if r.get('lag_days') else ''
        self._add_detail_row(
          r.get('task_code', ''),
          f'{r.get("rel_type","")} {lag}{driving}  {r.get("task_name","")}'
        )
    else:
      self.pnl_details_content.add_component(Label(text='  None'))

  def _render_notebook_tab(self, notes):
    """Render Notebook tab: topic heading + text content for each entry."""
    if not notes:
      self.pnl_details_content.add_component(
        Label(text='No notebook entries.')
      )
      return
    for note in notes:
      topic   = note[0] if len(note) > 0 else ''
      content = note[1] if len(note) > 1 else ''
      self.pnl_details_content.add_component(
        Label(text=topic, bold=True)
      )
      self.pnl_details_content.add_component(
        Label(text=content)
      )

  def _render_udfs_tab(self, udfs):
    """Render UDFs tab: label + value for each user-defined field."""
    if not udfs:
      self.pnl_details_content.add_component(
        Label(text='No user-defined fields.')
      )
      return
    for udf_row in udfs:
      label = udf_row[0] if len(udf_row) > 0 else ''
      val   = udf_row[1] if len(udf_row) > 1 else ''
      self._add_detail_row(label, val)

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