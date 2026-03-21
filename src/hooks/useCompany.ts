/**
 * useCompany.ts
 *
 * Re-exports useCompany and types from CompanyContext.
 * This file exists so that all existing imports like:
 *   import { useCompany } from '../hooks/useCompany'
 * continue to work without changing every file.
 *
 * The actual state management now lives in CompanyContext.tsx,
 * which is a React Context provider that shares company state
 * across all components (fixing the workspace switch bug where
 * each useCompany() call had its own independent state).
 */

export { useCompany } from '../contexts/CompanyContext';
export type { CompanyWithRole, CompanyContextType as UseCompanyReturn } from '../contexts/CompanyContext';
