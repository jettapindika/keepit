export type CoupleState = 'pending' | 'active';
export type LocationMode = 'live' | 'on_moment' | 'ghost';
export type StatusDurationPreset = '1h' | '3h' | 'tonight';
export type PostVisibility = 'partner' | 'friends' | 'everyone';
export type MomentFilterPreset =
  | 'normal'
  | 'warm_film'
  | 'polaroid'
  | 'noir'
  | 'cyber_neon'
  | 'golden_hour'
  | 'vhs_retro'
  | 'dreamy';
export type MomentMediaType = 'photo' | 'video';

export interface UserProfile {
  id: string;
  display_name: string;
  username?: string;
  bio?: string;
  pronouns?: string;
  mood_song?: string;
  banner_color?: string;
  website?: string;
  friend_code?: string;
  is_private?: boolean;
  dump_mode?: boolean;
  avatar_path: string | null;
  timezone: string;
  push_token: string | null;
  created_at: string;
}

export interface FriendRecord {
  id: string;
  user_id: string;
  friend_id: string;
  friend_profile: UserProfile;
  relationship: 'partner' | 'bestie' | 'friend';
  created_at: string;
}

export interface MusicTrackAttachment {
  id: string;
  title: string;
  artist: string;
  coverColor: string;
  previewNote?: string;
  bpm?: number;
}

export interface TaggedPerson {
  userId: string;
  displayName: string;
  username: string;
}

export interface PhotoOverlayItem {
  id: string;
  kind: 'emoji' | 'text';
  content: string;
  color?: string;
  bgStyle?: 'glass' | 'solid' | 'neon' | 'none';
  size?: 'sm' | 'md' | 'lg';
  xPct: number; // 0..100 horizontal position on photo
  yPct: number; // 0..100 vertical position on photo
}

export interface MomentCommentRecord {
  id: string;
  moment_id: string;
  author_id: string;
  author_name: string;
  author_username?: string;
  author_avatar?: string | null;
  text: string;
  emoji_reaction?: string | null;
  created_at: string;
}

export interface MomentReactionSummary {
  emoji: string;
  userIds: string[];
  userNames: string[];
}

export interface DirectMessageRecord {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  recipient_id: string;
  text: string;
  media_uri?: string | null;
  reply_moment_id?: string | null;
  reply_moment_preview?: string | null;
  snap_once?: boolean;
  snap_duration_seconds?: number;
  snap_opened_at_by_user?: Record<string, string>;
  viewed_by_user_ids?: string[];
  viewed_at?: string | null;
  reactions?: Record<string, string>; // userId -> emoji
  created_at: string;
}

export interface CoupleRecord {
  id: string;
  user_a_id: string;
  user_b_id: string | null;
  invite_code: string;
  invite_expires_at: string;
  state: CoupleState;
  paired_at: string | null;
  created_at: string;
}

export interface PairingSnapshot {
  couple: CoupleRecord | null;
  partner: UserProfile | null;
}

export type PairingErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_CODE_FORMAT'
  | 'ALREADY_PAIRED'
  | 'CODE_NOT_FOUND'
  | 'SELF_INVITE_FORBIDDEN'
  | 'COUPLE_FULL'
  | 'CODE_EXPIRED'
  | 'NETWORK_ERROR';

export class PairingError extends Error {
  readonly code: PairingErrorCode;

  constructor(code: PairingErrorCode, message: string) {
    super(message);
    this.name = 'PairingError';
    this.code = code;
  }
}

export interface DailyPromptRecord {
  id: string;
  couple_id: string;
  prompt_date: string;
  trigger_at: string;
  notified_at: string | null;
}

export const MAX_DAILY_MOMENTS_PER_DAY = 5;

export interface MomentRecord {
  id: string;
  couple_id: string;
  prompt_id: string;
  user_id: string;
  author_name?: string;
  author_username?: string;
  author_avatar?: string | null;
  back_photo_path: string;
  media_type?: MomentMediaType;
  video_uri?: string | null;
  video_duration_seconds?: number | null;
  filter_preset?: MomentFilterPreset;
  front_photo_path: string;
  back_blurhash: string;
  collage_photo_path: string | null;
  caption: string | null;
  captured_at: string;
  posted_at: string;
  late_by_seconds: number;
  is_late: boolean;
  retake_count: number;
  daily_index?: number; // 1..5
  lat: number | null;
  lng: number | null;
  location_label?: string | null;
  music_track?: MusicTrackAttachment | null;
  tagged_users?: TaggedPerson[];
  overlays?: PhotoOverlayItem[];
  visibility?: PostVisibility;
  snap_once?: boolean;
  snap_duration_seconds?: number; // default 15
  viewed_by_user_ids?: string[];
  snap_opened_at_by_user?: Record<string, string>; // userId -> ISO timestamp when 15s countdown started
  comments?: MomentCommentRecord[];
  reactions?: Record<string, string>; // userId -> emoji
  watermark_tag?: string; // default '#KeepIt'
  back_photo_url?: string | null;
  front_photo_url?: string | null;
}

