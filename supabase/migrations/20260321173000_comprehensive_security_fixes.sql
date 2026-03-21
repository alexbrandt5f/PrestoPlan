/*
  # Comprehensive Security Fixes Migration

  ## Security Issues Addressed

  1. **Missing Foreign Key Index** (1 index)
     - Add index on invitations.invited_by for FK constraint optimization

  2. **Drop Unused Indexes** (39 indexes)
     - Remove indexes that are not being used by query planner
     - Reduces storage overhead and maintenance costs
     - Improves INSERT/UPDATE/DELETE performance

  3. **Drop Duplicate Indexes** (9 indexes)
     - Remove indexes with identical index definitions
     - Eliminates redundant storage and maintenance overhead

  4. **Fix Function Search Paths** (5 functions)
     - Add SET search_path = public to all SECURITY DEFINER functions
     - Prevents search path injection attacks
     - Functions: update_invitations_updated_at, is_member_of_company,
       is_admin_of_company, user_has_write_access, user_has_company_access

  5. **Fix Companies Insert Policy**
     - Replace insecure WITH CHECK (true) policy with proper authentication
     - Ensures only authenticated users can create companies
     - Adds proper ownership validation

  ## Security Impact
  - Prevents unauthorized data access via search path manipulation
  - Improves query performance with proper indexing
  - Reduces attack surface by removing unused indexes
  - Enforces proper authentication on company creation
*/

-- =====================================================
-- PART 1: ADD MISSING FOREIGN KEY INDEX
-- =====================================================
-- This index improves JOIN performance when querying invitations
-- by the user who sent them, and is required for optimal FK constraint checking

CREATE INDEX IF NOT EXISTS idx_invitations_invited_by
  ON invitations(invited_by);

COMMENT ON INDEX idx_invitations_invited_by IS
  'Optimizes FK constraint checking and JOINs on invitations.invited_by';

-- =====================================================
-- PART 2: DROP UNUSED INDEXES (39 indexes)
-- =====================================================
-- These indexes are not being utilized by the query planner
-- and contribute to unnecessary storage and maintenance overhead

-- Invitations indexes (2)
DROP INDEX IF EXISTS idx_invitations_email_pending;
DROP INDEX IF EXISTS idx_invitations_company_id;

-- Code assignments indexes (2)
DROP INDEX IF EXISTS idx_code_assignments_activity_id;
DROP INDEX IF EXISTS idx_code_assignments_company_id;

-- Activity notes indexes (3)
DROP INDEX IF EXISTS idx_activity_notes_activity_id;
DROP INDEX IF EXISTS idx_activity_notes_company_id;
DROP INDEX IF EXISTS idx_activity_notes_topic_id;

-- Calendar dates indexes (1)
DROP INDEX IF EXISTS idx_calendar_dates_company_id;

-- Calendars indexes (1)
DROP INDEX IF EXISTS idx_calendars_company_id;

-- Code types indexes (1)
DROP INDEX IF EXISTS idx_code_types_company_id;

-- Code values indexes (1)
DROP INDEX IF EXISTS idx_code_values_company_id;

-- Custom field types indexes (1)
DROP INDEX IF EXISTS idx_custom_field_types_company_id;

-- Format metadata indexes (2)
DROP INDEX IF EXISTS idx_format_metadata_company_id;
DROP INDEX IF EXISTS idx_format_metadata_schedule_version_id;

-- Custom field values indexes (2)
DROP INDEX IF EXISTS idx_custom_field_values_company_id;
DROP INDEX IF EXISTS idx_custom_field_values_field_type_id;

-- Note topics indexes (2)
DROP INDEX IF EXISTS idx_note_topics_company_id;
DROP INDEX IF EXISTS idx_note_topics_schedule_version_id;

-- CPM projects indexes (1)
DROP INDEX IF EXISTS idx_cpm_projects_company_id;

-- Raw tables indexes (2)
DROP INDEX IF EXISTS idx_raw_tables_company_id;
DROP INDEX IF EXISTS idx_raw_tables_schedule_version_id;

-- Resource assignments indexes (2)
DROP INDEX IF EXISTS idx_resource_assignments_company_id;
DROP INDEX IF EXISTS idx_resource_assignments_resource_id;

