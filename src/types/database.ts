export type CoupleState = 'pending' | 'active';
export type LocationMode = 'live' | 'on_moment' | 'ghost';
export type StatusDurationPreset = '1h' | '3h' | 'tonight';

export interface UserProfile {
  id: string;
  display_name: string;
  avatar_path: string | null;
  timezone: string;
  push_token: string | null;
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

export interface MomentRecord {
  id: string;
  couple_id: string;
  prompt_id: string;
  user_id: string;
  back_photo_path: string;
  front_photo_path: string;
  back_blurhash: string;
  collage_photo_path: string | null;
  caption: string | null;
  captured_at: string;
  posted_at: string;
  late_by_seconds: number;
  is_late: boolean;
  retake_count: number;
  lat: number | null;
  lng: number | null;
  back_photo_url?: string | null;
  front_photo_url?: string | null;
}

export interface PartnerMomentView {
  id: string;
  user_id: string;
  locked: boolean;
  back_photo_path: string | null;
  front_photo_path: string | null;
  back_blurhash: string;
  caption: string | null;
  captured_at: string;
  posted_at: string;
  late_by_seconds: number;
  is_late: boolean;
  retake_count: number;
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
}
