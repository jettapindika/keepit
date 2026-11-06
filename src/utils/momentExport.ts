import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import { Platform, Share } from 'react-native';

import { getFilterPresetMeta } from '@/api/social';
import { MomentFilterPreset, PhotoOverlayItem, TaggedPerson } from '@/types/database';

import { exportNativeCompositeMomentJpeg } from '../../modules/keepit-widget-bridge';
export type StoryThemePreset = 'midnight' | 'terracotta' | 'forest' | 'neon';

export const STORY_THEME_PRESETS: readonly {
  id: StoryThemePreset;
  label: string;
  topHex: string;
  midHex: string;
  bottomHex: string;
  accentHex: string;
}[] = [
  {
    id: 'midnight',
    label: 'Midnight Ember',
    topHex: '#191418',
    midHex: '#100E12',
    bottomHex: '#070709',
    accentHex: '#D95D39',
  },
  {
    id: 'terracotta',
    label: 'Warm Clay',
    topHex: '#3A1F18',
    midHex: '#231411',
    bottomHex: '#0F0A09',
    accentHex: '#F59E0B',
  },
  {
    id: 'forest',
    label: 'Moss Studio',
    topHex: '#132820',
    midHex: '#0D1A15',
    bottomHex: '#070C0A',
    accentHex: '#34D399',
  },
  {
    id: 'neon',
    label: 'Cyber Dusk',
    topHex: '#26143B',
    midHex: '#150D24',
    bottomHex: '#090610',
    accentHex: '#C084FC',
  },
] as const;

