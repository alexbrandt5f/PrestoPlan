/*
  # Fix Security Issues - Performance and RLS Optimizations

  ## Changes Made

  1. **Foreign Key Indexes**
     - Add missing indexes on foreign key columns across all tables
     - Improves JOIN performance and query optimization
     - Covers 30+ foreign key relationships

  2. **RLS Policy Optimization**
     - Fix auth.uid() re-evaluation in cpm_calendar_dates policy

  3. **Function Security**
     - Add search_path security to update_layouts_updated_at
     - Add search_path security to generate_shortcode

  4. **Performance**
     - All indexes use IF NOT EXISTS for safe re-runs
     - Indexes improve query performance significantly
*/

-- =====================================================
-- PART 1: ADD MISSING FOREIGN KEY INDEXES
-- =====================================================

-- cpm_activity_notes indexes
CREATE INDEX IF NOT EXISTS idx_activity_notes_activity_id
  ON cpm_activity_notes(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_notes_company_id
  ON cpm_activity_notes(company_id);
CREATE INDEX IF NOT EXISTS idx_activity_notes_schedule_version_id
  ON cpm_activity_notes(schedule_version_id);
CREATE INDEX IF NOT EXISTS idx_activity_notes_topic_id
  ON cpm_activity_notes(topic_id);

-- cpm_calendar_dates indexes
CREATE INDEX IF NOT EXISTS idx_calendar_dates_calendar_id
  ON cpm_calendar_dates(calendar_id);
CREATE INDEX IF NOT EXISTS idx_calendar_dates_company_id
  ON cpm_calendar_dates(company_id);

-- cpm_calendars indexes
CREATE INDEX IF NOT EXISTS idx_calendars_company_id
  ON cpm_calendars(company_id);
CREATE INDEX IF NOT EXISTS idx_calendars_schedule_version_id
  ON cpm_calendars(schedule_version_id);

-- cpm_code_assignments indexes
CREATE INDEX IF NOT EXISTS idx_code_assignments_activity_id
  ON cpm_code_assignments(activity_id);
CREATE INDEX IF NOT EXISTS idx_code_assignments_company_id
  ON cpm_code_assignments(company_id);
CREATE INDEX IF NOT EXISTS idx_code_assignments_code_value_id
  ON cpm_code_assignments(code_value_id);

-- cpm_code_types indexes
CREATE INDEX IF NOT EXISTS idx_code_types_company_id
  ON cpm_code_types(company_id);
CREATE INDEX IF NOT EXISTS idx_code_types_schedule_version_id
  ON cpm_code_types(schedule_version_id);

-- cpm_code_values indexes
CREATE INDEX IF NOT EXISTS idx_code_values_code_type_id
  ON cpm_code_values(code_type_id);
CREATE INDEX IF NOT EXISTS idx_code_values_company_id
  ON cpm_code_values(company_id);

-- cpm_custom_field_types indexes
CREATE INDEX IF NOT EXISTS idx_custom_field_types_company_id
  ON cpm_custom_field_types(company_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_types_schedule_version_id
  ON cpm_custom_field_types(schedule_version_id);

-- cpm_custom_field_values indexes
CREATE INDEX IF NOT EXISTS idx_custom_field_values_activity_id
  ON cpm_custom_field_values(activity_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_company_id
  ON cpm_custom_field_values(company_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_field_type_id
  ON cpm_custom_field_values(field_type_id);

-- cpm_format_metadata indexes
CREATE INDEX IF NOT EXISTS idx_format_metadata_company_id
  ON cpm_format_metadata(company_id);
CREATE INDEX IF NOT EXISTS idx_format_metadata_schedule_version_id
  ON cpm_format_metadata(schedule_version_id);

-- cpm_note_topics indexes
CREATE INDEX IF NOT EXISTS idx_note_topics_company_id
  ON cpm_note_topics(company_id);
CREATE INDEX IF NOT EXISTS idx_note_topics_schedule_version_id
  ON cpm_note_topics(schedule_version_id);

-- cpm_projects indexes
CREATE INDEX IF NOT EXISTS idx_cpm_projects_company_id
  ON cpm_projects(company_id);

-- cpm_raw_tables indexes
CREATE INDEX IF NOT EXISTS idx_raw_tables_company_id
  ON cpm_raw_tables(company_id);
CREATE INDEX IF NOT EXISTS idx_raw_tables_schedule_version_id
  ON cpm_raw_tables(schedule_version_id);

-- cpm_resource_assignments indexes
CREATE INDEX IF NOT EXISTS idx_resource_assignments_activity_id
  ON cpm_resource_assignments(activity_id);
CREATE INDEX IF NOT EXISTS idx_resource_assignments_company_id
  ON cpm_resource_assignments(company_id);
CREATE INDEX IF NOT EXISTS idx_resource_assignments_resource_id
  ON cpm_resource_assignments(resource_id);

-- cpm_resources indexes
CREATE INDEX IF NOT EXISTS idx_resources_company_id
  ON cpm_resources(company_id);
CREATE INDEX IF NOT EXISTS idx_resources_schedule_version_id
  ON cpm_resources(schedule_version_id);

-- cpm_wbs indexes
CREATE INDEX IF NOT EXISTS idx_wbs_company_id
  ON cpm_wbs(company_id);
CREATE INDEX IF NOT EXISTS idx_wbs_schedule_version_id
  ON cpm_wbs(schedule_version_id);

-- obs_nodes indexes
CREATE INDEX IF NOT EXISTS idx_obs_nodes_company_id
  ON obs_nodes(company_id);
CREATE INDEX IF NOT EXISTS idx_obs_nodes_parent_node_id
  ON obs_nodes(parent_node_id);

-- projects indexes
CREATE INDEX IF NOT EXISTS idx_projects_obs_node_id
  ON projects(obs_node_id);

-- shared_links indexes
CREATE INDEX IF NOT EXISTS idx_shared_links_created_by
  ON shared_links(created_by);
CREATE INDEX IF NOT EXISTS idx_shared_links_layout_id
  ON shared_links(layout_id);
CREATE INDEX IF NOT EXISTS idx_shared_links_schedule_version_id
  ON shared_links(schedule_version_id);

-- user_obs_permissions indexes
CREATE INDEX IF NOT EXISTS idx_user_obs_permissions_company_id
  ON user_obs_permissions(company_id);
CREATE INDEX IF NOT EXISTS idx_user_obs_permissions_obs_node_id
  ON user_obs_permissions(obs_node_id);
CREATE INDEX IF NOT EXISTS idx_user_obs_permissions_user_id
  ON user_obs_permissions(user_id);

-- =====================================================
-- PART 2: FIX RLS POLICY FOR cpm_calendar_dates
-- =====================================================

DROP POLICY IF EXISTS "Users can view calendar dates for their company" ON cpm_calendar_dates;

CREATE POLICY "Users can view calendar dates for their company"
  ON cpm_calendar_dates
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM company_memberships
      WHERE user_id = (SELECT auth.uid())
        AND is_active = true
    )
  );

-- =====================================================
-- PART 3: FIX FUNCTION SEARCH PATHS
-- =====================================================

CREATE OR REPLACE FUNCTION update_layouts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION generate_shortcode()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$;