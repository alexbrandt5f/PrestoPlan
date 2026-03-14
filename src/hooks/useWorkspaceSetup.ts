import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

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
        console.log('Checking for existing membership...');
        const { data: existingMembership, error: membershipCheckError } = await supabase
          .from('company_memberships')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (membershipCheckError) {
          console.error('Error checking membership:', membershipCheckError);
        }

        if (existingMembership) {
          console.log('User already has a workspace');
          setIsReady(true);
          setIsSettingUp(false);
          return;
        }

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
            console.error('Error creating user:', userError);
            setIsSettingUp(false);
            return;
          }
          console.log('User record created successfully');
        }

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
          console.error('Error creating company:', companyError);
          setIsSettingUp(false);
          return;
        }
        console.log('Company created successfully:', companyId);

        console.log('Creating company membership...');
        const { error: membershipError } = await supabase
          .from('company_memberships')
          .insert({
            user_id: user.id,
            company_id: companyId,
            is_active: true,
          });

        if (membershipError) {
          console.error('Error creating membership:', membershipError);
          setIsSettingUp(false);
          return;
        }
        console.log('Company membership created successfully');

        console.log('Querying company...');
        const { data: newCompany, error: companyQueryError } = await supabase
          .from('companies')
          .select()
          .eq('id', companyId)
          .single();

        if (companyQueryError || !newCompany) {
          console.error('Error querying company:', companyQueryError);
        }

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
