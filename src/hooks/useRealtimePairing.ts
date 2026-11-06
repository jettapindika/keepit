import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { saveCompletedPairingLocally } from '@/api/pairing';
import {
  applyIncomingCouplePacket,
  CoupleSyncPacket,
  registerActiveCoupleChannel,
} from '@/api/realtimeSync';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { useSessionStore } from '@/store/sessionStore';
import { UserProfile } from '@/types/database';

export function useRealtimePairing() {
  const queryClient = useQueryClient();
  const user = useSessionStore((s) => s.user);
  const couple = useSessionStore((s) => s.couple);
  const partner = useSessionStore((s) => s.partner);
  const refreshPairing = useSessionStore((s) => s.refreshPairing);
  const setPairing = useSessionStore((s) => s.setPairing);

  const userId = user?.id;
  const coupleId = couple?.id;
  const coupleState = couple?.state;

  useEffect(() => {
    const client = supabase;
    if (!userId || !isSupabaseConfigured || !client) return;

    const dbChannel = client
      .channel(`pairing:${userId}:${Date.now().toString(36)}`)
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
      void client.removeChannel(dbChannel);
    };
  }, [userId, coupleState, refreshPairing]);

  // Cross-device Realtime Broadcast + Presence sync channel for active couples
  useEffect(() => {
    const client = supabase;
    if (!user || !coupleId || coupleState !== 'active' || !isSupabaseConfigured || !client) {
      return;
    }

    const syncChannel = client.channel(`keepit:couple_sync:${coupleId}`, {
      config: {
        broadcast: { ack: false, self: false },
        presence: { key: user.id },
      },
    });

    syncChannel
      .on('presence', { event: 'sync' }, () => {
        const state = syncChannel.presenceState();
        for (const [key, entries] of Object.entries(state)) {
          if (key === user.id) continue;
          for (const rawEntry of entries as unknown[]) {
            if (rawEntry && typeof rawEntry === 'object' && 'profile' in rawEntry) {
              const peerProfile = (rawEntry as { profile: UserProfile }).profile;
              if (
                peerProfile?.id &&
                peerProfile.id !== user.id &&
                (!partner || partner.display_name === 'Partner' || partner.id !== peerProfile.id)
              ) {
                const updatedCouple = {
                  ...couple!,
                  user_b_id:
                    couple!.user_a_id === user.id ? peerProfile.id : couple!.user_b_id ?? user.id,
                };
                void saveCompletedPairingLocally({
                  couple: updatedCouple,
                  partner: peerProfile,
                  selfProfile: user,
                }).then(() => {
                  setPairing(updatedCouple, peerProfile);
                });
              }
            }
          }
        }
      })
      .on('broadcast', { event: 'couple_packet' }, (msg) => {
        const packet = msg.payload as CoupleSyncPacket | undefined;
        if (!packet) return;

        if (packet.kind === 'unpair') {
          setPairing(null, null);
          return;
        }

        if (packet.kind === 'profile_upsert' && packet.profile.id !== user.id) {
          if (couple) {
            setPairing(couple, packet.profile);
          }
        }

        void applyIncomingCouplePacket(packet).then(() => {
          void queryClient.invalidateQueries({ queryKey: ['today-moment', coupleId] });
          void queryClient.invalidateQueries({ queryKey: ['month-memories', coupleId] });
          void queryClient.invalidateQueries({ queryKey: ['couple-statuses', coupleId] });
          void queryClient.invalidateQueries({ queryKey: ['couple-locations', coupleId] });
          void queryClient.invalidateQueries({ queryKey: ['couple-nudges', coupleId] });
          void queryClient.invalidateQueries({ queryKey: ['direct-messages'] });
          void queryClient.invalidateQueries({ queryKey: ['friends-list'] });
          void queryClient.invalidateQueries({ queryKey: ['user-posts'] });
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          registerActiveCoupleChannel(coupleId, syncChannel);
          void syncChannel.track({ profile: user }).catch(() => {});
        }
      });

    return () => {
      registerActiveCoupleChannel(null, null);
      void client.removeChannel(syncChannel);
    };
  }, [user, couple, coupleId, coupleState, partner, setPairing, queryClient]);
}
