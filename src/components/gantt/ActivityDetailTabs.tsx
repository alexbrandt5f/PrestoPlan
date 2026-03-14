import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { hoursToWorkingDays, formatDate } from '../../lib/dateUtils';
import { Loader2, Check } from 'lucide-react';

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
}

type TabType = 'general' | 'relationships' | 'codes' | 'resources' | 'notes' | 'customFields';

export default function ActivityDetailTabs({
  activity,
  calendars,
  scheduleVersionId,
  nearCriticalThreshold,
  onSelectActivity,
  tracedActivityIds
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
          relationship_lag_hours,
          is_driving,
          cpm_activities!cpm_relationships_predecessor_activity_id_fkey (
            activity_id_display,
            activity_name
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
          relationship_lag_hours,
          is_driving,
          cpm_activities!cpm_relationships_successor_activity_id_fkey (
            activity_id_display,
            activity_name
          )
        `)
        .eq('predecessor_activity_id', activity.id)
        .eq('schedule_version_id', scheduleVersionId)
    ]);

    setPredecessors(predRes.data || []);
    setSuccessors(succRes.data || []);
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
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500">Activity ID</label>
                <div className="text-xs text-gray-900">{activity.activity_id_display}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Status</label>
                <div className="text-xs text-gray-900">{activity.activity_status || '-'}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Critical</label>
                <div className="text-xs text-gray-900">{activity.is_critical ? 'Yes' : 'No'}</div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500">Activity Name</label>
              <div className="text-xs text-gray-900">{activity.activity_name}</div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500">Type</label>
                <div className="text-xs text-gray-900">{activity.activity_type || '-'}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Calendar</label>
                <div className="text-xs text-gray-900">{calendar?.calendar_name || '-'}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Criticality</label>
                <div className="mt-1">{getCriticalityBadge()}</div>
              </div>
            </div>

            <div className="border-t pt-2">
              <h3 className="text-xs font-semibold text-gray-900 mb-2">Dates</h3>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="font-medium text-gray-500">Early Start:</span>
                  <div className="text-gray-900">{formatDate(activity.early_start)}</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Early Finish:</span>
                  <div className="text-gray-900">{formatDate(activity.early_finish)}</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Late Start:</span>
                  <div className="text-gray-900">{formatDate(activity.late_start)}</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Late Finish:</span>
                  <div className="text-gray-900">{formatDate(activity.late_finish)}</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Actual Start:</span>
                  <div className="text-gray-900">{formatDate(activity.actual_start)}</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Actual Finish:</span>
                  <div className="text-gray-900">{formatDate(activity.actual_finish)}</div>
                </div>
              </div>
            </div>

            <div className="border-t pt-2">
              <h3 className="text-xs font-semibold text-gray-900 mb-2">Durations & Float (Days)</h3>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="font-medium text-gray-500">Original:</span>
                  <div className="text-gray-900">{hoursToWorkingDays(activity.original_duration_hours, hoursPerDay)}d</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Remaining:</span>
                  <div className="text-gray-900">{hoursToWorkingDays(activity.remaining_duration_hours, hoursPerDay)}d</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Actual:</span>
                  <div className="text-gray-900">{hoursToWorkingDays(activity.actual_duration_hours, hoursPerDay)}d</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">At Completion:</span>
                  <div className="text-gray-900">{hoursToWorkingDays(activity.at_completion_duration_hours, hoursPerDay)}d</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Total Float:</span>
                  <div className="text-gray-900">{hoursToWorkingDays(activity.total_float_hours, hoursPerDay)}d</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Free Float:</span>
                  <div className="text-gray-900">{hoursToWorkingDays(activity.free_float_hours, hoursPerDay)}d</div>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">% Complete</h3>
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="font-medium text-gray-500">Physical:</span>
                  <div className="text-gray-900">{activity.physical_percent_complete || 0}%</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Duration:</span>
                  <div className="text-gray-900">{activity.duration_percent_complete || 0}%</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500">Units:</span>
                  <div className="text-gray-900">{activity.units_percent_complete || 0}%</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'relationships' && (
          <div className="space-y-6">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : (
              <>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Predecessors</h3>
                  {predecessors.length === 0 ? (
                    <div className="text-sm text-gray-500">No predecessors</div>
                  ) : (
                    <div className="border border-gray-200 rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Activity ID</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Activity Name</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Type</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Lag</th>
                            <th className="px-3 py-2 text-center font-medium text-gray-700">Driving</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {predecessors.map((rel) => {
                            const pred = rel.cpm_activities;
                            const isTraced = tracedActivityIds.has(rel.predecessor_activity_id);
                            return (
                              <tr
                                key={rel.id}
                                className={`cursor-pointer hover:bg-blue-50 ${isTraced ? 'bg-orange-50' : ''}`}
                                onClick={() => handleRelationshipClick(rel.predecessor_activity_id)}
                              >
                                <td className="px-3 py-2">{pred.activity_id_display}</td>
                                <td className="px-3 py-2">{pred.activity_name}</td>
                                <td className="px-3 py-2">{getRelationshipTypeLabel(rel.relationship_type)}</td>
                                <td className="px-3 py-2">{hoursToWorkingDays(rel.relationship_lag_hours, hoursPerDay)}d</td>
                                <td className="px-3 py-2 text-center">
                                  {rel.is_driving && <Check className="w-4 h-4 text-green-600 inline" />}
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
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Activity ID</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Activity Name</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Type</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Lag</th>
                            <th className="px-3 py-2 text-center font-medium text-gray-700">Driving</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {successors.map((rel) => {
                            const succ = rel.cpm_activities;
                            const isTraced = tracedActivityIds.has(rel.successor_activity_id);
                            return (
                              <tr
                                key={rel.id}
                                className={`cursor-pointer hover:bg-blue-50 ${isTraced ? 'bg-orange-50' : ''}`}
                                onClick={() => handleRelationshipClick(rel.successor_activity_id)}
                              >
                                <td className="px-3 py-2">{succ.activity_id_display}</td>
                                <td className="px-3 py-2">{succ.activity_name}</td>
                                <td className="px-3 py-2">{getRelationshipTypeLabel(rel.relationship_type)}</td>
                                <td className="px-3 py-2">{hoursToWorkingDays(rel.relationship_lag_hours, hoursPerDay)}d</td>
                                <td className="px-3 py-2 text-center">
                                  {rel.is_driving && <Check className="w-4 h-4 text-green-600 inline" />}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
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
