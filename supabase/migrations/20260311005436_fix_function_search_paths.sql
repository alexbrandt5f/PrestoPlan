/*
  # Fix Function Search Paths for Security

  1. Problem
    - Functions have role-mutable search_path which is a security risk
    - Attackers could manipulate search_path to inject malicious code
    
  2. Solution
    - Set search_path to empty string or specific schema
    - Use fully qualified names for all objects
    
  3. Functions Updated
    - user_has_company_access
    - user_has_write_access
    - handle_updated_at
*/

-- Update user_has_company_access function with secure search_path
CREATE OR REPLACE FUNCTION user_has_company_access(check_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.company_memberships
    WHERE company_memberships.company_id = check_company_id
    AND company_memberships.user_id = auth.uid()
    AND company_memberships.is_active = true
  );
END;
$$;

-- Update user_has_write_access function with secure search_path
CREATE OR REPLACE FUNCTION user_has_write_access(check_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.company_memberships
    WHERE company_memberships.company_id = check_company_id
    AND company_memberships.user_id = auth.uid()
    AND company_memberships.is_active = true
  );
END;
$$;

-- Update handle_updated_at function with secure search_path
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
