/*
  # Fix RLS Policies - Add Anon Role Policies

  1. Problem
    - Current RLS policies only apply to 'authenticated' role
    - Supabase client queries are being made with 'anon' role
    - This causes "permission denied" errors even for authenticated users
    
  2. Solution
    - Add equivalent policies for 'anon' role
    - The anon role queries still check auth.uid() which verifies authentication
    - This allows the Supabase client to work properly with RLS
    
  3. Tables Updated
    - users
    - company_memberships
    - companies
*/

-- Users table policies for anon role
CREATE POLICY "Anon users can view own profile"
  ON users FOR SELECT
  TO anon
  USING (id = (SELECT auth.uid()));

CREATE POLICY "Anon users can insert own profile"
  ON users FOR INSERT
  TO anon
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY "Anon users can update own profile"
  ON users FOR UPDATE
  TO anon
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- Company memberships policies for anon role
CREATE POLICY "Anon users can view their memberships"
  ON company_memberships FOR SELECT
  TO anon
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Anon users can create their own membership"
  ON company_memberships FOR INSERT
  TO anon
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Companies policies for anon role
CREATE POLICY "Anon users can view their companies"
  ON companies FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM company_memberships
      WHERE company_memberships.company_id = companies.id
      AND company_memberships.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Anon users can create companies"
  ON companies FOR INSERT
  TO anon
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY "Anon users can update their companies"
  ON companies FOR UPDATE
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM company_memberships
      WHERE company_memberships.company_id = companies.id
      AND company_memberships.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_memberships
      WHERE company_memberships.company_id = companies.id
      AND company_memberships.user_id = (SELECT auth.uid())
    )
  );