export interface PartnerMomentView {
  id: string;
  user_id: string;
  author_name?: string;
  author_username?: string;
  author_avatar?: string | null;
  locked: boolean;
  back_photo_path: string | null;
  front_photo_path: string | null;
  back_blurhash: string;
  media_type?: MomentMediaType;
  video_uri?: string | null;
  video_duration_seconds?: number | null;
  filter_preset?: MomentFilterPreset;
  caption: string | null;
  captured_at: string;
  posted_at: string;
  late_by_seconds: number;
  is_late: boolean;
  retake_count: number;
  daily_index?: number;
  lat?: number | null;
  lng?: number | null;
  location_label?: string | null;
  music_track?: MusicTrackAttachment | null;
  tagged_users?: TaggedPerson[];
  overlays?: PhotoOverlayItem[];
  visibility?: PostVisibility;
  snap_once?: boolean;
  snap_duration_seconds?: number;
  viewed_by_user_ids?: string[];
  snap_opened_at_by_user?: Record<string, string>;
  comments?: MomentCommentRecord[];
  reactions?: Record<string, string>;
  watermark_tag?: string;
  back_photo_url?: string | null;
  front_photo_url?: string | null;
}

export interface StreakRecord {
  couple_id: string;
  current_count: number;
  longest_count: number;
  last_completed_date: string | null;
  updated_at?: string;
}

export interface TodayMomentBundle {
  prompt: DailyPromptRecord;
  streak: StreakRecord;
  mine: MomentRecord | null;
  partner: PartnerMomentView | null;
  myMomentsToday?: MomentRecord[];
  partnerMomentsToday?: PartnerMomentView[];
  friendMomentsToday?: MomentRecord[];
  dailyPostCount?: number;
  maxDailyPosts?: number;
}

export interface StatusRecord {
  user_id: string;
  couple_id: string;
  emoji: string;
  text: string;
  duration_preset: StatusDurationPreset;
  expires_at: string;
  updated_at: string;
}

export interface CoupleStatusBundle {
  mine: StatusRecord | null;
  partner: StatusRecord | null;
}

export interface LocationShareRecord {
  user_id: string;
  couple_id: string;
  display_name?: string;
  mode: LocationMode;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  place_name?: string | null;
  location_updated_at: string | null;
  mode_changed_at: string;
}

export interface CoupleEventRecord {
  id: string;
  couple_id?: string;
  actor_id: string;
  event_type: 'location_mode_changed' | 'nudge' | 'moment_posted';
  payload: {
    previous_mode?: LocationMode;
    new_mode?: LocationMode;
    note?: string;
    prompt_id?: string;
    is_late?: boolean;
    retake_count?: number;
  };
  created_at: string;
}

export interface CoupleLocationBundle {
  mine: LocationShareRecord | null;
  partner: LocationShareRecord | null;
  friends?: LocationShareRecord[];
  events: CoupleEventRecord[];
}

export interface MemoryDayRecord {
  prompt_id: string;
  prompt_date: string;
  mine: MomentRecord | null;
  partner: MomentRecord | null;
  allMoments?: MomentRecord[];
}

export interface MonthMemoriesBundle {
  days: MemoryDayRecord[];
  streak: StreakRecord | null;
}

export interface WidgetSnapshotPayload {
  coupleId: string;
  partnerName: string;
  statusEmoji: string | null;
  statusText: string | null;
  statusExpiresAt: string | null;
  momentPhotoUri: string | null;
  momentFrontPhotoUri: string | null;
  momentCaption: string | null;
  momentPostedAt: string | null;
  momentLocked: boolean;
  streakCount: number;
  deepLinkUrl: string;
  updatedAt: string;
  locationLabel?: string | null;
  musicTitle?: string | null;
  pinnedToHomeScreen?: boolean;
}
