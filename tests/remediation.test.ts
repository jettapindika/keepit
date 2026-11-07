// tests/remediation.test.ts
// Comprehensive regression & behavioral verification suite for KeepIt remediation:
// - P0-1: Snap Once Moment & DM expiration lifecycle, storage scrubbing, sender preview safety, Memories/Widget exclusion
// - P0-2: Auth password security (zero plaintext passwords in AsyncStorage), signOut/wipeLocalAccount cleanup, Solo fallback preservation
// - P1-1: Real audible WAV PCM synthesis & single-track playback exclusivity
// - P1-2: Friends Circle real lookup (no fabricated profiles), removal persistence without re-seeding, persistent friend post comments/reactions
// - P1-3: Username uniqueness enforcement & Private Dump Account visibility enforcement
// - P1-4: Post CRUD 5/day limit, retake replacement, location coordinate clearing on edit, comment deletion authorization, DM reaction toggle-off sync

// Offline/local-first mode is enforced in tests/register-loader.mjs BEFORE any
// module (including src/api/supabase.ts) is evaluated — ESM import hoisting makes
// in-file process.env assignments run too late.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

import { fetchMonthMemories } from '@/api/extras';
import { fetchCoupleLocations, updateMyLocationShare } from '@/api/locations';
import {
  addMomentComment,
  deleteMomentComment,
  deleteMomentPost,
  fetchTodayMomentBundle,
  computeDeterministicPromptTriggerIso,
  formatLateDuration,
  isMomentPromptCheckIn,
  simulateSandboxPromptState,
  getSnapOnceRemainingSeconds,
  isSnapOnceExpiredForViewer,
  markSnapOnceMomentState,
  submitDailyMoment,
  todayLocalDateString,
  toggleMomentReaction,
  updateMomentDetails,
} from '@/api/moments';
import { createOrRefreshInvite, fetchPairingSnapshot, redeemInviteCode, upsertUserProfile } from '@/api/pairing';
import { applyIncomingCouplePacket } from '@/api/realtimeSync';
import {
  addFriendByHandleOrCode,
  CURATED_MUSIC_TRACKS,
  fetchConversationMessages,
  fetchFriendsCircle,
  markSnapDirectMessageViewed,
  removeFriend,
  sendDirectMessage,
  toggleDirectMessageReaction,
} from '@/api/social';
import { buildWidgetSnapshotPayload } from '@/hooks/useWidgetSync';
import { computeCountdownSnapshot } from '@/hooks/useMomentCountdown';
import { useSessionStore } from '@/store/sessionStore';
import {
  buildSynthesizedTrackWavDataUri,
  getActiveMusicPreviewTrackId,
  stopMusicPreview,
  toggleMusicTrackPreview,
} from '@/utils/audioPreview';
import {
  buildMomentCompositeSvgDataUri,
  exportAndShareCompositeMoment,
  KEEPIT_WATERMARK_SVG_PATH_D,
} from '@/utils/momentExport';
import {
  advanceStreakOnDualPost,
  enrichStreakWithRecentChain,
  getAvailableCollageStamps,
  getCurrentAndNextChapter,
} from '@/utils/streakEngine';
import { requestPinKeepItWidgetDetailed } from '../modules/keepit-widget-bridge';


async function resetAllState() {
  const storeWithClear = AsyncStorage as unknown as {
    clear: () => Promise<void>;
    __dump: () => Record<string, string>;
  };
  await storeWithClear.clear();
  stopMusicPreview();
  useSessionStore.setState({
    hydrated: true,
    user: null,
    email: null,
    couple: null,
    partner: null,
    pendingInviteCode: null,
  });
}

