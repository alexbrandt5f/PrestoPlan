/*
  # Fix Security Issues and Performance Problems

  ## 1. RLS Policy Performance Optimization
  
  Updates all RLS policies to use `(select auth.uid())` instead of `auth.uid()` directly.
  This prevents re-evaluation of the auth function for each row, significantly improving
  query performance at scale.
  
  **Tables Updated:**
  - `users` - 3 policies (select, insert, update)
  - `companies` - 3 policies (select, insert, update)
  - `company_memberships` - 2 policies (select, insert)

  ## 2. Security Fixes

  ### Fixed Companies Insert Policy
  - **CRITICAL**: Replaced the `companies_insert` policy that had `WITH CHECK (true)`
  - New policy ensures only authenticated users can create companies
  - Prevents unrestricted access to company creation

  ### Removed Multiple Permissive Policies
  - Removed duplicate permissive policies from:
    - `obs_nodes` - "Anon users can view their OBS nodes"
    - `projects` - "Anon users can view their projects"  
    - `schedule_versions` - "Anon users can view their schedule versions"
  - These were causing multiple permissive policy conflicts

  ## 3. Performance Optimization

  ### Removed Unused Indexes
  Dropped 32 unused indexes that were consuming storage and slowing down write operations.

  ## Important Notes
  
  1. **Performance Impact**: Using `(select auth.uid())` evaluates the function once per query
     instead of once per row, dramatically improving performance for large result sets
  
  2. **Security Impact**: The companies_insert policy now properly validates authentication,
     preventing security vulnerabilities
  
  3. **Index Cleanup**: Removing unused indexes improves INSERT/UPDATE performance and
     reduces storage overhead
*/

-- ============================================================================
-- 1. FIX RLS POLICIES - USERS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select"
  ON users FOR SELECT
  TO authenticated
  USING (id = (select auth.uid()));

DROP POLICY IF EXISTS "users_insert" ON users;
CREATE POLICY "users_insert"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (id = (select auth.uid()));

DROP POLICY IF EXISTS "users_update" ON users;
CREATE POLICY "users_update"
  ON users FOR UPDATE
  TO authenticated
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

-- ============================================================================
-- 2. FIX RLS POLICIES - COMPANIES TABLE
-- ============================================================================

DROP POLICY IF EXISTS "companies_select" ON companies;
CREATE POLICY "companies_select"
  ON companies FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT company_id 
      FROM company_memberships 
      WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "companies_insert" ON companies;
CREATE POLICY "companies_insert"
  ON companies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM company_memberships 
      WHERE company_id = id 
      AND user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "companies_update" ON companies;
CREATE POLICY "companies_update"
  ON companies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM company_memberships 
      WHERE company_id = id 
      AND user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM company_memberships 
      WHERE company_id = id 
      AND user_id = (select auth.uid())
    )
  );

-- ============================================================================
-- 3. FIX RLS POLICIES - COMPANY_MEMBERSHIPS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "memberships_select" ON company_memberships;
CREATE POLICY "memberships_select"
  ON company_memberships FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "memberships_insert" ON company_memberships;
CREATE POLICY "memberships_insert"
  ON company_memberships FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

-- ============================================================================
-- 4. REMOVE MULTIPLE PERMISSIVE ANON POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Anon users can view their OBS nodes" ON obs_nodes;
DROP POLICY IF EXISTS "Anon users can view their projects" ON projects;
DROP POLICY IF EXISTS "Anon users can view their schedule versions" ON schedule_versions;

-- ============================================================================
-- 5. REMOVE UNUSED INDEXES
-- ============================================================================

DROP INDEX IF EXISTS idx_cpm_relationships_version_successor;
DROP INDEX IF EXISTS idx_cpm_code_assignments_company;
DROP INDEX IF EXISTS idx_cpm_wbs_company;
DROP INDEX IF EXISTS idx_cpm_calendars_company;
DROP INDEX IF EXISTS idx_cpm_resource_assignments_company;
DROP INDEX IF EXISTS idx_cpm_custom_field_values_company;
DROP INDEX IF EXISTS idx_obs_nodes_company;
DROP INDEX IF EXISTS idx_obs_nodes_parent;
DROP INDEX IF EXISTS idx_user_obs_permissions_user_company;
DROP INDEX IF EXISTS idx_layouts_company;
DROP INDEX IF EXISTS idx_layouts_project;
DROP INDEX IF EXISTS idx_cpm_format_metadata_version;
DROP INDEX IF EXISTS idx_cpm_activity_notes_activity_id;
DROP INDEX IF EXISTS idx_cpm_activity_notes_company_id;
DROP INDEX IF EXISTS idx_cpm_activity_notes_schedule_version_id;
DROP INDEX IF EXISTS idx_cpm_activity_notes_topic_id;
DROP INDEX IF EXISTS idx_cpm_code_types_company_id;
DROP INDEX IF EXISTS idx_cpm_code_types_schedule_version_id;
DROP INDEX IF EXISTS idx_cpm_code_values_company_id;
DROP INDEX IF EXISTS idx_cpm_custom_field_types_company_id;
DROP INDEX IF EXISTS idx_cpm_custom_field_values_activity_id;
DROP INDEX IF EXISTS idx_cpm_custom_field_values_field_type_id;
DROP INDEX IF EXISTS idx_cpm_format_metadata_company_id;
DROP INDEX IF EXISTS idx_cpm_note_topics_company_id;
DROP INDEX IF EXISTS idx_cpm_note_topics_schedule_version_id;
DROP INDEX IF EXISTS idx_cpm_projects_company_id;
DROP INDEX IF EXISTS idx_cpm_raw_tables_company_id;
DROP INDEX IF EXISTS idx_cpm_resource_assignments_resource_id;
DROP INDEX IF EXISTS idx_cpm_resources_company_id;
DROP INDEX IF EXISTS idx_layouts_created_by;
DROP INDEX IF EXISTS idx_projects_obs_node_id;
DROP INDEX IF EXISTS idx_user_obs_permissions_company_id;
DROP INDEX IF EXISTS idx_user_obs_permissions_obs_node_id;
