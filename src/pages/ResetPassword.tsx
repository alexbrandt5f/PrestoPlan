import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Loader2, Calendar, ArrowLeft } from 'lucide-react';

export function ResetPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { resetPassword } = useAuth();
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      showToast('Please enter your email address', 'error');
      return;
    }

    setLoading(true);

    try {
      const { error } = await resetPassword(email);

      if (error) {
        showToast(error.message, 'error');
      } else {
        showToast('Password reset link sent to your email', 'success');
        setSent(true);
      }
    } catch (error) {
      showToast('An unexpected error occurred', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <div className="flex items-center justify-center mb-8">
            <Calendar className="w-10 h-10 text-[#1B4F72] mr-2" />
            <h1 className="text-3xl font-bold text-[#1B4F72]">PrestoPlan</h1>
          </div>

          <h2 className="text-2xl font-semibold text-gray-800 text-center mb-2">
            Reset Password
          </h2>
          <p className="text-sm text-gray-600 text-center mb-6">
            Enter your email and we'll send you a link to reset your password
          </p>

          {!sent ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2E86C1] focus:border-transparent outline-none transition-all"
                  placeholder="you@example.com"
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#1B4F72] text-white py-2.5 rounded-lg font-medium hover:bg-[#2E86C1] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </form>
          ) : (
            <div className="text-center">
              <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 mb-6">
                <p className="text-sm">
                  Check your email for a link to reset your password. If it doesn't appear within a few minutes, check your spam folder.
                </p>
              </div>
              <Link
                to="/login"
                className="text-[#1B4F72] font-medium hover:text-[#2E86C1] flex items-center justify-center"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Log In
              </Link>
            </div>
          )}

          {!sent && (
            <div className="mt-6 text-center">
              <Link
                to="/login"
                className="text-sm text-[#1B4F72] hover:text-[#2E86C1] flex items-center justify-center"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Log In
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
