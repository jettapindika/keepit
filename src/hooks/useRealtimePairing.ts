import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  ensureCrossDeviceShareableUri,
  readLocalMoments,
  todayLocalDateString,
} from '@/api/moments';
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
  createFreshRealtimeChannel,
  emitDirectoryInviteAnnounce,
  emitDirectoryUserAnnounce,
  registerActiveCoupleChannel,
  registerActiveDirectoryChannel,
  syncDirectoryPresence,
} from '@/api/realtimeSync';
import { fetchFriendsCircle, matchesUserByQuery } from '@/api/social';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { useSessionStore } from '@/store/sessionStore';
import { safeGetStorageItem } from '@/utils/safeAsyncStorage';
import {
  DirectMessageRecord,
  LocationShareRecord,
  StatusRecord,
  UserProfile,
} from '@/types/database';
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
    if (!userId || !isSupabaseConfigured || !client) return;

    const directoryChannel = createFreshRealtimeChannel(client, buildUserDirectoryChannelTopic(), {
      config: {
        broadcast: { ack: true, self: false },
        presence: { key: userId },
      },
    });

    const syncDirectoryPresenceToLocalDb = async () => {
      const state = directoryChannel.presenceState();
      for (const [, entries] of Object.entries(state)) {
        for (const rawEntry of entries as unknown[]) {
          if (rawEntry && typeof rawEntry === 'object' && 'profile' in rawEntry) {
            const candidate = rawEntry.profile as UserProfile | undefined;
            if (candidate?.id) {
              if (candidate.id !== userId) {
                await applyIncomingCouplePacket({ kind: 'profile_upsert', profile: candidate });
                emitDirectoryUserAnnounce(candidate);
              }
            }
            if (
              'couple' in rawEntry &&
              rawEntry.couple &&
              typeof rawEntry.couple === 'object'
            ) {
              const candCouple = rawEntry.couple as {
                id: string;
                user_a_id: string;
                user_b_id: string | null;
                invite_code: string;
                invite_expires_at: string;
                state: 'pending' | 'active';
                paired_at: string | null;
                created_at: string;
              };
              if (
                candCouple.state === 'active' &&
                (candCouple.user_a_id === userId || candCouple.user_b_id === userId)
              ) {
                const currentSelf = useSessionStore.getState().user;
                const partnerId =
                  candCouple.user_a_id === userId ? candCouple.user_b_id : candCouple.user_a_id;
                let resolvedPartner: UserProfile | null =
                  candidate && candidate.id === partnerId
                    ? candidate
                    : useSessionStore.getState().partner;
                if (!resolvedPartner && partnerId) {
                  const snap = await fetchPairingSnapshot(userId);
                  resolvedPartner = snap.partner;
                }
                if (resolvedPartner) {
                  await saveCompletedPairingLocally({
                    couple: candCouple,
                    partner: resolvedPartner,
                    selfProfile: currentSelf,
                  });
                }
                setPairing(candCouple, resolvedPartner);
              }
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
        if (!payload?.query || payload.requesterId === userId) return;
        const currentUser = useSessionStore.getState().user;
        if (currentUser && matchesUserByQuery(currentUser, payload.query)) {
          void directoryChannel
            .send({
              type: 'broadcast',
              event: 'UserAnnounce',
              payload: { profile: currentUser },
            })
            .catch(() => {});
        }
      })
      .on('broadcast', { event: 'UserAnnounce' }, (msg) => {
        const payload = msg.payload as { profile?: UserProfile } | undefined;
        const candidate = payload?.profile;
        if (candidate?.id && candidate.id !== userId) {
          void applyIncomingCouplePacket({ kind: 'profile_upsert', profile: candidate });
          emitDirectoryUserAnnounce(candidate);
        }
      })
      .on('broadcast', { event: 'WhoHasInvite' }, (msg) => {
        const payload = msg.payload as { code?: string; joiner?: UserProfile } | undefined;
        if (!payload?.code) return;
        const requestedCode = normalizeInviteCode(payload.code);
        const currentUser = useSessionStore.getState().user;
        if (!currentUser) return;
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
      .on('broadcast', { event: 'invite_host_announce' }, (msg) => {
        const payload = msg.payload as RealtimeInvitePresence | undefined;
        if (payload?.couple && payload?.hostProfile) {
          emitDirectoryInviteAnnounce(payload);
        }
      })
      .on('broadcast', { event: 'invite_redeemed' }, (msg) => {
        const payload = msg.payload as RealtimeRedeemPayload | undefined;
        if (!payload?.couple || !payload?.joinerProfile) return;
        const currentUser = useSessionStore.getState().user;
        if (!currentUser || payload.couple.user_a_id !== currentUser.id) return;
        void saveCompletedPairingLocally({
          couple: payload.couple,
          partner: payload.joinerProfile,
          selfProfile: currentUser,
        }).then(() => {
          setPairing(payload.couple, payload.joinerProfile);
          void syncDirectoryPresence({ profile: currentUser, couple: payload.couple });
          void queryClient.invalidateQueries({ queryKey: ['today-moment'] });
          void queryClient.invalidateQueries({ queryKey: ['couple-statuses'] });
          void queryClient.invalidateQueries({ queryKey: ['couple-locations'] });
        });
      })
      .on('broadcast', { event: 'RequestRecentMoments' }, (msg) => {
        const payload = msg.payload as { requesterId?: string } | undefined;
        const currentUser = useSessionStore.getState().user;
        if (!currentUser) return;
        void (async () => {
          const [state, friends] = await Promise.all([
            readLocalMoments(),
            fetchFriendsCircle({ userId: currentUser.id }),
          ]);
          const requesterIsFriend =
            Boolean(payload?.requesterId) &&
            friends.some((f) => f.friend_id === payload?.requesterId);
          const today = todayLocalDateString();
          const isSameUserRequest = payload?.requesterId === currentUser.id;
          const myTodayMoments = Object.values(state.moments).filter(
            (m) =>
              m?.id &&
              m.user_id === currentUser.id &&
              (isSameUserRequest || m.visibility !== 'partner') &&
              (isSameUserRequest ||
                m.posted_at?.startsWith(today) ||
                m.captured_at?.startsWith(today)) &&
              (isSameUserRequest ||
                !currentUser.is_private ||
                friends.some((f) => f.friend_id === payload?.requesterId && f.relationship === 'bestie') ||
                !requesterIsFriend)
          );
          const seen = new Set<string>();
          for (const m of myTodayMoments) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            const [portableBack, portableFront] = await Promise.all([
              ensureCrossDeviceShareableUri(m.back_photo_url || m.back_photo_path),
              ensureCrossDeviceShareableUri(m.front_photo_url || m.front_photo_path),
            ]);
            const shareable: typeof m = {
              ...m,
              back_photo_path: portableBack,
              front_photo_path: portableFront,
              back_photo_url: portableBack,
              front_photo_url: portableFront,
            };
            await directoryChannel
              .send({
                type: 'broadcast',
                event: 'couple_packet',
                payload: { kind: 'moment_upsert', moment: shareable } satisfies CoupleSyncPacket,
              })
              .catch(() => {});
          }
          if (isSameUserRequest) {
            for (const f of friends) {
              await directoryChannel
                .send({
                  type: 'broadcast',
                  event: 'couple_packet',
                  payload: { kind: 'friend_added', friend: f } satisfies CoupleSyncPacket,
                })
                .catch(() => {});
            }
            await directoryChannel
              .send({
                type: 'broadcast',
                event: 'couple_packet',
                payload: { kind: 'profile_upsert', profile: currentUser } satisfies CoupleSyncPacket,
              })
              .catch(() => {});
          }
          if (payload?.requesterId) {
            const rawMsgs = await safeGetStorageItem('keepit.local_messages.v1');
            if (rawMsgs) {
              try {
                const allMsgs = JSON.parse(rawMsgs) as DirectMessageRecord[];
                const myDmsToRequester = allMsgs.filter(
                  (dm) =>
                    dm?.id &&
                    dm.sender_id === currentUser.id &&
                    dm.recipient_id === payload.requesterId
                );
                for (const dm of myDmsToRequester.slice(-15)) {
                  await directoryChannel
                    .send({
                      type: 'broadcast',
                      event: 'couple_packet',
                      payload: { kind: 'dm_upsert', message: dm } satisfies CoupleSyncPacket,
                    })
                    .catch(() => {});
                }
              } catch {
                // Ignore malformed local messages
              }
            }
          }
        })();
      })
      .on('broadcast', { event: 'couple_packet' }, (msg) => {
        const packet = msg.payload as CoupleSyncPacket | undefined;
        if (!packet) return;
        void applyIncomingCouplePacket(packet).then(() => {
          if (packet.kind === 'friend_added' || packet.kind === 'friend_removed') {
            void queryClient.invalidateQueries({ queryKey: ['friends-list'] });
            void queryClient.invalidateQueries({ queryKey: ['today-moment'] });
          } else if (packet.kind === 'profile_upsert') {
            if (packet.profile.id === userId) {
              const cur = useSessionStore.getState().user;
              if (!cur) {
                useSessionStore.setState({ user: packet.profile });
              }
            } else {
              emitDirectoryUserAnnounce(packet.profile);
            }
          } else if (
            packet.kind === 'moment_upsert' ||
            packet.kind === 'moment_delete' ||
            packet.kind === 'moment_comment' ||
            packet.kind === 'moment_comment_delete' ||
            packet.kind === 'moment_reaction' ||
            packet.kind === 'moment_snap_viewed'
          ) {
            void queryClient.invalidateQueries({ queryKey: ['today-moment'] });
            void queryClient.invalidateQueries({ queryKey: ['month-memories'] });
            void queryClient.invalidateQueries({ queryKey: ['user-posts'] });
          } else if (
            packet.kind === 'dm_upsert' ||
            packet.kind === 'dm_reaction' ||
            packet.kind === 'dm_snap_viewed'
          ) {
            void queryClient.invalidateQueries({ queryKey: ['direct-messages'] });
          }
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          registerActiveDirectoryChannel(directoryChannel);
          const currentUser = useSessionStore.getState().user;
          if (currentUser) {
            void fetchPairingSnapshot(currentUser.id).then((snap) => {
              void syncDirectoryPresence({
                profile: currentUser,
                couple: snap.couple,
              });
            });
            void directoryChannel
              .send({
                type: 'broadcast',
                event: 'RequestRecentMoments',
                payload: { requesterId: currentUser.id },
              })
              .catch(() => {});
          }
        }
      });
    return () => {
      registerActiveDirectoryChannel(null);
      void client.removeChannel(directoryChannel);
    };
  }, [userId, setPairing, queryClient]);

  // Cross-device Realtime Broadcast + Presence sync channel for active couples
  useEffect(() => {
    const client = supabase;
    if (!user || !coupleId || coupleState !== 'active' || !isSupabaseConfigured || !client) {
      return;
    }

    const syncChannel = createFreshRealtimeChannel(client, buildCoupleSyncChannelTopic(coupleId), {
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
      .on('broadcast', { event: 'RequestCoupleMoments' }, (msg) => {
        const payload = msg.payload as { requesterId?: string } | undefined;
        const currentUser = useSessionStore.getState().user;
        if (!currentUser || payload?.requesterId === currentUser.id) return;
        void (async () => {
          const state = await readLocalMoments();
          const myCoupleMoments = Object.values(state.moments).filter(
            (m) => m?.id && m.couple_id === coupleId && m.user_id === currentUser.id
          );
          const seen = new Set<string>();
          for (const m of myCoupleMoments.slice(0, 10)) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            const [portableBack, portableFront] = await Promise.all([
              ensureCrossDeviceShareableUri(m.back_photo_url || m.back_photo_path),
              ensureCrossDeviceShareableUri(m.front_photo_url || m.front_photo_path),
            ]);
            const shareable: typeof m = {
              ...m,
              back_photo_path: portableBack,
              front_photo_path: portableFront,
              back_photo_url: portableBack,
              front_photo_url: portableFront,
            };
            await syncChannel
              .send({
                type: 'broadcast',
                event: 'couple_packet',
                payload: { kind: 'moment_upsert', moment: shareable } satisfies CoupleSyncPacket,
              })
              .catch(() => {});
          }
          const [rawStatuses, rawLocations, rawMsgs] = await Promise.all([
            safeGetStorageItem('keepit.local_statuses.v1'),
            safeGetStorageItem('keepit.local_locations.v1'),
            safeGetStorageItem('keepit.local_messages.v1'),
          ]);
          if (rawStatuses) {
            try {
              const statusMap = JSON.parse(rawStatuses) as Record<string, StatusRecord>;
              const myStatus = statusMap[currentUser.id];
              if (myStatus && new Date(myStatus.expires_at).getTime() > Date.now()) {
                await syncChannel
                  .send({
                    type: 'broadcast',
                    event: 'couple_packet',
                    payload: { kind: 'status_upsert', status: myStatus } satisfies CoupleSyncPacket,
                  })
                  .catch(() => {});
              }
            } catch {
              // Ignore malformed status cache
            }
          }
          if (rawLocations) {
            try {
              const locMap = JSON.parse(rawLocations) as Record<string, LocationShareRecord>;
              const myLoc = locMap[`${coupleId}:${currentUser.id}`];
              if (myLoc) {
                await syncChannel
                  .send({
                    type: 'broadcast',
                    event: 'couple_packet',
                    payload: { kind: 'location_upsert', location: myLoc } satisfies CoupleSyncPacket,
                  })
                  .catch(() => {});
              }
            } catch {
              // Ignore malformed location cache
            }
          }
          if (rawMsgs) {
            try {
              const allMsgs = JSON.parse(rawMsgs) as DirectMessageRecord[];
              const myDms = allMsgs.filter((dm) => dm?.id && dm.sender_id === currentUser.id);
              for (const dm of myDms.slice(-15)) {
                await syncChannel
                  .send({
                    type: 'broadcast',
                    event: 'couple_packet',
                    payload: { kind: 'dm_upsert', message: dm } satisfies CoupleSyncPacket,
                  })
                  .catch(() => {});
              }
            } catch {
              // Ignore malformed messages cache
            }
          }
        })();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          registerActiveCoupleChannel(coupleId, syncChannel);
          void syncChannel.track({ profile: user }).catch(() => {});
          void syncChannel
            .send({
              type: 'broadcast',
              event: 'RequestCoupleMoments',
              payload: { requesterId: user.id },
            })
            .catch(() => {});
        }
      });

    return () => {
      registerActiveCoupleChannel(null, null);
      void client.removeChannel(syncChannel);
    };
  }, [user, couple, coupleId, coupleState, partner, setPairing, queryClient]);
}