export function formatMomentWatermarkTimestamp(postedAtIso?: string | null): string {
  const parsed = postedAtIso ? new Date(postedAtIso) : new Date();
  const validDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const datePart = validDate.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
  const timePart = validDate.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${datePart} · ${timePart}`;
}

export function buildMomentCompositeSvgDataUri(params: {
  backUri: string;
  frontUri: string;
  authorName: string;
  postedAtIso?: string | null;
  timestampLabel?: string | null;
  caption?: string | null;
  locationLabel?: string | null;
  musicTitle?: string | null;
  filterPreset?: MomentFilterPreset;
  overlays?: PhotoOverlayItem[];
  taggedUsers?: TaggedPerson[];
  aspect: '3:4' | '9:16';
  storyTheme?: StoryThemePreset;
}): string {
  const filterMeta = getFilterPresetMeta(params.filterPreset);
  const safeAuthor = (params.authorName || 'KeepIt')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const safeHandle = safeAuthor.toLowerCase().replace(/[^a-z0-9_]+/g, '') || 'keepit';
  const safeCaption = (params.caption ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .slice(0, 110);
  const safeLocation = (params.locationLabel ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .slice(0, 64);
  const safeMusic = (params.musicTitle ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .slice(0, 64);
  const rawTimestamp =
    params.timestampLabel?.trim() || formatMomentWatermarkTimestamp(params.postedAtIso);
  const safeTimestamp = rawTimestamp
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const safeBackHref = params.backUri
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const safeFrontHref = params.frontUri
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const tintStopOpacity =
    params.filterPreset && params.filterPreset !== 'normal' ? '0.22' : '0';
  if (params.aspect === '3:4') {
    const frameW = 900;
    const frameH = 1200;
    const overlaysSvg = (params.overlays ?? [])
      .map((ov) => {
        const x = Math.round((Math.min(90, Math.max(8, ov.xPct)) / 100) * frameW);
        const y = Math.round((Math.min(88, Math.max(10, ov.yPct)) / 100) * frameH);
        const safeText = ov.content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
        if (ov.kind === 'emoji') {
          return `<text x="${x}" y="${y}" font-family="system-ui, -apple-system, sans-serif" font-size="60" text-anchor="middle">${safeText}</text>`;
        }
        const pillWidth = Math.max(160, Math.min(540, safeText.length * 20 + 48));
        const pillBg =
          ov.bgStyle === 'neon'
            ? '#A855F7'
            : ov.bgStyle === 'solid'
              ? '#141416'
              : '#18181B';
        return `
          <g transform="translate(${Math.max(24, x - Math.round(pillWidth / 2))}, ${y - 34})">
            <rect width="${pillWidth}" height="52" rx="26" fill="${pillBg}" opacity="0.88" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2"/>
            <text x="${Math.round(pillWidth / 2)}" y="34" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="25" font-weight="700" fill="#FFFFFF">${safeText}</text>
          </g>
        `;
      })
      .join('\n');

    const svg3x4 = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${frameW}" height="${frameH}" viewBox="0 0 ${frameW} ${frameH}">
        <defs>
          <clipPath id="mainClip">
            <rect x="0" y="0" width="${frameW}" height="${frameH}" rx="42"/>
          </clipPath>
          <clipPath id="pipClip">
            <rect x="38" y="38" width="236" height="314" rx="34"/>
          </clipPath>
          <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0.72"/>
          </linearGradient>
          <filter id="wmShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.82"/>
          </filter>
        </defs>
        <g clip-path="url(#mainClip)">
          <rect width="${frameW}" height="${frameH}" fill="#141416"/>
          <image href="${safeBackHref}" x="0" y="0" width="${frameW}" height="${frameH}" preserveAspectRatio="xMidYMid slice"/>
          <rect width="${frameW}" height="${frameH}" fill="${filterMeta.svgTintHex}" opacity="${tintStopOpacity}"/>
          <rect x="0" y="920" width="${frameW}" height="280" fill="url(#bottomFade)"/>
          <g clip-path="url(#pipClip)">
            <rect x="38" y="38" width="236" height="314" rx="34" fill="#1E1E21"/>
            <image href="${safeFrontHref}" x="38" y="38" width="236" height="314" preserveAspectRatio="xMidYMid slice"/>
          </g>
          <rect x="38" y="38" width="236" height="314" rx="34" fill="none" stroke="#FAF7F2" stroke-width="6"/>
          ${overlaysSvg}
          <g filter="url(#wmShadow)">
            <text x="42" y="1118" text-anchor="start" font-family="system-ui, -apple-system, sans-serif" font-size="38" font-weight="900" letter-spacing="-0.8" fill="#FFFFFF">#keepit</text>
            <text x="42" y="1154" text-anchor="start" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="700" fill="#FFFFFF" opacity="0.92">${safeTimestamp}</text>
          </g>
          <text x="862" y="1144" text-anchor="end" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700" fill="#FAF7F2" opacity="0.92">@${safeHandle} · ${filterMeta.label}</text>
        </g>
      </svg>
    `;

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg3x4.trim())}`;
  }

  const theme =
    STORY_THEME_PRESETS.find((t) => t.id === params.storyTheme) ?? STORY_THEME_PRESETS[0];
  const cardX = 90;
  const cardY = 230;
  const cardW = 900;
  const cardH = 1200;

  const storyOverlaysSvg = (params.overlays ?? [])
    .map((ov) => {
      const x = cardX + Math.round((Math.min(90, Math.max(8, ov.xPct)) / 100) * cardW);
      const y = cardY + Math.round((Math.min(88, Math.max(10, ov.yPct)) / 100) * cardH);
      const safeText = ov.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      if (ov.kind === 'emoji') {
        return `<text x="${x}" y="${y}" font-family="system-ui, -apple-system, sans-serif" font-size="62" text-anchor="middle">${safeText}</text>`;
      }
      const pillWidth = Math.max(168, Math.min(560, safeText.length * 20 + 48));
      const pillBg =
        ov.bgStyle === 'neon'
          ? '#A855F7'
          : ov.bgStyle === 'solid'
            ? '#141416'
            : '#18181B';
      return `
        <g transform="translate(${Math.max(cardX + 20, x - Math.round(pillWidth / 2))}, ${y - 34})">
          <rect width="${pillWidth}" height="52" rx="26" fill="${pillBg}" opacity="0.88" stroke="#FFFFFF" stroke-opacity="0.24" stroke-width="2"/>
          <text x="${Math.round(pillWidth / 2)}" y="34" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="25" font-weight="700" fill="#FFFFFF">${safeText}</text>
        </g>
      `;
    })
    .join('\n');

  const metaChips: string[] = [];
  if (safeLocation) {
    metaChips.push(`📍 ${safeLocation}`);
  }
  if (safeMusic) {
    metaChips.push(`🎵 ${safeMusic}`);
  }
  if (params.taggedUsers && params.taggedUsers.length > 0) {
    const safeTags = params.taggedUsers
      .map((t) => `@${t.username.replace(/[^a-zA-Z0-9._]/g, '')}`)
      .join(' ');
    metaChips.push(`🏷️ ${safeTags}`);
  }
  const metaLine = metaChips.join('   ·   ');

  const svg9x16 = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
      <defs>
        <linearGradient id="storyBg" x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0%" stop-color="${theme.topHex}"/>
          <stop offset="52%" stop-color="${theme.midHex}"/>
          <stop offset="100%" stop-color="${theme.bottomHex}"/>
        </linearGradient>
        <clipPath id="storyMainClip">
          <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="56"/>
        </clipPath>
        <clipPath id="storyPipClip">
          <rect x="${cardX + 38}" y="${cardY + 38}" width="244" height="324" rx="36"/>
        </clipPath>
        <linearGradient id="storyCardBottom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.68"/>
        </linearGradient>
        <filter id="storyWmShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.82"/>
        </filter>
      </defs>

      <rect width="1080" height="1920" fill="url(#storyBg)"/>
      <circle cx="910" cy="210" r="240" fill="${theme.accentHex}" opacity="0.16"/>
      <circle cx="170" cy="1660" r="290" fill="${filterMeta.svgTintHex}" opacity="0.14"/>

      <!-- Top Header Pill -->
      <rect x="250" y="96" width="580" height="76" rx="38" fill="#141416" opacity="0.88" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="2"/>
      <circle cx="302" cy="134" r="12" fill="${theme.accentHex}"/>
      <text x="556" y="145" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="800" fill="#FFFFFF">KeepIt Story · @${safeHandle}</text>

      <!-- Centered 3:4 Photo Frame -->
      <g clip-path="url(#storyMainClip)">
        <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" fill="#141416"/>
        <image href="${safeBackHref}" x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" preserveAspectRatio="xMidYMid slice"/>
        <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" fill="${filterMeta.svgTintHex}" opacity="${tintStopOpacity}"/>
        <rect x="${cardX}" y="${cardY + 910}" width="${cardW}" height="290" fill="url(#storyCardBottom)"/>

        <!-- Top-Left PIP Frame -->
        <g clip-path="url(#storyPipClip)">
          <rect x="${cardX + 38}" y="${cardY + 38}" width="244" height="324" rx="36" fill="#1E1E21"/>
          <image href="${safeFrontHref}" x="${cardX + 38}" y="${cardY + 38}" width="244" height="324" preserveAspectRatio="xMidYMid slice"/>
        </g>
        <rect x="${cardX + 38}" y="${cardY + 38}" width="244" height="324" rx="36" fill="none" stroke="#FAF7F2" stroke-width="6"/>

        ${storyOverlaysSvg}

        <!-- Bottom-Left #keepit + Timestamp Watermark directly on photo -->
        <g filter="url(#storyWmShadow)">
          <text x="${cardX + 42}" y="${cardY + cardH - 82}" text-anchor="start" font-family="system-ui, -apple-system, sans-serif" font-size="40" font-weight="900" letter-spacing="-0.8" fill="#FFFFFF">#keepit</text>
          <text x="${cardX + 42}" y="${cardY + cardH - 44}" text-anchor="start" font-family="system-ui, -apple-system, sans-serif" font-size="23" font-weight="700" fill="#FFFFFF" opacity="0.92">${safeTimestamp}</text>
        </g>

        <rect x="${cardX + cardW - 224}" y="${cardY + 38}" width="186" height="52" rx="26" fill="#0B0B0C" opacity="0.78" stroke="#FFFFFF" stroke-opacity="0.2" stroke-width="2"/>
        <text x="${cardX + cardW - 131}" y="${cardY + 73}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700" fill="#FAF7F2">${filterMeta.label}</text>
      </g>
      <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="56" fill="none" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="3"/>

      <!-- Bottom Story Footer -->
      <rect x="90" y="1484" width="900" height="270" rx="40" fill="#141416" opacity="0.88" stroke="#FFFFFF" stroke-opacity="0.14" stroke-width="2"/>
      <text x="540" y="1558" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="700" fill="#FFFFFF">
        ${safeCaption ? `“${safeCaption}”` : `${safeAuthor}’s KeepIt Moment`}
      </text>
      ${
        metaLine
          ? `<text x="540" y="1624" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="600" fill="${theme.accentHex}">${metaLine}</text>`
          : `<text x="540" y="1624" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="25" font-weight="600" fill="#9A9AA0">Dual-camera authentic capture</text>`
      }
      <text x="540" y="1704" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700" fill="#9A9AA0">
        KeepIt · Keep every moment, together
      </text>
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg9x16.trim())}`;
}

