import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { WidgetSnapshotPayload } from '@/types/database';
import {
  safeGetStorageItem,
  safeRemoveStorageItem,
  safeSetStorageItem,
  spillDataUriToFileIfLarge,
} from '@/utils/safeAsyncStorage';

export const WIDGET_SNAPSHOT_STORAGE_KEY = 'keepit.widget_snapshot.v1';
export const WIDGET_PINNED_STORAGE_KEY = 'keepit.widget_pinned.v1';

export interface PinWidgetResult {
  pinned: boolean;
  mode: 'native_pinned' | 'manual_instructions' | 'unsupported';
  message: string;
}

export interface NativeCompositeExportResult {
  fileUri?: string;
  savedToGallery?: boolean;
}

interface KeepItWidgetBridgeNativeModule {
  syncWidgetSnapshotAsync(snapshotJson: string): Promise<void>;
  clearWidgetSnapshotAsync(): Promise<void>;
  getLastSyncedWidgetSnapshotAsync?(): Promise<string | null>;
  requestPinWidgetAsync?(): Promise<boolean>;
  exportCompositeMomentJpegAsync?(payloadJson: string): Promise<string>;
  extractVideoThumbnailJpegAsync?(videoUri: string): Promise<string | null>;
  compressImageToDataUriAsync?(
    uriStr: string,
    maxDimension: number,
    quality: number
  ): Promise<string | null>;
}
function getNativeBridge(): KeepItWidgetBridgeNativeModule | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return null;
  }
  return requireOptionalNativeModule<KeepItWidgetBridgeNativeModule>('KeepItWidgetBridge');
}

function isValidWidgetSnapshot(candidate: unknown): candidate is WidgetSnapshotPayload {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    typeof record.coupleId === 'string' &&
    typeof record.partnerName === 'string' &&
    typeof record.momentLocked === 'boolean' &&
    typeof record.streakCount === 'number' &&
    typeof record.deepLinkUrl === 'string' &&
    typeof record.updatedAt === 'string'
  );
}

/**
 * Persists the latest partner Moment + status snapshot to AsyncStorage (for in-app
 * previews, Expo Go, and web) and forwards it to the native iOS App Group / Android
 * Glance SharedPreferences bridge when compiled into a native build.
 */
export async function syncWidgetSnapshot(payload: WidgetSnapshotPayload): Promise<void> {
  const sanitizedPayload: WidgetSnapshotPayload = payload.momentLocked
    ? {
        ...payload,
        momentPhotoUri: null,
        momentFrontPhotoUri: null,
      }
    : { ...payload };

  if (Platform.OS !== 'web' && !sanitizedPayload.momentLocked) {
    if (
      sanitizedPayload.momentPhotoUri?.startsWith('data:') &&
      sanitizedPayload.momentPhotoUri.length > 90_000
    ) {
      sanitizedPayload.momentPhotoUri = await spillDataUriToFileIfLarge(
        sanitizedPayload.momentPhotoUri,
        'widget-back'
      );
    }
    if (
      sanitizedPayload.momentFrontPhotoUri?.startsWith('data:') &&
      sanitizedPayload.momentFrontPhotoUri.length > 90_000
    ) {
      sanitizedPayload.momentFrontPhotoUri = await spillDataUriToFileIfLarge(
        sanitizedPayload.momentFrontPhotoUri,
        'widget-front'
      );
    }
    if (
      sanitizedPayload.myPhotoUri?.startsWith('data:') &&
      sanitizedPayload.myPhotoUri.length > 90_000
    ) {
      sanitizedPayload.myPhotoUri = await spillDataUriToFileIfLarge(
        sanitizedPayload.myPhotoUri,
        'widget-mine-back'
      );
    }
    if (
      sanitizedPayload.myFrontPhotoUri?.startsWith('data:') &&
      sanitizedPayload.myFrontPhotoUri.length > 90_000
    ) {
      sanitizedPayload.myFrontPhotoUri = await spillDataUriToFileIfLarge(
        sanitizedPayload.myFrontPhotoUri,
        'widget-mine-front'
      );
    }
  }
  const serialized = JSON.stringify(sanitizedPayload);
  await safeSetStorageItem(WIDGET_SNAPSHOT_STORAGE_KEY, serialized);

  const nativeBridge = getNativeBridge();
  if (nativeBridge) {
    try {
      await nativeBridge.syncWidgetSnapshotAsync(serialized);
    } catch {
      // Keep AsyncStorage snapshot intact if native widget extension isn't mounted yet
    }
  }
}

/**
 * Clears any persisted widget snapshot from AsyncStorage and resets native iOS/Android
 * home screen timelines so signed-out or unpaired devices never display stale couple data.
 */
export async function clearWidgetSnapshot(): Promise<void> {
  await safeRemoveStorageItem(WIDGET_SNAPSHOT_STORAGE_KEY);

  const nativeBridge = getNativeBridge();
  if (nativeBridge) {
    try {
      await nativeBridge.clearWidgetSnapshotAsync();
    } catch {
      // Ignore missing native extension in Expo Go / simulator environments
    }
  }
}

