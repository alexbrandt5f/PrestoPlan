from ._anvil_designer import GanttFormTemplate
from anvil import *
import anvil.server
import anvil.js
from anvil.js.window import document
import json
from .. import client_globals


# ===========================================================================
#  CONSTANTS  (must match PP_* constants in Native Libraries JS)
# ===========================================================================

ROW_HEIGHT   = 24    # px per Gantt row
COL_HEADER_H = 48    # px for frozen column header (month row + week row)
DETAILS_H    = 220   # px for details pane
TOOLBAR_H    = 56    # px for Anvil nav bar
SIDEBAR_W    = 220   # px for sidebar when open

# WBS band background colours by indent depth
WBS_COLOURS = {
  1: '#bbdefb',
  2: '#c8e6c9',
  3: '#fff9c4',
  4: '#f3e5f5',
}
WBS_COLOUR_DEFAULT = '#f5f5f5'

# Bar colours keyed by segment type code
BAR_COLOURS = {
  '1': '#1565c0',   # actual (completed)
  '2': '#2e7d32',   # normal remaining
  '3': '#e65100',   # near-critical remaining
  '4': '#c62828',   # critical remaining
}

MILESTONE_COLOURS = {
  'M1': '#1565c0',
  'M2': '#2e7d32',
  'M3': '#e65100',
  'M4': '#c62828',
}


