import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  fetchPairingSnapshot,
  normalizeInviteCode,
  RealtimeInvitePresence,
  RealtimeRedeemPayload,
  saveCompletedPairingLocally,
} from '@/api/pairing';
import {
  applyIncomingCouplePacket,
  buildCoupleSyncChannelTopic,
  buildUserDirectoryChannelTopic,
  CoupleSyncPacket,
  registerActiveCoupleChannel,
  registerActiveDirectoryChannel,
} from '@/api/realtimeSync';
import { matchesUserByQuery } from '@/api/social';
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

  // Cross-device User Directory & Pending Invite responder channel
  useEffect(() => {
    const client = supabase;
    if (!user || !isSupabaseConfigured || !client) return;

    const directoryChannel = client.channel(buildUserDirectoryChannelTopic(), {
      config: {
        broadcast: { ack: true, self: false },
        presence: { key: user.id },
      },
    });

    const syncDirectoryPresenceToLocalDb = async () => {
      const state = directoryChannel.presenceState();
      for (const [key, entries] of Object.entries(state)) {
        if (key === user.id) continue;
        for (const rawEntry of entries as unknown[]) {
          if (rawEntry && typeof rawEntry === 'object' && 'profile' in rawEntry) {
            const candidate = rawEntry.profile as UserProfile | undefined;
            if (candidate?.id && candidate.id !== user.id) {
              await applyIncomingCouplePacket({ kind: 'profile_upsert', profile: candidate });
            }
          }
        }
      }
    };

    directoryChannel
      .on('presence', { event: 'sync' }, () => {
        void syncDirectoryPresenceToLocalDb();
      })
      .on('broadcast', { event: 'WhoIsUser' }, (msg) => {
        const payload = msg.payload as { query?: string; requesterId?: string } | undefined;
        if (!payload?.query || payload.requesterId === user.id) return;
        const currentUser = useSessionStore.getState().user ?? user;
        if (matchesUserByQuery(currentUser, payload.query)) {
          void directoryChannel
            .send({
              type: 'broadcast',
              event: 'UserAnnounce',
              payload: { profile: currentUser },
            })
            .catch(() => {});
        }
      })
      .on('broadcast', { event: 'WhoHasInvite' }, (msg) => {
        const payload = msg.payload as { code?: string; joiner?: UserProfile } | undefined;
        if (!payload?.code) return;
        const requestedCode = normalizeInviteCode(payload.code);
        const currentUser = useSessionStore.getState().user ?? user;
        void fetchPairingSnapshot(currentUser.id).then((snap) => {
          if (
            snap.couple &&
            snap.couple.state === 'pending' &&
            snap.couple.user_a_id === currentUser.id &&
            normalizeInviteCode(snap.couple.invite_code) === requestedCode &&
            new Date(snap.couple.invite_expires_at).getTime() > Date.now()
          ) {
            const announcePayload: RealtimeInvitePresence = {
              couple: snap.couple,
              hostProfile: currentUser,
            };
            void directoryChannel
              .send({
                type: 'broadcast',
                event: 'invite_host_announce',
                payload: announcePayload,
              })
              .catch(() => {});
          }
        });
      })
      .on('broadcast', { event: 'invite_redeemed' }, (msg) => {
        const payload = msg.payload as RealtimeRedeemPayload | undefined;
        if (!payload?.couple || !payload?.joinerProfile) return;
        const currentUser = useSessionStore.getState().user ?? user;
        if (payload.couple.user_a_id !== currentUser.id) return;
        void saveCompletedPairingLocally({
          couple: payload.couple,
          partner: payload.joinerProfile,
          selfProfile: currentUser,
        }).then(() => {
          setPairing(payload.couple, payload.joinerProfile);
          void queryClient.invalidateQueries({ queryKey: ['today-moment'] });
          void queryClient.invalidateQueries({ queryKey: ['couple-statuses'] });
          void queryClient.invalidateQueries({ queryKey: ['couple-locations'] });
        });
      })
      .on('broadcast', { event: 'couple_packet' }, (msg) => {
        const packet = msg.payload as CoupleSyncPacket | undefined;
        if (!packet) return;
        void applyIncomingCouplePacket(packet).then(() => {
          if (packet.kind === 'friend_added') {
            void queryClient.invalidateQueries({ queryKey: ['friends-list'] });
            void queryClient.invalidateQueries({ queryKey: ['today-moment'] });
          }
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          registerActiveDirectoryChannel(directoryChannel);
          void fetchPairingSnapshot(user.id).then((snap) => {
            void directoryChannel
              .track({
                profile: user,
                couple:
                  snap.couple && snap.couple.state === 'pending' ? snap.couple : undefined,
              })
              .catch(() => {});
          });
        }
      });

    return () => {
      registerActiveDirectoryChannel(null);
      void client.removeChannel(directoryChannel);
    };
  }, [user, setPairing, queryClient]);

  // Cross-device Realtime Broadcast + Presence sync channel for active couples
  useEffect(() => {
    const client = supabase;
    if (!user || !coupleId || coupleState !== 'active' || !isSupabaseConfigured || !client) {
      return;
    }

    const syncChannel = client.channel(buildCoupleSyncChannelTopic(coupleId), {
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
              const peerProfile = rawEntry.profile as UserProfile | undefined;
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
