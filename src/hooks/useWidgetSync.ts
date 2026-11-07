import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CoupleStatusBundle,
  StatusRecord,
  TodayMomentBundle,
  WidgetSnapshotPayload,
} from '@/types/database';

import {
  clearWidgetSnapshot,
  getLastSyncedWidgetSnapshot,
  syncWidgetSnapshot,
} from '../../modules/keepit-widget-bridge';

export interface UseWidgetSyncParams {
  partnerName: string;
  coupleId: string | null | undefined;
  momentBundle: TodayMomentBundle | null | undefined;
  statusBundle: CoupleStatusBundle | null | undefined;
}

export interface UseWidgetSyncResult {
  snapshot: WidgetSnapshotPayload | null;
  lastSyncedAt: string | null;
  error: string | null;
  forceSync: () => Promise<void>;
}

function getActiveStatus(status: StatusRecord | null | undefined, nowMs: number): StatusRecord | null {
  if (!status) {
    return null;
  }
  const expiresMs = new Date(status.expires_at).getTime();
  if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
    return null;
  }
  return status;
}

export function buildWidgetSnapshotPayload(params: {
  coupleId: string;
  partnerName: string;
  momentBundle: TodayMomentBundle | null | undefined;
  statusBundle: CoupleStatusBundle | null | undefined;
  now?: Date;
}): WidgetSnapshotPayload {
  const now = params.now ?? new Date();
  const rawPartnerMoment = params.momentBundle?.partner ?? null;
  const rawMyMoment = params.momentBundle?.mine ?? null;
  const partnerMoment = rawPartnerMoment?.snap_once ? null : rawPartnerMoment;
  const myMoment = rawMyMoment?.snap_once ? null : rawMyMoment;
  const momentLocked = Boolean(partnerMoment?.locked);

  const activePartnerStatus =
    getActiveStatus(params.statusBundle?.partner, now.getTime()) ??
    (partnerMoment === null ? getActiveStatus(params.statusBundle?.mine, now.getTime()) : null);

  const fallbackMoment = !momentLocked && !partnerMoment ? myMoment : null;

  const momentPhotoUri = !momentLocked
    ? partnerMoment
      ? (partnerMoment.back_photo_url ?? partnerMoment.back_photo_path ?? null)
      : (fallbackMoment?.back_photo_url ?? fallbackMoment?.back_photo_path ?? null)
    : null;

  const momentFrontPhotoUri = !momentLocked
    ? partnerMoment
      ? (partnerMoment.front_photo_url ?? partnerMoment.front_photo_path ?? null)
      : (fallbackMoment?.front_photo_url ?? fallbackMoment?.front_photo_path ?? null)
    : null;

  const momentCaption = !momentLocked
    ? partnerMoment
      ? (partnerMoment.caption ?? null)
      : (fallbackMoment?.caption ?? null)
    : null;

  const momentPostedAt = partnerMoment?.posted_at ?? fallbackMoment?.posted_at ?? null;
  const locationLabel = !momentLocked
    ? (partnerMoment?.location_label ?? fallbackMoment?.location_label ?? null)
    : null;
  const musicTitle = !momentLocked
    ? (partnerMoment?.music_track?.title ?? fallbackMoment?.music_track?.title ?? null)
    : null;

  const streakCount = params.momentBundle?.streak?.current_count ?? 0;
  const deepLinkUrl = momentLocked ? 'keepit://camera' : 'keepit://';

  return {
    coupleId: params.coupleId,
    partnerName: !partnerMoment && (fallbackMoment || (activePartnerStatus && activePartnerStatus === params.statusBundle?.mine))
      ? 'You'
      : params.partnerName,
    statusEmoji: activePartnerStatus?.emoji ?? null,
    statusText: activePartnerStatus?.text ?? null,
    statusExpiresAt: activePartnerStatus?.expires_at ?? null,
    momentPhotoUri,
    momentFrontPhotoUri,
    momentCaption,
    momentPostedAt,
    momentLocked,
    streakCount,
    deepLinkUrl,
    updatedAt: now.toISOString(),
    locationLabel,
    musicTitle,
  };
}

/**
 * Computes a deterministic content fingerprint excluding `updatedAt` so the bridge
 * only writes to disk / reloads native WidgetKit & Glance timelines when actual
 * partner Moment, lock state, streak, or live status content changes.
 */
