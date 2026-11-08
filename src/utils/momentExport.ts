import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import { Platform, Share } from 'react-native';

import { getFilterPresetMeta } from '@/api/social';
import { MomentFilterPreset, PhotoOverlayItem, TaggedPerson } from '@/types/database';

import { exportNativeCompositeMomentJpeg } from '../../modules/keepit-widget-bridge';

export const KEEPIT_WATERMARK_SVG_PATH_D =
  'M4.20738 8.50945L7.35848 0.233129H9.53048L6.36738 8.50945H4.20738ZM0.829146 6.86584L1.50226 5.09401H8.49826L7.82515 6.86584H0.829146ZM1.00338 8.50945L4.15448 0.233129H6.32648L3.16338 8.50945H1.00338ZM2.02195 3.75348L2.69506 1.98165H9.67906L9.00595 3.75348H2.02195ZM8.91241 8.50945L10.9355 0.233129H13.2635L12.2776 4.26638L14.6991 2.21478H17.4111L14.2939 4.75596L15.9204 8.50945H13.4484L12.5096 5.96827L11.6963 6.64436L11.2404 8.50945H8.91241ZM19.2418 8.64933C18.5458 8.64933 17.9711 8.51334 17.5175 8.24134C17.064 7.96935 16.7531 7.58856 16.5848 7.09898C16.4184 6.60162 16.4159 6.02267 16.5773 5.36212C16.7388 4.70157 17.0234 4.1265 17.4311 3.63691C17.8387 3.14733 18.3358 2.76654 18.9223 2.49455C19.5107 2.21478 20.1529 2.0749 20.8489 2.0749C21.5449 2.0749 22.1097 2.21867 22.5435 2.5062C22.9871 2.78597 23.2812 3.18618 23.426 3.70685C23.5707 4.22752 23.5566 4.84145 23.3838 5.54863L23.2869 5.94496H18.8349C18.7578 6.32574 18.7965 6.60939 18.9509 6.7959C19.1152 6.97464 19.3573 7.06401 19.6773 7.06401C19.9093 7.06401 20.1158 7.02127 20.2967 6.93578C20.4856 6.8503 20.6426 6.69876 20.7678 6.48117L23.0433 6.59774C22.702 7.27383 22.1927 7.78673 21.5152 8.13643C20.8396 8.47837 20.0818 8.64933 19.2418 8.64933ZM19.1312 4.73265H21.2552C21.3365 4.3674 21.3039 4.09153 21.1575 3.90502C21.013 3.71074 20.7848 3.6136 20.4728 3.6136C20.1768 3.6136 19.9041 3.71462 19.6547 3.91668C19.4133 4.11873 19.2388 4.39072 19.1312 4.73265ZM26.7418 8.64933C26.0458 8.64933 25.4711 8.51334 25.0175 8.24134C24.564 7.96935 24.2531 7.58856 24.0848 7.09898C23.9184 6.60162 23.9159 6.02267 24.0773 5.36212C24.2388 4.70157 24.5234 4.1265 24.9311 3.63691C25.3387 3.14733 25.8358 2.76654 26.4223 2.49455C27.0107 2.21478 27.6529 2.0749 28.3489 2.0749C29.0449 2.0749 29.6097 2.21867 30.0435 2.5062C30.4871 2.78597 30.7812 3.18618 30.926 3.70685C31.0707 4.22752 31.0566 4.84145 30.8838 5.54863L30.7869 5.94496H26.3349C26.2578 6.32574 26.2965 6.60939 26.4509 6.7959C26.6152 6.97464 26.8573 7.06401 27.1773 7.06401C27.4093 7.06401 27.6158 7.02127 27.7967 6.93578C27.9856 6.8503 28.1426 6.69876 28.2678 6.48117L30.5433 6.59774C30.202 7.27383 29.6927 7.78673 29.0152 8.13643C28.3396 8.47837 27.5818 8.64933 26.7418 8.64933ZM26.6312 4.73265H28.7552C28.8365 4.3674 28.8039 4.09153 28.6575 3.90502C28.513 3.71074 28.2848 3.6136 27.9728 3.6136C27.6768 3.6136 27.4041 3.71462 27.1547 3.91668C26.9133 4.11873 26.7388 4.39072 26.6312 4.73265ZM30.6686 10.258L32.6347 2.21478H34.9027L34.6287 3.532L34.487 3.47372C34.7571 3.02299 35.0977 2.67717 35.5086 2.43626C35.9194 2.19536 36.3649 2.0749 36.8449 2.0749C37.4209 2.0749 37.8747 2.21478 38.2063 2.49455C38.5379 2.77431 38.7469 3.16287 38.8334 3.66023C38.9217 4.14981 38.887 4.71711 38.7293 5.36212C38.5736 5.99936 38.3269 6.56665 37.9893 7.06401C37.6598 7.56136 37.2568 7.94992 36.7804 8.22969C36.312 8.50945 35.7898 8.64933 35.2138 8.64933C34.9098 8.64933 34.6391 8.59493 34.4017 8.48614C34.1662 8.36957 33.9741 8.20637 33.8254 7.99655C33.6847 7.78673 33.6015 7.53805 33.5757 7.25052L33.7431 7.20389L32.9966 10.258H30.6686ZM34.8539 7.02904C35.1899 7.02904 35.49 6.88139 35.7542 6.58608C36.0202 6.283 36.216 5.87502 36.3413 5.36212C36.4667 4.84922 36.4695 4.44512 36.3497 4.14981C36.2318 3.84673 36.0048 3.6952 35.6688 3.6952C35.4448 3.6952 35.2376 3.75737 35.0472 3.8817C34.8568 4.00604 34.6872 4.19255 34.5385 4.44123C34.3977 4.68991 34.2826 4.99687 34.1933 5.36212C34.1041 5.72736 34.069 6.03432 34.0882 6.283C34.1155 6.53168 34.1939 6.71819 34.3235 6.84253C34.4531 6.96687 34.6299 7.02904 34.8539 7.02904ZM38.9007 8.50945L40.4394 2.21478H42.7674L41.2287 8.50945H38.9007ZM40.5573 1.58532L40.9448 -6.10651e-06H43.3448L42.9573 1.58532H40.5573ZM45.2031 8.50945C44.4751 8.50945 43.983 8.34625 43.7268 8.01987C43.4725 7.6857 43.4337 7.15726 43.6103 6.43454L45.0037 0.734371H47.3317L46.0181 6.10815C45.9421 6.419 45.9539 6.63271 46.0534 6.74927C46.1628 6.85807 46.3535 6.91247 46.6255 6.91247H47.5135L47.1231 8.50945H45.2031ZM43.1475 3.81176L43.5378 2.21478H48.6618L48.2715 3.81176H43.1475Z';

