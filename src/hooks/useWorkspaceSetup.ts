/**
 * useWorkspaceSetup.ts
 *
 * Runs on every authenticated page load (via Dashboard).
 * Ensures the current user has:
 *   1. A row in the `users` table
 *   2. A personal workspace (company + membership)
 *   3. Memberships for any pending invitations matching their email
 *
 * FLOW:
 *   - If user already has any company_memberships → skip workspace creation
 *   - But ALWAYS check for new pending invitations (even for existing users)
 *   - If no memberships exist:
 *       a) Create `users` row (if missing)
 *       b) Create personal `companies` row (is_personal = true)
 *       c) Create `company_memberships` row (role = 'admin' for personal workspace)
 *       d) Check `invitations` table for pending invites matching user's email
 *       e) For each pending invite: create a membership and mark invite as 'accepted'
 *
 * IMPORTANT: The membership INSERT for the personal workspace uses role = 'admin'
 * explicitly, because the DB (database) default is 'viewer' (for invited users).
 * The workspace creator must always be an admin of their own workspace.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

/** Shape of a pending invitation row from the invitations table */
interface PendingInvitation {
  id: string;
  company_id: string;
  role: string;
  status: string;
}

export function useWorkspaceSetup() {
  const { user } = useAuth();
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsReady(false);
      return;
    }

    const setupWorkspace = async () => {
      setIsSettingUp(true);

      try {
        // ----------------------------------------------------------------
        // Step 1: Check if user already has any company memberships.
        // If yes, they've already been through initial setup — skip
        // workspace creation but still check for new invitations.
        // ----------------------------------------------------------------
        console.log('Checking for existing membership...');
        const { data: existingMembership, error: membershipCheckError } = await supabase
          .from('company_memberships')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        if (membershipCheckError) {
          console.error('Error checking membership:', membershipCheckError);
          // Don't return — fall through to try creating workspace.
          // This handles the case where the error is transient.
        }

        if (existingMembership) {
          console.log('User already has a workspace');

          // Even if they have a workspace, check for any NEW pending invitations
          // that arrived since their last login. This handles the case where an
          // existing user gets invited to another company.
          await acceptPendingInvitations(user.id, user.email || '');

          setIsReady(true);
          setIsSettingUp(false);
          return;
        }

        // ----------------------------------------------------------------
        // Step 2: Create user record in public.users (if missing).
        // This extends the Supabase auth.users row with app-specific fields.
        // ----------------------------------------------------------------
        console.log('No workspace found, creating...');
        console.log('Checking for existing user record...');
        const { data: existingUser, error: userCheckError } = await supabase
          .from('users')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();

        if (userCheckError) {
          console.error('Error checking user:', userCheckError);
        }

        if (!existingUser) {
          console.log('Creating user record...');
          const { error: userError } = await supabase
            .from('users')
            .insert({
              id: user.id,
              email: user.email || '',
              display_name: user.email?.split('@')[0] || 'User',
            });

          if (userError) {
            // 23505 = unique constraint violation — user row already exists
            // (race condition from React strict mode double-mount). Safe to ignore.
            if (userError.code === '23505') {
              console.log('User record already exists (race condition), continuing...');
            } else {
              console.error('Error creating user:', userError);
              setIsSettingUp(false);
              return;
            }
          } else {
            console.log('User record created successfully');
          }
        }

        // ----------------------------------------------------------------
        // Step 3: Create personal workspace (company + membership).
        // The personal workspace is the user's default "home" company.
        // is_personal = true distinguishes it from invited company workspaces.
        // ----------------------------------------------------------------
        const slug = (user.email || 'user')
          .split('@')[0]
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

        const companyId = crypto.randomUUID();
        console.log('Creating company with slug:', slug, 'and ID:', companyId);

        const { error: companyError } = await supabase
          .from('companies')
          .insert({
            id: companyId,
            name: user.email || 'My Workspace',
            slug: slug,
            plan_type: 'free',
            is_personal: true,
          });

        if (companyError) {
          // 23505 = slug collision or duplicate. Rare but possible.
          if (companyError.code === '23505') {
            console.log('Company already exists (race condition), continuing...');
          } else {
            console.error('Error creating company:', companyError);
            setIsSettingUp(false);
            return;
          }
        } else {
          console.log('Company created successfully:', companyId);
        }

        // Create membership — explicitly set role = 'admin' because the
        // DB default is 'viewer' (designed for invited users).
        console.log('Creating company membership...');
        const { error: membershipError } = await supabase
          .from('company_memberships')
          .insert({
            user_id: user.id,
            company_id: companyId,
            is_active: true,
            role: 'admin', // Owner of personal workspace is always admin
          });

        if (membershipError) {
          if (membershipError.code === '23505') {
            console.log('Membership already exists (race condition), continuing...');
          } else {
            console.error('Error creating membership:', membershipError);
            setIsSettingUp(false);
            return;
          }
        } else {
          console.log('Company membership created successfully');
        }

        // ----------------------------------------------------------------
        // Step 4: Accept any pending invitations for this user's email.
        // This handles the case where an admin invited this email address
        // BEFORE the user signed up. The user automatically joins those
        // companies with the role specified in the invitation.
        // ----------------------------------------------------------------
        await acceptPendingInvitations(user.id, user.email || '');

        setIsReady(true);
      } catch (error) {
        console.error('Unexpected error during workspace setup:', error);
      } finally {
        setIsSettingUp(false);
      }
    };

    setupWorkspace();
  }, [user]);

  return { isSettingUp, isReady };
}

