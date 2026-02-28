from ._anvil_designer import GanttFormTemplate
from anvil import *
import anvil.server
import anvil.js
from anvil.js.window import document
import json
from .. import client_globals


# ===========================================================================
#  CONSTANTS  (must match PP_* in Native Libraries JS)
# ===========================================================================

ROW_HEIGHT    = 24    # px per Gantt row
TOOLBAR_H     = 36    # px for the in-shell toolbar strip
COL_HEADER_H  = 48    # px for timescale header (month row + week row)
DETAILS_H     = 220   # px for details pane
NAV_H         = 56    # px for Anvil nav bar
SIDEBAR_W     = 220   # px for sidebar when open

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

  All UI (toolbar, sidebar, gantt, details) is rendered as HTML inside
  pp-shell which is position:fixed below the Anvil nav bar.
  Anvil YAML only contains: lbl_no_data, pnl_gantt_container, nav bar items.

  pp-shell layout:
    #pp-toolbar    (36px strip: hamburger, project, import, buttons)
    #pp-main-row   (fills remaining height minus details)
      #pp-sidebar  (collapsible, 220px)
      #pp-gantt-area
        #pp-col-header   (48px: month row + week row)
        #pp-scroll-body
          #pp-col-data   (column table with sticky header)
          #pp-splitter   (6px drag handle)
          #pp-plot-pane  (Plotly)
    #pp-details    (220px: tab strip + content)
  """

  def __init__(self, **properties):
    self.init_components(**properties)

    anvil.js.window._prestoplan_form = self

    # ---- State ----
    self._details_visible    = True
    self._sidebar_visible    = False
    self._gfs_visible        = False
    self._current_project_id = None
    self._current_import_id  = None
    self._current_layout_id  = 'default'
    self._active_tab         = 'general'
    self._selected_task_id   = None
    self._gantt_data         = None
    self._detail_cache       = {}
    self._row_meta           = []
    self._project_name       = ''
    self._import_label       = ''

    # ---- Session check ----
    if not client_globals.session_token:
      open_form('LoginForm')
      return

    user = client_globals.current_user
    if user:
      self.lbl_nav_user.text = user.get('display_name', '')

    self._open_project_selector()

  # ==========================================================================
  #  PROJECT SELECTOR
  # ==========================================================================

  def _open_project_selector(self):
    """Two-step modal: pick project then import. Loads Gantt on completion."""
    try:
      token    = client_globals.session_token
      projects = anvil.server.call('get_user_projects', token)

      if not projects:
        alert('You do not have access to any projects. Please contact your administrator.')
        return

      project_choices = [(p['project_name'], p['project_id']) for p in projects]
      pp = ColumnPanel()
      pp.add_component(Label(text='Select Project:', bold=True))
      dd_proj = DropDown(items=project_choices, placeholder='Select a project...')
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

      imports = anvil.server.call('get_project_imports', token, selected_project_id)
      if not imports:
        alert('No imports found for this project. Please upload an XER file first.')
        return

      import_choices = [
        (f"{i.get('import_date', '')} - {i.get('label', 'No label')}", i['import_id'])
        for i in imports
      ]
      ip = ColumnPanel()
      ip.add_component(Label(text='Select Import:', bold=True))
      dd_imp = DropDown(items=import_choices, placeholder='Select an import...')
      ip.add_component(dd_imp)
      if self._current_import_id:
        dd_imp.selected_value = self._current_import_id

      if not alert(content=ip, title='Select Import',
                   buttons=[('OK', True), ('Cancel', False)]):
        return
      if not dd_imp.selected_value:
        return

      self._current_project_id = selected_project_id
      self._current_import_id  = dd_imp.selected_value
      self._project_name       = selected_project_name
      self._import_label       = next(
        (lbl for lbl, val in import_choices if val == dd_imp.selected_value),
        'Unknown Import'
      )
      self._load_gantt()

    except Exception as e:
      alert(f'Error loading projects: {str(e)}')

  # ==========================================================================
  #  GANTT - LOAD
  # ==========================================================================

  def _load_gantt(self):
    """Fetch Gantt data from server and render."""
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
    Build and inject the full app HTML into pnl_gantt_container.

    Everything — toolbar, sidebar, gantt, details — lives inside pp-shell
    so it is all position:fixed and immune to Anvil's layout system.

    The column header row and bar chart timescale header are the same element
    (pp-col-header) so they always occupy the same vertical space.
    Column name cells go in the LEFT side of pp-col-header; timescale bands
    go in the RIGHT side — both 48px tall, perfectly aligned.
    """
    raw_tasks     = gantt_data.get('tasks', [])
    columns       = gantt_data.get('columns', [])
    bar_col_count = gantt_data.get('bar_col_count', 0)
    ts_start      = gantt_data.get('timescale_start', '')
    ts_end        = gantt_data.get('timescale_end', '')
    cols_per_week = gantt_data.get('cols_per_week', 7)

    tasks = [t for t in raw_tasks if t.get('row_type') != 'BLANK']
    if not tasks:
      return

    n_rows       = len(tasks)
    chart_height = n_rows * ROW_HEIGHT + 2

    collapse_state = client_globals.get_collapse_state(self._current_layout_id)
    for task in tasks:
      wbs_id = task.get('wbs_id', '')
      if wbs_id and task.get('row_type') == 'WBS' and wbs_id not in collapse_state:
        collapse_state[wbs_id] = True

    row_meta       = self._build_row_meta(tasks)
    self._row_meta = row_meta
    col_widths     = [col.get('width', 10) * 7 for col in columns]

    # Header: left side = column names, right side = timescale (both 48px)
    col_names_html    = self._build_col_names_html(columns, col_widths)
    col_table_html    = self._build_col_table_html(tasks, columns, col_widths, collapse_state)
    traces, layout    = self._build_plotly_data(
      tasks, bar_col_count, ts_start, ts_end, cols_per_week, n_rows, chart_height
    )
    month_bands, week_ticks = self._build_timescale_bands(
      ts_start, bar_col_count, cols_per_week
    )

    # Toolbar HTML
    sidebar_icon = '✕' if self._sidebar_visible else '☰'
    det_btn_text = 'Hide Details' if self._details_visible else 'Show Details'
    toolbar_html = f"""
<div id="pp-toolbar" style="
  display:flex; align-items:center; gap:8px;
  padding:0 8px; height:{TOOLBAR_H}px; min-height:{TOOLBAR_H}px;
  background:#1565c0; color:white; flex-shrink:0;">
  <button id="pp-btn-sidebar" onclick="_pp_onSidebarClick()"
    style="background:none; border:1px solid rgba(255,255,255,0.5);
    color:white; font-size:16px; padding:2px 8px; cursor:pointer;
    border-radius:3px;">{sidebar_icon}</button>
  <span id="pp-lbl-project" style="font-weight:bold; font-size:13px;">
    {self._project_name}</span>
  <span id="pp-lbl-import" style="font-size:12px; opacity:0.8;">
    {self._import_label}</span>
  <button onclick="_pp_onChangeProject()"
    style="background:none; border:1px solid rgba(255,255,255,0.5);
    color:white; font-size:12px; padding:2px 8px; cursor:pointer;
    border-radius:3px; margin-left:4px;">Change Project</button>
  <div style="flex:1;"></div>
  <button id="pp-btn-details" onclick="_pp_onDetailsClick()"
    style="background:none; border:1px solid rgba(255,255,255,0.5);
    color:white; font-size:12px; padding:2px 8px; cursor:pointer;
    border-radius:3px;">{det_btn_text}</button>
</div>"""

    # Sidebar HTML
    sidebar_html = """
<div style="padding:8px; font-family:Arial,sans-serif; font-size:12px;">
  <div style="font-weight:bold; margin-bottom:4px;">Layout:</div>
  <select id="pp-dd-layout" style="width:100%; margin-bottom:8px;"
    onchange="_pp_onLayoutChange(this.value)">
    <option value="default">Default layout</option>
  </select>
  <div style="font-weight:bold; margin-bottom:4px;">Saved Filters:</div>
  <select id="pp-dd-filters" style="width:100%; margin-bottom:8px;">
    <option value="">No filter applied</option>
  </select>
  <button onclick="_pp_onGfsToggle()"
    id="pp-btn-gfs"
    style="width:100%; text-align:left; background:#e8eaf6;
    border:1px solid #9fa8da; padding:4px 6px; cursor:pointer;
    border-radius:3px; font-size:12px; margin-bottom:4px;">
    ▶ Grouping / Filtering / Sorting
  </button>
  <div id="pp-gfs-panel" style="display:none;">
    <div style="font-weight:bold; margin:6px 0 2px;">Status</div>
    <label><input type="checkbox" id="pp-chk-ns" checked> Not Started</label><br>
    <label><input type="checkbox" id="pp-chk-ip" checked> In Progress</label><br>
    <label><input type="checkbox" id="pp-chk-co" checked> Complete</label><br>
    <div style="font-weight:bold; margin:6px 0 2px;">Criticality</div>
    <label><input type="checkbox" id="pp-chk-cr" checked> Critical</label><br>
    <label><input type="checkbox" id="pp-chk-nc" checked> Near Critical</label><br>
    <label><input type="checkbox" id="pp-chk-nn" checked> Non Critical</label><br>
    <div style="margin-top:8px;">
      <button onclick="_pp_onApplyFilters()"
        style="background:#1565c0; color:white; border:none; padding:4px 10px;
        cursor:pointer; border-radius:3px; margin-right:4px;">Apply</button>
      <button onclick="_pp_onClearFilters()"
        style="background:#e0e0e0; border:none; padding:4px 10px;
        cursor:pointer; border-radius:3px;">Clear</button>
    </div>
  </div>
</div>"""

    # Details pane HTML
    det_display  = 'flex' if self._details_visible else 'none'
    details_html = f"""
<div style="display:flex; align-items:center; gap:8px; padding:4px 8px;
  background:#e3f2fd; border-bottom:1px solid #90caf9; flex-shrink:0;">
  <span style="font-weight:bold; font-size:13px;">Activity Details</span>
  <span id="pp-det-id"   style="color:#555; font-size:12px;"></span>
  <span id="pp-det-name" style="font-weight:bold; font-size:12px;"></span>
</div>
<div style="display:flex; gap:4px; padding:4px 8px;
  background:#f5f5f5; border-bottom:1px solid #e0e0e0; flex-shrink:0;">
  {''.join(
    f'<button id="pp-tab-{t}" onclick="_pp_onTabClick(\'{t}\')"'
    f' style="padding:3px 10px; font-size:12px; cursor:pointer; border-radius:3px;'
    f' background:{\"#1565c0\" if t == self._active_tab else \"#e0e0e0\"};'
    f' color:{\"white\" if t == self._active_tab else \"#333\"};'
    f' border:none; font-weight:{\"bold\" if t == self._active_tab else \"normal\"};">'
    f'{label}</button>'
    for t, label in [
      ('general','General'),('status','Status'),('codes','Codes'),
      ('relationships','Relationships'),('notebook','Notebook'),('udfs','UDFs')
    ]
  )}
</div>
<div id="pp-det-content" style="flex:1; overflow-y:auto; padding:6px 8px;
  font-family:Arial,sans-serif; font-size:12px;">
  <em style="color:#888;">Click an activity in the Gantt chart to see details.</em>
</div>"""

    js_data = json.dumps({
      'traces':        traces,
      'layout':        layout,
      'rowMeta':       row_meta,
      'collapseState': collapse_state,
      'monthBands':    month_bands,
      'weekTicks':     week_ticks,
      'barColCount':   bar_col_count,
      'colsPerWeek':   cols_per_week,
      'toolbarH':      TOOLBAR_H,
      'detailsH':      DETAILS_H,
      'navH':          NAV_H,
      'colHeaderH':    COL_HEADER_H,
      'rowH':          ROW_HEIGHT,
    })

    html = f"""
<div id="pp-shell" style="font-family:Arial,sans-serif; font-size:12px;">

  {toolbar_html}

  <div id="pp-main-row">

    <div id="pp-sidebar">{sidebar_html}</div>

    <div id="pp-gantt-area">

      <!-- Unified header: col names LEFT, timescale RIGHT, same 48px height -->
      <div id="pp-col-header">

        <!-- Left: column name cells (populated by JS after col-data width is known) -->
        <div id="pp-col-names" style="flex-shrink:0; overflow:hidden;
          display:flex; flex-direction:column; background:#1565c0;">
          <div style="height:24px; border-bottom:1px solid #0d47a1;
            display:flex; align-items:center;">
            {col_names_html}
          </div>
          <div style="height:24px;"></div>
        </div>

        <!-- Splitter spacer (matches pp-splitter width) -->
        <div id="pp-header-splitter-spacer"
          style="width:6px; min-width:6px; flex-shrink:0;
          background:#1565c0; border-right:1px solid #0d47a1;"></div>

        <!-- Right: scrollable timescale (month + week rows) -->
        <div id="pp-header-right" style="flex:1; overflow:hidden;
          display:flex; flex-direction:column; background:#1565c0;">
          <div id="pp-header-months" style="height:24px; min-height:24px;
            display:flex; overflow:hidden; border-bottom:1px solid #0d47a1;"></div>
          <div id="pp-header-weeks"  style="height:24px; min-height:24px;
            display:flex; overflow:hidden;"></div>
        </div>

      </div>

      <div id="pp-scroll-body">
        <div id="pp-col-data">
          {col_table_html}
        </div>
        <div id="pp-splitter" title="Drag to resize columns"></div>
        <div id="pp-plot-pane">
          <div id="pp-plotly-div"
            style="height:{chart_height}px; min-width:600px;"></div>
        </div>
      </div>

    </div>
  </div>

  <div id="pp-details" style="display:{det_display}; flex-direction:column;">
    {details_html}
  </div>

</div>

<script>
(function() {{
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
    try:
      anvil.js.call_js('_pp_cleanup')
    except Exception:
      pass
    anvil.js.window._prestoplan_form = self
    self.pnl_gantt_container.add_component(HtmlTemplate(html=html))

  # --------------------------------------------------------------------------
  #  HTML BUILDERS
  # --------------------------------------------------------------------------

  def _build_row_meta(self, tasks):
    """Per-row metadata for JS collapse logic."""
    meta = []
    for idx, task in enumerate(tasks):
      row_type = task.get('row_type', 'TASK')
      wbs_id   = task.get('wbs_id', '')
      parent_wbs_id = wbs_id if row_type == 'TASK' else task.get('parent_wbs_id', '')
      meta.append({
        'rowIdx':      idx,
        'rowType':     row_type,
        'wbsId':       wbs_id,
        'parentWbsId': parent_wbs_id,
        'depth':       task.get('indent', 0),
        'taskId':      task.get('task_id', ''),
      })
    return meta

  def _build_col_names_html(self, columns, col_widths):
    """
    Column name cells for the LEFT side of pp-col-header.
    24px icon spacer then one cell per column.
    Must exactly match pp-col-table column widths.
    """
    parts = [
      '<div style="width:24px; min-width:24px; flex-shrink:0;'
      ' border-right:1px solid #0d47a1;"></div>'
    ]
    for i, col in enumerate(columns):
      parts.append(
        f'<div style="width:{col_widths[i]}px; min-width:{col_widths[i]}px;'
        f' flex-shrink:0; padding:0 6px; overflow:hidden; white-space:nowrap;'
        f' color:white; font-weight:bold; font-size:12px;'
        f' border-right:1px solid #0d47a1;'
        f' display:flex; align-items:center;">'
        f'{col.get("label","")}</div>'
      )
    return ''.join(parts)

  def _build_col_table_html(self, tasks, columns, col_widths, collapse_state):
    """Scrollable column data table. Row height fixed at ROW_HEIGHT px."""
    parts   = []
    total_w = sum(col_widths) + 24

    parts.append(
      f'<table id="pp-col-table" style="border-collapse:collapse;'
      f' width:{total_w}px; table-layout:fixed; font-size:12px;'
      f' font-family:Arial,sans-serif;"><tbody>'
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
          f'<tr data-row-idx="{idx}" data-wbs-id="{wbs_id}"'
          f' data-parent-wbs-id="{parent_wbs_id}"'
          f' style="height:{ROW_HEIGHT}px; background:{bg};'
          f' font-weight:bold; color:#1a237e;">'
        )
        parts.append(
          f'<td style="width:24px; text-align:center; vertical-align:middle;'
          f' border-bottom:1px solid #ccc; border-right:1px solid #ccc;'
          f' cursor:pointer; padding:0;"'
          f' onclick="_pp_toggleWbs(\'{wbs_id}\')">'
          f'<span class="pp-wbs-icon"'
          f' style="font-size:10px; user-select:none;">{icon}</span></td>'
        )
        for i, val in enumerate(row_data):
          pad = (f'padding-left:{indent_px+4}px; padding-right:4px;'
                 if i == 0 else 'padding:2px 4px;')
          parts.append(
            f'<td style="width:{col_widths[i]}px; {pad}'
            f' overflow:hidden; white-space:nowrap; vertical-align:middle;'
            f' border-bottom:1px solid #ccc; border-right:1px solid #ddd;'
            f' cursor:pointer;" onclick="_pp_toggleWbs(\'{wbs_id}\')">'
            f'{val if val is not None else ""}</td>'
          )
        parts.append('</tr>')

      else:
        indent_px = indent * 12
        parts.append(
          f'<tr data-row-idx="{idx}" data-task-id="{task_id}"'
          f' data-parent-wbs-id="{wbs_id}"'
          f' style="height:{ROW_HEIGHT}px; background:white;'
          f' color:#222; cursor:pointer;"'
          f' onmouseover="this.style.background=\'#fff9c4\'"'
          f' onmouseout="this.style.background=\'white\'">'
        )
        parts.append(
          f'<td style="width:24px; border-bottom:1px solid #eee;'
          f' border-right:1px solid #ccc;"></td>'
        )
        for i, val in enumerate(row_data):
          col   = columns[i] if i < len(columns) else {}
          pad   = (f'padding-left:{indent_px+4}px; padding-right:4px;'
                   if i == 0 else 'padding:2px 4px;')
          align = 'right' if col.get('duration_field') else 'left'
          disp  = '' if val is None else str(val)
          parts.append(
            f'<td style="width:{col_widths[i]}px; {pad}'
            f' overflow:hidden; white-space:nowrap; text-align:{align};'
            f' vertical-align:middle;'
            f' border-bottom:1px solid #eee; border-right:1px solid #eee;">'
            f'{disp}</td>'
          )
        parts.append('</tr>')

    parts.append('</tbody></table>')
    return ''.join(parts)

  def _build_plotly_data(self, tasks, bar_col_count, ts_start, ts_end,
                          cols_per_week, n_rows, chart_height):
    """Build Plotly traces and layout dict."""
    from datetime import date, timedelta
    try:
      ts_s = date.fromisoformat(ts_start)
    except (ValueError, AttributeError):
      ts_s = date.today()

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

    bar_data = {c: {'x': [], 'y': [], 'text': [], 'customdata': []}
                for c in BAR_COLOURS}
    ms_data  = {c: {'x': [], 'y': [], 'text': [], 'customdata': []}
                for c in MILESTONE_COLOURS}
    lbl_data = {'x': [], 'y': [], 'text': []}

    for row_idx, task in enumerate(tasks):
      if task.get('row_type') != 'TASK':
        continue
      task_id  = str(task.get('task_id', ''))
      for seg in task.get('bar_segments', []):
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
          s, e = seg.get('start', 0), seg.get('end', 0)
          bar_data[stype]['x'].extend([s, e, None])
          bar_data[stype]['y'].extend([row_idx, row_idx, None])
          bar_data[stype]['text'].extend([task_id, task_id, ''])
          bar_data[stype]['customdata'].extend([task_id, task_id, ''])

    traces = []
    colour_names = {'1':'Actual','2':'Remaining','3':'Near Critical','4':'Critical'}
    for code, colour in BAR_COLOURS.items():
      d = bar_data[code]
      if not d['x']: continue
      traces.append({
        'type': 'scatter', 'mode': 'lines',
        'name': colour_names.get(code, code),
        'x': d['x'], 'y': d['y'],
        'text': d['text'], 'customdata': d['customdata'],
        'line': {'color': colour, 'width': int(ROW_HEIGHT * 0.55)},
        'hovertemplate': '%{customdata}<extra></extra>',
      })

    ms_names = {'M1':'Actual Milestone','M2':'Milestone',
                'M3':'Near-Critical Milestone','M4':'Critical Milestone'}
    for code, colour in MILESTONE_COLOURS.items():
      d = ms_data[code]
      if not d['x']: continue
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
        'range': [0, bar_col_count],
        'showticklabels': False,
        'showgrid': True, 'gridcolor': '#eeeeee',
        'zeroline': False, 'fixedrange': False,
      },
      'yaxis': {
        'range': [n_rows, -1],
        'showticklabels': False,
        'showgrid': True, 'gridcolor': '#eeeeee',
        'zeroline': False, 'fixedrange': False,
        'dtick': 1, 'tick0': 0,
      },
      'shapes': shapes,
      'showlegend': False,
      'plot_bgcolor': 'white', 'paper_bgcolor': 'white',
      'hovermode': 'closest', 'clickmode': 'event',
    }
    return traces, layout

  def _build_timescale_bands(self, ts_start, bar_col_count, cols_per_week):
    """Month band and week tick data for the JS timescale header."""
    from datetime import date, timedelta
    try:
      ts_s = date.fromisoformat(ts_start)
    except (ValueError, AttributeError):
      ts_s = date.today()

    cpw     = cols_per_week / 7.0
    end_col = bar_col_count

    week_ticks = []
    day_off, d = 0, ts_s
    while True:
      col = int(day_off * cpw)
      if col >= end_col: break
      week_ticks.append({'label': d.strftime('%d'), 'col': col})
      d += timedelta(days=7); day_off += 7

    month_bands = []
    cur      = date(ts_s.year, ts_s.month, 1)
    end_date = ts_s + timedelta(days=int(end_col / cpw) + 31)
    while cur <= end_date:
      start_off = (cur - ts_s).days
      start_col = max(0, int(start_off * cpw))
      if start_col >= end_col: break
      nxt     = date(cur.year + 1, 1, 1) if cur.month == 12 else date(cur.year, cur.month + 1, 1)
      end_off = (nxt - ts_s).days
      month_bands.append({
        'label':    cur.strftime('%b %Y'),
        'startCol': start_col,
        'endCol':   min(end_col, int(end_off * cpw)),
      })
      cur = nxt

    return month_bands, week_ticks

  # ==========================================================================
  #  CALLBACKS FROM JS
  # ==========================================================================

  def _on_change_project(self):
    """Called from JS Change Project button."""
    self._open_project_selector()

  def _on_sidebar_toggle(self):
    """Called from JS hamburger button."""
    self._sidebar_visible = not self._sidebar_visible
    icon = '✕' if self._sidebar_visible else '☰'
    anvil.js.call_js('_pp_toggleSidebar', self._sidebar_visible)
    # Update button text
    try:
      anvil.js.call_js('_pp_setHtml', 'pp-btn-sidebar', icon)
    except Exception:
      pass

  def _on_details_toggle(self):
    """Called from JS Hide/Show Details button."""
    self._details_visible = not self._details_visible
    label = 'Hide Details' if self._details_visible else 'Show Details'
    anvil.js.call_js('_pp_toggleDetails', self._details_visible)
    try:
      anvil.js.call_js('_pp_setHtml', 'pp-btn-details', label)
    except Exception:
      pass

  def _on_gfs_toggle(self):
    """Called from JS GFS expand/collapse button."""
    self._gfs_visible = not self._gfs_visible

  def _on_apply_filters(self):
    """Called from JS Apply Filters button."""
    self._load_gantt()

  def _on_clear_filters(self):
    """Called from JS Clear Filters button."""
    self._load_gantt()

  def _on_layout_change(self, layout_id):
    """Called from JS layout dropdown."""
    if layout_id:
      self._current_layout_id = layout_id

  def _on_tab_click(self, tab_name):
    """Called from JS details tab buttons."""
    self._active_tab = tab_name
    self._render_details_content(tab_name)

  def _on_gantt_click(self, point_data):
    """
    Called from JS when a bar or milestone is clicked.
    Populates details pane from detail_cache (no server call).
    """
    try:
      task_id = str(point_data.get('text', '')).strip()
      if not task_id or task_id in ('', 'None', 'undefined', 'null'):
        return

      if task_id not in self._detail_cache:
        task_id = next(
          (k for k in self._detail_cache if str(k) == task_id), None
        )
        if not task_id:
          return

      self._selected_task_id = task_id

      act_id, act_name = '', ''
      if self._gantt_data:
        for t in self._gantt_data.get('tasks', []):
          if str(t.get('task_id', '')) == task_id and t.get('row_type') == 'TASK':
            row_data = t.get('row_data', [])
            act_id   = str(row_data[0]) if row_data else ''
            act_name = str(row_data[1]) if len(row_data) > 1 else ''
            break

      # Update detail header spans via JS
      anvil.js.call_js('_pp_setHtml', 'pp-det-id',   act_id)
      anvil.js.call_js('_pp_setHtml', 'pp-det-name', act_name)

      # Show details if hidden
      if not self._details_visible:
        self._details_visible = True
        anvil.js.call_js('_pp_toggleDetails', True)
        anvil.js.call_js('_pp_setHtml', 'pp-btn-details', 'Hide Details')

      self._render_details_content(self._active_tab)

    except Exception as e:
      print(f'[_on_gantt_click] ERROR: {e}')

  def _on_collapse_change(self, wbs_id, expanded):
    """Save WBS collapse state when toggled."""
    client_globals.set_collapse_state(self._current_layout_id, wbs_id, expanded)

  def _on_collapse_all(self, expanded):
    """Save collapse state for all WBS nodes."""
    if not self._gantt_data:
      return
    for task in self._gantt_data.get('tasks', []):
      if task.get('row_type') == 'WBS':
        wbs_id = task.get('wbs_id', '')
        if wbs_id and (expanded or task.get('indent', 0) == 1):
          client_globals.set_collapse_state(self._current_layout_id, wbs_id, expanded)

  # --------------------------------------------------------------------------
  #  DETAILS CONTENT RENDERING
  # --------------------------------------------------------------------------

  def _render_details_content(self, tab_name):
    """Build details tab content as HTML string and push to pp-det-content via JS."""
    self._active_tab = tab_name

    # Update tab button styles
    tab_buttons_js = '; '.join([
      f'(function(){{var b=document.getElementById("pp-tab-{t}");'
      f'if(b){{b.style.background="{("#1565c0" if t==tab_name else "#e0e0e0")}";'
      f'b.style.color="{("white" if t==tab_name else "#333")}";'
      f'b.style.fontWeight="{("bold" if t==tab_name else "normal")}"}}})()'
      for t in ['general','status','codes','relationships','notebook','udfs']
    ])
    try:
      anvil.js.call_js('_pp_execJs', tab_buttons_js)
    except Exception:
      pass

    if not self._selected_task_id:
      html = '<em style="color:#888;">Click an activity in the Gantt chart to see details.</em>'
      anvil.js.call_js('_pp_setHtml', 'pp-det-content', html)
      return

    cache = self._detail_cache.get(self._selected_task_id, {})

    if tab_name == 'general':
      html = self._html_general(cache.get('general', {}))
    elif tab_name == 'status':
      html = self._html_status(cache.get('general', {}))
    elif tab_name == 'codes':
      html = self._html_codes(cache.get('codes', []))
    elif tab_name == 'relationships':
      html = self._html_relationships(cache.get('relationships', {}))
    elif tab_name == 'notebook':
      html = self._html_notebook(cache.get('notebook', []))
    elif tab_name == 'udfs':
      html = self._html_udfs(cache.get('udfs', []))
    else:
      html = ''

    anvil.js.call_js('_pp_setHtml', 'pp-det-content', html)

  def _det_row(self, label, value):
    """Single label+value row for details pane."""
    v = str(value) if value is not None else ''
    return (f'<div style="display:flex; margin-bottom:2px;">'
            f'<span style="width:180px; min-width:180px; font-weight:bold;">{label}:</span>'
            f'<span>{v}</span></div>')

  def _html_general(self, g):
    rows = [
      self._det_row('Calendar',         g.get('calendar_name','')),
      self._det_row('Activity Type',    g.get('task_type','')),
      self._det_row('Duration Type',    g.get('duration_type','')),
      self._det_row('% Complete Type',  g.get('complete_pct_type','')),
      self._det_row('Orig Duration',    g.get('orig_dur_days','')),
      self._det_row('Rem Duration',     g.get('rem_dur_days','')),
      self._det_row('At Comp Duration', g.get('at_comp_dur_days','')),
      self._det_row('Total Float',      g.get('total_float_days','')),
      self._det_row('Free Float',       g.get('free_float_days','')),
      self._det_row('Start',            g.get('start_date','')),
      self._det_row('Finish',           g.get('finish_date','')),
    ]
    return ''.join(rows)

  def _html_status(self, g):
    rows = [
      self._det_row('Status',           g.get('status_code','')),
      self._det_row('Phys % Complete',  g.get('phys_complete_pct','')),
      self._det_row('Actual Start',     g.get('act_start_date','')),
      self._det_row('Actual Finish',    g.get('act_end_date','')),
      self._det_row('Early Start',      g.get('early_start_date','')),
      self._det_row('Early Finish',     g.get('early_end_date','')),
      self._det_row('Late Start',       g.get('late_start_date','')),
      self._det_row('Late Finish',      g.get('late_end_date','')),
      self._det_row('Target Start',     g.get('target_start_date','')),
      self._det_row('Target Finish',    g.get('target_end_date','')),
    ]
    return ''.join(rows)

  def _html_codes(self, codes):
    if not codes:
      return '<em style="color:#888;">No activity codes assigned.</em>'
    return ''.join(
      self._det_row(r[0] if r else '', f'{r[1]}  {r[2]}'.strip() if len(r) > 2 else '')
      for r in codes
    )

  def _html_relationships(self, rels):
    parts = ['<div style="font-weight:bold; margin-bottom:4px;">Predecessors</div>']
    preds = rels.get('predecessors', [])
    if preds:
      for r in preds:
        lag     = f' lag {r["lag_days"]}d' if r.get('lag_days') else ''
        driving = ' ★' if r.get('driving') else ''
        parts.append(self._det_row(r.get('task_code',''),
          f'{r.get("rel_type","")} {lag}{driving}  {r.get("task_name","")}'))
    else:
      parts.append('<div style="color:#888; margin-bottom:6px;">None</div>')
    parts.append('<div style="font-weight:bold; margin:6px 0 4px;">Successors</div>')
    succs = rels.get('successors', [])
    if succs:
      for r in succs:
        lag     = f' lag {r["lag_days"]}d' if r.get('lag_days') else ''
        driving = ' ★' if r.get('driving') else ''
        parts.append(self._det_row(r.get('task_code',''),
          f'{r.get("rel_type","")} {lag}{driving}  {r.get("task_name","")}'))
    else:
      parts.append('<div style="color:#888;">None</div>')
    return ''.join(parts)

  def _html_notebook(self, notes):
    if not notes:
      return '<em style="color:#888;">No notebook entries.</em>'
    return ''.join(
      f'<div style="font-weight:bold;">{n[0] if n else ""}</div>'
      f'<div style="margin-bottom:6px;">{n[1] if len(n)>1 else ""}</div>'
      for n in notes
    )

  def _html_udfs(self, udfs):
    if not udfs:
      return '<em style="color:#888;">No user-defined fields.</em>'
    return ''.join(self._det_row(r[0] if r else '', r[1] if len(r)>1 else '') for r in udfs)

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