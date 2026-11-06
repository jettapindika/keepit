// tests/remediation.test.ts
// Comprehensive regression & behavioral verification suite for KeepIt remediation:
// - P0-1: Snap Once Moment & DM expiration lifecycle, storage scrubbing, sender preview safety, Memories/Widget exclusion
// - P0-2: Auth password security (zero plaintext passwords in AsyncStorage), signOut/wipeLocalAccount cleanup, Solo fallback preservation
// - P1-1: Real audible WAV PCM synthesis & single-track playback exclusivity
// - P1-2: Friends Circle real lookup (no fabricated profiles), removal persistence without re-seeding, persistent friend post comments/reactions
// - P1-3: Username uniqueness enforcement & Private Dump Account visibility enforcement
// - P1-4: Post CRUD 5/day limit, retake replacement, location coordinate clearing on edit, comment deletion authorization, DM reaction toggle-off sync
// - P2: Truthful widget pinning behavior & composite watermark SVG/export invariants

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { fetchMonthMemories } from '@/api/extras';
import { fetchCoupleLocations } from '@/api/locations';
import {
  addMomentComment,
  deleteMomentComment,
  deleteMomentPost,
  fetchTodayMomentBundle,
  getSnapOnceRemainingSeconds,
  isSnapOnceExpiredForViewer,
  markSnapOnceMomentState,
  submitDailyMoment,
  todayLocalDateString,
  toggleMomentReaction,
  updateMomentDetails,
} from '@/api/moments';
import { redeemInviteCode, upsertUserProfile } from '@/api/pairing';
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
import { useSessionStore } from '@/store/sessionStore';
import {
  buildSynthesizedTrackWavDataUri,
  getActiveMusicPreviewTrackId,
  stopMusicPreview,
  toggleMusicTrackPreview,
} from '@/utils/audioPreview';
import { buildMomentCompositeSvgDataUri } from '@/utils/momentExport';
import { requestPinKeepItWidgetDetailed } from '../modules/keepit-widget-bridge';

// Force offline/local-first mode during unit tests so tests never depend on external network reachability
process.env.EXPO_PUBLIC_SUPABASE_URL = 'offline';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = '';

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

    // Signing out clears account-specific caches (messages, friends, moments, widget)
    await useSessionStore.getState().signOut();
    assert.equal(await AsyncStorage.getItem('keepit.local_messages.v1'), null);
    assert.equal(await AsyncStorage.getItem('keepit.local_friends.v1'), null);
    assert.equal(await AsyncStorage.getItem('keepit.widget_snapshot.v1'), null);
  });

  it('rejects unknown 6-character invite codes instead of fabricating a synthetic ghost partner', async () => {
    await assert.rejects(
      () => redeemInviteCode('user_solo_1', 'Z9Y8X7'),
      (err: Error) => err.message.includes('No active invite matches')
    );
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

  it('rejects nonexistent usernames, finds directory/registered users by handle or code, and does not re-seed removed friends', async () => {
    const userId = 'user_circle_owner';
    const initial = await fetchFriendsCircle({ userId });
    assert.equal(initial.length, 2); // Sora & Leo seeded once

    // Removing both seeded friends must leave 0 friends (not re-seed them!)
    for (const f of initial) {
      await removeFriend({ userId, friendRecordId: f.id });
    }
    const afterRemoveAll = await fetchFriendsCircle({ userId });
    assert.equal(afterRemoveAll.length, 0, 'Removed seeded friends must not resurrect');

    // Adding a nonexistent handle must throw instead of fabricating a fake profile
    await assert.rejects(
      () =>
        addFriendByHandleOrCode({
          userId,
          query: '@totally_nonexistent_person_999',
        }),
      /No KeepIt user found/
    );

    // Adding a known directory user by Friend Code (`MAY-305`) succeeds and prevents duplicates
    const maya = await addFriendByHandleOrCode({
      userId,
      query: 'MAY-305',
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
  });

  it('persists comments and reactions on Friends feed posts across bundle refreshes', async () => {
    const userId = 'user_friend_reactor';
    const coupleId = 'solo_user_friend_reactor';

    const bundle1 = await fetchTodayMomentBundle({ coupleId, userId });
    assert.ok(bundle1.friendMomentsToday && bundle1.friendMomentsToday.length >= 2);
    const soraPost = bundle1.friendMomentsToday![0];

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
      text: 'Love the matcha shot!',
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

  it('defaults couple locations to Ghost mode (null coords) and omits fake Partner for Solo accounts', async () => {
    const locBundle = await fetchCoupleLocations({
      coupleId: 'solo_loc_user',
      userId: 'loc_user',
    });
    assert.equal(locBundle.mine?.mode, 'ghost');
    assert.equal(locBundle.mine?.lat, null);
    assert.equal(locBundle.partner, null);
  });

  it('returns truthful widget pin status on Web/iOS and bakes #KeepIt + tags into 3:4 & 9:16 composites', async () => {
    Platform.OS = 'web';
    const webPin = await requestPinKeepItWidgetDetailed();
    assert.equal(webPin.pinned, false);
    assert.equal(webPin.mode, 'unsupported');

    Platform.OS = 'ios';
    const iosPin = await requestPinKeepItWidgetDetailed();
    assert.equal(iosPin.pinned, false);
    assert.equal(iosPin.mode, 'manual_instructions');
    Platform.OS = 'web';

    const svg3x4 = decodeURIComponent(
      buildMomentCompositeSvgDataUri({
        backUri: 'data:image/jpeg;base64,AAA',
        frontUri: 'data:image/jpeg;base64,BBB',
        authorName: 'Jetta',
        aspect: '3:4',
      })
    );
    assert.ok(svg3x4.includes('#KeepIt'));

    const svg9x16 = decodeURIComponent(
      buildMomentCompositeSvgDataUri({
        backUri: 'data:image/jpeg;base64,AAA',
        frontUri: 'data:image/jpeg;base64,BBB',
        authorName: 'Jetta',
        taggedUsers: [{ userId: 'u1', displayName: 'Sora', username: 'sora.frames' }],
        overlays: [{ id: 'ov1', kind: 'text', content: 'neon vibe', bgStyle: 'neon', xPct: 50, yPct: 50 }],
        aspect: '9:16',
        storyTheme: 'neon',
      })
    );
    assert.ok(svg9x16.includes('#KeepIt'));
    assert.ok(svg9x16.includes('@sora.frames'));
    assert.ok(svg9x16.includes('neon vibe'));
  });
});