function toSvgBase64DataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg.trim());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export function decodeSvgDataUriToXml(svgDataUri: string): string {
  if (svgDataUri.startsWith('data:image/svg+xml;base64,')) {
    const b64 = svgDataUri.slice('data:image/svg+xml;base64,'.length);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }
  if (svgDataUri.startsWith('data:image/svg+xml;utf8,')) {
    return decodeURIComponent(svgDataUri.slice('data:image/svg+xml;utf8,'.length));
  }
  return decodeURIComponent(svgDataUri);
}

export function buildKeepItWatermarkSvgDataUri(fill = 'white'): string {
  const safeFill = fill.replace(/[^a-zA-Z0-9#(),.% -]/g, '') || 'white';
  const svg = `<svg width="50" height="11" viewBox="0 0 50 11" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="${KEEPIT_WATERMARK_SVG_PATH_D}" fill="${safeFill}"/></svg>`;
  return toSvgBase64DataUri(svg);
}

export const KEEPIT_WATERMARK_SVG_DATA_URI = buildKeepItWatermarkSvgDataUri('white');
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
        </defs>
        <g clip-path="url(#mainClip)">
          <rect width="${frameW}" height="${frameH}" fill="#141416"/>
          <image href="${safeBackHref}" x="0" y="0" width="${frameW}" height="${frameH}" preserveAspectRatio="xMidYMid slice"/>
          <rect width="${frameW}" height="${frameH}" fill="${filterMeta.svgTintHex}" opacity="${tintStopOpacity}"/>
          <rect x="0" y="920" width="${frameW}" height="280" fill="url(#bottomFade)"/>
          <g clip-path="url(#pipClip)">
            <rect x="38" y="38" width="236" height="314" rx="34" fill="#1E1E21"/>
            <image href="${safeFrontHref}" x="38" y="38" width="236" height="314" preserveAspectRatio="xMidYMid slice"/>
            <rect x="38" y="38" width="236" height="314" fill="${filterMeta.svgTintHex}" opacity="${tintStopOpacity}"/>
          </g>
          <rect x="38" y="38" width="236" height="314" rx="34" fill="none" stroke="#FAF7F2" stroke-width="6"/>
          ${overlaysSvg}
          <!-- Bottom-Left #keepit SVG + Timestamp Watermark directly embedded on photo -->
          <g>
            <g transform="translate(42, 1084) scale(3.52)">
              <title>#keepit</title>
              <path d="${KEEPIT_WATERMARK_SVG_PATH_D}" fill="#FFFFFF"/>
            </g>
            <text x="42" y="1154" text-anchor="start" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="700" fill="#FFFFFF" opacity="0.92">${safeTimestamp}</text>
          </g>
          <text x="862" y="1144" text-anchor="end" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700" fill="#FAF7F2" opacity="0.92">@${safeHandle} · ${filterMeta.label}</text>
        </g>
      </svg>
    `;

    return toSvgBase64DataUri(svg3x4);
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
          <rect x="${cardX + 38}" y="${cardY + 38}" width="244" height="324" fill="${filterMeta.svgTintHex}" opacity="${tintStopOpacity}"/>
        </g>
        <rect x="${cardX + 38}" y="${cardY + 38}" width="244" height="324" rx="36" fill="none" stroke="#FAF7F2" stroke-width="6"/>

        ${storyOverlaysSvg}

        <!-- Bottom-Left #keepit SVG + Timestamp Watermark directly embedded on photo -->
        <g>
          <g transform="translate(${cardX + 42}, ${cardY + cardH - 118}) scale(3.68)">
            <title>#keepit</title>
            <path d="${KEEPIT_WATERMARK_SVG_PATH_D}" fill="#FFFFFF"/>
          </g>
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

  return toSvgBase64DataUri(svg9x16);
}

async function loadDrawableImageOnWeb(uri: string): Promise<HTMLImageElement | null> {
  if (!uri || typeof Image === 'undefined') return null;

  const tryLoad = (src: string, useCors: boolean) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      if (useCors) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

  if (uri.startsWith('data:')) {
    return tryLoad(uri, false);
  }
  const withCors = await tryLoad(uri, true);
  if (withCors) return withCors;
  return tryLoad(uri, false);
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawImageCenterCrop(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  const sw = Math.max(1, img.naturalWidth || img.width || dw);
  const sh = Math.max(1, img.naturalHeight || img.height || dh);
  const scale = Math.max(dw / sw, dh / sh);
  const rw = sw * scale;
  const rh = sh * scale;
  const rx = dx + (dw - rw) / 2;
  const ry = dy + (dh - rh) / 2;
  ctx.drawImage(img, rx, ry, rw, rh);
}

export function drawKeepItWatermarkSvgPathOnCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  fill = '#FFFFFF'
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = fill;

  if (typeof Path2D !== 'undefined') {
    const p = new Path2D(KEEPIT_WATERMARK_SVG_PATH_D);
    ctx.fill(p);
    ctx.restore();
    return;
  }

  const tokens =
    KEEPIT_WATERMARK_SVG_PATH_D.match(/[A-Za-z]|[-+]?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = '';
  let curX = 0;
  let curY = 0;
  ctx.beginPath();
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) {
      cmd = tokens[i++];
    }
    if (cmd === 'M') {
      curX = parseFloat(tokens[i++]);
      curY = parseFloat(tokens[i++]);
      ctx.moveTo(curX, curY);
    } else if (cmd === 'L') {
      curX = parseFloat(tokens[i++]);
      curY = parseFloat(tokens[i++]);
      ctx.lineTo(curX, curY);
    } else if (cmd === 'H') {
      curX = parseFloat(tokens[i++]);
      ctx.lineTo(curX, curY);
    } else if (cmd === 'V') {
      curY = parseFloat(tokens[i++]);
      ctx.lineTo(curX, curY);
    } else if (cmd === 'C') {
      const x1 = parseFloat(tokens[i++]);
      const y1 = parseFloat(tokens[i++]);
      const x2 = parseFloat(tokens[i++]);
      const y2 = parseFloat(tokens[i++]);
      curX = parseFloat(tokens[i++]);
      curY = parseFloat(tokens[i++]);
      ctx.bezierCurveTo(x1, y1, x2, y2, curX, curY);
    } else if (cmd === 'Z' || cmd === 'z') {
      ctx.closePath();
    } else {
      i++;
    }
  }
  ctx.fill();
  ctx.restore();
}

export async function embedKeepItWatermarkOnImageUri(
  uri: string,
  timestampLabel?: string | null
): Promise<string> {
  if (!uri || Platform.OS !== 'web' || typeof document === 'undefined') {
    return uri;
  }
  try {
    const img = await loadDrawableImageOnWeb(uri);
    if (!img) return uri;
    const w = Math.max(300, img.naturalWidth || img.width || 900);
    const h = Math.max(400, img.naturalHeight || img.height || 1200);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return uri;

    ctx.drawImage(img, 0, 0, w, h);

    const unit = w / 900;
    const padX = Math.round(42 * unit);
    const logoScale = 3.52 * unit;
    const logoY = Math.round(h - 116 * unit);

    const bottomScrim = ctx.createLinearGradient(0, h - Math.round(240 * unit), 0, h);
    bottomScrim.addColorStop(0, 'rgba(0, 0, 0, 0)');
    bottomScrim.addColorStop(1, 'rgba(0, 0, 0, 0.56)');
    ctx.fillStyle = bottomScrim;
    ctx.fillRect(0, h - Math.round(240 * unit), w, Math.round(240 * unit));

    ctx.save();
    drawKeepItWatermarkSvgPathOnCanvas(ctx, padX, logoY, logoScale, '#FFFFFF');

    if (timestampLabel) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.font = `700 ${Math.max(12, Math.round(22 * unit))}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(timestampLabel, padX, Math.round(h - 46 * unit));
    }
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.88);
  } catch {
    return uri;
  }
}