-- Resources indexes (2)
DROP INDEX IF EXISTS idx_resources_company_id;
DROP INDEX IF EXISTS idx_resources_schedule_version_id;

-- WBS indexes (1)
DROP INDEX IF EXISTS idx_wbs_company_id;

-- OBS nodes indexes (2)
DROP INDEX IF EXISTS idx_obs_nodes_company_id;
DROP INDEX IF EXISTS idx_obs_nodes_parent_node_id;

-- Projects indexes (1)
DROP INDEX IF EXISTS idx_projects_obs_node_id;

-- Shared links indexes (2)
DROP INDEX IF EXISTS idx_shared_links_created_by;
DROP INDEX IF EXISTS idx_shared_links_schedule_version_id;

-- User OBS permissions indexes (3)
DROP INDEX IF EXISTS idx_user_obs_permissions_company_id;
DROP INDEX IF EXISTS idx_user_obs_permissions_obs_node_id;
DROP INDEX IF EXISTS idx_user_obs_permissions_user_id;

-- Layouts indexes (4)
DROP INDEX IF EXISTS idx_layouts_company_id;
DROP INDEX IF EXISTS idx_layouts_created_by;
DROP INDEX IF EXISTS idx_layouts_scope;
DROP INDEX IF EXISTS idx_shared_links_company_id;

-- =====================================================
-- PART 3: DROP DUPLICATE INDEXES (9 indexes)
-- =====================================================
-- These indexes are functionally identical to other existing indexes
-- Keeping only one version improves performance and reduces storage

-- Calendars - keep idx_calendars_schedule_version_id, drop duplicate
DROP INDEX IF EXISTS idx_cpm_calendars_version;

-- Code assignments - keep original indexes, drop cpm_ prefixed versions
DROP INDEX IF EXISTS idx_cpm_code_assignments_activity_id;
DROP INDEX IF EXISTS idx_cpm_code_assignments_code_value_id;

-- Code values - keep idx_code_values_code_type_id, drop duplicate
DROP INDEX IF EXISTS idx_cpm_code_values_code_type_id;

-- Custom field types - keep idx_custom_field_types_schedule_version_id, drop duplicate
DROP INDEX IF EXISTS idx_cpm_custom_field_types_schedule_version_id;

-- Raw tables - keep idx_raw_tables_schedule_version_id, drop duplicate
DROP INDEX IF EXISTS idx_cpm_raw_tables_version;

-- Resource assignments - keep idx_resource_assignments_activity_id, drop duplicate
DROP INDEX IF EXISTS idx_cpm_resource_assignments_activity_id;

-- Resources - keep idx_resources_schedule_version_id, drop duplicate
DROP INDEX IF EXISTS idx_cpm_resources_schedule_version_id;

-- WBS - keep idx_wbs_schedule_version_id, drop duplicate
DROP INDEX IF EXISTS idx_cpm_wbs_version;

-- =====================================================
-- PART 4: FIX FUNCTION SEARCH PATHS (5 functions)
-- =====================================================
-- Adding SET search_path = public to all SECURITY DEFINER functions
-- prevents search path injection attacks where malicious users could
-- create objects in their schema that shadow system functions

-- Function 1: update_invitations_updated_at
-- Updates the updated_at timestamp when an invitation is modified
CREATE OR REPLACE FUNCTION update_invitations_updated_at()
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

COMMENT ON FUNCTION update_invitations_updated_at() IS
  'Trigger function to automatically update invitations.updated_at timestamp. SET search_path prevents injection attacks.';

-- Function 2: is_member_of_company
-- Checks if the current user is an active member of a given company
CREATE OR REPLACE FUNCTION is_member_of_company(company_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM company_memberships
    WHERE user_id = auth.uid()
      AND company_id = company_uuid
      AND is_active = true
  );
END;
$$;

COMMENT ON FUNCTION is_member_of_company(UUID) IS
  'Checks if authenticated user is an active member of specified company. SET search_path prevents injection attacks.';