class GanttForm(GanttFormTemplate):
  """
  Main Gantt viewer form for PrestoPlan.

  Fixed CSS layout:
    - Anvil nav bar:   fixed top, full width (PP_NAV_H px)
    - pp-shell:        position:fixed below nav bar, fills to bottom
      - pp-main-row:   sidebar + gantt area side by side
        - pp-sidebar:  collapsible left panel (layout/filter pickers)
        - pp-gantt-area:
          - pp-col-header:   frozen timescale header (month + week rows)
          - pp-scroll-body:  col table | splitter | plot pane (scrolls)
      - pp-details:    fixed-height bottom panel with activity tabs

  All JS sizing is done in _pp_applyLayout() in Native Libraries.
  Python builds the HTML structure and Plotly traces, JS does all layout.
  """

  def __init__(self, **properties):
    self.init_components(**properties)

    # Register form with JS so click callbacks can reach Python
    anvil.js.window._prestoplan_form = self

    # ---- Internal state ----
    self._details_visible    = True
    self._sidebar_visible    = False   # sidebar hidden by default
    self._gfs_visible        = False
    self._current_project_id = None
    self._current_import_id  = None
    self._current_layout_id  = 'default'
    self._active_tab         = 'general'
    self._selected_task_id   = None
    self._gantt_data         = None
    self._detail_cache       = {}
    self._row_meta           = []

    # ---- Session check ----
    if not client_globals.session_token:
      open_form('LoginForm')
      return

    # ---- Nav bar user display ----
    user = client_globals.current_user
    if user:
      self.lbl_nav_user.text = user.get('display_name', '')

    # ---- Sidebar dropdowns ----
    self.dd_layout.items        = [('Default layout', 'default')]
    self.dd_saved_filters.items = [('No filter applied', None)]

    # ---- Show project selector on load ----
    self._open_project_selector()

  # ==========================================================================
  #  TOOLBAR EVENTS
  # ==========================================================================

  @handle("btn_toggle_sidebar", "click")
  def btn_toggle_sidebar_click(self, **event_args):
    """Toggle the left sidebar open/closed via hamburger button."""
    self._sidebar_visible = not self._sidebar_visible
    self.btn_toggle_sidebar.text = '✕' if self._sidebar_visible else '☰'
    anvil.js.call_js('_pp_toggleSidebar', self._sidebar_visible)

  @handle("btn_toggle_details", "click")
  def btn_toggle_details_click(self, **event_args):
    """Show or hide the activity details pane at the bottom."""
    self._details_visible = not self._details_visible
    self.pnl_details.visible = self._details_visible
    self.btn_toggle_details.text = (
      'Hide Details' if self._details_visible else 'Show Details'
    )
    anvil.js.call_js('_pp_toggleDetails', self._details_visible)

  @handle("btn_select_project", "click")
  def btn_select_project_click(self, **event_args):
    """Open the project/import selector modal."""
    self._open_project_selector()

  # ==========================================================================
  #  SIDEBAR EVENTS
  # ==========================================================================

  @handle("btn_toggle_gfs", "click")
  def btn_toggle_gfs_click(self, **event_args):
    """Expand or collapse the Grouping/Filtering/Sorting sub-panel."""
    self._gfs_visible    = not self._gfs_visible
    self.pnl_gfs.visible = self._gfs_visible
    self.btn_toggle_gfs.text = (
      '▼ Grouping / Filtering / Sorting'
      if self._gfs_visible else
      '▶ Grouping / Filtering / Sorting'
    )

  @handle("dd_layout", "change")
  def dd_layout_change(self, **event_args):
    """Apply selected layout. Full implementation in a future phase."""
    selected = self.dd_layout.selected_value
    if selected:
      self._current_layout_id = selected

  @handle("dd_saved_filters", "change")
  def dd_saved_filters_change(self, **event_args):
    """Apply a saved filter set. Full implementation in a future phase."""
    pass

  # ==========================================================================
  #  PROJECT SELECTOR
  # ==========================================================================

  def _open_project_selector(self):
    """
    Two-step modal: user picks a project then an import.
    Fetches lists from server, stores selections, then triggers Gantt load.
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

      # Step 1: project picker
      project_choices = [
        (p['project_name'], p['project_id']) for p in projects
      ]
      pp = ColumnPanel()
      pp.add_component(Label(text='Select Project:', bold=True))
      dd_proj = DropDown(
        items=project_choices, placeholder='Select a project...'
      )
      pp.add_component(dd_proj)
      if self._current_project_id:
        dd_proj.selected_value = self._current_project_id

      if not alert(content=pp, title='Select Project',
                   buttons=[('OK', True), ('Cancel', False)]):
        return
      if not dd_proj.selected_value:
        return

      selected_project_id   = dd_proj.selected_value
      selected_project_name = next(
        (lbl for lbl, val in project_choices if val == selected_project_id),
        'Unknown Project'
      )

      # Step 2: import picker
      imports = anvil.server.call(
        'get_project_imports', token, selected_project_id
      )
      if not imports:
        alert('No imports found for this project. Please upload an XER file first.')
        return

      import_choices = [
        (
          f"{i.get('import_date', '')} - {i.get('label', 'No label')}",
          i['import_id']
        )
        for i in imports
      ]
      ip = ColumnPanel()
      ip.add_component(Label(text='Select Import:', bold=True))
      dd_imp = DropDown(
        items=import_choices, placeholder='Select an import...'
      )
      ip.add_component(dd_imp)
      if self._current_import_id:
        dd_imp.selected_value = self._current_import_id

      if not alert(content=ip, title='Select Import',
                   buttons=[('OK', True), ('Cancel', False)]):
        return
      if not dd_imp.selected_value:
        return

      # Store selections and update toolbar labels
      self._current_project_id = selected_project_id
      self._current_import_id  = dd_imp.selected_value
      self.lbl_project.text    = selected_project_name
      selected_import_label = next(
        (lbl for lbl, val in import_choices if val == dd_imp.selected_value),
        'Unknown Import'
      )
      self.lbl_import.text = f"  {selected_import_label}"

      self._load_gantt()

    except Exception as e:
      alert(f'Error loading projects: {str(e)}')

  # ==========================================================================
  #  GANTT - LOAD
  # ==========================================================================

  def _load_gantt(self):
    """
    Fetch Gantt data from server and render the chart.
    Shows a loading message while the server call is in progress.
    """
    if not self._current_project_id or not self._current_import_id:
      return

    self.lbl_no_data.text    = 'Loading Gantt chart...'
    self.lbl_no_data.visible = True
    self.pnl_gantt_container.clear()

    try:
      token      = client_globals.session_token
      gantt_data = anvil.server.call(
        'get_gantt_data', token,
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
    Build the full Gantt HTML structure and inject it into pnl_gantt_container.

    HTML structure:
      #pp-shell
        #pp-main-row
          #pp-sidebar        (layout/filter controls)
          #pp-gantt-area
            #pp-col-header   (timescale header built by JS)
            #pp-scroll-body
              #pp-col-data   (frozen column table; sticky header inside)
              #pp-splitter   (drag handle)
              #pp-plot-pane
                #pp-plotly-div
        #pp-details          (activity details pane)

    Data is embedded as a JS object literal in a <script> tag.
    The inline script polls for _pp_init and Plotly to be ready before calling.
    """
    raw_tasks     = gantt_data.get('tasks', [])
    columns       = gantt_data.get('columns', [])
    bar_col_count = gantt_data.get('bar_col_count', 0)
    ts_start      = gantt_data.get('timescale_start', '')
    ts_end        = gantt_data.get('timescale_end', '')
    cols_per_week = gantt_data.get('cols_per_week', 7)

    # Drop placeholder BLANK rows - not used with Plotly
    tasks = [t for t in raw_tasks if t.get('row_type') != 'BLANK']
    if not tasks:
      return

    n_rows       = len(tasks)
    chart_height = n_rows * ROW_HEIGHT + 2   # +2 avoids sub-pixel gaps

    # Load or initialise WBS collapse state for the current layout
    collapse_state = client_globals.get_collapse_state(self._current_layout_id)
    for task in tasks:
      wbs_id = task.get('wbs_id', '')
      if (wbs_id and task.get('row_type') == 'WBS'
          and wbs_id not in collapse_state):
        collapse_state[wbs_id] = True   # default: expanded

    # Build per-row metadata for JS collapse logic
    row_meta       = self._build_row_meta(tasks)
    self._row_meta = row_meta

    # Column widths: 7px per character-width unit from server
    col_widths = [col.get('width', 10) * 7 for col in columns]

    # Build HTML fragments
    header_html    = self._build_header_html(columns, col_widths)
    col_table_html = self._build_col_table_html(
      tasks, columns, col_widths, collapse_state
    )
    sidebar_html   = self._build_sidebar_html()
    details_html   = self._build_details_html()

    # Build Plotly traces and layout
    traces, layout = self._build_plotly_data(
      tasks, bar_col_count, ts_start, ts_end,
      cols_per_week, n_rows, chart_height
    )

    # Build timescale band data for JS header
    month_bands, week_ticks = self._build_timescale_bands(
      ts_start, bar_col_count, cols_per_week
    )

    # Serialise all JS data to a JSON string (avoids Anvil serialiser issues)
    js_data = json.dumps({
      'traces':        traces,
      'layout':        layout,
      'rowMeta':       row_meta,
      'collapseState': collapse_state,
      'monthBands':    month_bands,
      'weekTicks':     week_ticks,
      'barColCount':   bar_col_count,
      'colsPerWeek':   cols_per_week,
    })

    html = f"""
<div id="pp-shell" style="font-family:Arial,sans-serif; font-size:12px;">

  <div id="pp-main-row">

    <!-- Sidebar: layout/filter controls -->
    <div id="pp-sidebar">
      {sidebar_html}
    </div>

    <!-- Gantt area: timescale header + scrollable body -->
    <div id="pp-gantt-area">

      <!-- Timescale header (populated by JS _pp_buildTimescaleHeader) -->
      <div id="pp-col-header"></div>

      <!-- Scrollable body: column table | splitter | bar chart -->
      <div id="pp-scroll-body">

        <!-- Column data: sticky header row + data rows -->
        <div id="pp-col-data">
          <table id="pp-col-table-header"
            style="border-collapse:collapse; table-layout:fixed;
                   font-size:12px; font-family:Arial,sans-serif;
                   background:#1565c0; position:sticky; top:0; z-index:5; width:100%;">
            <tbody>
              <tr style="height:{COL_HEADER_H}px;">{header_html}</tr>
            </tbody>
          </table>
          {col_table_html}
        </div>

        <!-- Drag handle between columns and bars -->
        <div id="pp-splitter" title="Drag to resize columns"></div>

        <!-- Plotly bar chart -->
        <div id="pp-plot-pane">
          <div id="pp-plotly-div"
               style="height:{chart_height}px; min-width:600px;"></div>
        </div>

      </div>
    </div>
  </div>

  <!-- Activity details pane (tabs + content) -->
  <div id="pp-details">
    {details_html}
  </div>

</div>

<script>
(function() {{
  // Data embedded as JS object literal to avoid Anvil serialiser issues.
  // Polls every 100ms until both _pp_init and Plotly are ready.
  var _ganttData = {js_data};
  function _tryInit() {{
    if (typeof _pp_init === 'function' && typeof Plotly !== 'undefined') {{
      _pp_init(window._prestoplan_form, JSON.stringify(_ganttData));
    }} else {{
      setTimeout(_tryInit, 100);
    }}
  }}
  setTimeout(_tryInit, 100);
}})();
</script>
"""
    anvil.js.window._prestoplan_form = self
    self.pnl_gantt_container.add_component(HtmlTemplate(html=html))

  # --------------------------------------------------------------------------
  #  HTML BUILDERS
  # --------------------------------------------------------------------------

  def _build_row_meta(self, tasks):
    """
    Build per-row metadata list consumed by JS for collapse/expand logic.

    CRITICAL: For TASK rows, parentWbsId must be the wbs_id of the WBS node
    the task directly belongs to.  For WBS rows, parentWbsId is the WBS
    node's own parent WBS id.
    """
    meta = []
    for idx, task in enumerate(tasks):
      row_type = task.get('row_type', 'TASK')
      wbs_id   = task.get('wbs_id', '')

      if row_type == 'TASK':
        parent_wbs_id = wbs_id          # task is child of its own WBS node
      else:
        parent_wbs_id = task.get('parent_wbs_id', '')  # WBS node's parent

      meta.append({
        'rowIdx':      idx,
        'rowType':     row_type,
        'wbsId':       wbs_id,
        'parentWbsId': parent_wbs_id,
        'depth':       task.get('indent', 0),
        'taskId':      task.get('task_id', ''),
      })
    return meta

  def _build_header_html(self, columns, col_widths):
    """
    Build sticky header <td> cells for the column table.
    Must exactly match data row column widths.
    """
    parts = [
      # Icon column spacer
      '<td style="width:24px; min-width:24px; '
      'border-right:1px solid #0d47a1;"></td>'
    ]
    for i, col in enumerate(columns):
      parts.append(
        f'<td style="width:{col_widths[i]}px; min-width:{col_widths[i]}px; '
        f'padding:4px 6px; overflow:hidden; white-space:nowrap; '
        f'color:white; font-weight:bold; font-size:12px; '
        f'border-right:1px solid #0d47a1; vertical-align:middle;">'
        f'{col.get("label", "")}</td>'
      )
    return ''.join(parts)

  def _build_col_table_html(self, tasks, columns, col_widths, collapse_state):
    """
    Build the scrollable column data table.

    Row heights are fixed at ROW_HEIGHT px to align with Plotly y-axis.
    WBS rows: coloured band by depth, collapsible with ▼/▶ icon.
    TASK rows: white background, indented by depth.
    """
    parts    = []
    total_w  = sum(col_widths) + 24   # 24px for icon column

    parts.append(
      f'<table id="pp-col-table" style="'
      f'border-collapse:collapse; width:{total_w}px; '
      f'table-layout:fixed; font-size:12px; '
      f'font-family:Arial,sans-serif;">'
      f'<tbody>'
    )

    for idx, task in enumerate(tasks):
      row_type      = task.get('row_type', 'TASK')
      indent        = task.get('indent', 0)
      row_data      = task.get('row_data', [])
      task_id       = task.get('task_id', '')
      wbs_id        = task.get('wbs_id', '')
      parent_wbs_id = task.get('parent_wbs_id', '')

      if row_type == 'WBS':
        bg        = WBS_COLOURS.get(indent, WBS_COLOUR_DEFAULT)
        expanded  = collapse_state.get(wbs_id, True)
        icon      = '▼' if expanded else '▶'
        indent_px = (indent - 1) * 12

        parts.append(
          f'<tr data-row-idx="{idx}" data-wbs-id="{wbs_id}" '
          f'data-parent-wbs-id="{parent_wbs_id}" '
          f'style="height:{ROW_HEIGHT}px; background:{bg}; '
          f'font-weight:bold; color:#1a237e;">'
        )
        # Toggle icon cell
        parts.append(
          f'<td style="width:24px; text-align:center; vertical-align:middle; '
          f'border-bottom:1px solid #ccc; border-right:1px solid #ccc; '
          f'cursor:pointer; padding:0;" '
          f'onclick="_pp_toggleWbs(\'{wbs_id}\')">'
          f'<span class="pp-wbs-icon" '
          f'style="font-size:10px; user-select:none;">{icon}</span></td>'
        )
        for i, val in enumerate(row_data):
          pad = (
            f'padding-left:{indent_px + 4}px; padding-right:4px;'
            if i == 0 else 'padding:2px 4px;'
          )
          parts.append(
            f'<td style="width:{col_widths[i]}px; {pad} '
            f'overflow:hidden; white-space:nowrap; vertical-align:middle; '
            f'border-bottom:1px solid #ccc; border-right:1px solid #ddd; '
            f'cursor:pointer;" '
            f'onclick="_pp_toggleWbs(\'{wbs_id}\')">'
            f'{val if val is not None else ""}</td>'
          )
        parts.append('</tr>')

      else:
        # TASK row
        indent_px = indent * 12
        parts.append(
          f'<tr data-row-idx="{idx}" data-task-id="{task_id}" '
          f'data-parent-wbs-id="{wbs_id}" '
          f'style="height:{ROW_HEIGHT}px; background:white; '
          f'color:#222; cursor:pointer;" '
          f'onmouseover="this.style.background=\'#fff9c4\'" '
          f'onmouseout="this.style.background=\'white\'">'
        )
        # Empty icon cell
        parts.append(
          f'<td style="width:24px; border-bottom:1px solid #eee; '
          f'border-right:1px solid #ccc;"></td>'
        )
        for i, val in enumerate(row_data):
          col   = columns[i] if i < len(columns) else {}
          pad   = (
            f'padding-left:{indent_px + 4}px; padding-right:4px;'
            if i == 0 else 'padding:2px 4px;'
          )
          align = 'right' if col.get('duration_field') else 'left'
          disp  = '' if val is None else str(val)
          parts.append(
            f'<td style="width:{col_widths[i]}px; {pad} '
            f'overflow:hidden; white-space:nowrap; text-align:{align}; '
            f'vertical-align:middle; '
            f'border-bottom:1px solid #eee; border-right:1px solid #eee;">'
            f'{disp}</td>'
          )
        parts.append('</tr>')

    parts.append('</tbody></table>')
    return ''.join(parts)

  def _build_sidebar_html(self):
    """
    Build the sidebar HTML fragment.
    Anvil components (dropdowns, checkboxes) live in the YAML pnl_details
    area; this sidebar in the Gantt HTML is just a placeholder that JS sizes.
    The actual sidebar content is rendered by Anvil's own components which
    are positioned inside pp-sidebar by _pp_applyLayout.

    Returns empty string - the sidebar div exists for layout purposes only;
    Anvil's pnl_sidebar ColumnPanel content is separate.
    """
    # Layout/filter content is in the YAML sidebar components.
    # The HTML div #pp-sidebar is sized by JS; Anvil components go elsewhere.
    return ''

  def _build_details_html(self):
    """
    Build the details pane HTML fragment.
    The actual tab content is managed by Anvil Python (pnl_details).
    This just returns a placeholder so the div exists for JS layout.
    """
    return ''

  def _build_plotly_data(self, tasks, bar_col_count, ts_start, ts_end,
                         cols_per_week, n_rows, chart_height):
    """
    Build Plotly traces and layout dict.

    Y-axis: 0 = top row, inverted range [n_rows, -1].
    Every row (WBS and TASK) occupies one y-slot so bars align with the
    column table.

    WBS rows: coloured background shapes (layer='below').
    Bar segments: scatter lines (thick, no markers).
    Milestones: scatter diamond markers.
    Labels: scatter text markers.

    Returns plain Python dicts - serialised to JSON by _render_gantt.
    """
    from datetime import date, timedelta

    try:
      ts_s = date.fromisoformat(ts_start)
    except (ValueError, AttributeError):
      ts_s = date.today()

    # WBS background shapes
    shapes = []
    for idx, task in enumerate(tasks):
      if task.get('row_type') == 'WBS':
        depth = task.get('indent', 0)
        bg    = WBS_COLOURS.get(depth, WBS_COLOUR_DEFAULT)
        shapes.append({
          'type': 'rect', 'xref': 'x', 'yref': 'y',
          'x0': 0, 'x1': bar_col_count,
          'y0': idx - 0.5, 'y1': idx + 0.5,
          'fillcolor': bg, 'opacity': 0.5,
          'line': {'width': 0}, 'layer': 'below',
        })

    # Accumulate bar segments by colour code
    bar_data = {c: {'x': [], 'y': [], 'text': [], 'customdata': []}
                for c in BAR_COLOURS}
    ms_data  = {c: {'x': [], 'y': [], 'text': [], 'customdata': []}
                for c in MILESTONE_COLOURS}
    lbl_data = {'x': [], 'y': [], 'text': []}

    for row_idx, task in enumerate(tasks):
      if task.get('row_type') != 'TASK':
        continue
      task_id  = str(task.get('task_id', ''))
      segments = task.get('bar_segments', [])

      for seg in segments:
        stype = seg.get('type', '')

        if stype == 'L':
          lbl_data['x'].append(seg.get('start', 0))
          lbl_data['y'].append(row_idx)
          lbl_data['text'].append(seg.get('label', ''))

        elif stype in MILESTONE_COLOURS:
          ms_data[stype]['x'].append(seg.get('start', 0))
          ms_data[stype]['y'].append(row_idx)
          ms_data[stype]['text'].append(task_id)
          ms_data[stype]['customdata'].append(task_id)

        elif stype in BAR_COLOURS:
          s = seg.get('start', 0)
          e = seg.get('end', s)
          bar_data[stype]['x'].extend([s, e, None])
          bar_data[stype]['y'].extend([row_idx, row_idx, None])
          bar_data[stype]['text'].extend([task_id, task_id, ''])
          bar_data[stype]['customdata'].extend([task_id, task_id, ''])

    # Build traces list
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
        'type': 'scatter', 'mode': 'lines',
        'name': colour_names.get(code, code),
        'x': d['x'], 'y': d['y'],
        'text': d['text'], 'customdata': d['customdata'],
        'line': {'color': colour, 'width': int(ROW_HEIGHT * 0.55)},
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
        'type': 'scatter', 'mode': 'markers',
        'name': ms_names.get(code, code),
        'x': d['x'], 'y': d['y'],
        'text': d['text'], 'customdata': d['customdata'],
        'marker': {'symbol': 'diamond', 'size': 12, 'color': colour},
        'hovertemplate': '%{customdata}<extra></extra>',
      })

    if lbl_data['x']:
      traces.append({
        'type': 'scatter', 'mode': 'text',
        'name': 'Labels',
        'x': lbl_data['x'], 'y': lbl_data['y'], 'text': lbl_data['text'],
        'textposition': 'middle right',
        'textfont': {'size': 10, 'color': '#333333'},
        'hoverinfo': 'skip', 'showlegend': False,
      })

    layout = {
      'height': chart_height,
      'margin': {'l': 0, 'r': 20, 't': 0, 'b': 0},
      'xaxis': {
        'range':          [0, bar_col_count],
        'showticklabels': False,   # timescale header is our own HTML
        'showgrid':       True,
        'gridcolor':      '#eeeeee',
        'zeroline':       False,
        'fixedrange':     False,
      },
      'yaxis': {
        'range':          [n_rows, -1],
        'showticklabels': False,
        'showgrid':       True,
        'gridcolor':      '#eeeeee',
        'zeroline':       False,
        'fixedrange':     False,
        'dtick':          1,
        'tick0':          0,
      },
      'shapes':          shapes,
      'showlegend':      False,
      'plot_bgcolor':    'white',
      'paper_bgcolor':   'white',
      'hovermode':       'closest',
      'clickmode':       'event',
    }

    return traces, layout

  def _build_timescale_bands(self, ts_start, bar_col_count, cols_per_week):
    """
    Build month band and week tick data for the JS timescale header.

    Month bands: one entry per calendar month spanning the timescale.
    Week ticks:  one entry per Monday (every 7 days from ts_start).

    Returns:
      month_bands : list of {label, startCol, endCol}
      week_ticks  : list of {label, col}
    """
    from datetime import date, timedelta

    try:
      ts_s = date.fromisoformat(ts_start)
    except (ValueError, AttributeError):
      ts_s = date.today()

    cpw      = cols_per_week / 7.0
    end_col  = bar_col_count

    # Week ticks - every 7 days
    week_ticks = []
    day_off    = 0
    d          = ts_s
    while True:
      col = int(day_off * cpw)
      if col >= end_col:
        break
      week_ticks.append({'label': d.strftime('%d'), 'col': col})
      d       += timedelta(days=7)
      day_off += 7

    # Month bands - first day of each month within range
    month_bands = []
    cur         = date(ts_s.year, ts_s.month, 1)
    end_date    = ts_s + timedelta(days=int(end_col / cpw) + 31)

    while cur <= end_date:
      start_off = (cur - ts_s).days
      start_col = max(0, int(start_off * cpw))
      if start_col >= end_col:
        break

      # Next month boundary
      if cur.month == 12:
        nxt = date(cur.year + 1, 1, 1)
      else:
        nxt = date(cur.year, cur.month + 1, 1)

      end_off  = (nxt - ts_s).days
      end_band = min(end_col, int(end_off * cpw))

      month_bands.append({
        'label':    cur.strftime('%b %Y'),
        'startCol': start_col,
        'endCol':   end_band,
      })
      cur = nxt

    return month_bands, week_ticks

  # ==========================================================================
  #  CALLBACKS FROM JS
  # ==========================================================================

  def _on_gantt_click(self, point_data):
    """
    Called from JS when user clicks a bar or milestone in the Plotly chart.
    task_id is passed in point_data['text'] (from customdata field).
    Populates activity details from detail_cache without a server call.
    """
    try:
      task_id = str(point_data.get('text', '')).strip()
      if not task_id or task_id in ('', 'None', 'undefined', 'null'):
        return

      # Normalise key type (cache keys may be int or str)
      if task_id not in self._detail_cache:
        task_id = next(
          (k for k in self._detail_cache if str(k) == task_id), None
        )
        if not task_id:
          return

      self._selected_task_id = task_id

      # Update header labels from gantt_data row_data
      if self._gantt_data:
        for t in self._gantt_data.get('tasks', []):
          if (str(t.get('task_id', '')) == task_id
              and t.get('row_type') == 'TASK'):
            row_data = t.get('row_data', [])
            self.lbl_activity_id.text   = str(row_data[0]) if row_data else ''
            self.lbl_activity_name.text = (
              str(row_data[1]) if len(row_data) > 1 else ''
            )
            break

      # Show details pane if currently hidden
      if not self._details_visible:
        self._details_visible    = True
        self.pnl_details.visible = True
        self.btn_toggle_details.text = 'Hide Details'
        anvil.js.call_js('_pp_toggleDetails', True)

      self._show_details_tab(self._active_tab)

    except Exception as e:
      print(f'[_on_gantt_click] ERROR: {e}')

  def _on_collapse_change(self, wbs_id, expanded):
    """Save WBS collapse state when a node is toggled by JS."""
    client_globals.set_collapse_state(
      self._current_layout_id, wbs_id, expanded
    )

  def _on_collapse_all(self, expanded):
    """Save collapse state for all WBS nodes (Ctrl+= or Ctrl+-)."""
    if not self._gantt_data:
      return
    for task in self._gantt_data.get('tasks', []):
      if task.get('row_type') == 'WBS':
        wbs_id = task.get('wbs_id', '')
        if not wbs_id:
          continue
        if expanded or task.get('indent', 0) == 1:
          client_globals.set_collapse_state(
            self._current_layout_id, wbs_id, expanded
          )

  # ==========================================================================
  #  FILTER EVENTS
  # ==========================================================================

  @handle("btn_apply_filters", "click")
  def btn_apply_filters_click(self, **event_args):
    """Reload Gantt with current filter settings."""
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
      values = anvil.server.call(
        'get_actcode_values',
        client_globals.session_token,
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
    """Switch active tab - highlights active button, renders content."""
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
    """Render selected tab content from detail_cache (no server call)."""
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
    """Add a label + value pair row to the details content panel."""
    row = FlowPanel()
    row.add_component(Label(text=f'{label}:', bold=True, width=180))
    row.add_component(Label(text=str(value) if value is not None else ''))
    self.pnl_details_content.add_component(row)

  def _render_general_tab(self, g):
    self._add_detail_row('Calendar',         g.get('calendar_name', ''))
    self._add_detail_row('Activity Type',    g.get('task_type', ''))
    self._add_detail_row('Duration Type',    g.get('duration_type', ''))
    self._add_detail_row('% Complete Type',  g.get('complete_pct_type', ''))
    self._add_detail_row('Orig Duration',    g.get('orig_dur_days', ''))
    self._add_detail_row('Rem Duration',     g.get('rem_dur_days', ''))
    self._add_detail_row('At Comp Duration', g.get('at_comp_dur_days', ''))
    self._add_detail_row('Total Float',      g.get('total_float_days', ''))
    self._add_detail_row('Free Float',       g.get('free_float_days', ''))
    self._add_detail_row('Start',            g.get('start_date', ''))
    self._add_detail_row('Finish',           g.get('finish_date', ''))

  def _render_status_tab(self, g):
    self._add_detail_row('Status',           g.get('status_code', ''))
    self._add_detail_row('Phys % Complete',  g.get('phys_complete_pct', ''))
    self._add_detail_row('Actual Start',     g.get('act_start_date', ''))
    self._add_detail_row('Actual Finish',    g.get('act_end_date', ''))
    self._add_detail_row('Early Start',      g.get('early_start_date', ''))
    self._add_detail_row('Early Finish',     g.get('early_end_date', ''))
    self._add_detail_row('Late Start',       g.get('late_start_date', ''))
    self._add_detail_row('Late Finish',      g.get('late_end_date', ''))
    self._add_detail_row('Target Start',     g.get('target_start_date', ''))
    self._add_detail_row('Target Finish',    g.get('target_end_date', ''))

  def _render_codes_tab(self, codes):
    if not codes:
      self.pnl_details_content.add_component(
        Label(text='No activity codes assigned.')
      )
      return
    for r in codes:
      self._add_detail_row(
        r[0] if len(r) > 0 else '',
        f'{r[1]}  {r[2]}'.strip() if len(r) > 2 else ''
      )

  def _render_relationships_tab(self, rels):
    preds = rels.get('predecessors', [])
    succs = rels.get('successors',   [])

    self.pnl_details_content.add_component(
      Label(text='Predecessors', bold=True, font_size=12)
    )
    if preds:
      for r in preds:
        lag     = f'  lag {r["lag_days"]}d' if r.get('lag_days') else ''
        driving = ' ★' if r.get('driving') else ''
        self._add_detail_row(
          r.get('task_code', ''),
          f'{r.get("rel_type", "")} {lag}{driving}  {r.get("task_name", "")}'
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
          f'{r.get("rel_type", "")} {lag}{driving}  {r.get("task_name", "")}'
        )
    else:
      self.pnl_details_content.add_component(Label(text='  None'))

  def _render_notebook_tab(self, notes):
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
    if not udfs:
      self.pnl_details_content.add_component(
        Label(text='No user-defined fields.')
      )
      return
    for r in udfs:
      self._add_detail_row(
        r[0] if len(r) > 0 else '',
        r[1] if len(r) > 1 else ''
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
      pass    # don't block logout if server call fails
    client_globals.clear_session()
    open_form('LoginForm')