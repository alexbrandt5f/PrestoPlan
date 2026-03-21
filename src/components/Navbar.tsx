/**
 * Navbar.tsx
 *
 * Top navigation bar for PrestoPlan.
 * Shows the PrestoPlan logo, active company name (with switcher dropdown
 * if the user belongs to multiple companies), user email, and logout button.
 *
 * COMPANY SWITCHER:
 *   - Only shows the dropdown chevron if user has 2+ companies
 *   - Clicking the company name opens a dropdown listing all companies
 *   - Active company is highlighted with a checkmark
 *   - Personal workspaces show "(Personal)" suffix
 *   - Selecting a different company calls setActiveCompany() which updates
 *     the global context and persists to localStorage
 *   - Dropdown closes on outside click or Escape key
 *
 * ROLE BADGE:
 *   - Shows the user's role (Admin/Viewer) in the active company
 *   - Helps users understand their permission level at a glance
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCompany, CompanyWithRole } from '../hooks/useCompany';
import { useToast } from '../contexts/ToastContext';
import { Calendar, LogOut, ChevronDown, Check, Building2, User, Users } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

export function Navbar() {
  const { user, signOut } = useAuth();
  const { company, companies, userRole, setActiveCompany } = useCompany();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  /** Whether the current user is an admin of the active company */
  const isAdmin = userRole === 'admin';

  // Company switcher dropdown state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  // Close dropdown on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isDropdownOpen]);

  const handleSignOut = async () => {
    try {
      await signOut();
      showToast('Successfully logged out', 'success');
      navigate('/login');
    } catch (error) {
      showToast('Error logging out', 'error');
    }
  };

  const handleCompanySwitch = (companyId: string) => {
    setActiveCompany(companyId);
    setIsDropdownOpen(false);
    // Navigate to dashboard when switching companies so the project list refreshes
    navigate('/dashboard');
  };

  const getUserInitial = () => {
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  };

  /** Whether the company switcher dropdown should be available */
  const hasMultipleCompanies = companies.length > 1;

  /**
   * Get a display-friendly name for a company.
   * Personal workspaces show the user's email prefix + "(Personal)".
   */
  const getCompanyDisplayName = (c: CompanyWithRole): string => {
    if (c.is_personal) {
      return `${c.name} (Personal)`;
    }
    return c.name;
  };

  /** Format role string for badge display */
  const getRoleBadge = () => {
    if (!userRole) return null;
    const label = userRole.charAt(0).toUpperCase() + userRole.slice(1);
    const colorClass = userRole === 'admin'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-100 text-gray-600';
    return (
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colorClass}`}>
        {label}
      </span>
    );
  };

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left: Logo */}
          <div
            className="flex items-center cursor-pointer"
            onClick={() => navigate('/dashboard')}
          >
            <Calendar className="w-8 h-8 text-[#1B4F72] mr-2" />
            <span className="text-2xl font-bold text-[#1B4F72]">PrestoPlan</span>
          </div>

          {/* Center: Company switcher */}
          {company && (
            <div className="hidden md:block relative" ref={dropdownRef}>
              <button
                onClick={() => hasMultipleCompanies && setIsDropdownOpen(!isDropdownOpen)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                  hasMultipleCompanies
                    ? 'hover:bg-gray-50 cursor-pointer'
                    : 'cursor-default'
                }`}
                disabled={!hasMultipleCompanies}
                title={
                  hasMultipleCompanies
                    ? 'Switch workspace'
                    : company.name
                }
              >
                <Building2 className="w-4 h-4 text-gray-400" />
                <span className="font-medium text-gray-800 text-sm">
                  {getCompanyDisplayName(company)}
                </span>
                {getRoleBadge()}
                {hasMultipleCompanies && (
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      isDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                )}
              </button>

              {/* Dropdown menu */}
              {isDropdownOpen && hasMultipleCompanies && (
                <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  <div className="px-3 py-2 border-b border-gray-100">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Switch Workspace
                    </p>
                  </div>
                  {companies.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleCompanySwitch(c.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        c.id === company.id
                          ? 'bg-blue-50'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Company icon */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-medium ${
                        c.is_personal
                          ? 'bg-gray-100 text-gray-600'
                          : 'bg-[#1B4F72] text-white'
                      }`}>
                        {c.is_personal ? (
                          <User className="w-4 h-4" />
                        ) : (
                          c.name.charAt(0).toUpperCase()
                        )}
                      </div>

                      {/* Company name and role */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {c.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {c.is_personal ? 'Personal workspace' : c.role === 'admin' ? 'Admin' : 'Viewer'}
                        </p>
                      </div>

                      {/* Checkmark for active company */}
                      {c.id === company.id && (
                        <Check className="w-4 h-4 text-[#2E86C1] flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Right: Nav links + User info + Logout */}
          <div className="flex items-center space-x-4">
            {/* Team link (admin only) */}
            {isAdmin && company && (
              <button
                onClick={() => navigate('/team')}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  location.pathname === '/team'
                    ? 'text-[#1B4F72] bg-blue-50'
                    : 'text-gray-600 hover:text-[#1B4F72] hover:bg-gray-50'
                }`}
              >
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">Team</span>
              </button>
            )}

            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-[#2E86C1] flex items-center justify-center text-white font-medium">
                {getUserInitial()}
              </div>
              <span className="hidden sm:block text-sm text-gray-700">{user?.email}</span>
            </div>

            <button
              onClick={handleSignOut}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-gray-700 hover:text-[#1B4F72] hover:bg-gray-50 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