/**
 * Check the invitations table for any pending invitations matching the
 * user's email. For each one found:
 *   1. Create a company_memberships row with the invited role
 *   2. Mark the invitation as 'accepted'
 *
 * This runs both during first-time signup AND on subsequent logins,
 * so that invitations sent to an existing user are also picked up.
 *
 * Edge cases handled:
 *   - User already a member of the invited company → skip membership creation,
 *     still mark invite as accepted
 *   - One invitation fails → continue processing the others
 *   - No email available → skip silently
 *
 * @param userId - The auth.uid() of the current user
 * @param userEmail - The email of the current user
 */
async function acceptPendingInvitations(userId: string, userEmail: string): Promise<void> {
  if (!userEmail) {
    console.log('No email available, skipping invitation check');
    return;
  }

  try {
    const normalizedEmail = userEmail.toLowerCase().trim();
    console.log('Checking for pending invitations for:', normalizedEmail);

    // Fetch all pending invitations for this email
    const { data: pendingInvitations, error: inviteError } = await supabase
      .from('invitations')
      .select('id, company_id, role, status')
      .eq('invited_email', normalizedEmail)
      .eq('status', 'pending');

    if (inviteError) {
      console.error('Error checking invitations:', inviteError);
      return;
    }

    if (!pendingInvitations || pendingInvitations.length === 0) {
      console.log('No pending invitations found');
      return;
    }

    console.log(`Found ${pendingInvitations.length} pending invitation(s)`);

    // Process each invitation
    for (const invitation of pendingInvitations as PendingInvitation[]) {
      try {
        // Check if user is already a member of this company
        // (prevents duplicate memberships if this runs twice)
        const { data: existingMembership } = await supabase
          .from('company_memberships')
          .select('id')
          .eq('user_id', userId)
          .eq('company_id', invitation.company_id)
          .maybeSingle();

        if (existingMembership) {
          console.log(`Already a member of company ${invitation.company_id}, marking invite accepted`);
        } else {
          // Create the membership with the role from the invitation
          console.log(`Joining company ${invitation.company_id} as ${invitation.role}`);
          const { error: membershipError } = await supabase
            .from('company_memberships')
            .insert({
              user_id: userId,
              company_id: invitation.company_id,
              is_active: true,
              role: invitation.role,
            });

          if (membershipError) {
            console.error(`Error creating membership for company ${invitation.company_id}:`, membershipError);
            continue; // Skip this invitation but try the others
          }
          console.log(`Successfully joined company ${invitation.company_id}`);
        }

        // Mark the invitation as accepted
        const { error: updateError } = await supabase
          .from('invitations')
          .update({ status: 'accepted' })
          .eq('id', invitation.id);

        if (updateError) {
          console.error(`Error marking invitation ${invitation.id} as accepted:`, updateError);
        } else {
          console.log(`Invitation ${invitation.id} marked as accepted`);
        }
      } catch (inviteProcessError) {
        console.error(`Error processing invitation ${invitation.id}:`, inviteProcessError);
        // Continue with other invitations even if one fails
      }
    }
  } catch (error) {
    console.error('Unexpected error processing invitations:', error);
  }
}