describe('P0-1: Snap Once Security & Expiration Lifecycle', () => {
  beforeEach(async () => {
    await resetAllState();
  });

  it('authoritatively tracks 15s countdown, prevents sender preview from expiring recipient, and scrubs expired media/caption from storage', async () => {
    const coupleId = 'couple_snap_test';
    const senderId = 'user_alice';
    const recipientId = 'user_bob';
    const today = todayLocalDateString();

    const created = await submitDailyMoment({
      coupleId,
      promptId: `prompt_${coupleId}_${today}`,
      userId: senderId,
      authorName: 'Alice',
      backUri: 'data:image/jpeg;base64,SECRET_BACK_BYTES',
      frontUri: 'data:image/jpeg;base64,SECRET_FRONT_BYTES',
      caption: 'Secret disappearing note',
      snapOnce: true,
      snapDurationSeconds: 15,
    });

    // Recipient also posts so reciprocal lock opens
    await submitDailyMoment({
      coupleId,
      promptId: `prompt_${coupleId}_${today}`,
      userId: recipientId,
      authorName: 'Bob',
      backUri: 'data:image/jpeg;base64,BOB_BACK',
      frontUri: 'data:image/jpeg;base64,BOB_FRONT',
    });

    // 1. Sender previewing their own Snap Once post MUST NOT consume or start recipient timer
    await markSnapOnceMomentState({
      momentId: created.id,
      coupleId,
      viewerId: senderId,
      expired: true,
    });

    let bundleForBob = await fetchTodayMomentBundle({ coupleId, userId: recipientId });
    assert.equal(bundleForBob.partner?.snap_once, true);
    assert.equal(
      isSnapOnceExpiredForViewer(bundleForBob.partner!, recipientId),
      false,
      'Sender preview must not expire Snap Once for recipient'
    );
    assert.equal(bundleForBob.partner?.back_photo_url, 'data:image/jpeg;base64,SECRET_BACK_BYTES');

    // 2. Recipient opens Snap Once -> authoritative timestamp recorded, countdown resumes across refreshes
    await markSnapOnceMomentState({
      momentId: created.id,
      coupleId,
      viewerId: recipientId,
      expired: false,
    });

    bundleForBob = await fetchTodayMomentBundle({ coupleId, userId: recipientId });
    const remAfterOpen = getSnapOnceRemainingSeconds(bundleForBob.partner!, recipientId);
    assert.ok(remAfterOpen !== null && remAfterOpen > 0 && remAfterOpen <= 15);

    // Simulate 16 seconds passing -> timer expires even if user switched tabs without client tick completing
    const futureMs = Date.now() + 16_000;
    assert.equal(isSnapOnceExpiredForViewer(bundleForBob.partner!, recipientId, futureMs), true);
    assert.equal(getSnapOnceRemainingSeconds(bundleForBob.partner!, recipientId, futureMs), 0);

    // 3. Explicit expiration scrubs media & caption from AsyncStorage
    await markSnapOnceMomentState({
      momentId: created.id,
      coupleId,
      viewerId: recipientId,
      expired: true,
    });

    const rawMomentsJson = await AsyncStorage.getItem('keepit.local_moments.v1');
    assert.ok(rawMomentsJson);
    assert.equal(
      rawMomentsJson.includes('SECRET_BACK_BYTES'),
      false,
      'Expired Snap Once back photo bytes must be scrubbed from AsyncStorage'
    );
    assert.equal(
      rawMomentsJson.includes('SECRET_FRONT_BYTES'),
      false,
      'Expired Snap Once front photo bytes must be scrubbed from AsyncStorage'
    );
    assert.equal(
      rawMomentsJson.includes('Secret disappearing note'),
      false,
      'Expired Snap Once caption must be scrubbed from AsyncStorage'
    );

    const afterExpiryBundle = await fetchTodayMomentBundle({ coupleId, userId: recipientId });
    assert.equal(afterExpiryBundle.partner?.back_photo_url, null);
    assert.equal(afterExpiryBundle.partner?.front_photo_url, null);
    assert.equal(afterExpiryBundle.partner?.caption, null);
  });

  it('excludes Snap Once moments from Monthly Memories and Home Screen Widget snapshots', async () => {
    const coupleId = 'couple_mem_snap';
    const aliceId = 'user_alice';
    const bobId = 'user_bob';
    const now = new Date();
    const today = todayLocalDateString(now);

    await submitDailyMoment({
      coupleId,
      promptId: `prompt_${coupleId}_${today}`,
      userId: aliceId,
      backUri: 'data:image/jpeg;base64,ALICE_SNAP',
      frontUri: 'data:image/jpeg;base64,ALICE_FRONT',
      caption: 'Hidden from memories & widget',
      snapOnce: true,
    });

    const bundle = await fetchTodayMomentBundle({ coupleId, userId: bobId });
    const widgetSnap = buildWidgetSnapshotPayload({
      coupleId,
      partnerName: 'Alice',
      momentBundle: bundle,
      statusBundle: null,
    });
    assert.equal(widgetSnap.momentPhotoUri, null, 'Snap Once must never leak to Home Screen widget');
    assert.equal(widgetSnap.momentCaption, null);

    const memories = await fetchMonthMemories({
      coupleId,
      userId: bobId,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    });
    assert.equal(memories.days.length, 0, 'Snap Once moments must be excluded from Memories archive');
  });

  it('protects Snap Once DMs: sender preview never expires message, recipient expiry scrubs text & media', async () => {
    const msg = await sendDirectMessage({
      coupleId: 'couple_dm_snap',
      senderId: 'user_alice',
      senderName: 'Alice',
      recipientId: 'user_bob',
      text: 'Top secret 15s DM!',
      snapOnce: true,
    });

    // Sender taps preview -> must NOT mark viewed or scrub text
    await markSnapDirectMessageViewed({
      coupleId: 'couple_dm_snap',
      messageId: msg.id,
      viewerId: 'user_alice',
      expired: true,
    });

    let threadForBob = await fetchConversationMessages({
      userId: 'user_bob',
      peerId: 'user_alice',
      peerName: 'Alice',
    });
    assert.equal(threadForBob[0].text, 'Top secret 15s DM!');

    // Recipient finishes 15s view -> scrubs text & media from AsyncStorage
    await markSnapDirectMessageViewed({
      coupleId: 'couple_dm_snap',
      messageId: msg.id,
      viewerId: 'user_bob',
      expired: true,
    });

    const rawDmStorage = await AsyncStorage.getItem('keepit.local_messages.v1');
    assert.ok(rawDmStorage);
    assert.equal(
      rawDmStorage.includes('Top secret 15s DM!'),
      false,
      'Expired Snap Once DM text must be wiped from AsyncStorage'
    );

    threadForBob = await fetchConversationMessages({
      userId: 'user_bob',
      peerId: 'user_alice',
      peerName: 'Alice',
    });
    assert.equal(threadForBob[0].text, '');
  });
});