async function rasterizeSvgDataUriOnWeb(
  svgDataUri: string,
  width: number,
  height: number
): Promise<string | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return null;
  }
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    } catch {
      resolve(null);
    }
  };
  img.onerror = () => resolve(null);
  img.src = svgDataUri;
  return promise;
}

async function resolveExportSourceFileOnNative(params: {
  sourceUri: string;
  svgDataUri: string;
  jpgName: string;
  svgName: string;
}): Promise<{ file: FileSystem.File; filename: string; mimeType: string } | null> {
  const { sourceUri, svgDataUri, jpgName, svgName } = params;

  // 1. Base64 data URI (e.g. data:image/jpeg;base64,... or data:image/png;base64,...)
  if (sourceUri.startsWith('data:image/') && sourceUri.includes(';base64,')) {
    try {
      const commaIdx = sourceUri.indexOf(',');
      const b64 = sourceUri.slice(commaIdx + 1);
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const outFile = new FileSystem.File(FileSystem.Paths.cache, jpgName);
      await outFile.write(bytes);
      return { file: outFile, filename: jpgName, mimeType: 'image/jpeg' };
    } catch {
      // Continue to next strategy
    }
  }

  // 2. Local file:// URI
  if (sourceUri.startsWith('file://')) {
    try {
      const srcFile = new FileSystem.File(sourceUri);
      const dstFile = new FileSystem.File(FileSystem.Paths.cache, jpgName);
      if (srcFile.uri !== dstFile.uri) {
        const b64 = await srcFile.base64();
        if (b64) {
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          await dstFile.write(bytes);
          return { file: dstFile, filename: jpgName, mimeType: 'image/jpeg' };
        }
      }
      return { file: srcFile, filename: jpgName, mimeType: 'image/jpeg' };
    } catch {
      // Continue to next strategy
    }
  }

  // 3. Remote http(s):// URI
  if (sourceUri.startsWith('http://') || sourceUri.startsWith('https://')) {
    try {
      const dstFile = new FileSystem.File(FileSystem.Paths.cache, jpgName);
      if (typeof FileSystem.File.downloadFileAsync === 'function') {
        const downloaded = await FileSystem.File.downloadFileAsync(sourceUri, dstFile, {
          idempotent: true,
        });
        return { file: downloaded, filename: jpgName, mimeType: 'image/jpeg' };
      }
    } catch {
      // Continue to SVG fallback
    }
  }

  // 4. Composite SVG data URI written to local file
  if (svgDataUri.startsWith('data:image/svg+xml;utf8,')) {
    try {
      const rawSvg = decodeURIComponent(
        svgDataUri.slice('data:image/svg+xml;utf8,'.length)
      );
      const svgFile = new FileSystem.File(FileSystem.Paths.cache, svgName);
      await svgFile.write(rawSvg);
      return { file: svgFile, filename: svgName, mimeType: 'image/svg+xml' };
    } catch {
      // Ignore
    }
  }

  return null;
}