function computeSnapshotSignature(payload: WidgetSnapshotPayload): string {
  return JSON.stringify({
    coupleId: payload.coupleId,
    partnerName: payload.partnerName,
    statusEmoji: payload.statusEmoji,
    statusText: payload.statusText,
    statusExpiresAt: payload.statusExpiresAt,
    momentPhotoUri: payload.momentPhotoUri,
    momentFrontPhotoUri: payload.momentFrontPhotoUri,
    momentCaption: payload.momentCaption,
    momentPostedAt: payload.momentPostedAt,
    momentLocked: payload.momentLocked,
    streakCount: payload.streakCount,
    deepLinkUrl: payload.deepLinkUrl,
    locationLabel: payload.locationLabel ?? null,
    musicTitle: payload.musicTitle ?? null,
  });
}

export function useWidgetSync({
  partnerName,
  coupleId,
  momentBundle,
  statusBundle,
}: UseWidgetSyncParams): UseWidgetSyncResult {
  const [cachedSnapshot, setCachedSnapshot] = useState<WidgetSnapshotPayload | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSyncedSignatureRef = useRef<string | null>(null);

  // Hydrate previously synced widget snapshot on mount so cold start previews render immediately
  useEffect(() => {
    let active = true;
    void getLastSyncedWidgetSnapshot().then((saved) => {
      if (!active || !saved) return;
      if (!coupleId || saved.coupleId === coupleId) {
        setCachedSnapshot(saved);
        setLastSyncedAt(saved.updatedAt);
      }
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load your widget preview. Try syncing again.');
    });
    return () => {
      active = false;
    };
  }, [coupleId]);

  const liveSnapshot = useMemo<WidgetSnapshotPayload | null>(() => {
    if (!coupleId) {
      return null;
    }
    return buildWidgetSnapshotPayload({
      coupleId,
      partnerName,
      momentBundle,
      statusBundle,
    });
  }, [coupleId, partnerName, momentBundle, statusBundle]);

  // Clear persisted snapshot if the couple unpairs or signs out
  useEffect(() => {
    if (coupleId) {
      return;
    }
    lastSyncedSignatureRef.current = null;
    let active = true;
    void clearWidgetSnapshot().then(() => {
      if (!active) return;
      setCachedSnapshot(null);
      setLastSyncedAt(null);
    }).catch((err: unknown) => {
      if (!active) return;
      setError(err instanceof Error ? err.message : 'Could not clear the previous widget snapshot. Try syncing again.');
    });
    return () => { active = false; };
  }, [coupleId]);

  // Sync automatically whenever partner Moment, lock state, or status changes
  useEffect(() => {
    if (!liveSnapshot) {
      return;
    }

    const nextSignature = computeSnapshotSignature(liveSnapshot);
    if (lastSyncedSignatureRef.current === nextSignature) {
      return;
    }

    lastSyncedSignatureRef.current = nextSignature;
    const stampedSnapshot: WidgetSnapshotPayload = {
      ...liveSnapshot,
      updatedAt: new Date().toISOString(),
    };

    let active = true;
    void syncWidgetSnapshot(stampedSnapshot).then(() => {
      if (!active) return;
      setCachedSnapshot(stampedSnapshot);
      setLastSyncedAt(stampedSnapshot.updatedAt);
      setError(null);
    }).catch((err: unknown) => {
      if (!active) return;
      if (lastSyncedSignatureRef.current === nextSignature) lastSyncedSignatureRef.current = null;
      setError(err instanceof Error ? err.message : 'Your widget could not sync. Try again.');
    });

    return () => {
      active = false;
    };
  }, [liveSnapshot]);

  const forceSync = useCallback(async () => {
    setError(null);
    try {
      if (!coupleId) {
        await clearWidgetSnapshot();
        lastSyncedSignatureRef.current = null;
        setCachedSnapshot(null);
        setLastSyncedAt(null);
        return;
      }

      const freshSnapshot = buildWidgetSnapshotPayload({
        coupleId,
        partnerName,
        momentBundle,
        statusBundle,
        now: new Date(),
      });
      await syncWidgetSnapshot(freshSnapshot);
      lastSyncedSignatureRef.current = computeSnapshotSignature(freshSnapshot);
      setCachedSnapshot(freshSnapshot);
      setLastSyncedAt(freshSnapshot.updatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your widget could not sync. Try again.');
      throw err;
    }
  }, [coupleId, partnerName, momentBundle, statusBundle]);

  return {
    snapshot: coupleId ? (liveSnapshot ?? cachedSnapshot) : null,
    lastSyncedAt: coupleId ? lastSyncedAt : null,
    error,
    forceSync,
  };
}