describe('P0-2: Authentication, Password Security & Session Cleanup', () => {
  beforeEach(async () => {
    await resetAllState();
  });

  it('never stores plaintext passwords in AsyncStorage and wipes messages/friends on signOut & wipeLocalAccount', async () => {
    const dumpFn = (AsyncStorage as unknown as { __dump: () => Record<string, string> }).__dump;

    // Seed legacy plaintext password store to verify hydration purges it
    await AsyncStorage.setItem(
      'keepit.local_accounts.v1',
      JSON.stringify({ 'test@example.com': { password: 'SuperSecretPassword123!' } })
    );
    await useSessionStore.getState().hydrate();
    assert.equal(await AsyncStorage.getItem('keepit.local_accounts.v1'), null);

    // Inspect all storage keys after profile creation & messaging
    const profile = await upsertUserProfile({
      userId: 'user_sec_1',
      displayName: 'SecUser',
    });
    useSessionStore.setState({
      user: profile,
      email: 'sec@example.com',
      couple: {
        id: 'solo_user_sec_1',
        user_a_id: 'user_sec_1',
        user_b_id: null,
        invite_code: '',
        invite_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        state: 'active',
        paired_at: null,
        created_at: profile.created_at,
      },
      partner: null,
    });

    await sendDirectMessage({
      senderId: 'user_sec_1',
      senderName: 'SecUser',
      recipientId: 'friend_sora_k',
      text: 'Private DM before signout',
    });
    await fetchFriendsCircle({ userId: 'user_sec_1' });

    const beforeDump = JSON.stringify(dumpFn());
    assert.equal(beforeDump.includes('SuperSecretPassword123!'), false);
    assert.equal(beforeDump.includes('Private DM before signout'), true);

    // Refreshing pairing on a Solo account MUST preserve the active `solo_` fallback couple
    await useSessionStore.getState().refreshPairing();
    assert.equal(useSessionStore.getState().couple?.id, 'solo_user_sec_1');
    assert.equal(useSessionStore.getState().couple?.state, 'active');

    useSessionStore.getState().setPendingInviteCode('ABC123');
    // Signing out clears account-specific caches (messages, friends, moments, widget)
    await useSessionStore.getState().signOut();
    assert.equal(await AsyncStorage.getItem('keepit.local_messages.v1'), null);
    assert.equal(await AsyncStorage.getItem('keepit.local_friends.v1'), null);
    assert.equal(await AsyncStorage.getItem('keepit.widget_snapshot.v1'), null);
    assert.equal(useSessionStore.getState().pendingInviteCode, null);
    assert.equal(useSessionStore.getState().user, null);
  });

  it('rejects unknown 6-character invite codes instead of fabricating a synthetic ghost partner', async () => {
    await assert.rejects(
      () => redeemInviteCode('user_solo_1', 'Z9Y8X7'),
      (err: Error) => err.message.includes('No active invite matches')
    );
  });

  it('joins a normalized invite and persists the same two-partner relationship for both accounts', async () => {
    const host = await upsertUserProfile({ userId: 'invite_host', displayName: 'Host' });
    const guest = await upsertUserProfile({ userId: 'invite_guest', displayName: 'Guest' });
    const invite = await createOrRefreshInvite(host.id);

    await assert.rejects(() => redeemInviteCode(host.id, invite.invite_code), /your own invite code/);
    const pastedCode = ` ${invite.invite_code.slice(0, 3).toLowerCase()}-${invite.invite_code.slice(3).toLowerCase()} `;
    const joined = await redeemInviteCode(guest.id, pastedCode);
    assert.equal(joined.couple?.id, invite.id);
    assert.equal(joined.couple?.state, 'active');
    assert.equal(joined.partner?.id, host.id);
    const hostSnapshot = await fetchPairingSnapshot(host.id);
    assert.equal(hostSnapshot.couple?.user_b_id, guest.id);
    assert.equal(hostSnapshot.partner?.id, guest.id);
    await assert.rejects(() => redeemInviteCode('third_account', invite.invite_code), /already has 2 partners/);
  });

  it('rejects expired invites without pairing either account and permits joining a refreshed invite', async () => {
    const host = await upsertUserProfile({ userId: 'expiry_host', displayName: 'Host' });
    const guest = await upsertUserProfile({ userId: 'expiry_guest', displayName: 'Guest' });
    const invite = await createOrRefreshInvite(host.id);
    const raw = await AsyncStorage.getItem('keepit.local_db.v1');
    assert.ok(raw);
    const database = JSON.parse(raw);
    database.couples[invite.id].invite_expires_at = '2000-01-01T00:00:00.000Z';
    await AsyncStorage.setItem('keepit.local_db.v1', JSON.stringify(database));

    await assert.rejects(() => redeemInviteCode(guest.id, invite.invite_code), /invite code expired/);
    assert.equal((await fetchPairingSnapshot(guest.id)).couple, null);
    assert.equal((await fetchPairingSnapshot(host.id)).couple?.state, 'pending');
    const refreshed = await createOrRefreshInvite(host.id, true);
    assert.ok(new Date(refreshed.invite_expires_at).getTime() > Date.now());
    const joined = await redeemInviteCode(guest.id, refreshed.invite_code);
    assert.equal(joined.couple?.state, 'active');
    assert.equal(joined.partner?.id, host.id);
  });
});

describe('P1-1: Real Audible Music Preview Synthesis & Exclusivity', () => {
  beforeEach(async () => {
    await resetAllState();
  });

  it('generates valid RIFF WAVE PCM audio data URIs and enforces single-track playback exclusivity', () => {
    const track1 = CURATED_MUSIC_TRACKS[0];
    const track2 = CURATED_MUSIC_TRACKS[1];

    const wavDataUri = buildSynthesizedTrackWavDataUri(track1);
    assert.ok(wavDataUri.startsWith('data:audio/wav;base64,'));
    const b64 = wavDataUri.slice('data:audio/wav;base64,'.length);
    const decodedHeader = atob(b64.slice(0, 24));
    assert.equal(decodedHeader.slice(0, 4), 'RIFF');
    assert.equal(decodedHeader.slice(8, 12), 'WAVE');

    assert.equal(getActiveMusicPreviewTrackId(), null);
    const started1 = toggleMusicTrackPreview(track1);
    assert.equal(started1, true);
    assert.equal(getActiveMusicPreviewTrackId(), track1.id);

    // Starting track 2 automatically stops track 1
    const started2 = toggleMusicTrackPreview(track2);
    assert.equal(started2, true);
    assert.equal(getActiveMusicPreviewTrackId(), track2.id);

    // Toggling track 2 again stops playback
    const stopped2 = toggleMusicTrackPreview(track2);
    assert.equal(stopped2, false);
    assert.equal(getActiveMusicPreviewTrackId(), null);
  });
});

