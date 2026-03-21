/**
 * CompanyContext.tsx
 *
 * Provides shared company state across all components.
 *
 * PROBLEM THIS SOLVES:
 *   Previously, useCompany() was a standalone hook that each component called
 *   independently. Each call created its own useState — so when Navbar called
 *   setActiveCompany(), Dashboard's useCompany() didn't see the change because
 *   it had its own separate state. This meant switching workspaces in the Navbar
 *   didn't refresh the project list until a manual page reload.
 *
 * SOLUTION:
 *   Lift all company state into a React Context. The CompanyProvider wraps the
 *   app (inside AuthProvider, so it has access to the user). All components
 *   that call useCompany() now read from the same shared state. When Navbar
 *   calls setActiveCompany(), every consumer re-renders with the new company.
 *
 * USAGE:
 *   // In App.tsx, wrap inside AuthProvider:
 *   <AuthProvider>
 *     <CompanyProvider>
 *       ...routes...
 *     </CompanyProvider>
 *   </AuthProvider>
 *
 *   // In any component:
 *   const { company, companies, userRole, setActiveCompany } = useCompany();
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
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

/** The shape of the context value */
export interface CompanyContextType {
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
  /** Re-fetch company data (call after accepting invitations, renaming, etc.) */
  refetch: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: React.ReactNode }) {
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
        .filter((m) => m.companies)
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

      // Determine which company should be active (only on initial load,
      // not when refetching after a rename — preserve current selection)
      setActiveCompanyId((currentId) => {
        // If we already have a valid selection, keep it
        if (currentId && companyList.some((c) => c.id === currentId)) {
          return currentId;
        }

        // Try localStorage
        const storedId = localStorage.getItem(ACTIVE_COMPANY_KEY);
        if (storedId && companyList.some((c) => c.id === storedId)) {
          return storedId;
        }

        // Pick a default: prefer non-personal, fall back to first
        const nonPersonal = companyList.find((c) => !c.is_personal);
        const defaultCompany = nonPersonal || companyList[0];
        if (defaultCompany) {
          localStorage.setItem(ACTIVE_COMPANY_KEY, defaultCompany.id);
          return defaultCompany.id;
        }

        return null;
      });
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
   * Switch the active company. All consumers of useCompany() will re-render.
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

  const value: CompanyContextType = {
    company,
    companies,
    loading,
    userRole,
    setActiveCompany,
    refetch: fetchCompanies,
  };

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

/**
 * Hook to access the shared company context.
 * Must be used inside a CompanyProvider.
 */
export function useCompany(): CompanyContextType {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
}
