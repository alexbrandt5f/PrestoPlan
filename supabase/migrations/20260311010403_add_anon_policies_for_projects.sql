/*
  # Add Anon Role Policies for Projects and Related Tables

  1. Problem
    - Current RLS policies only apply to 'authenticated' role
    - Supabase client queries are being made with 'anon' role
    - This causes "permission denied" errors even for authenticated users
    
  2. Solution
    - Add equivalent policies for 'anon' role on projects and related tables
    - The anon role queries still check auth.uid() which verifies authentication
    - This allows the Supabase client to work properly with RLS
    
  3. Tables Updated
    - projects
    - schedule_versions
    - obs_nodes
*/

-- Projects table policies for anon role
CREATE POLICY "Anon users can view their projects"
  ON projects FOR SELECT
  TO anon
  USING (user_has_company_access(company_id));

CREATE POLICY "Anon users can create projects"
  ON projects FOR INSERT
  TO anon
  WITH CHECK (user_has_write_access(company_id));

CREATE POLICY "Anon users can update their projects"
  ON projects FOR UPDATE
  TO anon
  USING (user_has_write_access(company_id))
  WITH CHECK (user_has_write_access(company_id));

CREATE POLICY "Anon users can delete their projects"
  ON projects FOR DELETE
  TO anon
  USING (user_has_write_access(company_id));

-- Schedule versions policies for anon role
CREATE POLICY "Anon users can view their schedule versions"
  ON schedule_versions FOR SELECT
  TO anon
  USING (user_has_company_access(company_id));

CREATE POLICY "Anon users can create schedule versions"
  ON schedule_versions FOR INSERT
  TO anon
  WITH CHECK (user_has_write_access(company_id));

CREATE POLICY "Anon users can update their schedule versions"
  ON schedule_versions FOR UPDATE
  TO anon
  USING (user_has_write_access(company_id))
  WITH CHECK (user_has_write_access(company_id));

CREATE POLICY "Anon users can delete their schedule versions"
  ON schedule_versions FOR DELETE
  TO anon
  USING (user_has_write_access(company_id));

-- OBS nodes policies for anon role
CREATE POLICY "Anon users can view their OBS nodes"
  ON obs_nodes FOR SELECT
  TO anon
  USING (user_has_company_access(company_id));

CREATE POLICY "Anon users can create OBS nodes"
  ON obs_nodes FOR INSERT
  TO anon
  WITH CHECK (user_has_write_access(company_id));

CREATE POLICY "Anon users can update their OBS nodes"
  ON obs_nodes FOR UPDATE
  TO anon
  USING (user_has_write_access(company_id))
  WITH CHECK (user_has_write_access(company_id));

CREATE POLICY "Anon users can delete their OBS nodes"
  ON obs_nodes FOR DELETE
  TO anon
  USING (user_has_write_access(company_id));