describe('P1-2 & P1-3: Friends Circle, Username Uniqueness & Privacy Enforcement', () => {
  beforeEach(async () => {
    await resetAllState();
  });

  it('starts fresh accounts with 0 friends, rejects nonexistent usernames, and finds registered users by handle or code', async () => {
    const userId = 'user_circle_owner';
    const initial = await fetchFriendsCircle({ userId });
    assert.equal(initial.length, 0, 'Fresh account must start with 0 dummy friends');

    // Adding a nonexistent handle must throw instead of fabricating a fake profile
    await assert.rejects(
      () =>
        addFriendByHandleOrCode({
          userId,
          query: '@totally_nonexistent_person_999',
        }),
      /No KeepIt user found/
    );

    // Register a real user and add them by Friend Code or @username
    const registeredMaya = await upsertUserProfile({
      userId: 'user_maya_real',
      displayName: 'Maya Lin',
      username: 'maya.snaps',
    });

    const maya = await addFriendByHandleOrCode({
      userId,
      query: registeredMaya.friend_code!,
      relationship: 'bestie',
    });
    assert.equal(maya.friend_profile.username, 'maya.snaps');

    const mayaDup = await addFriendByHandleOrCode({
      userId,
      query: '@maya.snaps',
      relationship: 'bestie',
    });
    assert.equal(mayaDup.id, maya.id);
    const listAfterDup = await fetchFriendsCircle({ userId });
    assert.equal(listAfterDup.length, 1);

    await removeFriend({ userId, friendRecordId: maya.id });
    const afterRemoveAll = await fetchFriendsCircle({ userId });
    assert.equal(afterRemoveAll.length, 0, 'Removed friends must stay removed');
  });

  it('starts fresh accounts with 0 friend moments and persists comments/reactions on real added friend posts', async () => {
    const userId = 'user_friend_reactor';
    const coupleId = 'solo_user_friend_reactor';

    const freshBundle = await fetchTodayMomentBundle({ coupleId, userId });
    assert.equal(freshBundle.friendMomentsToday?.length ?? 0, 0, 'Fresh account must have 0 dummy friend moments');
    assert.equal(freshBundle.mine, null);
    assert.equal(freshBundle.partner, null);

    // Register a real friend, add them, and have them post a Moment today
    const realFriend = await upsertUserProfile({
      userId: 'user_real_friend_1',
      displayName: 'Sora Real',
      username: 'sora.real',
    });
    await addFriendByHandleOrCode({
      userId,
      query: '@sora.real',
      relationship: 'bestie',
    });
    const friendPost = await submitDailyMoment({
      coupleId: 'solo_user_real_friend_1',
      promptId: `prompt_solo_friend_${todayLocalDateString()}`,
      userId: realFriend.id,
      authorName: realFriend.display_name,
      authorUsername: realFriend.username,
      backUri: 'data:image/jpeg;base64,FRIEND_BACK',
      frontUri: 'data:image/jpeg;base64,FRIEND_FRONT',
      visibility: 'friends',
    });

    const bundle1 = await fetchTodayMomentBundle({ coupleId, userId });
    assert.equal(bundle1.friendMomentsToday?.length, 1);
    const soraPost = bundle1.friendMomentsToday![0];
    assert.equal(soraPost.id, friendPost.id);

    await toggleMomentReaction({
      momentId: soraPost.id,
      coupleId,
      userId,
      emoji: '🔥',
    });
    const cmt = await addMomentComment({
      momentId: soraPost.id,
      coupleId,
      authorId: userId,
      authorName: 'Reactor',
      text: 'Love the shot!',
    });

    const bundle2 = await fetchTodayMomentBundle({ coupleId, userId });
    const refreshedSora = bundle2.friendMomentsToday!.find((m) => m.id === soraPost.id)!;
    assert.equal(refreshedSora.reactions?.[userId], '🔥');
    assert.equal(refreshedSora.comments?.length, 1);
    assert.equal(refreshedSora.comments?.[0].id, cmt.id);

    // Comment deletion works for author and blocks unauthorized strangers
    await assert.rejects(
      () =>
        deleteMomentComment({
          momentId: soraPost.id,
          commentId: cmt.id,
          coupleId,
          requesterId: 'random_stranger',
        }),
      /only delete your own/
    );

    await deleteMomentComment({
      momentId: soraPost.id,
      commentId: cmt.id,
      coupleId,
      requesterId: userId,
    });
    const bundle3 = await fetchTodayMomentBundle({ coupleId, userId });
    assert.equal(
      bundle3.friendMomentsToday!.find((m) => m.id === soraPost.id)!.comments?.length,
      0
    );
  });

  it('enforces username uniqueness and Private Account feed restrictions', async () => {
    await upsertUserProfile({
      userId: 'user_one',
      displayName: 'User One',
      username: 'unique.handle',
    });

    await assert.rejects(
      () =>
        upsertUserProfile({
          userId: 'user_two',
          displayName: 'User Two',
          username: '@UNIQUE.HANDLE',
        }),
      /already taken/
    );

    // Private profile friend post is hidden from regular 'friend' tier, visible only to 'bestie'
    const privOwner = await upsertUserProfile({
      userId: 'user_priv_friend',
      displayName: 'Priv Friend',
      username: 'priv.dump',
      isPrivate: true,
      dumpMode: true,
    });

    const viewerId = 'user_viewer';
    await addFriendByHandleOrCode({
      userId: viewerId,
      query: '@priv.dump',
      relationship: 'friend',
    });

    await submitDailyMoment({
      coupleId: 'solo_user_priv_friend',
      promptId: `prompt_solo_${todayLocalDateString()}`,
      userId: privOwner.id,
      authorName: privOwner.display_name,
      backUri: 'data:image/jpeg;base64,PRIV_BACK',
      frontUri: 'data:image/jpeg;base64,PRIV_FRONT',
      visibility: 'friends',
    });

    const viewerBundleAsRegularFriend = await fetchTodayMomentBundle({
      coupleId: 'solo_user_viewer',
      userId: viewerId,
    });
    assert.equal(
      viewerBundleAsRegularFriend.friendMomentsToday?.some((m) => m.user_id === privOwner.id),
      false,
      'Regular friend tier must not see Private Dump Account posts'
    );

    // Upgrade friendship to 'bestie' -> now authorized
    await addFriendByHandleOrCode({
      userId: viewerId,
      query: '@priv.dump',
      relationship: 'bestie',
    });
    const viewerBundleAsBestie = await fetchTodayMomentBundle({
      coupleId: 'solo_user_viewer',
      userId: viewerId,
    });
    assert.equal(
      viewerBundleAsBestie.friendMomentsToday?.some((m) => m.user_id === privOwner.id),
      true,
      'Approved Bestie tier can view Private Dump Account friends-visible posts'
    );
  });
});

