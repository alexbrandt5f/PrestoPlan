/*
  # Add Missing Foreign Key Indexes

  1. Performance Improvements
    - Add indexes for all unindexed foreign keys
    - Improves query performance on joins and foreign key lookups
    
  2. Tables Updated
    - cpm_activities: calendar_id, wbs_id
    - cpm_activity_notes: activity_id, company_id, schedule_version_id, topic_id
    - cpm_code_assignments: activity_id, code_value_id
    - cpm_code_types: company_id, schedule_version_id
    - cpm_code_values: code_type_id, company_id, schedule_version_id
    - cpm_custom_field_types: company_id, schedule_version_id
    - cpm_custom_field_values: activity_id, field_type_id
    - cpm_format_metadata: company_id
    - cpm_note_topics: company_id, schedule_version_id
    - cpm_projects: company_id, schedule_version_id
    - cpm_raw_tables: company_id
    - cpm_relationships: predecessor_activity_id, successor_activity_id
    - cpm_resource_assignments: activity_id, resource_id
    - cpm_resources: company_id, schedule_version_id
    - cpm_wbs: parent_wbs_id
    - layouts: created_by
    - projects: obs_node_id
    - user_obs_permissions: company_id, obs_node_id
*/

-- cpm_activities
CREATE INDEX IF NOT EXISTS idx_cpm_activities_calendar_id ON cpm_activities(calendar_id);
CREATE INDEX IF NOT EXISTS idx_cpm_activities_wbs_id ON cpm_activities(wbs_id);

-- cpm_activity_notes
CREATE INDEX IF NOT EXISTS idx_cpm_activity_notes_activity_id ON cpm_activity_notes(activity_id);
CREATE INDEX IF NOT EXISTS idx_cpm_activity_notes_company_id ON cpm_activity_notes(company_id);
CREATE INDEX IF NOT EXISTS idx_cpm_activity_notes_schedule_version_id ON cpm_activity_notes(schedule_version_id);
CREATE INDEX IF NOT EXISTS idx_cpm_activity_notes_topic_id ON cpm_activity_notes(topic_id);

-- cpm_code_assignments
CREATE INDEX IF NOT EXISTS idx_cpm_code_assignments_activity_id ON cpm_code_assignments(activity_id);
CREATE INDEX IF NOT EXISTS idx_cpm_code_assignments_code_value_id ON cpm_code_assignments(code_value_id);

-- cpm_code_types
CREATE INDEX IF NOT EXISTS idx_cpm_code_types_company_id ON cpm_code_types(company_id);
CREATE INDEX IF NOT EXISTS idx_cpm_code_types_schedule_version_id ON cpm_code_types(schedule_version_id);

-- cpm_code_values
CREATE INDEX IF NOT EXISTS idx_cpm_code_values_code_type_id ON cpm_code_values(code_type_id);
CREATE INDEX IF NOT EXISTS idx_cpm_code_values_company_id ON cpm_code_values(company_id);
CREATE INDEX IF NOT EXISTS idx_cpm_code_values_schedule_version_id ON cpm_code_values(schedule_version_id);

-- cpm_custom_field_types
CREATE INDEX IF NOT EXISTS idx_cpm_custom_field_types_company_id ON cpm_custom_field_types(company_id);
CREATE INDEX IF NOT EXISTS idx_cpm_custom_field_types_schedule_version_id ON cpm_custom_field_types(schedule_version_id);

-- cpm_custom_field_values
CREATE INDEX IF NOT EXISTS idx_cpm_custom_field_values_activity_id ON cpm_custom_field_values(activity_id);
CREATE INDEX IF NOT EXISTS idx_cpm_custom_field_values_field_type_id ON cpm_custom_field_values(field_type_id);

-- cpm_format_metadata
CREATE INDEX IF NOT EXISTS idx_cpm_format_metadata_company_id ON cpm_format_metadata(company_id);

-- cpm_note_topics
CREATE INDEX IF NOT EXISTS idx_cpm_note_topics_company_id ON cpm_note_topics(company_id);
CREATE INDEX IF NOT EXISTS idx_cpm_note_topics_schedule_version_id ON cpm_note_topics(schedule_version_id);

-- cpm_projects
CREATE INDEX IF NOT EXISTS idx_cpm_projects_company_id ON cpm_projects(company_id);
CREATE INDEX IF NOT EXISTS idx_cpm_projects_schedule_version_id ON cpm_projects(schedule_version_id);

-- cpm_raw_tables
CREATE INDEX IF NOT EXISTS idx_cpm_raw_tables_company_id ON cpm_raw_tables(company_id);

-- cpm_relationships
CREATE INDEX IF NOT EXISTS idx_cpm_relationships_predecessor_activity_id ON cpm_relationships(predecessor_activity_id);
CREATE INDEX IF NOT EXISTS idx_cpm_relationships_successor_activity_id ON cpm_relationships(successor_activity_id);

-- cpm_resource_assignments
CREATE INDEX IF NOT EXISTS idx_cpm_resource_assignments_activity_id ON cpm_resource_assignments(activity_id);
CREATE INDEX IF NOT EXISTS idx_cpm_resource_assignments_resource_id ON cpm_resource_assignments(resource_id);

-- cpm_resources
CREATE INDEX IF NOT EXISTS idx_cpm_resources_company_id ON cpm_resources(company_id);
CREATE INDEX IF NOT EXISTS idx_cpm_resources_schedule_version_id ON cpm_resources(schedule_version_id);

-- cpm_wbs
CREATE INDEX IF NOT EXISTS idx_cpm_wbs_parent_wbs_id ON cpm_wbs(parent_wbs_id);

-- layouts
CREATE INDEX IF NOT EXISTS idx_layouts_created_by ON layouts(created_by);

-- projects
CREATE INDEX IF NOT EXISTS idx_projects_obs_node_id ON projects(obs_node_id);

-- user_obs_permissions
CREATE INDEX IF NOT EXISTS idx_user_obs_permissions_company_id ON user_obs_permissions(company_id);
CREATE INDEX IF NOT EXISTS idx_user_obs_permissions_obs_node_id ON user_obs_permissions(obs_node_id);
