import { useEffect } from 'react';

import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { useSessionStore } from '@/store/sessionStore';

export function useRealtimePairing() {
  const userId = useSessionStore((s) => s.user?.id);
  const coupleState = useSessionStore((s) => s.couple?.state);
  const refreshPairing = useSessionStore((s) => s.refreshPairing);

  useEffect(() => {
    const client = supabase;
    if (!userId || !isSupabaseConfigured || !client) return;

    const channel = client
      .channel(`pairing:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'couples',
        },
        () => {
          void refreshPairing();
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [userId, coupleState, refreshPairing]);
}
