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
