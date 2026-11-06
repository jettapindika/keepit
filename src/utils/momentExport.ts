import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';

import { getFilterPresetMeta } from '@/api/social';
import { MomentFilterPreset, PhotoOverlayItem } from '@/types/database';

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

export function buildMomentCompositeSvgDataUri(params: {
  backUri: string;
  frontUri: string;
  authorName: string;
  caption?: string | null;
  locationLabel?: string | null;
  musicTitle?: string | null;
  filterPreset?: MomentFilterPreset;
  overlays?: PhotoOverlayItem[];
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
          <rect x="36" y="1108" width="172" height="56" rx="28" fill="#0B0B0C" opacity="0.82" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="2"/>
          <text x="122" y="1145" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="800" fill="#FFFFFF">#KeepIt</text>
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

        <!-- Bottom-Left #KeepIt Watermark inside frame -->
        <rect x="${cardX + 34}" y="${cardY + cardH - 92}" width="184" height="58" rx="29" fill="#0B0B0C" opacity="0.84" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="2"/>
        <text x="${cardX + 126}" y="${cardY + cardH - 53}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="800" fill="#FFFFFF">#KeepIt</text>

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

export async function downloadOrShareMomentUri(params: {
  dataUri: string;
  filename: string;
  title: string;
}): Promise<string> {
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      const link = document.createElement('a');
      link.href = params.dataUri;
      link.download = params.filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    try {
      await Clipboard.setStringAsync(`${params.title} #KeepIt`);
    } catch {
      // Clipboard optional on restricted web contexts
    }
    return 'Saved to device (' + params.filename + ')';
  }

  await Share.share({
    message: params.title + ' #KeepIt',
    url: params.dataUri,
  });
  return 'Opened share sheet';
}
