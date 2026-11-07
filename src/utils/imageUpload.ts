import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

export type ProfileImageKind = 'avatar' | 'banner';

export interface PickedProfileImage {
  uri: string;
  mimeType: string;
  name: string;
}

const MAX_DIMENSIONS: Record<ProfileImageKind, { width: number; height: number }> = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1280, height: 480 },
};

function resizeWebImageToDataUri(
  rawDataUri: string,
  kind: ProfileImageKind,
  mimeType: string,
): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(rawDataUri);
  }
  if (mimeType === 'image/svg+xml' || rawDataUri.startsWith('data:image/svg+xml')) {
    return Promise.resolve(rawDataUri);
  }

  const { promise, resolve } = Promise.withResolvers<string>();
  const img = new globalThis.Image();
  img.onload = () => {
    try {
      const target = MAX_DIMENSIONS[kind];
      const srcW = img.naturalWidth || img.width || target.width;
      const srcH = img.naturalHeight || img.height || target.height;

      let outW = srcW;
      let outH = srcH;
      const scale = Math.min(1, target.width / srcW, target.height / srcH);
      if (scale < 1) {
        outW = Math.max(1, Math.round(srcW * scale));
        outH = Math.max(1, Math.round(srcH * scale));
      }

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawDataUri);
        return;
      }
      ctx.drawImage(img, 0, 0, outW, outH);
      const outputMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      const optimized = canvas.toDataURL(outputMime, 0.86);
      resolve(optimized || rawDataUri);
    } catch {
      resolve(rawDataUri);
    }
  };
  img.onerror = () => resolve(rawDataUri);
  img.src = rawDataUri;
  return promise;
}

function pickWebImageFile(kind: ProfileImageKind): Promise<PickedProfileImage | null> {
  if (typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  const { promise, resolve, reject } = Promise.withResolvers<PickedProfileImage | null>();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.style.opacity = '0';
  document.body.appendChild(input);

  let settled = false;
  const cleanup = () => {
    if (input.parentNode) {
      input.parentNode.removeChild(input);
    }
  };

  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) {
      settled = true;
      cleanup();
      resolve(null);
      return;
    }

    if (!file.type.startsWith('image/')) {
      settled = true;
      cleanup();
      reject(new Error('Please select a valid image file (PNG, JPG, WebP, or SVG).'));
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      settled = true;
      cleanup();
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('Could not read the selected image file.'));
        return;
      }
      const optimizedUri = await resizeWebImageToDataUri(result, kind, file.type || 'image/jpeg');
      resolve({
        uri: optimizedUri,
        mimeType: file.type || 'image/jpeg',
        name: file.name || `${kind}.jpg`,
      });
    };
    reader.onerror = () => {
      settled = true;
      cleanup();
      reject(new Error('Could not read the selected image file.'));
    };
    reader.readAsDataURL(file);
  };

  input.oncancel = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(null);
  };

  input.click();
  return promise;
}

async function pickNativeImageFile(kind: ProfileImageKind): Promise<PickedProfileImage | null> {
  const fsAny = FileSystem as unknown as {
    File?: {
      pickFileAsync?: (initialUri?: string, mimeType?: string) => Promise<
        | { uri: string; name?: string; type?: string; base64?: () => Promise<string> }
        | { uri: string; name?: string; type?: string; base64?: () => Promise<string> }[]
      >;
    };
  };

  if (typeof fsAny.File?.pickFileAsync === 'function') {
    try {
      const picked = await fsAny.File.pickFileAsync(undefined, 'image/*');
      const fileObj = Array.isArray(picked) ? picked[0] : picked;
      if (!fileObj?.uri) return null;

      const mimeType = fileObj.type && fileObj.type.startsWith('image/') ? fileObj.type : 'image/jpeg';
      if (typeof fileObj.base64 === 'function') {
        const b64 = await fileObj.base64();
        if (b64) {
          return {
            uri: `data:${mimeType};base64,${b64}`,
            mimeType,
            name: fileObj.name ?? `${kind}.jpg`,
          };
        }
      }

      return {
        uri: fileObj.uri,
        mimeType,
        name: fileObj.name ?? `${kind}.jpg`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/cancel/i.test(msg)) {
        return null;
      }
      throw err;
    }
  }

  return null;
}

export async function pickProfileImage(kind: ProfileImageKind): Promise<PickedProfileImage | null> {
  if (Platform.OS === 'web') {
    return pickWebImageFile(kind);
  }
  return pickNativeImageFile(kind);
}
