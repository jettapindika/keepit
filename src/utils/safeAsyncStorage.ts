import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * Android SQLite `CursorWindow` has a hard ~2 MB per-query allocation limit.
 * Furthermore, `@react-native-async-storage/async-storage` `mergeValues` and
 * `multiGet` read existing rows inside transactions via `SELECT * FROM Storage WHERE key IN (...)`.
 * If any row in `AsyncStorage` exceeds ~1.5–2 MB (or if a JSON string contains large
 * base64 data URIs), SQLite throws:
 *   `Row too big to fit into CursorWindow requiredPos=0, totalRows=1`
 *
 * This module enforces strict per-key byte ceilings and spills large native
 * `data:image/...;base64,...` strings to `expo-file-system` files so `AsyncStorage`
 * rows remain small, fast, and immune to `CursorWindow` overflows.
 */
export const MAX_SAFE_ASYNC_STORAGE_VALUE_CHARS = 750_000;
export const MAX_INLINE_DATA_URI_CHARS = 90_000;

let spillCounter = 0;

function isCursorWindowError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /CursorWindow|Row too big|SQLiteBlobTooBigException/i.test(msg);
}

/**
 * On native platforms (Android/iOS), if a `data:image/...;base64,...` URI exceeds
 * `maxInlineChars`, writes the decoded binary bytes to `FileSystem.Paths.document`
 * (or cache) and returns the compact `file://` URI so it never bloats SQLite rows.
 */
export async function spillDataUriToFileIfLarge(
  uri: string | null | undefined,
  prefix = 'media',
  maxInlineChars = MAX_INLINE_DATA_URI_CHARS
): Promise<string | null> {
  if (!uri) return null;
  if (Platform.OS === 'web' || !uri.startsWith('data:') || uri.length <= maxInlineChars) {
    return uri;
  }

  try {
    const commaIdx = uri.indexOf(',');
    if (commaIdx < 0) return uri;
    const header = uri.slice(5, commaIdx);
    const mime = header.split(';')[0] || 'image/jpeg';
    if (mime === 'image/svg+xml') {
      return uri;
    }
    const ext =
      mime === 'image/png'
        ? 'png'
        : mime === 'image/webp'
          ? 'webp'
          : mime === 'video/mp4'
            ? 'mp4'
            : 'jpg';
    const b64 = uri.slice(commaIdx + 1);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    spillCounter += 1;
    const baseDir = FileSystem.Paths?.document || FileSystem.Paths?.cache || 'file:///tmp/keepit-doc';
    const filename = `keepit-${prefix}-${Date.now().toString(36)}-${spillCounter}.${ext}`;
    const file = new FileSystem.File(baseDir, filename);
    await file.write(bytes);
    return file.uri;
  } catch {
    // If file write fails and the data URI is dangerously huge, drop it rather than bricking SQLite CursorWindow
    if (uri.length > MAX_SAFE_ASYNC_STORAGE_VALUE_CHARS) {
      return null;
    }
    return uri;
  }
}

/**
 * Safely reads a key from `AsyncStorage`. If Android throws a `CursorWindow` error
 * because a previously stored row is >2 MB, automatically purges the oversized row
 * via `removeItem` (`DELETE FROM Storage WHERE key = ?` does not allocate a CursorWindow)
 * and returns `null` so the app self-heals instead of crashing.
 */
export async function safeGetStorageItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch (err) {
    if (isCursorWindowError(err)) {
      await AsyncStorage.removeItem(key).catch(() => {});
    }
    return null;
  }
}

/**
 * Safely writes a key to `AsyncStorage`, guarding against values that would exceed
 * Android's SQLite `CursorWindow` limit (~2 MB). If `setItem` throws a CursorWindow
 * error (e.g. from native merge/read), removes the corrupted key and retries once.
 */
export async function safeSetStorageItem(key: string, value: string): Promise<void> {
  let payload = value;
  if (payload.length > MAX_SAFE_ASYNC_STORAGE_VALUE_CHARS) {
    // Strip embedded base64 data URIs exceeding MAX_INLINE_DATA_URI_CHARS inside JSON strings
    payload = payload.replace(
      /"data:(?:image|video|audio)\/[^;"]+;base64,[A-Za-z0-9+/=]{90000,}"/g,
      'null'
    );
  }

  try {
    await AsyncStorage.setItem(key, payload);
  } catch (err) {
    if (isCursorWindowError(err)) {
      await AsyncStorage.removeItem(key).catch(() => {});
      if (payload.length <= MAX_SAFE_ASYNC_STORAGE_VALUE_CHARS) {
        await AsyncStorage.setItem(key, payload).catch(() => {});
      }
      return;
    }
    throw err;
  }
}

export async function safeRemoveStorageItem(key: string): Promise<void> {
  await AsyncStorage.removeItem(key).catch(() => {});
}

export async function safeClearAllStorage(): Promise<void> {
  const clearFn = (AsyncStorage as unknown as { clear?: () => Promise<void> }).clear;
  if (typeof clearFn === 'function') {
    await clearFn.call(AsyncStorage).catch(() => {});
  }
}
