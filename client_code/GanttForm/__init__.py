from ._anvil_designer import GanttFormTemplate
from anvil import *
import anvil.server
import anvil.js
from anvil.js.window import document
from .. import client_globals


# ===========================================================================
#  CONSTANTS
# ===========================================================================

ROW_HEIGHT   = 24     # px - must match JS side
COL_HEADER_H = 48     # px - header row height
MAX_GANTT_H  = 600    # px - max visible height before scroll kicks in

# WBS band colours by depth (depth 1 = top level under root)
WBS_COLOURS = {
  1: '#bbdefb',   # light blue
  2: '#c8e6c9',   # light green
  3: '#fff9c4',   # light yellow
  4: '#f3e5f5',   # light purple
}
WBS_COLOUR_DEFAULT = '#f5f5f5'

# Bar colours: 1=actual, 2=normal, 3=near-critical, 4=critical
BAR_COLOURS = {
  '1': '#1565c0',
  '2': '#2e7d32',
  '3': '#e65100',
  '4': '#c62828',
}
MILESTONE_COLOURS = {
  'M1': '#1565c0',
  'M2': '#2e7d32',
  'M3': '#e65100',
  'M4': '#c62828',
}


class GanttForm(GanttFormTemplate):
  """
  Main application form for PrestoPlan.

  Layout:
    Toolbar (top): project/import, Change Project, Hide/Show Details
    Sidebar (left): layout picker, saved filters, collapsible GFS panel
    Centre: synced column table (HTML) + Plotly Gantt bars
    Details pane (bottom, fixed): tabbed activity details
  """

  def __init__(self, **properties):
    self.init_components(**properties)

    # Register form with JS for callbacks
    anvil.js.window._prestoplan_form = self

    # -- Internal state --
    self._details_visible     = True
    self._gfs_visible         = False
    self._current_project_id  = None
    self._current_import_id   = None
    self._current_layout_id   = 'default'
    self._active_tab          = 'general'
    self._selected_task_id    = None
    self._gantt_data          = None
    self._detail_cache        = {}
    self._row_meta            = []   # parallel list to tasks, for JS

    # -- Session check --
    if not client_globals.session_token:
      open_form('LoginForm')
      return

    # -- Nav bar --
    user = client_globals.current_user
    if user:
      self.lbl_nav_user.text = user.get('display_name', '')

    # -- Sidebar dropdowns --
    self.dd_layout.items        = [('Default layout', 'default')]
    self.dd_saved_filters.items = [('No filter applied', None)]

    # -- Open project selector --
    self._open_project_selector()

  # ==========================================================================
  #  TOOLBAR
  # ==========================================================================

  @handle("btn_toggle_details", "click")
  def btn_toggle_details_click(self, **event_args):
    """Show or hide the activity details pane."""
    self._details_visible    = not self._details_visible
    self.pnl_details.visible = self._details_visible
    self.btn_toggle_details.text = (
      'Hide Details' if self._details_visible else 'Show Details'
    )

  @handle("btn_select_project", "click")
  def btn_select_project_click(self, **event_args):
    """Open the project/import selector modal."""
    self._open_project_selector()

  # ==========================================================================
  #  SIDEBAR
  # ==========================================================================

  @handle("btn_toggle_gfs", "click")
  def btn_toggle_gfs_click(self, **event_args):
    """Expand or collapse the Grouping/Filtering/Sorting panel."""
    self._gfs_visible        = not self._gfs_visible
    self.pnl_gfs.visible     = self._gfs_visible
    self.btn_toggle_gfs.text = (
      '▼ Grouping / Filtering / Sorting'
      if self._gfs_visible else
      '▶ Grouping / Filtering / Sorting'
    )

  @handle("dd_layout", "change")
  def dd_layout_change(self, **event_args):
    """Apply selected layout. Full implementation in future phase."""
    selected = self.dd_layout.selected_value
    if selected:
      self._current_layout_id = selected
    # TODO: load saved layout config and re-render

  @handle("dd_saved_filters", "change")
  def dd_saved_filters_change(self, **event_args):
    """Apply a saved filter set. Full implementation in future phase."""
    pass  # TODO: populate filter controls from saved filter and reload

  # ==========================================================================
  #  PROJECT SELECTOR
  # ==========================================================================

  def _open_project_selector(self):
    """
    Opens modal alerts for project then import selection.
    Fetches project list from server, then import list once project chosen.
    """
    try:
      token    = client_globals.session_token
      projects = anvil.server.call('get_user_projects', token)

      if not projects:
        alert(
          'You do not have access to any projects. '
          'Please contact your administrator.'
        )
        return

      # -- Project picker --
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
         if val == selected_project_id),
        'Unknown Project'
      )

      # -- Import picker --
      imports = anvil.server.call(
        'get_project_imports', token, selected_project_id
      )
      if not imports:
        alert(
          'No imports found for this project. '
          'Please upload an XER file first.'
        )
        return

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

      # -- Store and load --
      self._current_project_id = selected_project_id
      self._current_import_id  = dd_import.selected_value
      self.lbl_project.text    = selected_project_name
      selected_import_label = next(
        (lbl for lbl, val in import_choices
         if val == dd_import.selected_value),
        'Unknown Import'
      )
      self.lbl_import.text = f"  {selected_import_label}"
      self._load_gantt()

    except Exception as e:
      alert(f'Error loading projects: {str(e)}')

  # ==========================================================================
  #  GANTT - DATA LOAD
  # ==========================================================================

  def _load_gantt(self):
    """
    Fetch Gantt data from server and trigger render.
    Shows loading indicator while waiting.
    """
    if not self._current_project_id or not self._current_import_id:
      return

    self.lbl_no_data.text    = 'Loading Gantt chart...'
    self.lbl_no_data.visible = True
    self.pnl_gantt_container.clear()

    try:
      token      = client_globals.session_token
      gantt_data = anvil.server.call(
        'get_gantt_data',
        token,
        self._current_project_id,
        self._current_import_id
      )

      if not gantt_data or not gantt_data.get('tasks'):
        self.lbl_no_data.text = 'No tasks found for this import.'
        return

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
    Build the full Gantt view:
      - Filter out BLANK rows (not needed with Plotly)
      - Build HTML column table
      - Build Plotly traces + layout
      - Inject HTML container into pnl_gantt_container
      - Call JS _pp_init to render Plotly and wire up interactions
    """
    raw_tasks     = gantt_data.get('tasks', [])
    columns       = gantt_data.get('columns', [])
    bar_col_count = gantt_data.get('bar_col_count', 0)
    ts_start      = gantt_data.get('timescale_start', '')
    ts_end        = gantt_data.get('timescale_end', '')
    cols_per_week = gantt_data.get('cols_per_week', 7)

    # -- Drop BLANK spacer rows - not needed with Plotly --
    tasks = [t for t in raw_tasks if t.get('row_type') != 'BLANK']

    if not tasks:
      return

    n_rows       = len(tasks)
    chart_height = COL_HEADER_H + (n_rows * ROW_HEIGHT)
    vis_height   = min(chart_height, MAX_GANTT_H)

    # -- Load collapse state for current layout --
    collapse_state = client_globals.get_collapse_state(self._current_layout_id)
    # Default: all expanded
    for task in tasks:
      wbs_id = task.get('wbs_id') or (
        task.get('task_id') if task.get('row_type') == 'WBS' else None
      )
      if wbs_id and wbs_id not in collapse_state:
        collapse_state[wbs_id] = True

    # -- Build row metadata for JS --
    row_meta = self._build_row_meta(tasks)
    self._row_meta = row_meta

    # -- Build column table HTML --
    col_html = self._build_column_table_html(tasks, columns, collapse_state)

    # -- Build Plotly data --
    traces, layout = self._build_plotly_chart(
      tasks, bar_col_count, ts_start, ts_end,
      cols_per_week, n_rows, chart_height
    )

    # -- Inject HTML container --
    container_html = f"""
