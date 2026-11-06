import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { WidgetSnapshotPayload } from '@/types/database';

export const WIDGET_SNAPSHOT_STORAGE_KEY = 'keepit.widget_snapshot.v1';

interface KeepItWidgetBridgeNativeModule {
  syncWidgetSnapshotAsync(snapshotJson: string): Promise<void>;
  clearWidgetSnapshotAsync(): Promise<void>;
  getLastSyncedWidgetSnapshotAsync?(): Promise<string | null>;
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
    : payload;

  const serialized = JSON.stringify(sanitizedPayload);
  await AsyncStorage.setItem(WIDGET_SNAPSHOT_STORAGE_KEY, serialized);

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
  await AsyncStorage.removeItem(WIDGET_SNAPSHOT_STORAGE_KEY);

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
    const stored = await AsyncStorage.getItem(WIDGET_SNAPSHOT_STORAGE_KEY);
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