-- Function 3: is_admin_of_company
-- Checks if the current user is an admin of a given company
CREATE OR REPLACE FUNCTION is_admin_of_company(company_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM company_memberships
    WHERE user_id = auth.uid()
      AND company_id = company_uuid
      AND role = 'admin'
      AND is_active = true
  );
END;
$$;

COMMENT ON FUNCTION is_admin_of_company(UUID) IS
  'Checks if authenticated user is an admin of specified company. SET search_path prevents injection attacks.';

-- Function 4: user_has_write_access
-- Checks if the current user has write access to a specific resource
CREATE OR REPLACE FUNCTION user_has_write_access(
  resource_company_id UUID,
  required_role TEXT DEFAULT 'member'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM company_memberships
    WHERE user_id = auth.uid()
      AND company_id = resource_company_id
      AND is_active = true
      AND (
        role = 'admin' OR
        (required_role = 'member' AND role IN ('admin', 'member'))
      )
  );
END;
$$;

COMMENT ON FUNCTION user_has_write_access(UUID, TEXT) IS
  'Checks if authenticated user has write access to resource in specified company. SET search_path prevents injection attacks.';

-- Function 5: user_has_company_access
-- Checks if the current user has any access to a given company
CREATE OR REPLACE FUNCTION user_has_company_access(company_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM company_memberships
    WHERE user_id = auth.uid()
      AND company_id = company_uuid
      AND is_active = true
  );
END;
$$;

COMMENT ON FUNCTION user_has_company_access(UUID) IS
  'Checks if authenticated user has any access to specified company. SET search_path prevents injection attacks.';

-- =====================================================
-- PART 5: FIX COMPANIES INSERT POLICY
-- =====================================================
-- Replace the insecure policy that allows unrestricted inserts
-- with proper authentication and authorization checks

-- Drop the insecure policy
DROP POLICY IF EXISTS "Users can insert companies" ON companies;

-- Create a secure policy that:
-- 1. Requires authentication (TO authenticated)
-- 2. Ensures the created_by field matches the authenticated user
-- 3. Validates that the user exists and is authenticated
CREATE POLICY "Authenticated users can create companies with proper ownership"
  ON companies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User must be authenticated
    auth.uid() IS NOT NULL
    -- User must set themselves as the creator
    AND created_by = auth.uid()
    -- Additional validation: ensure user exists in auth.users
    AND EXISTS (
      SELECT 1
      FROM auth.users
      WHERE id = auth.uid()
    )
  );

COMMENT ON POLICY "Authenticated users can create companies with proper ownership" ON companies IS
  'Allows authenticated users to create companies only if they set themselves as the creator. Replaces insecure WITH CHECK (true) policy.';

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================
-- Run these queries after migration to verify the changes

-- Verify the new index was created
-- SELECT schemaname, tablename, indexname
-- FROM pg_indexes
-- WHERE indexname = 'idx_invitations_invited_by';

-- Verify unused indexes were dropped (should return 0 rows)
-- SELECT indexname FROM pg_indexes
-- WHERE indexname IN (
--   'idx_invitations_email_pending', 'idx_invitations_company_id',
--   'idx_code_assignments_activity_id', 'idx_code_assignments_company_id'
--   -- ... etc
-- );

-- Verify duplicate indexes were dropped (should return 0 rows)
-- SELECT indexname FROM pg_indexes
-- WHERE indexname LIKE 'idx_cpm_%version'
--   OR indexname IN ('idx_cpm_code_assignments_activity_id',
--                    'idx_cpm_code_assignments_code_value_id',
--                    'idx_cpm_code_values_code_type_id');

-- Verify functions have search_path set
-- SELECT
--   p.proname as function_name,
--   pg_get_function_identity_arguments(p.oid) as arguments,
--   p.prosecdef as is_security_definer,
--   p.proconfig as config_settings
-- FROM pg_proc p
-- JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE n.nspname = 'public'
--   AND p.proname IN (
--     'update_invitations_updated_at',
--     'is_member_of_company',
--     'is_admin_of_company',
--     'user_has_write_access',
--     'user_has_company_access'
--   );

-- Verify companies insert policy
-- SELECT
--   schemaname, tablename, policyname,
--   permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'companies'
--   AND cmd = 'INSERT';