<div id="gantt-wrapper" style="
  display:flex; flex-direction:row;
  overflow-x:auto; overflow-y:hidden;
  border:1px solid #cccccc;
  font-family:Arial,sans-serif; font-size:12px;
  width:100%;
">
  <div id="gantt-cols" style="
    flex:0 0 auto; overflow-y:auto; overflow-x:hidden;
    max-height:{vis_height}px; border-right:2px solid #999999;
  ">
    {col_html}
  </div>
  <div id="gantt-plot" style="
    flex:1 1 auto; overflow-y:auto; overflow-x:hidden;
    max-height:{vis_height}px; min-width:400px;
  ">
    <div id="plotly-div" style="width:100%; height:{chart_height}px;"></div>
  </div>
</div>
"""
    self.pnl_gantt_container.add_component(HtmlTemplate(html=container_html))

    # -- Hand off to JS --
    anvil.js.call_js(
      '_pp_init',
      self,
      traces,
      layout,
      row_meta,
      collapse_state
    )

  def _build_row_meta(self, tasks):
    """
    Build a list of row metadata dicts for JS.
    Each entry describes row type, wbs identity and parent for
    collapse/expand logic.
    """
    meta = []
    for idx, task in enumerate(tasks):
      row_type = task.get('row_type', 'TASK')
      meta.append({
        'rowIdx':      idx,
        'rowType':     row_type,
        'wbsId':       task.get('wbs_id', ''),
        'parentWbsId': task.get('parent_wbs_id', ''),
        'depth':       task.get('indent', 0),
        'taskId':      task.get('task_id', ''),
      })
    return meta

  def _build_column_table_html(self, tasks, columns, collapse_state):
    """
    Build the left-side column table HTML.

    - Fixed row height = ROW_HEIGHT px
    - WBS rows: coloured by depth, show +/- toggle icon
    - TASK rows: white background, indented by depth
    - WBS band colour extends across full row
    - Activity ID rendered as text to preserve leading zeros
    """
    col_widths  = [col.get('width', 10) * 7 for col in columns]
    total_width = sum(col_widths) + 24  # +24 for toggle icon column

    lines = []
    lines.append(
      f'<table id="gantt-col-table" style="'
      f'border-collapse:collapse; width:{total_width}px; '
      f'table-layout:fixed; border-spacing:0;">'
    )

    # -- Header --
    lines.append(
      f'<thead><tr style="height:{COL_HEADER_H}px; '
      f'background:#1565c0; color:white; font-weight:bold; '
      f'position:sticky; top:0; z-index:10;">'
    )
    # Icon column header
    lines.append(
      '<th style="width:24px; padding:2px; '
      'border-right:1px solid #0d47a1;"></th>'
    )
    for i, col in enumerate(columns):
      lines.append(
        f'<th style="width:{col_widths[i]}px; padding:2px 4px; '
        f'overflow:hidden; white-space:nowrap; text-align:left; '
        f'border-right:1px solid #0d47a1; vertical-align:middle;">'
        f'{col.get("label", "")}</th>'
      )
    lines.append('</tr></thead><tbody>')

    # -- Rows --
    for idx, task in enumerate(tasks):
      row_type = task.get('row_type', 'TASK')
      indent   = task.get('indent', 0)
      row_data = task.get('row_data', [])
      task_id  = task.get('task_id', '')
      wbs_id   = task.get('wbs_id', '')
      parent_wbs_id = task.get('parent_wbs_id', '')

      if row_type == 'WBS':
        depth      = indent
        bg_colour  = WBS_COLOURS.get(depth, WBS_COLOUR_DEFAULT)
        expanded   = collapse_state.get(wbs_id, True)
        icon       = '▼' if expanded else '▶'
        indent_px  = (indent - 1) * 12

        lines.append(
          f'<tr data-row-idx="{idx}" data-wbs-id="{wbs_id}" '
          f'data-parent-wbs-id="{parent_wbs_id}" '
          f'style="height:{ROW_HEIGHT}px; background:{bg_colour}; '
          f'font-weight:bold; color:#1a237e; cursor:pointer;">'
        )
        # Toggle icon cell
        lines.append(
          f'<td style="width:24px; text-align:center; '
          f'padding:0; border-bottom:1px solid #cccccc; '
          f'border-right:1px solid #cccccc; vertical-align:middle;" '
          f'onclick="_pp_toggleWbs(\'{wbs_id}\')">'
          f'<span class="wbs-toggle" style="font-size:10px; '
          f'user-select:none;">{icon}</span></td>'
        )
        for i, val in enumerate(row_data):
          pad = (
            f'padding-left:{indent_px + 4}px; padding-right:4px;'
            if i == 0 else 'padding:2px 4px;'
          )
          lines.append(
            f'<td style="width:{col_widths[i]}px; {pad} '
            f'overflow:hidden; white-space:nowrap; '
            f'border-bottom:1px solid #cccccc; '
            f'border-right:1px solid #dddddd; '
            f'vertical-align:middle;" '
            f'onclick="_pp_toggleWbs(\'{wbs_id}\')">'
            f'{val if val is not None else ""}</td>'
          )
        lines.append('</tr>')

      else:
        # TASK row
        indent_px = indent * 12
        lines.append(
          f'<tr data-row-idx="{idx}" data-task-id="{task_id}" '
          f'data-parent-wbs-id="{parent_wbs_id}" '
          f'style="height:{ROW_HEIGHT}px; background:white; '
          f'color:#222222; cursor:pointer;" '
          f'onmouseover="this.style.background=\'#fff9c4\'" '
          f'onmouseout="this.style.background=\'white\'">'
        )
        # Empty icon cell for tasks
        lines.append(
          '<td style="width:24px; border-bottom:1px solid #eeeeee; '
          'border-right:1px solid #cccccc;"></td>'
        )
        for i, val in enumerate(row_data):
          col    = columns[i] if i < len(columns) else {}
          pad    = (
            f'padding-left:{indent_px + 4}px; padding-right:4px;'
            if i == 0 else 'padding:2px 4px;'
          )
          align  = 'right' if col.get('duration_field') else 'left'
          display = '' if val is None else str(val)
          lines.append(
            f'<td style="width:{col_widths[i]}px; {pad} '
            f'overflow:hidden; white-space:nowrap; text-align:{align}; '
            f'border-bottom:1px solid #eeeeee; '
            f'border-right:1px solid #eeeeee; '
            f'vertical-align:middle;">'
            f'{display}</td>'
          )
        lines.append('</tr>')

    lines.append('</tbody></table>')
    return ''.join(lines)

  def _build_plotly_chart(self, tasks, bar_col_count, ts_start, ts_end,
                          cols_per_week, n_rows, chart_height):
    """
    Build Plotly traces and layout.

    Y-axis: one slot per row index (0=top), inverted.
    Every row (WBS and TASK) has a y-slot so rows align with column table.
    WBS rows get a coloured background shape spanning full x width.
    Bars use scatter lines (thick) for performance.
    Milestones use diamond scatter markers.
    """
    from datetime import date, timedelta

    try:
      ts_s = date.fromisoformat(ts_start)
    except (ValueError, AttributeError):
      ts_s = date.today()

    # -- X-axis tick marks (weekly) --
    tick_vals  = []
    tick_texts = []
    for day_offset in range(0, bar_col_count, 7):
      col = int(day_offset * cols_per_week / 7)
      d   = ts_s + timedelta(days=day_offset)
      tick_vals.append(col)
      tick_texts.append(d.strftime('%d %b %y'))

    # -- WBS background shapes --
    shapes = []
    for idx, task in enumerate(tasks):
      if task.get('row_type') == 'WBS':
        depth     = task.get('indent', 0)
        bg_colour = WBS_COLOURS.get(depth, WBS_COLOUR_DEFAULT)
        shapes.append({
          'type':      'rect',
          'xref':      'x',
          'yref':      'y',
          'x0':        0,
          'x1':        bar_col_count,
          'y0':        idx - 0.5,
          'y1':        idx + 0.5,
          'fillcolor': bg_colour,
          'opacity':   0.6,
          'line':      {'width': 0},
          'layer':     'below',
        })

    # -- Accumulate bar segments by colour --
    bar_data = {c: {'x': [], 'y': [], 'text': []} for c in BAR_COLOURS}
    ms_data  = {c: {'x': [], 'y': [], 'text': []} for c in MILESTONE_COLOURS}
    lbl_data = {'x': [], 'y': [], 'text': []}

    for row_idx, task in enumerate(tasks):
      if task.get('row_type') != 'TASK':
        continue

      task_id  = task.get('task_id', '')
      segments = task.get('bar_segments', [])

      for seg in segments:
        seg_type = seg.get('type', '')

        if seg_type == 'L':
          lbl_data['x'].append(seg.get('start', 0))
          lbl_data['y'].append(row_idx)
          lbl_data['text'].append(seg.get('label', ''))

        elif seg_type in MILESTONE_COLOURS:
          ms_data[seg_type]['x'].append(seg.get('start', 0))
          ms_data[seg_type]['y'].append(row_idx)
          ms_data[seg_type]['text'].append(task_id)

        elif seg_type in BAR_COLOURS:
          s = seg.get('start', 0)
          e = seg.get('end', s)
          # Three points per segment: start, end, None (line break)
          bar_data[seg_type]['x'].extend([s, e, None])
          bar_data[seg_type]['y'].extend([row_idx, row_idx, None])
          bar_data[seg_type]['text'].extend([task_id, task_id, ''])

    # -- Build traces --
    traces = []
    colour_names = {
      '1': 'Actual',
      '2': 'Remaining',
      '3': 'Near Critical',
      '4': 'Critical',
    }

    for code, colour in BAR_COLOURS.items():
      d = bar_data[code]
      if not d['x']:
        continue
      traces.append({
        'type':       'scatter',
        'mode':       'lines',
        'name':       colour_names.get(code, code),
        'x':          d['x'],
        'y':          d['y'],
        'customdata': d['text'],
        'text':       d['text'],
        'line':       {'color': colour, 'width': ROW_HEIGHT * 0.55},
        'hovertemplate': '%{customdata}<extra></extra>',
      })

    ms_names = {
      'M1': 'Actual Milestone',
      'M2': 'Milestone',
      'M3': 'Near-Critical Milestone',
      'M4': 'Critical Milestone',
    }
    for code, colour in MILESTONE_COLOURS.items():
      d = ms_data[code]
      if not d['x']:
        continue
      traces.append({
        'type':       'scatter',
        'mode':       'markers',
        'name':       ms_names.get(code, code),
        'x':          d['x'],
        'y':          d['y'],
        'customdata': d['text'],
        'text':       d['text'],
        'marker':     {'symbol': 'diamond', 'size': 12, 'color': colour},
        'hovertemplate': '%{customdata}<extra></extra>',
      })

    if lbl_data['x']:
      traces.append({
        'type':         'scatter',
        'mode':         'text',
        'name':         'Labels',
        'x':            lbl_data['x'],
        'y':            lbl_data['y'],
        'text':         lbl_data['text'],
        'textposition': 'middle right',
        'textfont':     {'size': 10, 'color': '#333333'},
        'hoverinfo':    'skip',
        'showlegend':   False,
      })

    # -- Layout --
    layout = {
      'height':  chart_height,
      'margin':  {'l': 4, 'r': 20, 't': 0, 'b': 40},
      'xaxis': {
        'range':      [0, bar_col_count],
        'tickvals':   tick_vals,
        'ticktext':   tick_texts,
        'showgrid':   True,
        'gridcolor':  '#eeeeee',
        'zeroline':   False,
        'fixedrange': False,
        'side':       'top',
      },
      'yaxis': {
        'range':          [n_rows, -1],
        'showticklabels': False,
        'showgrid':       False,
        'zeroline':       False,
        'fixedrange':     False,
        'dtick':          1,
      },
      'shapes':       shapes,
      'showlegend':   False,
      'plot_bgcolor': 'white',
      'paper_bgcolor': 'white',
      'hovermode':    'closest',
      'clickmode':    'event',
    }

    return traces, layout

  # ==========================================================================
  #  GANTT CALLBACKS FROM JS
  # ==========================================================================

  def _on_gantt_click(self, point_data):
    """
    Called from JS when a Plotly bar is clicked.
    Looks up task in detail_cache and populates the details pane.
    """
    try:
      task_id = str(point_data.get('text', ''))
      if not task_id or task_id not in self._detail_cache:
        return

      self._selected_task_id = task_id

      # Find task row_data for header labels
      if self._gantt_data:
        for t in self._gantt_data.get('tasks', []):
          if (str(t.get('task_id')) == task_id
              and t.get('row_type') == 'TASK'):
            row_data = t.get('row_data', [])
            self.lbl_activity_id.text   = str(row_data[0]) if row_data else ''
            self.lbl_activity_name.text = (
              str(row_data[1]) if len(row_data) > 1 else ''
            )
            break

      # Show details pane if hidden
      if not self._details_visible:
        self._details_visible    = True
        self.pnl_details.visible = True
        self.btn_toggle_details.text = 'Hide Details'

      self._render_details_tab(self._active_tab)

    except Exception as e:
      print(f'[_on_gantt_click] ERROR: {e}')

  def _on_collapse_change(self, wbs_id, expanded):
    """
    Called from JS when a WBS row is toggled.
    Saves state to client_globals for persistence across reloads.
    """
    client_globals.set_collapse_state(
      self._current_layout_id, wbs_id, expanded
    )

  def _on_collapse_all(self, expanded):
    """
    Called from JS on Ctrl+/Ctrl-.
    Updates all WBS nodes in collapse state.
    """
    if self._gantt_data:
      tasks = self._gantt_data.get('tasks', [])
      for task in tasks:
        if task.get('row_type') == 'WBS':
          wbs_id = task.get('wbs_id', '')
          if wbs_id:
            if expanded:
              client_globals.set_collapse_state(
                self._current_layout_id, wbs_id, True
              )
            elif task.get('indent', 0) == 1:
              client_globals.set_collapse_state(
                self._current_layout_id, wbs_id, False
              )

  # ==========================================================================
  #  FILTER EVENTS
  # ==========================================================================

  @handle("btn_apply_filters", "click")
  def btn_apply_filters_click(self, **event_args):
    """Re-load Gantt with current filter settings."""
    self._load_gantt()

  @handle("btn_clear_filters", "click")
  def btn_clear_filters_click(self, **event_args):
    """Reset all filters to defaults and reload."""
    self.chk_not_started.checked   = True
    self.chk_in_progress.checked   = True
    self.chk_complete.checked      = True
    self.chk_critical.checked      = True
    self.chk_near_critical.checked = True
    self.chk_non_critical.checked  = True
    self.dd_actcode_type.selected_value = None
    self.dd_actcode_value.items         = []
    self._load_gantt()

  @handle("dd_actcode_type", "change")
  def dd_actcode_type_change(self, **event_args):
    """Reload activity code value dropdown when type changes."""
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
  #  DETAILS PANE - TABS
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
    """Switch active tab with solid background highlight."""
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
    Render content for the selected tab from detail_cache.
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
    """Add a label + value row to the details content panel."""
    row = FlowPanel()
    row.add_component(Label(text=f'{label}:', bold=True, width=180))
    row.add_component(Label(text=str(value) if value is not None else ''))
    self.pnl_details_content.add_component(row)

  def _render_general_tab(self, g):
    """General tab: calendar, type, durations, float, dates."""
    self._add_detail_row('Calendar',          g.get('calendar_name', ''))
    self._add_detail_row('Activity Type',     g.get('task_type', ''))
    self._add_detail_row('Duration Type',     g.get('duration_type', ''))
    self._add_detail_row('% Complete Type',   g.get('complete_pct_type', ''))
    self._add_detail_row('Orig Duration',     g.get('orig_dur_days', ''))
    self._add_detail_row('Rem Duration',      g.get('rem_dur_days', ''))
    self._add_detail_row('At Comp Duration',  g.get('at_comp_dur_days', ''))
    self._add_detail_row('Total Float',       g.get('total_float_days', ''))
    self._add_detail_row('Free Float',        g.get('free_float_days', ''))
    self._add_detail_row('Start',             g.get('start_date', ''))
    self._add_detail_row('Finish',            g.get('finish_date', ''))

  def _render_status_tab(self, g):
    """Status tab: actual dates, status code, physical % complete."""
    self._add_detail_row('Status',            g.get('status_code', ''))
    self._add_detail_row('Phys % Complete',   g.get('phys_complete_pct', ''))
    self._add_detail_row('Actual Start',      g.get('act_start_date', ''))
    self._add_detail_row('Actual Finish',     g.get('act_end_date', ''))
    self._add_detail_row('Early Start',       g.get('early_start_date', ''))
    self._add_detail_row('Early Finish',      g.get('early_end_date', ''))
    self._add_detail_row('Late Start',        g.get('late_start_date', ''))
    self._add_detail_row('Late Finish',       g.get('late_end_date', ''))
    self._add_detail_row('Target Start',      g.get('target_start_date', ''))
    self._add_detail_row('Target Finish',     g.get('target_end_date', ''))

  def _render_codes_tab(self, codes):
    """Codes tab: activity code type/value/description."""
    if not codes:
      self.pnl_details_content.add_component(
        Label(text='No activity codes assigned.')
      )
      return
    for code_row in codes:
      self._add_detail_row(
        code_row[0] if len(code_row) > 0 else '',
        f'{code_row[1]}  {code_row[2]}'.strip() if len(code_row) > 2 else ''
      )

  def _render_relationships_tab(self, rels):
    """Relationships tab: predecessors then successors."""
    preds = rels.get('predecessors', [])
    succs = rels.get('successors', [])

    self.pnl_details_content.add_component(
      Label(text='Predecessors', bold=True, font_size=12)
    )
    if preds:
      for r in preds:
        lag     = f'  lag {r["lag_days"]}d' if r.get('lag_days') else ''
        driving = ' ★' if r.get('driving') else ''
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
        lag     = f'  lag {r["lag_days"]}d' if r.get('lag_days') else ''
        driving = ' ★' if r.get('driving') else ''
        self._add_detail_row(
          r.get('task_code', ''),
          f'{r.get("rel_type","")} {lag}{driving}  {r.get("task_name","")}'
        )
    else:
      self.pnl_details_content.add_component(Label(text='  None'))

  def _render_notebook_tab(self, notes):
    """Notebook tab: topic heading + text content."""
    if not notes:
      self.pnl_details_content.add_component(
        Label(text='No notebook entries.')
      )
      return
    for note in notes:
      self.pnl_details_content.add_component(
        Label(text=note[0] if len(note) > 0 else '', bold=True)
      )
      self.pnl_details_content.add_component(
        Label(text=note[1] if len(note) > 1 else '')
      )

  def _render_udfs_tab(self, udfs):
    """UDFs tab: label + value for each user-defined field."""
    if not udfs:
      self.pnl_details_content.add_component(
        Label(text='No user-defined fields.')
      )
      return
    for udf_row in udfs:
      self._add_detail_row(
        udf_row[0] if len(udf_row) > 0 else '',
        udf_row[1] if len(udf_row) > 1 else ''
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
      pass
    client_globals.clear_session()
    open_form('LoginForm')