async function renderDirectCompositePngDataUriOnWeb(params: {
  backUri: string;
  frontUri: string;
  authorName: string;
  timestampLabel: string;
  caption?: string | null;
  locationLabel?: string | null;
  musicTitle?: string | null;
  taggedUsers?: TaggedPerson[];
  filterPreset?: MomentFilterPreset;
  overlays?: PhotoOverlayItem[];
  aspect: '3:4' | '9:16';
  storyTheme?: StoryThemePreset;
}): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  try {
    const [backImg, frontImg] = await Promise.all([
      loadDrawableImageOnWeb(params.backUri),
      loadDrawableImageOnWeb(params.frontUri),
    ]);
    const filterMeta = getFilterPresetMeta(params.filterPreset);
    const theme =
      STORY_THEME_PRESETS.find((t) => t.id === params.storyTheme) ?? STORY_THEME_PRESETS[0];
    const isStory = params.aspect === '9:16';
    const outW = isStory ? 1080 : 900;
    const outH = isStory ? 1920 : 1200;
    const cardX = isStory ? 90 : 0;
    const cardY = isStory ? 230 : 0;
    const cardW = 900;
    const cardH = 1200;

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const handle =
      (params.authorName || 'keepit').toLowerCase().replace(/[^a-z0-9_]+/g, '') || 'keepit';

    if (isStory) {
      const bgGrad = ctx.createLinearGradient(0, 0, outW * 0.25, outH);
      bgGrad.addColorStop(0, theme.topHex);
      bgGrad.addColorStop(0.52, theme.midHex);
      bgGrad.addColorStop(1, theme.bottomHex);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, outW, outH);

      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = theme.accentHex;
      ctx.beginPath();
      ctx.arc(910, 210, 240, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = filterMeta.svgTintHex;
      ctx.beginPath();
      ctx.arc(170, 1660, 290, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Top Header Pill matching 9:16 preview SVG
      ctx.save();
      drawRoundedRectPath(ctx, 250, 96, 580, 76, 38);
      ctx.fillStyle = 'rgba(20, 20, 22, 0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = theme.accentHex;
      ctx.beginPath();
      ctx.arc(302, 134, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 30px system-ui, -apple-system, sans-serif';
      ctx.fillText(`KeepIt Story · @${handle}`, 556, 145);
      ctx.restore();
    } else {
      ctx.fillStyle = '#141416';
      ctx.fillRect(0, 0, outW, outH);
    }

    // Main 3:4 photo card
    ctx.save();
    drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, isStory ? 56 : 42);
    ctx.clip();

    if (backImg) {
      if (params.filterPreset && params.filterPreset !== 'normal' && filterMeta.webCssFilter !== 'none') {
        ctx.save();
        ctx.filter = filterMeta.webCssFilter;
        drawImageCenterCrop(ctx, backImg, cardX, cardY, cardW, cardH);
        ctx.restore();
      } else {
        drawImageCenterCrop(ctx, backImg, cardX, cardY, cardW, cardH);
      }
    } else {
      const fallbackGrad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
      fallbackGrad.addColorStop(0, '#EBD8C8');
      fallbackGrad.addColorStop(1, '#231E1B');
      ctx.fillStyle = fallbackGrad;
      ctx.fillRect(cardX, cardY, cardW, cardH);
    }

    if (params.filterPreset && params.filterPreset !== 'normal') {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = filterMeta.svgTintHex;
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.restore();
    }

    // Bottom scrim for legible watermark
    const bottomScrim = ctx.createLinearGradient(
      cardX,
      cardY + cardH - 290,
      cardX,
      cardY + cardH
    );
    bottomScrim.addColorStop(0, 'rgba(0, 0, 0, 0)');
    bottomScrim.addColorStop(1, 'rgba(0, 0, 0, 0.72)');
    ctx.fillStyle = bottomScrim;
    ctx.fillRect(cardX, cardY + cardH - 290, cardW, 290);

    // Secondary PIP photo (top-left)
    const pipX = cardX + 38;
    const pipY = cardY + 38;
    const pipW = isStory ? 244 : 236;
    const pipH = isStory ? 324 : 314;
    const pipR = isStory ? 36 : 34;

    ctx.save();
    drawRoundedRectPath(ctx, pipX, pipY, pipW, pipH, pipR);
    ctx.clip();
    if (frontImg) {
      if (params.filterPreset && params.filterPreset !== 'normal' && filterMeta.webCssFilter !== 'none') {
        ctx.save();
        ctx.filter = filterMeta.webCssFilter;
        drawImageCenterCrop(ctx, frontImg, pipX, pipY, pipW, pipH);
        ctx.restore();
      } else {
        drawImageCenterCrop(ctx, frontImg, pipX, pipY, pipW, pipH);
      }
    } else {
      ctx.fillStyle = '#221D1A';
      ctx.fillRect(pipX, pipY, pipW, pipH);
    }
    if (params.filterPreset && params.filterPreset !== 'normal') {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = filterMeta.svgTintHex;
      ctx.fillRect(pipX, pipY, pipW, pipH);
      ctx.restore();
    }
    ctx.restore();

    ctx.save();
    drawRoundedRectPath(ctx, pipX, pipY, pipW, pipH, pipR);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#FAF7F2';
    ctx.stroke();
    ctx.restore();

    // Overlays
    for (const ov of params.overlays ?? []) {
      const ox = cardX + Math.round((Math.min(90, Math.max(8, ov.xPct)) / 100) * cardW);
      const oy = cardY + Math.round((Math.min(88, Math.max(10, ov.yPct)) / 100) * cardH);
      if (ov.kind === 'emoji') {
        ctx.font = '60px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(ov.content, ox, oy);
      } else {
        const pillWidth = Math.max(160, Math.min(540, ov.content.length * 20 + 48));
        const px = Math.max(cardX + 20, ox - Math.round(pillWidth / 2));
        const py = oy - 34;
        ctx.save();
        drawRoundedRectPath(ctx, px, py, pillWidth, 52, 26);
        ctx.fillStyle =
          ov.bgStyle === 'neon'
            ? 'rgba(168, 85, 247, 0.88)'
            : 'rgba(20, 20, 22, 0.88)';
        ctx.fill();
        ctx.font = '700 25px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(ov.content, px + pillWidth / 2, py + 34);
        ctx.restore();
      }
    }

    // BeReal-style bottom-left #keepit SVG + timestamp watermark directly embedded on photo
    ctx.save();
    drawKeepItWatermarkSvgPathOnCanvas(
      ctx,
      cardX + 42,
      cardY + cardH - (isStory ? 118 : 116),
      isStory ? 3.68 : 3.52,
      '#FFFFFF'
    );
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = `700 ${isStory ? 23 : 22}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(params.timestampLabel, cardX + 42, cardY + cardH - (isStory ? 44 : 46));
    ctx.restore();

    if (isStory) {
      // Top-right filter pill matching 9:16 preview SVG
      ctx.save();
      drawRoundedRectPath(ctx, cardX + cardW - 224, cardY + 38, 186, 52, 26);
      ctx.fillStyle = 'rgba(11, 11, 12, 0.78)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FAF7F2';
      ctx.font = '700 24px system-ui, -apple-system, sans-serif';
      ctx.fillText(filterMeta.label, cardX + cardW - 131, cardY + 73);
      ctx.restore();
    } else {
      ctx.save();
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(250, 247, 242, 0.92)';
      ctx.font = '700 24px system-ui, -apple-system, sans-serif';
      ctx.fillText(`@${handle} · ${filterMeta.label}`, cardX + cardW - 38, cardY + cardH - 52);
      ctx.restore();
    }

    ctx.restore();

    if (isStory) {
      ctx.save();
      drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 56);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 3;
      ctx.stroke();

      drawRoundedRectPath(ctx, 90, 1484, 900, 270, 40);
      ctx.fillStyle = 'rgba(20, 20, 22, 0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 34px system-ui, -apple-system, sans-serif';
      const storyTitle = params.caption
        ? `“${params.caption.slice(0, 80)}”`
        : `${params.authorName || 'KeepIt'}’s KeepIt Moment`;
      ctx.fillText(storyTitle, 540, 1558);

      const metaParts: string[] = [];
      if (params.locationLabel) metaParts.push(params.locationLabel.slice(0, 64));
      if (params.musicTitle) metaParts.push(params.musicTitle.slice(0, 64));
      if (params.taggedUsers && params.taggedUsers.length > 0) {
        metaParts.push(params.taggedUsers.map((t) => `@${t.username}`).join(' '));
      }
      if (metaParts.length > 0) {
        ctx.fillStyle = theme.accentHex;
        ctx.font = '600 26px system-ui, -apple-system, sans-serif';
        ctx.fillText(metaParts.join(' · '), 540, 1624);
      } else {
        ctx.fillStyle = '#9A9AA0';
        ctx.font = '600 25px system-ui, -apple-system, sans-serif';
        ctx.fillText('Dual-camera authentic capture', 540, 1624);
      }

      ctx.fillStyle = '#9A9AA0';
      ctx.font = '700 24px system-ui, -apple-system, sans-serif';
      ctx.fillText('KeepIt · Keep every moment, together', 540, 1704);
      ctx.restore();
    }

    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
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

async function ensureSelfContainedImageUriForComposite(uri: string): Promise<string> {
  if (!uri) return uri;
  if (uri.startsWith('data:')) return uri;
  if (Platform.OS !== 'web' && uri.startsWith('file://')) {
    try {
      const file = new FileSystem.File(uri);
      const b64 = await file.base64();
      if (b64) {
        return `data:image/jpeg;base64,${b64}`;
      }
    } catch {
      // Keep original URI
    }
  }
  if (Platform.OS !== 'web' && (uri.startsWith('http://') || uri.startsWith('https://'))) {
    try {
      const tmpFile = new FileSystem.File(
        FileSystem.Paths.cache,
        `keepit-embed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`
      );
      if (typeof FileSystem.File.downloadFileAsync === 'function') {
        const dl = await FileSystem.File.downloadFileAsync(uri, tmpFile, { idempotent: true });
        const b64 = await dl.base64();
        if (b64) {
          return `data:image/jpeg;base64,${b64}`;
        }
      }
    } catch {
      // Keep original URI
    }
  }
  return uri;
}

async function resolveExportSourceFileOnNative(params: {
  svgDataUri: string;
  svgName: string;
}): Promise<{ file: FileSystem.File; filename: string; mimeType: string } | null> {
  const { svgDataUri, svgName } = params;

  // Always write the full composite SVG (which contains both primary + secondary PIP photos + #keepit + timestamp watermark)
  if (svgDataUri.startsWith('data:image/svg+xml')) {
    try {
      const rawSvg = decodeSvgDataUriToXml(svgDataUri);
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

  const [embeddedBackUri, embeddedFrontUri] = await Promise.all([
    ensureSelfContainedImageUriForComposite(params.backUri),
    ensureSelfContainedImageUriForComposite(params.frontUri),
  ]);

  const svgDataUri = buildMomentCompositeSvgDataUri({
    backUri: embeddedBackUri,
    frontUri: embeddedFrontUri,
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
    // Rasterize the exact SVG shown in preview first so exported PNG matches preview pixel-for-pixel!
    const svgRasterPng = await rasterizeSvgDataUriOnWeb(svgDataUri, targetW, targetH);
    const pngDataUri =
      svgRasterPng ??
      (await renderDirectCompositePngDataUriOnWeb({
        backUri: embeddedBackUri,
        frontUri: embeddedFrontUri,
        authorName: params.authorName,
        timestampLabel,
        caption: params.caption,
        locationLabel: params.locationLabel,
        musicTitle: params.musicTitle,
        taggedUsers: params.taggedUsers,
        filterPreset: params.filterPreset,
        overlays: params.overlays,
        aspect: params.aspect,
        storyTheme: params.storyTheme,
      }));
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
    backUri: embeddedBackUri,
    frontUri: embeddedFrontUri,
    authorName: params.authorName,
    timestampLabel,
    caption: params.caption ?? '',
    filterHex: filterMeta.svgTintHex,
    filterActive: Boolean(params.filterPreset && params.filterPreset !== 'normal'),
    themeTop: theme.topHex,
    themeMid: theme.midHex,
    themeBottom: theme.bottomHex,
    themeAccent: theme.accentHex,
    filterLabel: filterMeta.label,
    locationLabel: params.locationLabel ?? '',
    musicTitle: params.musicTitle ?? '',
    taggedUsers: params.taggedUsers ?? [],
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
  // Write the full composite SVG (with embedded primary photo, secondary PIP photo, and #keepit + timestamp watermark)
  const resolved = await resolveExportSourceFileOnNative({
    svgDataUri,
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
