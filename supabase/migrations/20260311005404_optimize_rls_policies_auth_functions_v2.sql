/*
  # Optimize RLS Policies for Auth Function Performance

  1. Changes
    - Replace auth.uid() with (SELECT auth.uid()) in RLS policies
    - This prevents re-evaluation of auth functions for each row
    - Significantly improves query performance at scale
    
  2. Tables Updated
    - users: All policies updated
    - companies: All policies updated
    - company_memberships: All policies updated
    - layouts: write policy updated
*/

-- Drop and recreate users policies
DROP POLICY IF EXISTS "Users can view own profile" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;
DROP POLICY IF EXISTS "Users can insert own profile" ON users;

CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY "Users can insert own profile"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

-- Drop and recreate companies policies
DROP POLICY IF EXISTS "Users can view their companies" ON companies;
DROP POLICY IF EXISTS "Users can update their companies" ON companies;

CREATE POLICY "Users can view their companies"
  ON companies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_memberships
      WHERE company_memberships.company_id = companies.id
      AND company_memberships.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update their companies"
  ON companies FOR UPDATE
  TO authenticated
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

-- Drop and recreate company_memberships policies
DROP POLICY IF EXISTS "Users can view their memberships" ON company_memberships;
DROP POLICY IF EXISTS "Users can create their own membership" ON company_memberships;

CREATE POLICY "Users can view their memberships"
  ON company_memberships FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can create their own membership"
  ON company_memberships FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Drop and recreate layouts write policy
DROP POLICY IF EXISTS "write" ON layouts;

CREATE POLICY "write"
  ON layouts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_memberships cm
      WHERE cm.company_id = layouts.company_id
      AND cm.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_memberships cm
      WHERE cm.company_id = layouts.company_id
      AND cm.user_id = (SELECT auth.uid())
    )
  );
