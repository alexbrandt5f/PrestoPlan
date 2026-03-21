-- ============================================================================
-- COMPREHENSIVE SECURITY FIX MIGRATION
-- ============================================================================
-- This migration addresses multiple security and performance issues:
-- 1. Adds missing foreign key indexes (30 total)
-- 2. Fixes RLS policy performance issues
-- 3. Fixes function search path
-- 4. Drops unused indexes
-- ============================================================================

-- ============================================================================
-- PART 1: ADD MISSING FOREIGN KEY INDEXES
-- ============================================================================
-- Foreign keys without indexes can cause performance issues and potential
-- deadlocks. Adding indexes improves query performance and concurrent access.
-- ============================================================================

-- cpm_activity_notes table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_activity_notes_activity_id
  ON cpm_activity_notes(activity_id);

CREATE INDEX IF NOT EXISTS idx_cpm_activity_notes_company_id
  ON cpm_activity_notes(company_id);

CREATE INDEX IF NOT EXISTS idx_cpm_activity_notes_topic_id
  ON cpm_activity_notes(topic_id);

-- cpm_calendar_dates table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_calendar_dates_company_id
  ON cpm_calendar_dates(company_id);

-- cpm_calendars table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_calendars_company_id
  ON cpm_calendars(company_id);

-- cpm_code_assignments table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_code_assignments_company_id
  ON cpm_code_assignments(company_id);

-- cpm_code_types table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_code_types_company_id
  ON cpm_code_types(company_id);

-- cpm_code_values table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_code_values_company_id
  ON cpm_code_values(company_id);

-- cpm_custom_field_types table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_custom_field_types_company_id
  ON cpm_custom_field_types(company_id);

-- cpm_custom_field_values table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_custom_field_values_company_id
  ON cpm_custom_field_values(company_id);

CREATE INDEX IF NOT EXISTS idx_cpm_custom_field_values_field_type_id
  ON cpm_custom_field_values(field_type_id);

-- cpm_format_metadata table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_format_metadata_company_id
  ON cpm_format_metadata(company_id);

CREATE INDEX IF NOT EXISTS idx_cpm_format_metadata_schedule_version_id
  ON cpm_format_metadata(schedule_version_id);

-- cpm_note_topics table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_note_topics_company_id
  ON cpm_note_topics(company_id);

CREATE INDEX IF NOT EXISTS idx_cpm_note_topics_schedule_version_id
  ON cpm_note_topics(schedule_version_id);

-- cpm_projects table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_projects_company_id
  ON cpm_projects(company_id);

-- cpm_raw_tables table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_raw_tables_company_id
  ON cpm_raw_tables(company_id);

-- cpm_resource_assignments table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_resource_assignments_company_id
  ON cpm_resource_assignments(company_id);

CREATE INDEX IF NOT EXISTS idx_cpm_resource_assignments_resource_id
  ON cpm_resource_assignments(resource_id);

-- cpm_resources table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_resources_company_id
  ON cpm_resources(company_id);

-- cpm_wbs table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cpm_wbs_company_id
  ON cpm_wbs(company_id);

-- layouts table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_layouts_company_id
  ON layouts(company_id);

CREATE INDEX IF NOT EXISTS idx_layouts_created_by
  ON layouts(created_by);

-- obs_nodes table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_obs_nodes_company_id
  ON obs_nodes(company_id);

CREATE INDEX IF NOT EXISTS idx_obs_nodes_parent_node_id
  ON obs_nodes(parent_node_id);

-- projects table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_projects_obs_node_id
  ON projects(obs_node_id);

-- shared_links table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_shared_links_company_id
  ON shared_links(company_id);

CREATE INDEX IF NOT EXISTS idx_shared_links_created_by
  ON shared_links(created_by);

CREATE INDEX IF NOT EXISTS idx_shared_links_schedule_version_id
  ON shared_links(schedule_version_id);

-- user_obs_permissions table indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_obs_permissions_company_id
  ON user_obs_permissions(company_id);

CREATE INDEX IF NOT EXISTS idx_user_obs_permissions_obs_node_id
  ON user_obs_permissions(obs_node_id);

-- ============================================================================
-- PART 2: FIX RLS POLICY PERFORMANCE
-- ============================================================================
-- The "Users can create one company" policy uses auth.uid() directly which
-- can cause performance issues. Wrapping it in (SELECT auth.uid()) ensures
-- proper query planning and index usage.
-- ============================================================================

-- Drop the existing policy
DROP POLICY IF EXISTS "Users can create one company" ON companies;

-- Recreate the policy with the performance fix
CREATE POLICY "Users can create one company"
  ON companies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND NOT EXISTS (
      SELECT 1
      FROM companies
      WHERE owner_id = (SELECT auth.uid())
    )
  );

-- ============================================================================
-- PART 3: FIX FUNCTION SEARCH PATH
-- ============================================================================
-- Adding search_path to the function prevents search_path injection attacks
-- and ensures consistent behavior regardless of caller's search path.
-- ============================================================================

-- Drop and recreate the function with proper search_path
CREATE OR REPLACE FUNCTION get_current_user_email()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_email TEXT;
BEGIN
  SELECT email INTO user_email
  FROM auth.users
  WHERE id = auth.uid();

  RETURN user_email;
END;
$$;

-- ============================================================================
-- PART 4: DROP UNUSED INDEX
-- ============================================================================
-- The idx_invitations_invited_by index is not being used by any queries
-- and adds unnecessary overhead to INSERT/UPDATE operations.
-- ============================================================================

DROP INDEX IF EXISTS idx_invitations_invited_by;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Summary of changes:
-- - Added 30 missing foreign key indexes across 20 tables
-- - Fixed RLS policy to use (SELECT auth.uid()) for better performance
-- - Added search_path to get_current_user_email function for security
-- - Dropped unused idx_invitations_invited_by index
-- ============================================================================
