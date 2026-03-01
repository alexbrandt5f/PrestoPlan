from ._anvil_designer import GanttFormTemplate
from anvil import *
import anvil.server
import anvil.js
from anvil.js.window import document
import json
import time as _time
from datetime import date as _date, datetime as _datetime
from .. import client_globals


# ===========================================================================
#  SAFE JSON ENCODER — handles date/datetime objects anywhere in payload
# ===========================================================================

class _SafeEncoder(json.JSONEncoder):
  """Custom encoder that converts date/datetime to ISO strings."""
  def default(self, obj):
    if isinstance(obj, _datetime):
      return obj.isoformat()
    if isinstance(obj, _date):
      return obj.isoformat()
    return super().default(obj)


# ===========================================================================
#  CLIENT-SIDE LOGGING — set to False for production
# ===========================================================================

PP_LOG_ENABLED = True


def _log(tag, msg):
  """Print a timestamped log line to the Anvil client console."""
  if PP_LOG_ENABLED:
    ts = _datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[PP-Client {ts}] {tag} | {msg}")


# ===========================================================================
#  CONSTANTS
# ===========================================================================

ROW_HEIGHT    = 24
COL_HEADER_H  = 48
DETAILS_H     = 220
NAV_H         = 56
SIDEBAR_W     = 220
TOOLBAR_H     = 32    # thin toolbar strip inside pp-shell

WBS_COLOURS = {1:'#bbdefb', 2:'#c8e6c9', 3:'#fff9c4', 4:'#f3e5f5'}
WBS_COLOUR_DEFAULT = '#f5f5f5'

BAR_COLOURS = {'1':'#1565c0', '2':'#2e7d32', '3':'#e65100', '4':'#c62828'}
MILESTONE_COLOURS = {'M1':'#1565c0', 'M2':'#2e7d32', 'M3':'#e65100', 'M4':'#c62828'}


