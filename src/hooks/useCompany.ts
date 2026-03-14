import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface Company {
  id: string;
  name: string;
  slug: string;
  plan_type: string;
  is_personal: boolean;
}

export function useCompany() {
  const { user } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setCompany(null);
      setLoading(false);
      return;
    }

    const fetchCompany = async () => {
      try {
        const { data: membership } = await supabase
          .from('company_memberships')
          .select('company_id, companies(*)')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (membership && membership.companies) {
          setCompany(membership.companies as unknown as Company);
        }
      } catch (error) {
        console.error('Error fetching company:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCompany();
  }, [user]);

  return { company, loading };
}
