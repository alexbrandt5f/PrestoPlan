/**
 * TeamManagement.tsx
 *
 * Team management page at /team. Allows admins to:
 *   - View current company members with their roles
 *   - Invite new users by email (creates a pending invitation)
 *   - Change member roles (admin ↔ viewer)
 *   - Remove members from the company
 *   - View and revoke pending invitations
 *
 * PERMISSIONS:
 *   - Only visible to admins (Navbar hides the "Team" link for viewers)
 *   - If a viewer navigates to /team directly, they see a read-only member list
 *     with no invite/edit/remove controls
 *   - All write operations are also gated by RLS (Row-Level Security) policies
 *     on the server, so even if someone bypasses the UI, the DB blocks it
 *
 * DATA FLOW:
 *   - Members: fetched via company_memberships JOIN users, filtered by active company
 *   - Invitations: fetched from invitations table, filtered by active company
 *   - Invite: INSERT into invitations (invited_email stored lowercase/trimmed)
 *   - Role change: UPDATE company_memberships.role
 *   - Remove member: DELETE from company_memberships
 *   - Revoke invite: UPDATE invitations.status = 'revoked'
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from '../components/Navbar';
import { useCompany } from '../hooks/useCompany';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import {
  Loader2,
  Users,
  Mail,
  UserPlus,
  Shield,
  Eye,
  Trash2,
  X,
  Clock,
  AlertTriangle,
} from 'lucide-react';

/** Shape of a company member row (joined from company_memberships + users) */
interface Member {
  membership_id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  joined_at: string;
}

/** Shape of a pending invitation row */
interface Invitation {
  id: string;
  invited_email: string;
  role: string;
  status: string;
  created_at: string;
  invited_by_email?: string;
}