class GanttForm(GanttFormTemplate):
  """
  Main Gantt viewer form for PrestoPlan.

  v7: Fixed row highlighting (yellow/orange), Go To logic chasing,
  zoom direction, pan/zoom limits removed, Change Project/XER in
  white header bar, enhanced sidebar filtering.
  """

  def __init__(self, **properties):
    self.init_components(**properties)
    anvil.js.window._prestoplan_form = self
    _log("__init__", "GanttForm initialising")

    self._details_visible    = True
    self._sidebar_visible    = False
    self._current_project_id = None
    self._current_import_id  = None
    self._current_layout_id  = 'default'
    self._project_name       = ''
    self._import_label       = ''
    self._import_list        = []   # all imports for current project
    self._gantt_data         = None
    self._detail_cache       = {}

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
    _log("project_selector", "Opening project selector")
    try:
      token    = client_globals.session_token
      projects = anvil.server.call('get_user_projects', token)
      if not projects:
        alert('No projects available.')
        return

      project_choices = [(p['project_name'], p['project_id']) for p in projects]
      pp = ColumnPanel()
      pp.add_component(Label(text='Select Project:', bold=True))
      dd_proj = DropDown(items=project_choices,
                         placeholder='Select a project...')
      pp.add_component(dd_proj)
      if self._current_project_id:
        dd_proj.selected_value = self._current_project_id

      if not alert(content=pp, title='Select Project',
                   buttons=[('OK', True), ('Cancel', False)]):
        return
      if not dd_proj.selected_value:
        return

      sel_pid  = dd_proj.selected_value
      sel_name = next(
        (l for l, v in project_choices if v == sel_pid), 'Unknown')

      imports = anvil.server.call('get_project_imports', token, sel_pid)
      if not imports:
        alert('No imports found.')
        return

      import_choices = [
        (f"{i.get('import_date','')} - {i.get('label','No label')}",
         i['import_id'])
        for i in imports
      ]
      ip = ColumnPanel()
      ip.add_component(Label(text='Select Import:', bold=True))
      dd_imp = DropDown(items=import_choices,
                        placeholder='Select an import...')
      ip.add_component(dd_imp)
      if self._current_import_id:
        dd_imp.selected_value = self._current_import_id

      if not alert(content=ip, title='Select Import',
                   buttons=[('OK', True), ('Cancel', False)]):
        return
      if not dd_imp.selected_value:
        return

      self._current_project_id = sel_pid
      self._current_import_id  = dd_imp.selected_value
      self._project_name       = sel_name
      self._import_label       = next(
        (l for l, v in import_choices if v == dd_imp.selected_value),
        'Unknown')
      self._import_list        = imports
      self._load_gantt()

    except Exception as e:
      alert(f'Error: {str(e)}')

  # ==========================================================================
  #  GANTT - LOAD  (handles BlobMedia for large payloads)
  # ==========================================================================

  def _load_gantt(self):
    """Fetch Gantt data from server and render."""
    if not self._current_project_id or not self._current_import_id:
      _log("load_gantt", "No project/import selected, skipping")
      return

    _log("load_gantt", f"START project={self._current_project_id} "
         f"import={self._current_import_id}")
    t0 = _time.time()
    self.lbl_no_data.text    = 'Loading Gantt chart...'
    self.lbl_no_data.visible = True
    self.pnl_gantt_container.clear()

    try:
      token  = client_globals.session_token
      _log("load_gantt", "Calling get_gantt_data...")
      t1 = _time.time()
      result = anvil.server.call(
        'get_gantt_data', token,
        self._current_project_id, self._current_import_id
      )
      elapsed_call = _time.time() - t1
      _log("load_gantt", f"Server call returned in {elapsed_call:.2f}s")

      # --- Handle BlobMedia for large payloads ---
      if isinstance(result, anvil.BlobMedia):
        _log("load_gantt", "Result is BlobMedia, decoding...")
        t1 = _time.time()
        gantt_data = json.loads(result.get_bytes().decode('utf-8'))
        _log("load_gantt", f"BlobMedia decoded in "
             f"{_time.time()-t1:.2f}s")
      else:
        gantt_data = result
        _log("load_gantt", "Result is dict (under 500KB)")

      if not gantt_data or not gantt_data.get('tasks'):
        self.lbl_no_data.text = 'No tasks found for this import.'
        _log("load_gantt", "No tasks in response")
        return

      task_count = len(gantt_data.get('tasks', []))
      detail_count = len(gantt_data.get('detail_cache', {}))
      _log("load_gantt", f"Data: {task_count} tasks, "
           f"{detail_count} detail entries")

      self._gantt_data   = gantt_data
      self._detail_cache = gantt_data.get('detail_cache', {})
      self.lbl_no_data.visible = False

      _log("load_gantt", "Calling _render_gantt...")
      t1 = _time.time()
      self._render_gantt(gantt_data)
      _log("load_gantt", f"Render completed in {_time.time()-t1:.2f}s")
      _log("load_gantt", f"TOTAL load time: {_time.time()-t0:.2f}s")

    except Exception as e:
      _log("load_gantt", f"EXCEPTION: {e}")
      self.lbl_no_data.text    = f'Error loading Gantt: {str(e)}'
      self.lbl_no_data.visible = True

  # ==========================================================================
  #  GANTT - RENDER
  # ==========================================================================

  def _render_gantt(self, gantt_data):
    """Build full app HTML and inject into pnl_gantt_container."""
    t0 = _time.time()
    raw_tasks     = gantt_data.get('tasks', [])
    columns       = gantt_data.get('columns', [])
    bar_col_count = gantt_data.get('bar_col_count', 0)
    ts_start      = gantt_data.get('timescale_start', '')
    ts_end        = gantt_data.get('timescale_end', '')
    cols_per_week = gantt_data.get('cols_per_week', 7)

    tasks = [t for t in raw_tasks if t.get('row_type') != 'BLANK']
    _log("render", f"Rendering {len(tasks)} visible rows "
         f"(filtered from {len(raw_tasks)} raw)")
    if not tasks:
      return

    n_rows       = len(tasks)
    chart_height = n_rows * ROW_HEIGHT + 2

    if not hasattr(client_globals, "_collapse_state"):
      client_globals._collapse_state = {}
    cs = client_globals._collapse_state
    for t in tasks:
      wid = t.get('wbs_id', '')
      if wid and t.get('row_type') == 'WBS' and wid not in cs:
        cs[wid] = True

    row_meta   = self._build_row_meta(tasks)
    col_widths = [c.get('width', 10) * 7 for c in columns]

    col_names_html = self._build_col_names_html(columns, col_widths)
    col_table_html = self._build_col_table_html(tasks, columns,
                                                col_widths, cs)
    traces, layout = self._build_plotly_data(
      tasks, bar_col_count, ts_start, ts_end, cols_per_week,
      n_rows, chart_height
    )
    month_bands, week_ticks = self._build_timescale_bands(
      ts_start, bar_col_count, cols_per_week
    )

    # --- Build import options for Change XER dropdown ---
    import_options_html = ''
    for imp in self._import_list:
      imp_id  = imp.get('import_id', '')
      imp_lbl = (f"{imp.get('import_date','')} - "
                 f"{imp.get('label','No label')}")
      selected = ' selected' if str(imp_id) == str(
        self._current_import_id) else ''
      import_options_html += (
        f'<option value="{imp_id}"{selected}>'
        f'{imp_lbl}</option>')

    # --- Toolbar HTML (thin strip inside pp-shell) ---
    proj_display = self._project_name or ''
    toolbar_html = f"""
<div id="pp-toolbar">
  <button id="pp-btn-sidebar" onclick="_pp_onSidebarClick()"
    style="background:none; border:1px solid rgba(255,255,255,0.4);
    color:white; font-size:18px; padding:1px 10px; cursor:pointer;
    border-radius:4px; line-height:1.2;"
    title="Toggle filter/group/sort panel">&#9776;</button>
  <div style="flex:1;"></div>
  <span style="font-weight:bold; font-size:13px;">{proj_display}</span>
  <div style="flex:1;"></div>
  <button id="pp-btn-details" onclick="_pp_onDetailsClick()"
    style="background:none; border:1px solid rgba(255,255,255,0.4);
    color:white; font-size:12px; padding:1px 10px; cursor:pointer;
    border-radius:3px;">Hide Details</button>
</div>"""

    # --- Sidebar HTML (enhanced filtering) ---
    sidebar_html = """
<div style="padding:8px; font-family:Arial,sans-serif; font-size:12px;">
  <div style="font-weight:bold; margin-bottom:4px;">Layout:</div>
  <select id="pp-dd-layout" style="width:100%; margin-bottom:8px;"
    onchange="_pp_onLayoutChange(this.value)">
    <option value="default">Default layout</option></select>

  <button onclick="_pp_onGfsToggle()" id="pp-btn-gfs"
    style="width:100%; text-align:left; background:#e8eaf6;
    border:1px solid #9fa8da; padding:4px 6px; cursor:pointer;
    border-radius:3px; font-size:12px; margin-bottom:4px;">
    &#9654; Grouping / Filtering / Sorting</button>
  <div id="pp-gfs-panel" style="display:none;">

    <div style="font-weight:bold; margin:8px 0 2px;">Activity ID</div>
    <input type="text" id="pp-flt-actid" placeholder="Contains..."
      style="width:100%; padding:2px 4px; font-size:11px; box-sizing:border-box;">

    <div style="font-weight:bold; margin:8px 0 2px;">Activity Name</div>
    <input type="text" id="pp-flt-actname" placeholder="Contains..."
      style="width:100%; padding:2px 4px; font-size:11px; box-sizing:border-box;">

    <div style="font-weight:bold; margin:8px 0 2px;">Status</div>
    <label style="display:block;"><input type="checkbox" id="pp-chk-ns" checked> Not Started</label>
    <label style="display:block;"><input type="checkbox" id="pp-chk-ip" checked> In Progress</label>
    <label style="display:block;"><input type="checkbox" id="pp-chk-co" checked> Complete</label>

    <div style="font-weight:bold; margin:8px 0 2px;">Criticality</div>
    <label style="display:block;"><input type="checkbox" id="pp-chk-crit" checked> Critical</label>
    <label style="display:block;"><input type="checkbox" id="pp-chk-nearcrit" checked> Near-Critical</label>
    <label style="display:block;"><input type="checkbox" id="pp-chk-noncrit" checked> Non-Critical</label>

    <div style="font-weight:bold; margin:8px 0 2px;">Start Date Range</div>
    <div style="display:flex; gap:4px; align-items:center;">
      <input type="date" id="pp-flt-start-after"
        style="flex:1; font-size:11px; padding:2px;">
      <span style="font-size:10px;">to</span>
      <input type="date" id="pp-flt-start-before"
        style="flex:1; font-size:11px; padding:2px;">
    </div>

    <div style="font-weight:bold; margin:8px 0 2px;">Finish Date Range</div>
    <div style="display:flex; gap:4px; align-items:center;">
      <input type="date" id="pp-flt-finish-after"
        style="flex:1; font-size:11px; padding:2px;">
      <span style="font-size:10px;">to</span>
      <input type="date" id="pp-flt-finish-before"
        style="flex:1; font-size:11px; padding:2px;">
    </div>

    <div style="margin-top:10px; display:flex; gap:6px;">
      <button onclick="_pp_onApplyFilters()"
        style="background:#1565c0; color:white; border:none; padding:4px 12px;
        cursor:pointer; border-radius:3px; font-size:12px;">Apply</button>
      <button onclick="_pp_onClearFilters()"
        style="background:#e0e0e0; border:none; padding:4px 12px;
        cursor:pointer; border-radius:3px; font-size:12px;">Clear</button>
    </div>
  </div>
</div>"""

    # --- Details pane HTML ---
    det_display = 'flex' if self._details_visible else 'none'
    _tab_defs = [
      ('general','General'), ('status','Status'), ('codes','Codes'),
      ('relationships','Relationships'), ('notebook','Notebook'),
      ('udfs','UDFs'),
    ]
    _tab_buttons = ''.join(
      '<button id="pp-tab-' + t + '"'
      ' onclick="_pp_onTabClick(\'' + t + '\')"'
      ' style="padding:3px 10px; font-size:12px; cursor:pointer;'
      ' border-radius:3px;'
      ' background:' + ('#1565c0' if t == 'general' else '#e0e0e0') + ';'
      ' color:' + ('white' if t == 'general' else '#333') + ';'
      ' border:none;'
      ' font-weight:' + ('bold' if t == 'general' else 'normal') + ';">'
      + label + '</button>'
      for t, label in _tab_defs
    )
    details_html = (
      '<div style="display:flex; align-items:center; gap:8px;'
      ' padding:4px 8px; background:#e3f2fd;'
      ' border-bottom:1px solid #90caf9; flex-shrink:0;">'
      '<span style="font-weight:bold; font-size:13px;">'
      'Activity Details</span>'
      '<span id="pp-det-id" style="color:#555;'
      ' font-size:12px;"></span>'
      '<span id="pp-det-name" style="font-weight:bold;'
      ' font-size:12px;"></span>'
      '</div>'
      '<div style="display:flex; gap:4px; padding:4px 8px;'
      ' background:#f5f5f5; border-bottom:1px solid #e0e0e0;'
      ' flex-shrink:0;">'
      + _tab_buttons +
      '</div>'
      '<div id="pp-det-content" style="flex:1; overflow-y:auto;'
      ' padding:6px 8px; font-family:Arial,sans-serif;'
      ' font-size:12px;">'
      '<em style="color:#888;">Click an activity in the Gantt chart'
      ' to see details.</em>'
      '</div>'
    )

    # --- JS data payload ---
    _log("render", "Serialising JS data payload...")
    t_json = _time.time()
    js_data = json.dumps({
      'traces':        traces,
      'layout':        layout,
      'rowMeta':       row_meta,
      'collapseState': cs,
      'monthBands':    month_bands,
      'weekTicks':     week_ticks,
      'barColCount':   bar_col_count,
      'colsPerWeek':   cols_per_week,
      'detailsH':      DETAILS_H,
      'navH':          NAV_H,
      'colHeaderH':    COL_HEADER_H,
      'rowH':          ROW_HEIGHT,
      'detailCache':   self._detail_cache,
      'importList':    self._import_list,
      'currentImportId': self._current_import_id,
    }, cls=_SafeEncoder)
    _log("render", f"JSON payload: {len(js_data)/1024:.1f} KB "
         f"in {_time.time()-t_json:.2f}s")

    # --- Shell HTML ---
    html = f"""
<div id="pp-shell" style="font-family:Arial,sans-serif; font-size:12px;">

  {toolbar_html}

  <div id="pp-main-row">
    <div id="pp-sidebar">{sidebar_html}</div>
    <div id="pp-gantt-area">
      <div id="pp-col-header">
        <div id="pp-col-names" style="flex-shrink:0; overflow:hidden;
          display:flex; flex-direction:column; background:#1565c0;">
          <div style="height:24px; border-bottom:1px solid #0d47a1;
            display:flex; align-items:center;">{col_names_html}</div>
          <div style="height:24px;"></div>
        </div>
        <div id="pp-header-splitter-spacer"
          style="width:6px; min-width:6px; flex-shrink:0;
          background:#1565c0;
          border-right:1px solid #0d47a1;"></div>
        <div id="pp-header-right" style="flex:1; overflow:hidden;
          display:flex; flex-direction:column; background:#1565c0;">
          <div id="pp-header-months" style="height:24px;
            min-height:24px; display:flex; overflow:hidden;
            border-bottom:1px solid #0d47a1;"></div>
          <div id="pp-header-weeks" style="height:24px;
            min-height:24px; display:flex; overflow:hidden;"></div>
        </div>
      </div>
      <div id="pp-scroll-body">
        <div id="pp-col-data">{col_table_html}</div>
        <div id="pp-splitter"
          title="Drag to resize columns"></div>
        <div id="pp-plot-pane">
          <div id="pp-plotly-div"
            style="height:{chart_height}px;
            min-width:600px;"></div>
        </div>
      </div>
    </div>
  </div>

  <div id="pp-details"
    style="display:{det_display}; flex-direction:column;">
    {details_html}
  </div>

</div>

<script>
(function() {{
  var _ganttData = {js_data};
  function _tryInit() {{
    if (typeof _pp_init === 'function' &&
        typeof Plotly !== 'undefined') {{
      _pp_init(window._prestoplan_form,
               JSON.stringify(_ganttData));
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
    _log("render", "Injecting HTML into pnl_gantt_container...")
    self.pnl_gantt_container.add_component(HtmlTemplate(html=html))
    _log("render", f"Render complete. Total: {_time.time()-t0:.2f}s")

  # --------------------------------------------------------------------------
  #  HTML BUILDERS
  # --------------------------------------------------------------------------

  def _build_row_meta(self, tasks):
    """Per-row metadata for JS details and navigation."""
    meta = []
    for idx, task in enumerate(tasks):
      row_type = task.get('row_type', 'TASK')
      wbs_id   = task.get('wbs_id', '')
      rd       = task.get('row_data', [])
      parent_wbs_id = (wbs_id if row_type == 'TASK'
                       else task.get('parent_wbs_id', ''))
      meta.append({
        'rowIdx':       idx,
        'rowType':      row_type,
        'wbsId':        wbs_id,
        'parentWbsId':  parent_wbs_id,
        'depth':        task.get('indent', 0),
        'taskId':       task.get('task_id', ''),
        'activityId':   str(rd[0]) if rd else '',
        'activityName': str(rd[1]) if len(rd) > 1 else '',
      })
    return meta

  def _build_col_names_html(self, columns, col_widths):
    """Column name cells for the LEFT side of pp-col-header."""
    parts = [
      '<div style="width:24px; min-width:24px; flex-shrink:0;'
      ' border-right:1px solid #0d47a1;"></div>'
    ]
    for i, col in enumerate(columns):
      parts.append(
        f'<div style="width:{col_widths[i]}px;'
        f' min-width:{col_widths[i]}px; flex-shrink:0;'
        f' padding:0 6px; overflow:hidden; white-space:nowrap;'
        f' color:white; font-weight:bold; font-size:12px;'
        f' border-right:1px solid #0d47a1;'
        f' display:flex; align-items:center;">'
        f'{col.get("label","")}</div>'
      )
    return ''.join(parts)

  def _build_col_table_html(self, tasks, columns, col_widths, cs):
    """Scrollable column data table."""
    parts   = []
    total_w = sum(col_widths) + 24

    parts.append(
      f'<table id="pp-col-table" style="border-collapse:collapse;'
      f' width:{total_w}px; table-layout:fixed; font-size:12px;'
      f' font-family:Arial,sans-serif;"><tbody>'
    )

    for idx, task in enumerate(tasks):
      rt   = task.get('row_type', 'TASK')
      ind  = task.get('indent', 0)
      rd   = task.get('row_data', [])
      tid  = task.get('task_id', '')
      wid  = task.get('wbs_id', '')
      pwid = task.get('parent_wbs_id', '')

      if rt == 'WBS':
        bg   = WBS_COLOURS.get(ind, WBS_COLOUR_DEFAULT)
        exp  = cs.get(wid, True)
        icon = '\u25BC' if exp else '\u25B6'
        ipx  = (ind - 1) * 12
        parts.append(
          f'<tr data-row-idx="{idx}" data-wbs-id="{wid}"'
          f' data-parent-wbs-id="{pwid}"'
          f' style="height:{ROW_HEIGHT}px; background:{bg};'
          f' font-weight:bold; color:#1a237e;">'
        )
        parts.append(
          f'<td style="width:24px; text-align:center;'
          f' vertical-align:middle; border-bottom:1px solid #ccc;'
          f' border-right:1px solid #ccc; cursor:pointer;'
          f' padding:0;"'
          f' onclick="_pp_toggleWbs(\'{wid}\')">'
          f'<span class="pp-wbs-icon" style="font-size:10px;'
          f' user-select:none;">{icon}</span></td>'
        )
        for i, val in enumerate(rd):
          pad = (f'padding-left:{ipx+4}px; padding-right:4px;'
                 if i == 0 else 'padding:2px 4px;')
          parts.append(
            f'<td style="width:{col_widths[i]}px; {pad}'
            f' overflow:hidden; white-space:nowrap;'
            f' vertical-align:middle;'
            f' border-bottom:1px solid #ccc;'
            f' border-right:1px solid #ddd;'
            f' cursor:pointer;"'
            f' onclick="_pp_toggleWbs(\'{wid}\')">'
            f'{val if val is not None else ""}</td>'
          )
        parts.append('</tr>')
      else:
        ipx = ind * 12
        parts.append(
          f'<tr data-row-idx="{idx}" data-task-id="{tid}"'
          f' data-parent-wbs-id="{wid}"'
          f' style="height:{ROW_HEIGHT}px; background:white;'
          f' color:#222; cursor:pointer;">'
        )
        parts.append(
          f'<td style="width:24px; border-bottom:1px solid #eee;'
          f' border-right:1px solid #ccc;"></td>'
        )
        for i, val in enumerate(rd):
          col   = columns[i] if i < len(columns) else {}
          pad   = (f'padding-left:{ipx+4}px; padding-right:4px;'
                   if i == 0 else 'padding:2px 4px;')
          align = 'right' if col.get('duration_field') else 'left'
          disp  = '' if val is None else str(val)
          parts.append(
            f'<td style="width:{col_widths[i]}px; {pad}'
            f' overflow:hidden; white-space:nowrap;'
            f' text-align:{align}; vertical-align:middle;'
            f' border-bottom:1px solid #eee;'
            f' border-right:1px solid #eee;">{disp}</td>'
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
          'type':'rect', 'xref':'x', 'yref':'y',
          'x0':0, 'x1':bar_col_count,
          'y0':idx-0.5, 'y1':idx+0.5,
          'fillcolor':bg, 'opacity':0.5,
          'line':{'width':0}, 'layer':'below',
        })

    bar_data = {c:{'x':[],'y':[],'text':[],'customdata':[]}
                for c in BAR_COLOURS}
    ms_data  = {c:{'x':[],'y':[],'text':[],'customdata':[]}
                for c in MILESTONE_COLOURS}
    lbl_data = {'x':[],'y':[],'text':[]}

    for ri, task in enumerate(tasks):
      if task.get('row_type') != 'TASK':
        continue
      tid = str(task.get('task_id', ''))
      for seg in task.get('bar_segments', []):
        st = seg.get('type', '')
        if st == 'L':
          lbl_data['x'].append(seg.get('start',0))
          lbl_data['y'].append(ri)
          lbl_data['text'].append(seg.get('label',''))
        elif st in MILESTONE_COLOURS:
          ms_data[st]['x'].append(seg.get('start',0))
          ms_data[st]['y'].append(ri)
          ms_data[st]['text'].append(tid)
          ms_data[st]['customdata'].append(tid)
        elif st in BAR_COLOURS:
          s, e = seg.get('start',0), seg.get('end',0)
          bar_data[st]['x'].extend([s,e,None])
          bar_data[st]['y'].extend([ri,ri,None])
          bar_data[st]['text'].extend([tid,tid,''])
          bar_data[st]['customdata'].extend([tid,tid,''])

    traces = []
    cn = {'1':'Actual','2':'Remaining','3':'Near Critical','4':'Critical'}
    for code, colour in BAR_COLOURS.items():
      d = bar_data[code]
      if not d['x']:
        continue
      traces.append({
        'type':'scatter','mode':'lines','name':cn.get(code,code),
        'x':d['x'],'y':d['y'],'text':d['text'],
        'customdata':d['customdata'],
        'line':{'color':colour,'width':int(ROW_HEIGHT*0.55)},
        'hovertemplate':'%{customdata}<extra></extra>',
      })

    mn = {'M1':'Actual MS','M2':'Milestone',
          'M3':'Near-Crit MS','M4':'Critical MS'}
    for code, colour in MILESTONE_COLOURS.items():
      d = ms_data[code]
      if not d['x']:
        continue
      traces.append({
        'type':'scatter','mode':'markers','name':mn.get(code,code),
        'x':d['x'],'y':d['y'],'text':d['text'],
        'customdata':d['customdata'],
        'marker':{'symbol':'diamond','size':12,'color':colour},
        'hovertemplate':'%{customdata}<extra></extra>',
      })

    if lbl_data['x']:
      traces.append({
        'type':'scatter','mode':'text','name':'Labels',
        'x':lbl_data['x'],'y':lbl_data['y'],
        'text':lbl_data['text'],
        'textposition':'middle right',
        'textfont':{'size':10,'color':'#333'},
        'hoverinfo':'skip','showlegend':False,
      })

    layout = {
      'height':chart_height,
      'margin':{'l':0,'r':20,'t':0,'b':0},
      'xaxis':{
        'range':[0, bar_col_count],
        'showticklabels':False,
        'showgrid':True, 'gridcolor':'#eee',
        'zeroline':False, 'fixedrange':False,
      },
      'yaxis':{
        'range':[n_rows, -1],
        'showticklabels':False,
        'showgrid':True, 'gridcolor':'#eee',
        'zeroline':False, 'fixedrange':False,
        'dtick':1, 'tick0':0,
      },
      'shapes':shapes, 'showlegend':False,
      'plot_bgcolor':'white', 'paper_bgcolor':'white',
      'hovermode':'closest', 'clickmode':'event',
    }
    return traces, layout

  def _build_timescale_bands(self, ts_start, bar_col_count, cols_per_week):
    """Month band and week tick data for the JS timescale header."""
    from datetime import date, timedelta
    try:
      ts_s = date.fromisoformat(ts_start)
    except (ValueError, AttributeError):
      ts_s = date.today()

    cpw = cols_per_week / 7.0
    end_col = bar_col_count
    week_ticks = []
    day_off, d = 0, ts_s
    while True:
      col = int(day_off * cpw)
      if col >= end_col:
        break
      week_ticks.append({'label': d.strftime('%d'), 'col': col})
      d += timedelta(days=7)
      day_off += 7

    month_bands = []
    cur = date(ts_s.year, ts_s.month, 1)
    end_date = ts_s + timedelta(days=int(end_col / cpw) + 31)
    while cur <= end_date:
      start_off = (cur - ts_s).days
      start_col = max(0, int(start_off * cpw))
      if start_col >= end_col:
        break
      nxt = (date(cur.year + 1, 1, 1) if cur.month == 12
             else date(cur.year, cur.month + 1, 1))
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
    _log("callback", "_on_change_project triggered")
    self._open_project_selector()

  def _on_change_xer(self, import_id):
    """Called from JS Change XER dropdown."""
    _log("callback", f"_on_change_xer triggered: import_id={import_id}")
    if not import_id:
      return
    self._current_import_id = import_id
    # Update the label
    for imp in self._import_list:
      if str(imp.get('import_id', '')) == str(import_id):
        self._import_label = (
          f"{imp.get('import_date','')} - "
          f"{imp.get('label','No label')}")
        break
    self._load_gantt()

  def _on_apply_filters(self):
    """Server-side filter reload (fallback if client filters inadequate)."""
    self._load_gantt()

  def _on_clear_filters(self):
    """Server-side filter clear (fallback)."""
    self._load_gantt()

  def _on_layout_change(self, layout_id):
    if layout_id:
      self._current_layout_id = layout_id

  def _on_collapse_change(self, wbs_id, expanded):
    if not hasattr(client_globals, "_collapse_state"):
      client_globals._collapse_state = {}
    client_globals._collapse_state[wbs_id] = expanded

  def _on_collapse_all(self, expanded):
    if not self._gantt_data:
      return
    if not hasattr(client_globals, "_collapse_state"):
      client_globals._collapse_state = {}
    for t in self._gantt_data.get('tasks', []):
      if t.get('row_type') == 'WBS':
        wid = t.get('wbs_id', '')
        if wid and (expanded or t.get('indent', 0) == 1):
          client_globals._collapse_state[wid] = expanded

  # ==========================================================================
  #  CHANGE PROJECT (white header button)
  # ==========================================================================

  def btn_change_project_click(self, **event_args):
    """Change Project button in the white navbar header."""
    self._open_project_selector()

  # ==========================================================================
  #  LOGOUT
  # ==========================================================================

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