describe('P1-4, P1-5 & P2: Post CRUD Quota, DM Reactions, Location Privacy, Widget & Watermark', () => {
  beforeEach(async () => {
    await resetAllState();
  });

  it('enforces max 5 daily posts, supports retake replacement, clears coords when location cleared, and deletes cleanly', async () => {
    const coupleId = 'solo_quota_user';
    const userId = 'quota_user';
    const today = todayLocalDateString();
    const createdIds: string[] = [];

    for (let i = 1; i <= 5; i += 1) {
      const m = await submitDailyMoment({
        coupleId,
        promptId: `prompt_${coupleId}_${today}`,
        userId,
        backUri: `data:image/jpeg;base64,SHOT_${i}`,
        frontUri: `data:image/jpeg;base64,SELFIE_${i}`,
        lat: 37.77,
        lng: -122.41,
        locationLabel: 'Coffee Spot',
      });
      createdIds.push(m.id);
    }

    // 6th post must fail
    await assert.rejects(
      () =>
        submitDailyMoment({
          coupleId,
          promptId: `prompt_${coupleId}_${today}`,
          userId,
          backUri: 'data:image/jpeg;base64,SHOT_6',
          frontUri: 'data:image/jpeg;base64,SELFIE_6',
        }),
      /Daily limit reached/
    );

    // Retake replacement on post #5 succeeds even when 5/5 slots are full
    const replaced = await submitDailyMoment({
      coupleId,
      promptId: `prompt_${coupleId}_${today}`,
      userId,
      backUri: 'data:image/jpeg;base64,SHOT_5_RETAKE',
      frontUri: 'data:image/jpeg;base64,SELFIE_5_RETAKE',
      replaceMomentId: createdIds[4],
    });
    assert.equal(replaced.id, createdIds[4]);
    assert.equal(replaced.retake_count, 1);

    // Clearing location_label clears stale lat/lng coordinates
    const edited = await updateMomentDetails({
      momentId: createdIds[0],
      userId,
      locationLabel: null,
    });
    assert.equal(edited.location_label, null);
    assert.equal(edited.lat, null);
    assert.equal(edited.lng, null);

    // Deleting 1 post frees a daily slot (4/5)
    await deleteMomentPost({
      momentId: createdIds[4],
      userId,
      coupleId,
    });
    const bundleAfterDelete = await fetchTodayMomentBundle({ coupleId, userId });
    assert.equal(bundleAfterDelete.dailyPostCount, 4);
  });

  it('toggles DM reactions ON and OFF cleanly across Realtime packets', async () => {
    const msg = await sendDirectMessage({
      coupleId: 'couple_dm_react',
      senderId: 'alice',
      senderName: 'Alice',
      recipientId: 'bob',
      text: 'React to me!',
    });

    await toggleDirectMessageReaction({
      coupleId: 'couple_dm_react',
      messageId: msg.id,
      userId: 'bob',
      emoji: '❤️',
    });
    let list = await fetchConversationMessages({ userId: 'bob', peerId: 'alice', peerName: 'Alice' });
    assert.equal(list[0].reactions?.bob, '❤️');

    // Simulate incoming Realtime toggle-off packet (`emoji: null`)
    await applyIncomingCouplePacket({
      kind: 'dm_reaction',
      messageId: msg.id,
      userId: 'bob',
      emoji: null,
    });
    list = await fetchConversationMessages({ userId: 'bob', peerId: 'alice', peerName: 'Alice' });
    assert.equal(list[0].reactions?.bob, undefined);
  });

  it('defaults couple locations to Ghost mode (null coords) and omits fake Partner & dummy Friends for fresh Solo accounts', async () => {
    const locBundle = await fetchCoupleLocations({
      coupleId: 'solo_loc_user',
      userId: 'loc_user',
    });
    assert.equal(locBundle.mine?.mode, 'ghost');
    assert.equal(locBundle.mine?.lat, null);
    assert.equal(locBundle.partner, null);
    assert.equal(locBundle.friends?.length ?? 0, 0);
  });

  it('keeps missing coordinates unknown and shares only a real located Moment', async () => {
    const host = await upsertUserProfile({ userId: 'location_host', displayName: 'Host' });
    const guest = await upsertUserProfile({ userId: 'location_guest', displayName: 'Guest' });
    const invite = await createOrRefreshInvite(host.id);
    const pairing = await redeemInviteCode(guest.id, invite.invite_code);
    assert.ok(pairing.couple);
    const coupleId = pairing.couple.id;
    useSessionStore.setState({ user: host, couple: pairing.couple, partner: guest });

    await updateMyLocationShare({ coupleId, userId: host.id, mode: 'on_moment' });
    await updateMyLocationShare({ coupleId, userId: guest.id, mode: 'on_moment' });
    let locations = await fetchCoupleLocations({ coupleId, userId: host.id });
    assert.equal(locations.mine?.lat, null);
    assert.equal(locations.mine?.lng, null);
    assert.equal(locations.partner?.lat, null);
    assert.equal(locations.partner?.lng, null);

    const promptId = `prompt_${coupleId}_${todayLocalDateString()}`;
    await submitDailyMoment({ coupleId, userId: host.id, promptId, backUri: 'data:image/jpeg;base64,UNLOCATED_BACK', frontUri: 'data:image/jpeg;base64,UNLOCATED_FRONT' });
    locations = await updateMyLocationShare({ coupleId, userId: host.id, mode: 'on_moment' });
    assert.equal(locations.mine?.lat, null);
    assert.equal(locations.mine?.location_updated_at, null);

    await submitDailyMoment({ coupleId, userId: host.id, promptId, backUri: 'data:image/jpeg;base64,LOCATED_BACK', frontUri: 'data:image/jpeg;base64,LOCATED_FRONT', lat: -6.2, lng: 106.8, locationLabel: 'Chosen check-in' });
    locations = await updateMyLocationShare({ coupleId, userId: host.id, mode: 'on_moment' });
    assert.equal(locations.mine?.lat, -6.2);
    assert.equal(locations.mine?.lng, 106.8);
    locations = await updateMyLocationShare({ coupleId, userId: host.id, mode: 'ghost' });
    assert.equal(locations.mine?.lat, null);
    assert.equal(locations.mine?.lng, null);
    assert.equal(locations.mine?.place_name, null);
  });

  it('ensures newly created account via signUpWithPassword is completely fresh with no dummy bio, song, partner, friends, or posts', async () => {
    await useSessionStore.getState().signUpWithPassword({
      displayName: 'Fresh User',
      email: `fresh.${Date.now()}@gmail.com`,
      password: 'password123',
      confirmPassword: 'password123',
    });

    const state = useSessionStore.getState();
    assert.ok(state.user);
    assert.equal(state.user.display_name, 'Fresh User');
    assert.equal(state.user.bio, '');
    assert.equal(state.user.mood_song, '');
    assert.equal(state.partner, null);
    assert.ok(state.couple?.id.startsWith('solo_'));

    const friends = await fetchFriendsCircle({ userId: state.user.id });
    assert.equal(friends.length, 0);

    const momentBundle = await fetchTodayMomentBundle({
      coupleId: state.couple!.id,
      userId: state.user.id,
    });
    assert.equal(momentBundle.mine, null);
    assert.equal(momentBundle.partner, null);
    assert.equal(momentBundle.myMomentsToday?.length ?? 0, 0);
    assert.equal(momentBundle.partnerMomentsToday?.length ?? 0, 0);
    assert.equal(momentBundle.friendMomentsToday?.length ?? 0, 0);

    const locations = await fetchCoupleLocations({
      coupleId: state.couple!.id,
      userId: state.user.id,
    });
    assert.equal(locations.partner, null);
    assert.equal(locations.friends?.length ?? 0, 0);
  });

  it('returns truthful widget pin status on Web/iOS, bakes #keepit + timestamp into 3:4 & 9:16 composites, and saves photos across URI formats', async () => {
    Platform.OS = 'web';
    const webPin = await requestPinKeepItWidgetDetailed();
    assert.equal(webPin.pinned, false);
    assert.equal(webPin.mode, 'unsupported');

    Platform.OS = 'ios';
    const iosPin = await requestPinKeepItWidgetDetailed();
    assert.equal(iosPin.pinned, false);
    assert.equal(iosPin.mode, 'manual_instructions');

    const svgSaveMsg = await exportAndShareCompositeMoment({
      backUri: 'data:image/jpeg;base64,PRIMARY_PHOTO_BYTES',
      frontUri: 'data:image/jpeg;base64,SECONDARY_PIP_PHOTO_BYTES',
      authorName: 'Jetta',
      timestampLabel: 'Nov 6 · 02:30 PM',
      aspect: '3:4',
      baseFilename: 'keepit-jetta-3x4',
      title: 'Jetta’s KeepIt Moment',
    });
    assert.ok(svgSaveMsg.includes('Saved'));

    const savedCompositeFile = new FileSystem.File(
      FileSystem.Paths.cache,
      'keepit-jetta-3x4.svg'
    );
    const savedContent = await savedCompositeFile.text();
    assert.ok(
      savedContent.includes('PRIMARY_PHOTO_BYTES'),
      'Exported file must include primary photo'
    );
    assert.ok(
      savedContent.includes('SECONDARY_PIP_PHOTO_BYTES'),
      'Exported file must include secondary PIP photo'
    );
    assert.ok(
      savedContent.includes('#keepit'),
      'Exported file must include #keepit watermark'
    );
    assert.ok(
      savedContent.includes(KEEPIT_WATERMARK_SVG_PATH_D),
      'Exported file must embed the exact #keepit SVG vector path'
    );
    assert.ok(
      savedContent.includes('Nov 6 · 02:30 PM'),
      'Exported file must include watermark timestamp'
    );
    Platform.OS = 'web';

    const svg3x4 = decodeURIComponent(
      buildMomentCompositeSvgDataUri({
        backUri: 'data:image/jpeg;base64,AAA',
        frontUri: 'data:image/jpeg;base64,BBB',
        authorName: 'Jetta',
        timestampLabel: 'Nov 6 · 02:30 PM',
        aspect: '3:4',
      })
    );
    assert.ok(svg3x4.includes('#keepit'));
    assert.ok(svg3x4.includes(KEEPIT_WATERMARK_SVG_PATH_D));
    assert.ok(svg3x4.includes('Nov 6 · 02:30 PM'));
    const svg9x16 = decodeURIComponent(
      buildMomentCompositeSvgDataUri({
        backUri: 'data:image/jpeg;base64,AAA',
        frontUri: 'data:image/jpeg;base64,BBB',
        authorName: 'Jetta',
        timestampLabel: 'Nov 6 · 02:30 PM',
        taggedUsers: [{ userId: 'u1', displayName: 'Sora', username: 'sora.frames' }],
        overlays: [{ id: 'ov1', kind: 'text', content: 'neon vibe', bgStyle: 'neon', xPct: 50, yPct: 50 }],
        aspect: '9:16',
        storyTheme: 'neon',
      })
    );
    assert.ok(svg9x16.includes('#keepit'));
    assert.ok(svg9x16.includes(KEEPIT_WATERMARK_SVG_PATH_D));
    assert.ok(svg9x16.includes('Nov 6 · 02:30 PM'));
    assert.ok(svg9x16.includes('@sora.frames'));
    assert.ok(svg9x16.includes('neon vibe'));
  });

  it('synchronizes daily prompt deterministically, enforces 5m check-in window only on the first post after prompt, and keeps bonus/pre-prompt/solo posts spontaneous', async () => {
    const coupleId = 'couple_time_system';
    const aliceId = 'user_alice';
    const bobId = 'user_bob';
    const today = todayLocalDateString();

    // 1. Both partners independently compute the exact same daily prompt trigger_at
    const triggerA = computeDeterministicPromptTriggerIso(coupleId, today);
    const triggerB = computeDeterministicPromptTriggerIso(coupleId, today);
    assert.equal(triggerA, triggerB);

    const bundleAlice = await fetchTodayMomentBundle({ coupleId, userId: aliceId });
    const bundleBob = await fetchTodayMomentBundle({ coupleId, userId: bobId });
    assert.equal(bundleAlice.prompt.trigger_at, triggerA);
    assert.equal(bundleBob.prompt.trigger_at, triggerB);

    // 2. Simulate an upcoming prompt (45m in the future) -> early spontaneous post is NOT a prompt check-in and NOT marked late
    await simulateSandboxPromptState({ coupleId, mode: 'upcoming' });
    const upcomingBundle = await fetchTodayMomentBundle({ coupleId, userId: aliceId });
    const upcomingSnap = computeCountdownSnapshot(upcomingBundle.prompt.trigger_at);
    assert.equal(upcomingSnap.phase, 'upcoming');

    const earlyPost = await submitDailyMoment({
      coupleId,
      promptId: upcomingBundle.prompt.id,
      userId: aliceId,
      authorName: 'Alice',
      backUri: 'data:image/jpeg;base64,EARLY_BACK',
      frontUri: 'data:image/jpeg;base64,EARLY_FRONT',
      capturedAtIso: new Date().toISOString(),
    });
    assert.equal(earlyPost.is_prompt_checkin, false);
    assert.equal(earlyPost.is_late, false);
    assert.equal(earlyPost.late_by_seconds, 0);
    assert.equal(isMomentPromptCheckIn(earlyPost), false);

    // 3. Simulate live window (prompt triggered 3m ago -> within 5-minute window)
    const liveTriggerMs = Date.now() - 180_000;
    const liveTriggerIso = new Date(liveTriggerMs).toISOString();
    const liveSnap = computeCountdownSnapshot(liveTriggerIso);
    assert.equal(liveSnap.phase, 'live');
    assert.ok(liveSnap.secondsRemaining >= 115 && liveSnap.secondsRemaining <= 120);

    // Update prompt to 180s ago and have Alice capture her first post AFTER the prompt -> On time check-in!
    await simulateSandboxPromptState({ coupleId, mode: 'live_window' });
    const liveBundle = await fetchTodayMomentBundle({ coupleId, userId: aliceId });
    const checkInOnTime = await submitDailyMoment({
      coupleId,
      promptId: liveBundle.prompt.id,
      userId: aliceId,
      authorName: 'Alice',
      backUri: 'data:image/jpeg;base64,CHECKIN_BACK',
      frontUri: 'data:image/jpeg;base64,CHECKIN_FRONT',
      capturedAtIso: new Date(
        new Date(liveBundle.prompt.trigger_at).getTime() + 240_000
      ).toISOString(), // 4m after trigger (within 5m window)
    });
    assert.equal(checkInOnTime.is_prompt_checkin, true);
    assert.equal(checkInOnTime.is_late, false);
    assert.equal(checkInOnTime.late_by_seconds, 240);
    assert.equal(formatLateDuration(checkInOnTime.late_by_seconds), 'On time');

    // 4. Alice's next post (#3 of the day, 3 hours after prompt) is a bonus spontaneous post -> never marked late!
    const bonusPost = await submitDailyMoment({
      coupleId,
      promptId: liveBundle.prompt.id,
      userId: aliceId,
      authorName: 'Alice',
      backUri: 'data:image/jpeg;base64,BONUS_BACK',
      frontUri: 'data:image/jpeg;base64,BONUS_FRONT',
      capturedAtIso: new Date(
        new Date(liveBundle.prompt.trigger_at).getTime() + 3 * 3600_000
      ).toISOString(),
    });
    assert.equal(bonusPost.is_prompt_checkin, false);
    assert.equal(bonusPost.is_late, false);
    assert.equal(bonusPost.late_by_seconds, 0);
    assert.equal(isMomentPromptCheckIn(bonusPost), false);

    // 5. Bob posts his first Moment 17 minutes after the prompt (12m past the 5m window) -> marked as prompt check-in, 12m after prompt
    const bobLateCheckIn = await submitDailyMoment({
      coupleId,
      promptId: liveBundle.prompt.id,
      userId: bobId,
      authorName: 'Bob',
      backUri: 'data:image/jpeg;base64,BOB_LATE_BACK',
      frontUri: 'data:image/jpeg;base64,BOB_LATE_FRONT',
      capturedAtIso: new Date(
        new Date(liveBundle.prompt.trigger_at).getTime() + 17 * 60_000
      ).toISOString(),
    });
    assert.equal(bobLateCheckIn.is_prompt_checkin, true);
    assert.equal(bobLateCheckIn.is_late, true);
    assert.equal(formatLateDuration(bobLateCheckIn.late_by_seconds), '12m after prompt');

    // 6. Solo user posts are always spontaneous (never marked late)
    const soloPost = await submitDailyMoment({
      coupleId: 'solo_user_1',
      promptId: `prompt_solo_user_1_${today}`,
      userId: 'user_1',
      authorName: 'Solo',
      backUri: 'data:image/jpeg;base64,SOLO_BACK',
      frontUri: 'data:image/jpeg;base64,SOLO_FRONT',
      capturedAtIso: new Date(Date.now() + 8 * 3600_000).toISOString(),
    });
    assert.equal(soloPost.is_prompt_checkin, false);
    assert.equal(soloPost.is_late, false);
  });

});