export async function exportAndShareCompositeMoment(params: {
  backUri: string;
  frontUri: string;
  authorName: string;
  postedAtIso?: string | null;
  timestampLabel?: string | null;
  caption?: string | null;
  locationLabel?: string | null;
  musicTitle?: string | null;
  taggedUsers?: TaggedPerson[];
  filterPreset?: MomentFilterPreset;
  overlays?: PhotoOverlayItem[];
  aspect: '3:4' | '9:16';
  storyTheme?: StoryThemePreset;
  baseFilename: string;
  title: string;
}): Promise<string> {
  const timestampLabel =
    params.timestampLabel?.trim() || formatMomentWatermarkTimestamp(params.postedAtIso);

  const svgDataUri = buildMomentCompositeSvgDataUri({
    backUri: params.backUri,
    frontUri: params.frontUri,
    authorName: params.authorName,
    postedAtIso: params.postedAtIso,
    timestampLabel,
    caption: params.caption,
    locationLabel: params.locationLabel,
    musicTitle: params.musicTitle,
    taggedUsers: params.taggedUsers,
    filterPreset: params.filterPreset,
    overlays: params.overlays,
    aspect: params.aspect,
    storyTheme: params.storyTheme,
  });

  const cleanStem = params.baseFilename.replace(/\.(svg|png|jpe?g)$/i, '');

  if (Platform.OS === 'web') {
    const targetW = params.aspect === '9:16' ? 1080 : 900;
    const targetH = params.aspect === '9:16' ? 1920 : 1200;
    const pngDataUri = await rasterizeSvgDataUriOnWeb(svgDataUri, targetW, targetH);
    const downloadHref = pngDataUri ?? svgDataUri;
    const finalName = pngDataUri ? `${cleanStem}.png` : `${cleanStem}.svg`;

    if (typeof document !== 'undefined') {
      const link = document.createElement('a');
      link.href = downloadHref;
      link.download = finalName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    try {
      await Clipboard.setStringAsync(`${params.title} #keepit`);
    } catch {
      // Clipboard optional on restricted web contexts
    }
    return `Saved ${finalName} to device`;
  }

  const filterMeta = getFilterPresetMeta(params.filterPreset);
  const theme =
    STORY_THEME_PRESETS.find((t) => t.id === params.storyTheme) ?? STORY_THEME_PRESETS[0];
  const jpgName = `${cleanStem}.jpg`;
  const svgName = `${cleanStem}.svg`;

  const nativeRes = await exportNativeCompositeMomentJpeg({
    aspect: params.aspect,
    backUri: params.backUri,
    frontUri: params.frontUri,
    authorName: params.authorName,
    timestampLabel,
    caption: params.caption ?? '',
    filterHex: filterMeta.svgTintHex,
    filterActive: Boolean(params.filterPreset && params.filterPreset !== 'normal'),
    themeTop: theme.topHex,
    themeBottom: theme.bottomHex,
    overlays: params.overlays ?? [],
    filename: jpgName,
    saveToGallery: true,
  });

  if (nativeRes?.fileUri) {
    if (Platform.OS === 'android') {
      const previewFile = new FileSystem.File(nativeRes.fileUri);
      const canPreview = await previewFile.canPreview().catch(() => false);
      if (canPreview) {
        await previewFile.preview({ title: params.title, mimeType: 'image/jpeg' }).catch(() => {});
      } else {
        await Share.share({
          title: params.title,
          message: `${params.title} #keepit`,
          url: nativeRes.fileUri,
        }).catch(() => {});
      }
      return nativeRes.savedToGallery
        ? `Saved ${jpgName} to Pictures/KeepIt & opened preview`
        : `Saved ${jpgName} & opened preview`;
    }

    await Share.share({
      title: params.title,
      message: `${params.title} #keepit`,
      url: nativeRes.fileUri,
    }).catch(() => {});
    return nativeRes.savedToGallery
      ? `Saved ${jpgName} to Photos & opened Share Sheet`
      : `Opened Share Sheet (${jpgName})`;
  }

  // Fallback when running inside Expo Go or without custom native module compiled:
  // Persist file to document & cache storage and open native preview / share sheet
  const resolved = await resolveExportSourceFileOnNative({
    sourceUri: params.backUri,
    svgDataUri,
    jpgName,
    svgName,
  });

  if (resolved) {
    try {
      const docCopy = new FileSystem.File(FileSystem.Paths.document, resolved.filename);
      if (docCopy.uri !== resolved.file.uri) {
        const b64 = await resolved.file.base64();
        if (b64) {
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          await docCopy.write(bytes);
        }
      }
    } catch {
      // Best-effort copy into persistent app documents
    }

    if (Platform.OS === 'ios') {
      await Share.share({
        title: params.title,
        message: `${params.title} #keepit`,
        url: resolved.file.uri,
      }).catch(() => {});
      return `Saved ${resolved.filename} & opened Share Sheet`;
    }

    const canPreview = await resolved.file.canPreview().catch(() => false);
    if (canPreview) {
      await resolved.file
        .preview({ title: params.title, mimeType: resolved.mimeType })
        .catch(() => {});
      return `Saved ${resolved.filename} to device & opened preview`;
    }

    await Share.share({
      title: params.title,
      message: `${params.title} #keepit`,
      url: resolved.file.uri,
    }).catch(() => {});
    return `Saved ${resolved.filename} to device`;
  }

  await Share.share({
    title: params.title,
    message: `${params.title} #keepit`,
  }).catch(() => {});
  return 'Opened share sheet';
}

export async function downloadOrShareMomentUri(params: {
  dataUri: string;
  filename: string;
  title: string;
}): Promise<string> {
  if (Platform.OS === 'web') {
    const pngUri = await rasterizeSvgDataUriOnWeb(params.dataUri, 900, 1200);
    const outName = pngUri
      ? params.filename.replace(/\.svg$/i, '.png')
      : params.filename;
    if (typeof document !== 'undefined') {
      const link = document.createElement('a');
      link.href = pngUri ?? params.dataUri;
      link.download = outName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    return `Saved to device (${outName})`;
  }
  await Share.share({
    title: params.title,
    message: `${params.title} #keepit`,
  }).catch(() => {});
  return 'Opened share sheet';
}
