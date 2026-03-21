import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { hoursToWorkingDays, hoursToDays, formatDate } from '../../lib/dateUtils';
import { Loader2, Check, ArrowRight } from 'lucide-react';

interface Activity {
  id: string;
  [key: string]: any;
}

interface Calendar {
  id: string;
  calendar_name: string;
  hours_per_day: number;
}

interface ActivityDetailTabsProps {
  activity: Activity;
  calendars: Calendar[];
  scheduleVersionId: string;
  nearCriticalThreshold: number;
  onSelectActivity: (activityId: string) => void;
  tracedActivityIds: Set<string>;
  wbsMap?: Map<string, any>; // WBS lookup map for building the WBS path display
}

type TabType = 'general' | 'relationships' | 'codes' | 'resources' | 'notes' | 'customFields';

export default function ActivityDetailTabs({
  activity,
  calendars,
  scheduleVersionId,
  nearCriticalThreshold,
  onSelectActivity,
  tracedActivityIds,
  wbsMap
}: ActivityDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [lastViewedTab, setLastViewedTab] = useState<TabType>('general');
  const [loading, setLoading] = useState(false);

  const [predecessors, setPredecessors] = useState<any[]>([]);
  const [successors, setSuccessors] = useState<any[]>([]);
  const [codes, setCodes] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [customFields, setCustomFields] = useState<any[]>([]);

  const calendar = calendars.find(c => c.id === activity.calendar_id);
  const hoursPerDay = calendar?.hours_per_day || 8;

  useEffect(() => {
    setActiveTab(lastViewedTab);
  }, [activity.id]);

  useEffect(() => {
    if (activeTab !== 'general') {
      loadTabData(activeTab);
    }
  }, [activeTab, activity.id]);

  async function loadTabData(tab: TabType) {
    setLoading(true);
    try {
      switch (tab) {
        case 'relationships':
          await loadRelationships();
          break;
        case 'codes':
          await loadCodes();
          break;
        case 'resources':
          await loadResources();
          break;
        case 'notes':
          await loadNotes();
          break;
        case 'customFields':
          await loadCustomFields();
          break;
      }
    } catch (error) {
      console.error('Error loading tab data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadRelationships() {
    const [predRes, succRes] = await Promise.all([
      supabase
        .from('cpm_relationships')
        .select(`
          id,
          predecessor_activity_id,
          successor_activity_id,
          relationship_type,
          lag_hours,
          relationship_float_hours,
          is_driving,
          cpm_activities!cpm_relationships_predecessor_activity_id_fkey (
            activity_id_display,
            activity_name,
            calendar_id
          )
        `)
        .eq('successor_activity_id', activity.id)
        .eq('schedule_version_id', scheduleVersionId),

      supabase
        .from('cpm_relationships')
        .select(`
          id,
          predecessor_activity_id,
          successor_activity_id,
          relationship_type,
          lag_hours,
          relationship_float_hours,
          is_driving,
          cpm_activities!cpm_relationships_successor_activity_id_fkey (
            activity_id_display,
            activity_name,
            calendar_id
          )
        `)
        .eq('predecessor_activity_id', activity.id)
        .eq('schedule_version_id', scheduleVersionId)
    ]);

    const sortedPreds = (predRes.data || []).sort((a, b) => {
      const aFloat = a.relationship_float_hours ?? Infinity;
      const bFloat = b.relationship_float_hours ?? Infinity;
      return aFloat - bFloat;
    });

    const sortedSuccs = (succRes.data || []).sort((a, b) => {
      const aFloat = a.relationship_float_hours ?? Infinity;
      const bFloat = b.relationship_float_hours ?? Infinity;
      return aFloat - bFloat;
    });

    setPredecessors(sortedPreds);
    setSuccessors(sortedSuccs);
  }

  async function loadCodes() {
    const { data } = await supabase
      .from('cpm_code_assignments')
      .select(`
        id,
        cpm_code_values!inner (
          id,
          code_value_name,
          cpm_code_types!inner (
            id,
            code_type_name
          )
        )
      `)
      .eq('activity_id', activity.id)
      .eq('schedule_version_id', scheduleVersionId);

    setCodes(data || []);
  }

  async function loadResources() {
    const { data } = await supabase
      .from('cpm_resource_assignments')
      .select(`
        id,
        budgeted_units,
        budgeted_cost,
        actual_units,
        actual_cost,
        remaining_units,
        remaining_cost,
        cpm_resources!inner (
          id,
          resource_name,
          resource_type
        )
      `)
      .eq('activity_id', activity.id)
      .eq('schedule_version_id', scheduleVersionId);

    setResources(data || []);
  }

  async function loadNotes() {
    const { data } = await supabase
      .from('cpm_activity_notes')
      .select(`
        id,
        note_content,
        cpm_note_topics (
          id,
          topic_name
        )
      `)
      .eq('activity_id', activity.id)
      .eq('schedule_version_id', scheduleVersionId);

    setNotes(data || []);
  }

  async function loadCustomFields() {
    const { data } = await supabase
      .from('cpm_custom_field_values')
      .select(`
        id,
        field_value,
        cpm_custom_field_types!inner (
          id,
          field_name
        )
      `)
      .eq('activity_id', activity.id)
      .eq('schedule_version_id', scheduleVersionId);

    setCustomFields(data || []);
  }

  function handleTabChange(tab: TabType) {
    setActiveTab(tab);
    setLastViewedTab(tab);
  }

  function getCriticalityBadge() {
    if (activity.is_critical) {
      return <span className="px-2 py-1 text-xs font-semibold bg-red-100 text-red-800 rounded">Critical</span>;
    }

    if (activity.total_float_hours !== null) {
      const floatDays = activity.total_float_hours / hoursPerDay;
      if (floatDays <= nearCriticalThreshold) {
        return <span className="px-2 py-1 text-xs font-semibold bg-orange-100 text-orange-800 rounded">Near-Critical</span>;
      }
    }

    return <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-800 rounded">Non-Critical</span>;
  }

  function getRelationshipTypeLabel(type: string): string {
    const types: Record<string, string> = {
      'finish_to_start': 'FS',
      'finish_to_finish': 'FF',
      'start_to_start': 'SS',
      'start_to_finish': 'SF'
    };
    return types[type] || type;
  }

  function handleRelationshipClick(activityId: string) {
    onSelectActivity(activityId);
  }

  /**
   * Build the full WBS path string by walking up the parent chain.
   * Example: "Project > Division A > Building 1"
   */
  function getWbsPath(): string {
    if (!wbsMap || !activity.wbs_id) return '-';
    const parts: string[] = [];
    let current = wbsMap.get(activity.wbs_id);
    while (current) {
      parts.unshift(current.wbs_name || current.wbs_code || '?');
      current = current.parent_wbs_id ? wbsMap.get(current.parent_wbs_id) : null;
    }
    return parts.length > 0 ? parts.join(' > ') : '-';
  }

  /** Format activity type for display */
  function formatActivityType(type: string | null): string {
    if (!type) return '-';
    const types: Record<string, string> = {
      'task_dependent': 'Task Dependent',
      'resource_dependent': 'Resource Dependent',
      'level_of_effort': 'Level of Effort',
      'start_milestone': 'Start Milestone',
      'finish_milestone': 'Finish Milestone',
      'wbs_summary': 'WBS Summary',
    };
    return types[type] || type;
  }

  /** Format activity status for display */
  function formatActivityStatus(status: string | null): string {
    if (!status) return '-';
    const statuses: Record<string, string> = {
      'not_started': 'Not Started',
      'in_progress': 'In Progress',
      'complete': 'Complete',
    };
    return statuses[status] || status;
  }

  /** Get a color class for the activity status badge */
  function getStatusColor(status: string | null): string {
    switch (status) {
      case 'complete': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      case 'not_started': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  }

  /** Format constraint type for display */
  function formatConstraintType(type: string | null): string {
    if (!type) return 'None';
    const types: Record<string, string> = {
      'CS_MEO': 'Must Finish On',
      'CS_MEOA': 'Finish On or After',
      'CS_MEOB': 'Finish On or Before',
      'CS_MSO': 'Must Start On',
      'CS_MSOA': 'Start On or After',
      'CS_MSOB': 'Start On or Before',
      'CS_ALAP': 'As Late As Possible',
      'CS_MANDSTART': 'Mandatory Start',
      'CS_MANDFINISH': 'Mandatory Finish',
    };
    return types[type] || type.replace(/^CS_/, '');
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => handleTabChange('general')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'general'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          General
        </button>
        <button
          onClick={() => handleTabChange('relationships')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'relationships'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Relationships
        </button>
        <button
          onClick={() => handleTabChange('codes')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'codes'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Codes
        </button>
        <button
          onClick={() => handleTabChange('resources')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'resources'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Resources
        </button>
        <button
          onClick={() => handleTabChange('notes')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'notes'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Notes
        </button>
        <button
          onClick={() => handleTabChange('customFields')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'customFields'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Custom Fields
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'general' && (
          <div className="space-y-5 text-sm">

            {/* ── GENERAL SECTION ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">General</h3>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5">
                  <span className="text-gray-500 text-xs">ID</span>
                  <span className="text-gray-900 font-mono text-xs">{activity.activity_id_display}</span>

                  <span className="text-gray-500 text-xs">Name</span>
                  <span className="text-gray-900 font-medium break-words">{activity.activity_name}</span>

                  <span className="text-gray-500 text-xs">WBS</span>
                  <span className="text-gray-900 text-xs break-words" title={getWbsPath()}>{getWbsPath()}</span>

                  <span className="text-gray-500 text-xs">Type</span>
                  <span className="text-gray-900 text-xs">{formatActivityType(activity.activity_type)}</span>

                  <span className="text-gray-500 text-xs">Calendar</span>
                  <span className="text-gray-900 text-xs">{calendar?.calendar_name || '-'}</span>
                </div>
              </div>
            </section>

            {/* ── STATUS SECTION ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Status</h3>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-3 mb-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${getStatusColor(activity.activity_status)}`}>
                    {formatActivityStatus(activity.activity_status)}
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    activity.is_critical
                      ? 'bg-red-100 text-red-800'
                      : activity.total_float_hours !== null && (activity.total_float_hours / hoursPerDay) <= nearCriticalThreshold
                      ? 'bg-orange-100 text-orange-800'
                      : 'bg-green-100 text-green-800'
                  }`}>
                    {activity.is_critical
                      ? 'Critical'
                      : activity.total_float_hours !== null && (activity.total_float_hours / hoursPerDay) <= nearCriticalThreshold
                      ? 'Near Critical'
                      : 'Non Critical'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-gray-500 text-xs">% Complete (Physical)</div>
                    <div className="text-gray-900 font-medium tabular-nums">
                      {activity.physical_percent_complete !== null ? `${Number(activity.physical_percent_complete).toFixed(1)}%` : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">% Complete (Duration)</div>
                    <div className="text-gray-900 font-medium tabular-nums">
                      {activity.duration_percent_complete !== null ? `${Number(activity.duration_percent_complete).toFixed(1)}%` : '-'}
                    </div>
                  </div>
                  {(activity.suspend_date || activity.resume_date) && (
                    <>
                      <div>
                        <div className="text-gray-500 text-xs">Suspend Date</div>
                        <div className="text-gray-900">{formatDate(activity.suspend_date)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs">Resume Date</div>
                        <div className="text-gray-900">{formatDate(activity.resume_date)}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>

            {/* ── DATES SECTION ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Dates</h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-1.5 text-left font-medium text-gray-600"></th>
                      <th className="px-3 py-1.5 text-left font-medium text-gray-600">Start</th>
                      <th className="px-3 py-1.5 text-left font-medium text-gray-600">Finish</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr>
                      <td className="px-3 py-1.5 font-medium text-gray-600">Early</td>
                      <td className="px-3 py-1.5 text-gray-900 tabular-nums">{formatDate(activity.early_start)}</td>
                      <td className="px-3 py-1.5 text-gray-900 tabular-nums">{formatDate(activity.early_finish)}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1.5 font-medium text-gray-600">Late</td>
                      <td className="px-3 py-1.5 text-gray-900 tabular-nums">{formatDate(activity.late_start)}</td>
                      <td className="px-3 py-1.5 text-gray-900 tabular-nums">{formatDate(activity.late_finish)}</td>
                    </tr>
                    <tr className={activity.actual_start || activity.actual_finish ? 'bg-blue-50/50' : ''}>
                      <td className="px-3 py-1.5 font-medium text-gray-600">Actual</td>
                      <td className="px-3 py-1.5 text-gray-900 tabular-nums">{formatDate(activity.actual_start)}</td>
                      <td className="px-3 py-1.5 text-gray-900 tabular-nums">{formatDate(activity.actual_finish)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── DURATIONS SECTION ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Durations</h3>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <div className="text-gray-500 text-xs">Original</div>
                    <div className="text-gray-900 font-medium tabular-nums">
                      {hoursToDays(activity.original_duration_hours, hoursPerDay)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">Remaining</div>
                    <div className="text-gray-900 font-medium tabular-nums">
                      {hoursToDays(activity.remaining_duration_hours, hoursPerDay)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">Actual</div>
                    <div className="text-gray-900 font-medium tabular-nums">
                      {hoursToDays(activity.actual_duration_hours, hoursPerDay)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">At Completion</div>
                    <div className="text-gray-900 font-medium tabular-nums">
                      {hoursToDays(activity.at_completion_duration_hours, hoursPerDay)}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-gray-400 mt-1">Values in working days ({hoursPerDay}h/day)</div>
              </div>
            </section>

            {/* ── FLOAT SECTION ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Float</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-lg p-3 ${
                  activity.is_critical
                    ? 'bg-red-50 border border-red-200'
                    : activity.total_float_hours !== null && (activity.total_float_hours / hoursPerDay) <= nearCriticalThreshold
                    ? 'bg-orange-50 border border-orange-200'
                    : 'bg-gray-50'
                }`}>
                  <div className="text-gray-500 text-xs">Total Float</div>
                  <div className={`text-lg font-semibold tabular-nums ${
                    activity.is_critical
                      ? 'text-red-700'
                      : activity.total_float_hours !== null && (activity.total_float_hours / hoursPerDay) <= nearCriticalThreshold
                      ? 'text-orange-700'
                      : 'text-gray-900'
                  }`}>
                    {hoursToDays(activity.total_float_hours, hoursPerDay)}
                    <span className="text-xs font-normal text-gray-400 ml-1">days</span>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-gray-500 text-xs">Free Float</div>
                  <div className="text-lg font-semibold tabular-nums text-gray-900">
                    {hoursToDays(activity.free_float_hours, hoursPerDay)}
                    <span className="text-xs font-normal text-gray-400 ml-1">days</span>
                  </div>
                </div>
              </div>
            </section>

            {/* ── CONSTRAINTS SECTION ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Constraints</h3>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="grid grid-cols-[80px_1fr_80px] gap-x-3 gap-y-1.5">
                  <span className="text-gray-500 text-xs">Primary</span>
                  <span className="text-gray-900 text-xs">
                    {formatConstraintType(activity.original_data?.primary_constraint_type)}
                  </span>
                  <span className="text-gray-900 text-xs tabular-nums">
                    {activity.original_data?.primary_constraint_date ? formatDate(activity.original_data.primary_constraint_date) : '-'}
                  </span>

                  <span className="text-gray-500 text-xs">Secondary</span>
                  <span className="text-gray-900 text-xs">
                    {formatConstraintType(activity.original_data?.secondary_constraint_type)}
                  </span>
                  <span className="text-gray-900 text-xs tabular-nums">
                    {activity.original_data?.secondary_constraint_date ? formatDate(activity.original_data.secondary_constraint_date) : '-'}
                  </span>
                </div>
              </div>
            </section>

          </div>
        )}

        {activeTab === 'relationships' && (
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Predecessors</h3>
                  {predecessors.length === 0 ? (
                    <div className="text-sm text-gray-500">No predecessors</div>
                  ) : (
                    <div className="border border-gray-200 rounded overflow-hidden">
                      <table className="w-full text-xs table-fixed">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-1 text-left font-medium text-gray-700 w-16">Activity ID</th>
                            <th className="px-2 py-1 text-left font-medium text-gray-700">Activity Name</th>
                            <th className="px-2 py-1 text-left font-medium text-gray-700 w-14">Type/Lag</th>
                            <th className="px-2 py-1 text-right font-medium text-gray-700 w-12">Rel Free Float</th>
                            <th className="px-2 py-1 text-center font-medium text-gray-700 w-14">Driving</th>
                            <th className="px-2 py-1 text-center font-medium text-gray-700 w-16">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {predecessors.map((rel) => {
                            const pred = rel.cpm_activities;
                            const isTraced = tracedActivityIds.has(rel.predecessor_activity_id);
                            const predCalendar = calendars.find(c => c.id === pred.calendar_id);
                            const predHoursPerDay = predCalendar?.hours_per_day || 8;
                            const lagDays = hoursToDays(rel.lag_hours, predHoursPerDay);
                            const typeLag = `${getRelationshipTypeLabel(rel.relationship_type)} ${lagDays}`;
                            return (
                              <tr
                                key={rel.id}
                                className={`${isTraced ? 'bg-orange-50' : 'hover:bg-gray-50'}`}
                              >
                                <td className="px-2 py-1">{pred.activity_id_display}</td>
                                <td className="px-2 py-1 truncate" title={pred.activity_name}>{pred.activity_name}</td>
                                <td className="px-2 py-1 tabular-nums">{typeLag}</td>
                                <td className="px-2 py-1 tabular-nums text-right">{rel.relationship_float_hours !== null && rel.relationship_float_hours !== undefined ? Number(rel.relationship_float_hours).toFixed(0) : '-'}</td>
                                <td className="px-2 py-1 text-center">
                                  <input
                                    type="checkbox"
                                    checked={rel.is_driving || false}
                                    readOnly
                                    className="w-4 h-4 text-green-600 bg-gray-100 border-gray-300 rounded focus:ring-green-500 pointer-events-none"
                                  />
                                </td>
                                <td className="px-2 py-1 text-center">
                                  <button
                                    onClick={() => handleRelationshipClick(rel.predecessor_activity_id)}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition-colors whitespace-nowrap"
                                    title="Go to this activity"
                                  >
                                    Go To
                                    <ArrowRight className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Successors</h3>
                  {successors.length === 0 ? (
                    <div className="text-sm text-gray-500">No successors</div>
                  ) : (
                    <div className="border border-gray-200 rounded overflow-hidden">
                      <table className="w-full text-xs table-fixed">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-1 text-left font-medium text-gray-700 w-16">Activity ID</th>
                            <th className="px-2 py-1 text-left font-medium text-gray-700">Activity Name</th>
                            <th className="px-2 py-1 text-left font-medium text-gray-700 w-14">Type/Lag</th>
                            <th className="px-2 py-1 text-right font-medium text-gray-700 w-12">Rel Free Float</th>
                            <th className="px-2 py-1 text-center font-medium text-gray-700 w-14">Driving</th>
                            <th className="px-2 py-1 text-center font-medium text-gray-700 w-16">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {successors.map((rel) => {
                            const succ = rel.cpm_activities;
                            const isTraced = tracedActivityIds.has(rel.successor_activity_id);
                            const succCalendar = calendars.find(c => c.id === succ.calendar_id);
                            const succHoursPerDay = succCalendar?.hours_per_day || 8;
                            const lagDays = hoursToDays(rel.lag_hours, succHoursPerDay);
                            const typeLag = `${getRelationshipTypeLabel(rel.relationship_type)} ${lagDays}`;
                            return (
                              <tr
                                key={rel.id}
                                className={`${isTraced ? 'bg-orange-50' : 'hover:bg-gray-50'}`}
                              >
                                <td className="px-2 py-1">{succ.activity_id_display}</td>
                                <td className="px-2 py-1 truncate" title={succ.activity_name}>{succ.activity_name}</td>
                                <td className="px-2 py-1 tabular-nums">{typeLag}</td>
                                <td className="px-2 py-1 tabular-nums text-right">{rel.relationship_float_hours !== null && rel.relationship_float_hours !== undefined ? Number(rel.relationship_float_hours).toFixed(0) : '-'}</td>
                                <td className="px-2 py-1 text-center">
                                  <input
                                    type="checkbox"
                                    checked={rel.is_driving || false}
                                    readOnly
                                    className="w-4 h-4 text-green-600 bg-gray-100 border-gray-300 rounded focus:ring-green-500 pointer-events-none"
                                  />
                                </td>
                                <td className="px-2 py-1 text-center">
                                  <button
                                    onClick={() => handleRelationshipClick(rel.successor_activity_id)}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition-colors whitespace-nowrap"
                                    title="Go to this activity"
                                  >
                                    Go To
                                    <ArrowRight className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'codes' && (
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : codes.length === 0 ? (
              <div className="text-sm text-gray-500">No activity codes assigned</div>
            ) : (
              <div className="border border-gray-200 rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Code Type</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Code Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {codes.map((code) => (
                      <tr key={code.id}>
                        <td className="px-3 py-2">{code.cpm_code_values.cpm_code_types.code_type_name}</td>
                        <td className="px-3 py-2">{code.cpm_code_values.code_value_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'resources' && (
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : resources.length === 0 ? (
              <div className="text-sm text-gray-500">No resources assigned</div>
            ) : (
              <>
                <div className="border border-gray-200 rounded overflow-hidden mb-4">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Resource Name</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Type</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Budgeted Units</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Budgeted Cost</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Actual Units</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Actual Cost</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Remaining Units</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Remaining Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {resources.map((res) => (
                        <tr key={res.id}>
                          <td className="px-3 py-2">{res.cpm_resources.resource_name}</td>
                          <td className="px-3 py-2">{res.cpm_resources.resource_type}</td>
                          <td className="px-3 py-2 text-right">{res.budgeted_units?.toFixed(2) || '-'}</td>
                          <td className="px-3 py-2 text-right">{res.budgeted_cost?.toFixed(2) || '-'}</td>
                          <td className="px-3 py-2 text-right">{res.actual_units?.toFixed(2) || '-'}</td>
                          <td className="px-3 py-2 text-right">{res.actual_cost?.toFixed(2) || '-'}</td>
                          <td className="px-3 py-2 text-right">{res.remaining_units?.toFixed(2) || '-'}</td>
                          <td className="px-3 py-2 text-right">{res.remaining_cost?.toFixed(2) || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 font-semibold">
                      <tr>
                        <td colSpan={2} className="px-3 py-2">Total</td>
                        <td className="px-3 py-2 text-right">
                          {resources.reduce((sum, r) => sum + (r.budgeted_units || 0), 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {resources.reduce((sum, r) => sum + (r.budgeted_cost || 0), 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {resources.reduce((sum, r) => sum + (r.actual_units || 0), 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {resources.reduce((sum, r) => sum + (r.actual_cost || 0), 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {resources.reduce((sum, r) => sum + (r.remaining_units || 0), 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {resources.reduce((sum, r) => sum + (r.remaining_cost || 0), 0).toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'notes' && (
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : notes.length === 0 ? (
              <div className="text-sm text-gray-500">No notes</div>
            ) : (
              <div className="space-y-4">
                {notes.map((note) => (
                  <div key={note.id} className="border border-gray-200 rounded p-3">
                    <div className="font-semibold text-sm text-gray-900 mb-1">
                      {note.cpm_note_topics?.topic_name || 'Note'}
                    </div>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap">
                      {note.note_content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'customFields' && (
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : customFields.length === 0 ? (
              <div className="text-sm text-gray-500">No custom fields</div>
            ) : (
              <div className="border border-gray-200 rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Field Name</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {customFields.map((field) => (
                      <tr key={field.id}>
                        <td className="px-3 py-2">{field.cpm_custom_field_types.field_name}</td>
                        <td className="px-3 py-2">{field.field_value || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