export function TeamManagement() {
  const { company, userRole, refetch: refetchCompany } = useCompany();
  const { user } = useAuth();
  const { showToast } = useToast();

  // Data state
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);

  // Workspace rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'viewer'>('viewer');
  const [inviting, setInviting] = useState(false);

  // Track in-progress operations to disable buttons
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const isAdmin = userRole === 'admin';

  /**
   * Fetch current members and pending invitations for the active company.
   */
  const fetchTeamData = useCallback(async () => {
    if (!company) return;

    try {
      setLoading(true);

      // Fetch members: company_memberships joined with users
      const { data: memberData, error: memberError } = await supabase
        .from('company_memberships')
        .select('id, user_id, role, is_active, joined_at, users(email, display_name)')
        .eq('company_id', company.id)
        .eq('is_active', true)
        .order('joined_at', { ascending: true });

      if (memberError) {
        console.error('Error fetching members:', memberError);
      } else {
        const transformedMembers: Member[] = (memberData || [])
          .filter((m) => m.users)
          .map((m) => {
            const u = m.users as unknown as { email: string; display_name: string };
            return {
              membership_id: m.id,
              user_id: m.user_id,
              email: u.email || '',
              display_name: u.display_name || u.email?.split('@')[0] || 'User',
              role: m.role,
              is_active: m.is_active,
              joined_at: m.joined_at,
            };
          });
        setMembers(transformedMembers);
      }

      // Fetch pending invitations (only if admin — viewers can't see them via RLS)
      if (isAdmin) {
        const { data: inviteData, error: inviteError } = await supabase
          .from('invitations')
          .select('id, invited_email, role, status, created_at')
          .eq('company_id', company.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (inviteError) {
          console.error('Error fetching invitations:', inviteError);
        } else {
          setInvitations((inviteData || []) as Invitation[]);
        }
      }
    } catch (error) {
      console.error('Error fetching team data:', error);
    } finally {
      setLoading(false);
    }
  }, [company, isAdmin]);

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  /**
   * Send an invitation to a new user.
   * Creates a row in the invitations table with status = 'pending'.
   * The invited_email is stored lowercase and trimmed.
   */
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company || !user || !inviteEmail.trim()) return;

    const normalizedEmail = inviteEmail.toLowerCase().trim();

    // Validation: don't invite yourself
    if (normalizedEmail === user.email?.toLowerCase()) {
      showToast("You can't invite yourself", 'error');
      return;
    }

    // Validation: don't invite someone who's already a member
    const existingMember = members.find(
      (m) => m.email.toLowerCase() === normalizedEmail
    );
    if (existingMember) {
      showToast('This person is already a member of this workspace', 'error');
      return;
    }

    // Validation: don't create duplicate pending invitations
    const existingInvite = invitations.find(
      (inv) => inv.invited_email.toLowerCase() === normalizedEmail
    );
    if (existingInvite) {
      showToast('An invitation has already been sent to this email', 'error');
      return;
    }

    setInviting(true);
    try {
      const { error } = await supabase.from('invitations').insert({
        company_id: company.id,
        invited_email: normalizedEmail,
        role: inviteRole,
        invited_by: user.id,
      });

      if (error) {
        console.error('Error creating invitation:', error);
        if (error.code === '23505') {
          showToast('An invitation already exists for this email', 'error');
        } else {
          showToast('Failed to send invitation', 'error');
        }
        return;
      }

      showToast(`Invitation sent to ${normalizedEmail}`, 'success');
      setInviteEmail('');
      setInviteRole('viewer');
      fetchTeamData(); // Refresh the list
    } catch (error) {
      console.error('Unexpected error sending invitation:', error);
      showToast('Failed to send invitation', 'error');
    } finally {
      setInviting(false);
    }
  };

  /**
   * Change a member's role between 'admin' and 'viewer'.
   * Cannot change your own role (safety: prevents last admin from demoting themselves).
   */
  const handleChangeRole = async (member: Member) => {
    if (!company) return;

    // Safety: don't let the last admin demote themselves
    if (member.user_id === user?.id) {
      const adminCount = members.filter((m) => m.role === 'admin').length;
      if (adminCount <= 1 && member.role === 'admin') {
        showToast("Can't change role — you're the only admin", 'error');
        return;
      }
    }

    const newRole = member.role === 'admin' ? 'viewer' : 'admin';
    setChangingRole(member.membership_id);

    try {
      const { error } = await supabase
        .from('company_memberships')
        .update({ role: newRole })
        .eq('id', member.membership_id);

      if (error) {
        console.error('Error changing role:', error);
        showToast('Failed to change role', 'error');
        return;
      }

      showToast(`${member.display_name} is now ${newRole === 'admin' ? 'an Admin' : 'a Viewer'}`, 'success');
      fetchTeamData();
    } catch (error) {
      console.error('Unexpected error changing role:', error);
      showToast('Failed to change role', 'error');
    } finally {
      setChangingRole(null);
    }
  };

  /**
   * Remove a member from the company (delete their company_memberships row).
   * Cannot remove yourself.
   */
  const handleRemoveMember = async (member: Member) => {
    if (member.user_id === user?.id) {
      showToast("You can't remove yourself from the workspace", 'error');
      return;
    }

    if (!confirm(`Remove ${member.display_name} (${member.email}) from this workspace?`)) {
      return;
    }

    setRemoving(member.membership_id);

    try {
      const { error } = await supabase
        .from('company_memberships')
        .delete()
        .eq('id', member.membership_id);

      if (error) {
        console.error('Error removing member:', error);
        showToast('Failed to remove member', 'error');
        return;
      }

      showToast(`${member.display_name} has been removed`, 'success');
      fetchTeamData();
    } catch (error) {
      console.error('Unexpected error removing member:', error);
      showToast('Failed to remove member', 'error');
    } finally {
      setRemoving(null);
    }
  };

  /**
   * Revoke a pending invitation (sets status to 'revoked').
   */
  const handleRevokeInvitation = async (invitation: Invitation) => {
    setRevoking(invitation.id);

    try {
      const { error } = await supabase
        .from('invitations')
        .update({ status: 'revoked' })
        .eq('id', invitation.id);

      if (error) {
        console.error('Error revoking invitation:', error);
        showToast('Failed to revoke invitation', 'error');
        return;
      }

      showToast(`Invitation to ${invitation.invited_email} revoked`, 'success');
      fetchTeamData();
    } catch (error) {
      console.error('Unexpected error revoking invitation:', error);
      showToast('Failed to revoke invitation', 'error');
    } finally {
      setRevoking(null);
    }
  };

  /**
   * Rename the current workspace.
   * Updates the companies.name column and refreshes the company context.
   */
  const handleRenameWorkspace = async () => {
    if (!company || !newWorkspaceName.trim()) return;

    try {
      const { error } = await supabase
        .from('companies')
        .update({ name: newWorkspaceName.trim() })
        .eq('id', company.id);

      if (error) {
        console.error('Error renaming workspace:', error);
        showToast('Failed to rename workspace', 'error');
        return;
      }

      showToast('Workspace renamed', 'success');
      setIsRenaming(false);
      setNewWorkspaceName('');
      // Refresh company data so Navbar and Dashboard pick up the new name
      refetchCompany();
    } catch (error) {
      console.error('Unexpected error renaming workspace:', error);
      showToast('Failed to rename workspace', 'error');
    }
  };

  /**
   * Format a date string for display.
   */
  const formatDate = (dateStr: string): string => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <Loader2 className="w-10 h-10 text-[#2E86C1] animate-spin" />
        </div>
      </div>
    );
  }

  // ---- No company selected ----
  if (!company) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <p className="text-gray-600">No workspace selected.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page header with rename */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Team</h1>
          <div className="flex items-center gap-2">
            {isRenaming ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder={company.name}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameWorkspace();
                    if (e.key === 'Escape') { setIsRenaming(false); setNewWorkspaceName(''); }
                  }}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2E86C1] focus:border-transparent outline-none text-sm"
                />
                <button
                  onClick={handleRenameWorkspace}
                  disabled={!newWorkspaceName.trim()}
                  className="px-3 py-1.5 bg-[#2E86C1] text-white text-sm rounded-lg hover:bg-[#1B4F72] disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => { setIsRenaming(false); setNewWorkspaceName(''); }}
                  className="px-3 py-1.5 text-gray-600 text-sm hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <p className="text-gray-600">
                Manage members and invitations for{' '}
                <span className="font-medium text-gray-800">{company.name}</span>
                {isAdmin && (
                  <button
                    onClick={() => { setIsRenaming(true); setNewWorkspaceName(company.name); }}
                    className="ml-2 text-xs text-[#2E86C1] hover:text-[#1B4F72] font-medium"
                  >
                    Rename
                  </button>
                )}
              </p>
            )}
          </div>
        </div>

        {/* ---- Invite Form (admin only) ---- */}
        {isAdmin && (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-[#2E86C1]" />
              Invite a Team Member
            </h2>
            <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  required
                  disabled={inviting}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2E86C1] focus:border-transparent outline-none transition-all disabled:opacity-50"
                />
              </div>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'admin' | 'viewer')}
                disabled={inviting}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2E86C1] focus:border-transparent outline-none bg-white disabled:opacity-50"
              >
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="submit"
                disabled={inviting || !inviteEmail.trim()}
                className="flex items-center justify-center gap-2 px-6 py-2 bg-[#2E86C1] text-white rounded-lg hover:bg-[#1B4F72] transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {inviting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4" />
                )}
                Send Invite
              </button>
            </form>
            <p className="text-xs text-gray-500 mt-2">
              The invited person will automatically join this workspace when they sign up
              with this email address.
            </p>
          </div>
        )}

        {/* ---- Pending Invitations (admin only) ---- */}
        {isAdmin && invitations.length > 0 && (
          <div className="bg-white rounded-lg shadow border border-gray-200 mb-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" />
                Pending Invitations
                <span className="text-sm font-normal text-gray-500">
                  ({invitations.length})
                </span>
              </h2>
            </div>
            <div className="divide-y divide-gray-100">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="px-6 py-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                      <Mail className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {inv.invited_email}
                      </p>
                      <p className="text-xs text-gray-500">
                        Invited as {inv.role} · {formatDate(inv.created_at)}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevokeInvitation(inv)}
                    disabled={revoking === inv.id}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    title="Revoke invitation"
                  >
                    {revoking === inv.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- Members List ---- */}
        <div className="bg-white rounded-lg shadow border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Users className="w-5 h-5 text-[#1B4F72]" />
              Members
              <span className="text-sm font-normal text-gray-500">
                ({members.length})
              </span>
            </h2>
          </div>
          <div className="divide-y divide-gray-100">
            {members.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-500">
                No members found.
              </div>
            ) : (
              members.map((member) => {
                const isCurrentUser = member.user_id === user?.id;
                const isOnlyAdmin =
                  member.role === 'admin' &&
                  members.filter((m) => m.role === 'admin').length <= 1;

                return (
                  <div
                    key={member.membership_id}
                    className="px-6 py-4 flex items-center justify-between"
                  >
                    {/* Member info */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#2E86C1] flex items-center justify-center text-white font-medium">
                        {member.display_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900">
                            {member.display_name}
                          </p>
                          {isCurrentUser && (
                            <span className="text-xs text-gray-400">(you)</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">{member.email}</p>
                      </div>
                    </div>

                    {/* Role badge + actions */}
                    <div className="flex items-center gap-3">
                      {/* Role badge */}
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
                          member.role === 'admin'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {member.role === 'admin' ? (
                          <Shield className="w-3 h-3" />
                        ) : (
                          <Eye className="w-3 h-3" />
                        )}
                        {member.role === 'admin' ? 'Admin' : 'Viewer'}
                      </span>

                      {/* Admin actions */}
                      {isAdmin && !isCurrentUser && (
                        <div className="flex items-center gap-1">
                          {/* Change role button */}
                          <button
                            onClick={() => handleChangeRole(member)}
                            disabled={changingRole === member.membership_id}
                            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
                            title={`Make ${member.role === 'admin' ? 'Viewer' : 'Admin'}`}
                          >
                            {changingRole === member.membership_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : member.role === 'admin' ? (
                              'Make Viewer'
                            ) : (
                              'Make Admin'
                            )}
                          </button>

                          {/* Remove button */}
                          <button
                            onClick={() => handleRemoveMember(member)}
                            disabled={removing === member.membership_id}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Remove from workspace"
                          >
                            {removing === member.membership_id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      )}

                      {/* Show warning if this is the only admin */}
                      {isAdmin && isCurrentUser && isOnlyAdmin && (
                        <span
                          className="text-amber-500"
                          title="You're the only admin. Add another admin before changing your role."
                        >
                          <AlertTriangle className="w-4 h-4" />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