/**
 * Reads back the most recently synced widget snapshot from AsyncStorage, falling back
 * to the native bridge container if AsyncStorage was cleared independently.
 */
export async function getLastSyncedWidgetSnapshot(): Promise<WidgetSnapshotPayload | null> {
  try {
    const stored = await safeGetStorageItem(WIDGET_SNAPSHOT_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (isValidWidgetSnapshot(parsed)) {
        return parsed;
      }
    }

    const nativeBridge = getNativeBridge();
    if (nativeBridge?.getLastSyncedWidgetSnapshotAsync) {
      const nativeRaw = await nativeBridge.getLastSyncedWidgetSnapshotAsync();
      if (nativeRaw) {
        const parsedNative: unknown = JSON.parse(nativeRaw);
        if (isValidWidgetSnapshot(parsedNative)) {
          return parsedNative;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Requests pinning the KeepIt widget directly onto the user's Home Screen on Android O+
 * (API 26+) via `AppWidgetManager.requestPinAppWidget`. Returns truthful platform status
 * instead of fabricating pin success on iOS, Web, or unsupported launchers.
 */
export async function requestPinKeepItWidgetDetailed(): Promise<PinWidgetResult> {
  const nativeBridge = getNativeBridge();
  if (Platform.OS === 'android') {
    if (nativeBridge?.requestPinWidgetAsync) {
      try {
        const requested = await nativeBridge.requestPinWidgetAsync();
        if (requested) {
          await AsyncStorage.setItem(WIDGET_PINNED_STORAGE_KEY, 'true');
          return {
            pinned: true,
            mode: 'native_pinned',
            message: 'System widget pin prompt opened on your Android Home Screen.',
          };
        }
        return {
          pinned: false,
          mode: 'manual_instructions',
          message:
            'Your launcher does not support one-tap pinning. Long-press your Home Screen → Widgets → KeepIt.',
        };
      } catch {
        return {
          pinned: false,
          mode: 'manual_instructions',
          message:
            'Widget extension requires a native Android build. Long-press your Home Screen → Widgets → KeepIt.',
        };
      }
    }
    return {
      pinned: false,
      mode: 'manual_instructions',
      message: 'Long-press your Android Home Screen → Widgets → KeepIt to add the widget.',
    };
  }

  if (Platform.OS === 'ios') {
    return {
      pinned: false,
      mode: 'manual_instructions',
      message:
        'Snapshot synced! On iOS, long-press your Home Screen → tap + in the top corner → search "KeepIt".',
    };
  }

  return {
    pinned: false,
    mode: 'unsupported',
    message: 'Home Screen widgets require the iOS or Android mobile app.',
  };
}

export async function requestPinKeepItWidget(): Promise<boolean> {
  const res = await requestPinKeepItWidgetDetailed();
  return res.pinned;
}

export async function exportNativeCompositeMomentJpeg(
  payload: Record<string, unknown>
): Promise<NativeCompositeExportResult | null> {
  const nativeBridge = getNativeBridge();
  if (!nativeBridge?.exportCompositeMomentJpegAsync) {
    return null;
  }
  try {
    const raw = await nativeBridge.exportCompositeMomentJpegAsync(JSON.stringify(payload));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const fileUri = 'fileUri' in parsed && typeof parsed.fileUri === 'string' ? parsed.fileUri : undefined;
      const savedToGallery =
        'savedToGallery' in parsed && typeof parsed.savedToGallery === 'boolean'
          ? parsed.savedToGallery
          : undefined;
      return { fileUri, savedToGallery };
    }
  } catch {
    return null;
  }
  return null;
}

export async function extractVideoThumbnailJpeg(videoUri: string): Promise<string | null> {
  const frames = await extractVideoDualFramesJpeg(videoUri);
  return frames?.startUri ?? null;
}

export async function extractVideoDualFramesJpeg(
  videoUri: string
): Promise<{ startUri: string; endUri: string } | null> {
  const nativeBridge = getNativeBridge();
  if (!nativeBridge?.extractVideoThumbnailJpegAsync) {
    return null;
  }
  try {
    const raw = await nativeBridge.extractVideoThumbnailJpegAsync(videoUri);
    if (!raw) return null;
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as { startUri?: string; endUri?: string };
      if (parsed.startUri) {
        return {
          startUri: parsed.startUri,
          endUri: parsed.endUri ?? parsed.startUri,
        };
      }
    }
    return { startUri: raw, endUri: raw };
  } catch {
    return null;
  }
}
export async function compressImageForCrossDeviceShare(
  uri: string,
  maxDimension = 640,
  quality = 68
): Promise<string | null> {
  if (!uri) return null;
  const nativeBridge = getNativeBridge();
  if (!nativeBridge?.compressImageToDataUriAsync) {
    return null;
  }
  try {
    const dataUri = await nativeBridge.compressImageToDataUriAsync(uri, maxDimension, quality);
    if (dataUri && dataUri.startsWith('data:image/')) {
      return dataUri;
    }
  } catch {
    return null;
  }
  return null;
}

export async function isKeepItWidgetPinned(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(WIDGET_PINNED_STORAGE_KEY);
    return stored === 'true';
  } catch {
    return false;
  }
}