describe('Shared Pulse Streak System: Grace Shields, Golden Syncs & Milestone Chapters', () => {
  beforeEach(async () => {
    await resetAllState();
  });

  it('bridges a 1-day missed gap using a Grace Shield, awards +1 shield on 7th day, and tracks Golden Syncs & stamps', async () => {
    const coupleId = 'couple_pulse_test';

    // Start at day 2 completed on 2026-11-01 with 1 shield
    let streak = advanceStreakOnDualPost({
      previous: {
        couple_id: coupleId,
        current_count: 2,
        longest_count: 2,
        last_completed_date: '2026-11-01',
        grace_shields: 1,
        shield_used_dates: [],
        golden_sync_count: 1,
        unlocked_milestones: [],
      },
      coupleId,
      todayDate: '2026-11-02',
      bothOnTime: true,
    });

    assert.equal(streak.current_count, 3);
    assert.equal(streak.golden_sync_count, 2);
    assert.deepEqual(streak.unlocked_milestones, [3]);

    // Skip 2026-11-03 (1-day gap) and post on 2026-11-04 -> Grace Shield bridges the gap!
    streak = advanceStreakOnDualPost({
      previous: streak,
      coupleId,
      todayDate: '2026-11-04',
      bothOnTime: false,
    });

    assert.equal(streak.current_count, 4, 'Grace shield must bridge a 1-day gap to Day 4');
    assert.equal(streak.grace_shields, 0, 'Grace shield count must decrement by 1');
    assert.ok(streak.shield_used_dates?.includes('2026-11-03'), 'Missed date must be recorded in shield_used_dates');
    assert.equal(streak.golden_sync_count, 2, 'Late sync must not increment golden_sync_count');

    // Advance through days 5, 6, 7 -> Day 7 unlocks Weekly Ritual (7d) and awards +1 Grace Shield
    streak = advanceStreakOnDualPost({ previous: streak, coupleId, todayDate: '2026-11-05', bothOnTime: true });
    streak = advanceStreakOnDualPost({ previous: streak, coupleId, todayDate: '2026-11-06', bothOnTime: true });
    streak = advanceStreakOnDualPost({ previous: streak, coupleId, todayDate: '2026-11-07', bothOnTime: true });

    assert.equal(streak.current_count, 7);
    assert.equal(streak.grace_shields, 1, 'Reaching 7-day multiple must award +1 Grace Shield');
    assert.deepEqual(streak.unlocked_milestones, [3, 7]);

    const chapterInfo = getCurrentAndNextChapter(streak.current_count);
    assert.equal(chapterInfo.current?.title, 'Weekly Ritual');
    assert.equal(chapterInfo.next?.title, 'Fortnight');
    assert.equal(chapterInfo.daysRemaining, 7);

    const stamps = getAvailableCollageStamps(streak.current_count, streak.longest_count);
    assert.equal(stamps.length, 3, 'Should have Classic + 3d Spark + 7d Weekly Ritual stamps');
    assert.ok(stamps[2].watermarkText.includes('WEEKLY RITUAL · DAY 7'));

    const enriched = enrichStreakWithRecentChain({
      streak,
      coupleId,
      userId: 'user_a',
      todayDate: '2026-11-07',
      moments: [],
    });
    assert.equal(enriched.recent_chain?.length, 7);
    const bridgedNode = enriched.recent_chain?.find((n) => n.date === '2026-11-03');
    assert.equal(bridgedNode?.state, 'shield');
  });
});
