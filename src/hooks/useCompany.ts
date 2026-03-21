/**
 * useCompany.ts
 *
 * Fetches ALL companies the current user belongs to (via company_memberships),
 * tracks which one is "active" (selected), and provides a function to switch
 * between them.
 *
 * MULTI-COMPANY SUPPORT:
 *   - A user may belong to multiple companies (their personal workspace +
 *     any companies they've been invited to)
 *   - The "active" company determines which projects/schedules are shown
 *   - Active company ID is persisted to localStorage so it survives page refreshes
 *   - If the stored active company is no longer valid (user removed), falls back
 *     to the first available company
 *
 * COMPANY SELECTION PRIORITY:
 *   1. localStorage stored value (if still valid)
 *   2. First non-personal company (if any) — because invited companies are
 *      more likely to be the user's primary work context
 *   3. First company in the list (personal workspace fallback)
 *
 * The `role` field on each company comes from the company_memberships join,
 * so the UI can check whether the user is 'admin' or 'viewer' for the
 * currently active company.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

/** localStorage key for persisting the active company selection */
const ACTIVE_COMPANY_KEY = 'prestoplan_active_company_id';

/** Company data enriched with the user's role in that company */
export interface CompanyWithRole {
  id: string;
  name: string;
  slug: string;
  plan_type: string;
  is_personal: boolean;
  role: string; // 'admin' | 'viewer' — from company_memberships
}

/** Return type of the useCompany hook */
export interface UseCompanyReturn {
  /** The currently active/selected company (null while loading) */
  company: CompanyWithRole | null;
  /** All companies the user belongs to */
  companies: CompanyWithRole[];
  /** Whether the initial fetch is in progress */
  loading: boolean;
  /** The user's role in the active company ('admin' or 'viewer') */
  userRole: string | null;
  /** Switch the active company by ID. Updates state and localStorage. */
  setActiveCompany: (companyId: string) => void;
  /** Re-fetch company data (call after accepting invitations, etc.) */
  refetch: () => Promise<void>;
}

export function useCompany(): UseCompanyReturn {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<CompanyWithRole[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Fetch all companies the user belongs to, joined with their role
   * from company_memberships.
   */
  const fetchCompanies = useCallback(async () => {
    if (!user) {
      setCompanies([]);
      setActiveCompanyId(null);
      setLoading(false);
      return;
    }

    try {
      // Query company_memberships with a JOIN (PostgREST embedded select)
      // to get company details + the user's role in one query.
      const { data: memberships, error } = await supabase
        .from('company_memberships')
        .select('company_id, role, companies(id, name, slug, plan_type, is_personal)')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (error) {
        console.error('Error fetching companies:', error);
        setLoading(false);
        return;
      }

      if (!memberships || memberships.length === 0) {
        console.log('No company memberships found (workspace setup may still be in progress)');
        setCompanies([]);
        setLoading(false);
        return;
      }

      // Transform the joined data into a flat CompanyWithRole array
      const companyList: CompanyWithRole[] = memberships
        .filter((m) => m.companies) // Guard against null joins
        .map((m) => {
          const c = m.companies as unknown as {
            id: string;
            name: string;
            slug: string;
            plan_type: string;
            is_personal: boolean;
          };
          return {
            id: c.id,
            name: c.name,
            slug: c.slug,
            plan_type: c.plan_type,
            is_personal: c.is_personal,
            role: m.role,
          };
        });

      setCompanies(companyList);

      // Determine which company should be active
      const storedId = localStorage.getItem(ACTIVE_COMPANY_KEY);
      const storedIsValid = storedId && companyList.some((c) => c.id === storedId);

      if (storedIsValid) {
        // Stored selection is still valid — use it
        setActiveCompanyId(storedId);
      } else {
        // Pick a default: prefer non-personal companies (work context),
        // fall back to first available (personal workspace)
        const nonPersonal = companyList.find((c) => !c.is_personal);
        const defaultCompany = nonPersonal || companyList[0];
        if (defaultCompany) {
          setActiveCompanyId(defaultCompany.id);
          localStorage.setItem(ACTIVE_COMPANY_KEY, defaultCompany.id);
        }
      }
    } catch (error) {
      console.error('Error in fetchCompanies:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Fetch on mount and when user changes
  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  /**
   * Switch the active company. Updates local state and persists to localStorage.
   * The Dashboard and other components will re-render with the new company context.
   */
  const setActiveCompany = useCallback(
    (companyId: string) => {
      const exists = companies.some((c) => c.id === companyId);
      if (!exists) {
        console.error(`Cannot switch to company ${companyId} — user is not a member`);
        return;
      }
      setActiveCompanyId(companyId);
      localStorage.setItem(ACTIVE_COMPANY_KEY, companyId);
    },
    [companies]
  );

  // Derive the active company object and user's role
  const company = companies.find((c) => c.id === activeCompanyId) || null;
  const userRole = company?.role || null;

  return {
    company,
    companies,
    loading,
    userRole,
    setActiveCompany,
    refetch: fetchCompanies,
  };
}
