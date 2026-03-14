/*
  # Fix Multiple Permissive Policies

  1. Problem
    - Tables have both 'select' and 'write' policies for SELECT operations
    - The 'write' policy uses cmd='ALL' which includes SELECT
    - This creates multiple permissive policies for the same operation
    
  2. Solution
    - Replace 'write' policies with specific INSERT, UPDATE, DELETE policies
    - Keep 'select' policy unchanged
    - This eliminates policy overlap
    
  3. Tables Updated
    - All tables with the duplicate policy pattern
*/

-- Function to replace write policies with specific policies
DO $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN 
    SELECT DISTINCT tablename 
    FROM pg_policies 
    WHERE schemaname = 'public' 
      AND policyname = 'write'
  LOOP
    -- Drop the 'write' policy
    EXECUTE format('DROP POLICY IF EXISTS "write" ON %I', table_record.tablename);
    
    -- Create specific INSERT policy
    EXECUTE format('
      CREATE POLICY "insert_policy"
        ON %I FOR INSERT
        TO authenticated
        WITH CHECK (user_has_write_access(company_id))
    ', table_record.tablename);
    
    -- Create specific UPDATE policy
    EXECUTE format('
      CREATE POLICY "update_policy"
        ON %I FOR UPDATE
        TO authenticated
        USING (user_has_write_access(company_id))
        WITH CHECK (user_has_write_access(company_id))
    ', table_record.tablename);
    
    -- Create specific DELETE policy
    EXECUTE format('
      CREATE POLICY "delete_policy"
        ON %I FOR DELETE
        TO authenticated
        USING (user_has_write_access(company_id))
    ', table_record.tablename);
  END LOOP;
END $$;
