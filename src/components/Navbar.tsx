import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCompany } from '../hooks/useCompany';
import { useToast } from '../contexts/ToastContext';
import { Calendar, LogOut, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function Navbar() {
  const { user, signOut } = useAuth();
  const { company } = useCompany();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      showToast('Successfully logged out', 'success');
      navigate('/login');
    } catch (error) {
      showToast('Error logging out', 'error');
    }
  };

  const getUserInitial = () => {
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  };

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <Calendar className="w-8 h-8 text-[#1B4F72] mr-2" />
            <span className="text-2xl font-bold text-[#1B4F72]">PrestoPlan</span>
          </div>

          {company && (
            <div className="hidden md:block">
              <span className="text-sm text-gray-600">
                <span className="font-medium text-gray-800">{company.name}</span>
              </span>
            </div>
          )}

          <div className="flex items-center space-x-4">
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
