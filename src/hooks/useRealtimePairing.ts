import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  ensureCrossDeviceShareableUri,
  isSnapOnceExpiredForViewer,
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

    let active = true;
    const directoryChannel = createFreshRealtimeChannel(client, buildUserDirectoryChannelTopic(), {
      config: {
        broadcast: { ack: true, self: false },
        presence: { key: userId },
      },
    });

    const syncDirectoryPresenceToLocalDb = async () => {
      if (!active) return;
      const state = directoryChannel.presenceState();
      for (const [, entries] of Object.entries(state)) {
        for (const rawEntry of entries as unknown[]) {
          if (!active) return;
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
                if (!active || useSessionStore.getState().user?.id !== userId) return;
                if (resolvedPartner) {
                  await saveCompletedPairingLocally({
                    couple: candCouple,
                    partner: resolvedPartner,
                    selfProfile: currentSelf,
                  });
                }
                if (!active || useSessionStore.getState().user?.id !== userId) return;
                setPairing(candCouple, resolvedPartner);
              }
            }
          }
        }
      }
    };

    directoryChannel
      .on('presence', { event: 'sync' }, () => {
        void syncDirectoryPresenceToLocalDb().catch(() => {});
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
          void applyIncomingCouplePacket({ kind: 'profile_upsert', profile: candidate }).catch(() => {});
          emitDirectoryUserAnnounce(candidate);
        }
      })
      .on('broadcast', { event: 'WhoHasInvite' }, (msg) => {
        const payload = msg.payload as { code?: string; joiner?: UserProfile } | undefined;
        if (!payload?.code) return;
        const requestedCode = normalizeInviteCode(payload.code);
        const currentUser = useSessionStore.getState().user;
        if (!currentUser || currentUser.id !== userId) return;
        void fetchPairingSnapshot(currentUser.id)
          .then((snap) => {
            if (!active || useSessionStore.getState().user?.id !== userId) return;
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
          })
          .catch(() => {});
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
        if (!currentUser || currentUser.id !== userId || payload.couple.user_a_id !== currentUser.id) {
          return;
        }
        void saveCompletedPairingLocally({
          couple: payload.couple,
          partner: payload.joinerProfile,
          selfProfile: currentUser,
        })
          .then(() => {
            if (!active || useSessionStore.getState().user?.id !== userId) return;
            setPairing(payload.couple, payload.joinerProfile);
            void syncDirectoryPresence({ profile: currentUser, couple: payload.couple }).catch(() => {});
            void queryClient.invalidateQueries({ queryKey: ['today-moment'] });
            void queryClient.invalidateQueries({ queryKey: ['couple-statuses'] });
            void queryClient.invalidateQueries({ queryKey: ['couple-locations'] });
          })
          .catch(() => {});
      })
      .on('broadcast', { event: 'RequestRecentMoments' }, (msg) => {
        const payload = msg.payload as { requesterId?: string } | undefined;
        const currentUser = useSessionStore.getState().user;
        if (!currentUser || currentUser.id !== userId) return;
        void (async () => {
          const [state, friends] = await Promise.all([
            readLocalMoments(),
            fetchFriendsCircle({ userId: currentUser.id }),
          ]);
          if (!active || useSessionStore.getState().user?.id !== userId) return;
          const requesterId = payload?.requesterId;
          const requesterFriendEntry = requesterId
            ? friends.find((f) => f.friend_id === requesterId)
            : undefined;
          const requesterIsFriend = Boolean(requesterFriendEntry);
          const requesterIsBestie = requesterFriendEntry?.relationship === 'bestie';
          const today = todayLocalDateString();
          const isSameUserRequest = requesterId === currentUser.id;
          const myTodayMoments = Object.values(state.moments).filter((m) => {
            if (!m?.id || m.user_id !== currentUser.id) return false;
            if (isSameUserRequest) return true;
            if (m.visibility === 'partner') return false;
            if (currentUser.is_private && !requesterIsBestie) return false;
            if (m.visibility === 'friends' && !requesterIsFriend) return false;
            if (m.snap_once && requesterId && isSnapOnceExpiredForViewer(m, requesterId)) {
              return false;
            }
            const rawIso = m.captured_at || m.posted_at;
            const parsedDate = rawIso ? new Date(rawIso) : null;
            const localDate =
              parsedDate && !Number.isNaN(parsedDate.getTime())
                ? todayLocalDateString(parsedDate)
                : rawIso?.slice(0, 10);
            return localDate === today;
          });
          const seen = new Set<string>();
          for (const m of myTodayMoments) {
            if (!active) return;
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
              if (!active) return;
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
          if (requesterId) {
            const rawMsgs = await safeGetStorageItem('keepit.local_messages.v1');
            if (rawMsgs) {
              try {
                const allMsgs = JSON.parse(rawMsgs) as DirectMessageRecord[];
                const myDmsToRequester = Array.isArray(allMsgs)
                  ? allMsgs.filter(
                      (dm) =>
                        dm?.id &&
                        dm.sender_id === currentUser.id &&
                        dm.recipient_id === requesterId
                    )
                  : [];
                for (const dm of myDmsToRequester.slice(-15)) {
                  if (!active) return;
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
        })().catch(() => {});
      })
      .on('broadcast', { event: 'couple_packet' }, (msg) => {
        const packet = msg.payload as CoupleSyncPacket | undefined;
        if (!packet || !active) return;
        void applyIncomingCouplePacket(packet)
          .then(() => {
            if (!active || useSessionStore.getState().user?.id !== userId) return;
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
          })
          .catch(() => {});
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === 'SUBSCRIBED') {
          registerActiveDirectoryChannel(directoryChannel);
          const currentUser = useSessionStore.getState().user;
          if (currentUser && currentUser.id === userId) {
            void fetchPairingSnapshot(currentUser.id)
              .then((snap) => {
                if (!active || useSessionStore.getState().user?.id !== userId) return;
                void syncDirectoryPresence({
                  profile: currentUser,
                  couple: snap.couple,
                }).catch(() => {});
              })
              .catch(() => {});
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
      active = false;
      registerActiveDirectoryChannel(null);
      void client.removeChannel(directoryChannel).catch(() => {});
    };
  }, [userId, setPairing, queryClient]);

  // Cross-device Realtime Broadcast + Presence sync channel for active couples
  useEffect(() => {
    const client = supabase;
    if (!userId || !coupleId || coupleState !== 'active' || !isSupabaseConfigured || !client) {
      return;
    }

    let active = true;
    const syncChannel = createFreshRealtimeChannel(client, buildCoupleSyncChannelTopic(coupleId), {
      config: {
        broadcast: { ack: false, self: false },
        presence: { key: userId },
      },
    });

    syncChannel
      .on('presence', { event: 'sync' }, () => {
        if (!active) return;
        const currentUser = useSessionStore.getState().user;
        const currentCouple = useSessionStore.getState().couple;
        const currentPartner = useSessionStore.getState().partner;
        if (!currentUser || currentUser.id !== userId || !currentCouple || currentCouple.id !== coupleId) {
          return;
        }
        const state = syncChannel.presenceState();
        for (const [key, entries] of Object.entries(state)) {
          if (key === userId) continue;
          for (const rawEntry of entries as unknown[]) {
            if (rawEntry && typeof rawEntry === 'object' && 'profile' in rawEntry) {
              const peerProfile = rawEntry.profile as UserProfile | undefined;
              if (!peerProfile?.id || peerProfile.id === userId) continue;
              const partnerAlreadySynced = Boolean(
                currentPartner &&
                  currentPartner.id === peerProfile.id &&
                  currentPartner.display_name === peerProfile.display_name &&
                  currentPartner.username === peerProfile.username &&
                  currentPartner.avatar_path === peerProfile.avatar_path
              );
              if (partnerAlreadySynced) continue;

              const updatedCouple = {
                ...currentCouple,
                user_b_id:
                  currentCouple.user_a_id === userId
                    ? peerProfile.id
                    : (currentCouple.user_b_id ?? userId),
              };
              void saveCompletedPairingLocally({
                couple: updatedCouple,
                partner: peerProfile,
                selfProfile: currentUser,
              })
                .then(() => {
                  if (!active || useSessionStore.getState().user?.id !== userId) return;
                  setPairing(updatedCouple, peerProfile);
                })
                .catch(() => {});
            }
          }
        }
      })
      .on('broadcast', { event: 'couple_packet' }, (msg) => {
        const packet = msg.payload as CoupleSyncPacket | undefined;
        if (!packet || !active) return;

        if (packet.kind === 'unpair') {
          if (useSessionStore.getState().user?.id === userId) {
            setPairing(null, null);
          }
          return;
        }

        if (packet.kind === 'profile_upsert' && packet.profile.id !== userId) {
          const currentCouple = useSessionStore.getState().couple;
          if (currentCouple && currentCouple.id === coupleId) {
            setPairing(currentCouple, packet.profile);
          }
        }

        void applyIncomingCouplePacket(packet)
          .then(() => {
            if (!active || useSessionStore.getState().user?.id !== userId) return;
            void queryClient.invalidateQueries({ queryKey: ['today-moment', coupleId] });
            void queryClient.invalidateQueries({ queryKey: ['month-memories', coupleId] });
            void queryClient.invalidateQueries({ queryKey: ['couple-statuses', coupleId] });
            void queryClient.invalidateQueries({ queryKey: ['couple-locations', coupleId] });
            void queryClient.invalidateQueries({ queryKey: ['couple-nudges', coupleId] });
            void queryClient.invalidateQueries({ queryKey: ['direct-messages'] });
            void queryClient.invalidateQueries({ queryKey: ['friends-list'] });
            void queryClient.invalidateQueries({ queryKey: ['user-posts'] });
          })
          .catch(() => {});
      })
      .on('broadcast', { event: 'RequestCoupleMoments' }, (msg) => {
        const payload = msg.payload as { requesterId?: string } | undefined;
        const currentUser = useSessionStore.getState().user;
        if (!active || !currentUser || currentUser.id !== userId || payload?.requesterId === userId) {
          return;
        }
        void (async () => {
          const state = await readLocalMoments();
          if (!active || useSessionStore.getState().user?.id !== userId) return;
          const myCoupleMoments = Object.values(state.moments).filter(
            (m) => m?.id && m.couple_id === coupleId && m.user_id === currentUser.id
          );
          const seen = new Set<string>();
          for (const m of myCoupleMoments.slice(0, 10)) {
            if (!active) return;
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
          if (!active) return;
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
              const myDms = Array.isArray(allMsgs)
                ? allMsgs.filter((dm) => dm?.id && dm.sender_id === currentUser.id)
                : [];
              for (const dm of myDms.slice(-15)) {
                if (!active) return;
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
        })().catch(() => {});
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === 'SUBSCRIBED') {
          registerActiveCoupleChannel(coupleId, syncChannel);
          const currentUser = useSessionStore.getState().user;
          if (currentUser && currentUser.id === userId) {
            void syncChannel.track({ profile: currentUser }).catch(() => {});
            void syncChannel
              .send({
                type: 'broadcast',
                event: 'RequestCoupleMoments',
                payload: { requesterId: userId },
              })
              .catch(() => {});
          }
        }
      });

    return () => {
      active = false;
      registerActiveCoupleChannel(null, null);
      void client.removeChannel(syncChannel).catch(() => {});
    };
  }, [userId, coupleId, coupleState, setPairing, queryClient]);
}
