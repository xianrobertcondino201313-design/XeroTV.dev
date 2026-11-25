export type ShortDramaProviderId = 'all' | 'reelshort' | 'stardusttv' | 'miniseries';

export interface ShortDramaProviderConfig {
  id: ShortDramaProviderId;
  label: string;
  tagline: string;
}

export interface ShortDramaCategory {
  id: string;
  label: string;
}

export interface ShortDramaSeries {
  id: string;
  provider: Exclude<ShortDramaProviderId, 'all'>;
  title: string;
  slug: string;
  poster: string;
  overview: string;
  episodeCount: number;
  freeEpisodesCount?: number;
  category: string;
  tags: string[];
  scoreLabel?: string;
  sourceUrl?: string;
  tmdbId?: number;
}

export interface ShortDramaEpisode {
  episodeNum: number;
  chapterId: string;
  title: string;
  durationSec?: number;
  thumbnail?: string;
  isFree: boolean;
  hlsUrl?: string;
  backupHlsUrl?: string;
  mp4Url?: string;
  subtitleUrl?: string;
}

export interface ShortDramaDetail {
  series: ShortDramaSeries;
  episodes: ShortDramaEpisode[];
}

export interface ShortDramaWatchStream {
  provider: Exclude<ShortDramaProviderId, 'all'>;
  seriesId: string;
  chapterId: string;
  episodeNum: number;
  title: string;
  isFree: boolean;
  streamType: 'hls' | 'mp4' | 'tmdb';
  proxiedStreamUrl: string | null;
  proxiedSubtitleUrl: string | null;
  durationSec?: number;
  poster?: string;
  tmdbId?: number;
}

export const SHORT_DRAMA_PROVIDERS: ShortDramaProviderConfig[] = [
  { id: 'all', label: 'All Dramas', tagline: 'ReelShort + StardustTV + Mini-Series' },
  { id: 'reelshort', label: 'ReelShort', tagline: 'Vertical HD Episodes' },
  { id: 'stardusttv', label: 'StardustTV', tagline: 'Dual-CDN + Subtitles' },
  { id: 'miniseries', label: 'Asian Mini-Series', tagline: 'K-Drama & C-Drama Shorts' },
];

export const REELSHORT_CATEGORIES: ShortDramaCategory[] = [
  { id: 'all', label: 'All Picks' },
  { id: 'New Release', label: 'New Release' },
  { id: 'TOP', label: 'Top Ranked' },
  { id: 'Reel Original', label: 'Reel Original' },
  { id: 'Hidden Identity', label: 'Hidden Identity' },
  { id: 'Love at First Sight', label: 'Love at First Sight' },
  { id: 'Second Chance', label: 'Second Chance' },
  { id: 'Young Love', label: 'Young Love' },
];

export const STARDUST_CATEGORIES: ShortDramaCategory[] = [
  { id: 'all', label: 'Featured' },
  { id: 'CEO & Billionaire', label: 'CEO & Billionaire' },
  { id: 'Revenge & Secrets', label: 'Revenge & Secrets' },
  { id: 'Fantasy & Alpha', label: 'Fantasy & Alpha' },
  { id: 'Romance', label: 'Romance' },
];

export const MINISERIES_CATEGORIES: ShortDramaCategory[] = [
  { id: 'all', label: 'All Asian Shorts' },
  { id: 'kdrama', label: 'Korean Drama' },
  { id: 'cdrama', label: 'Chinese Drama' },
  { id: 'romance', label: 'Romance' },
];

export function getShortDramaCategories(provider: ShortDramaProviderId): ShortDramaCategory[] {
  switch (provider) {
    case 'reelshort':
      return REELSHORT_CATEGORIES;
    case 'stardusttv':
      return STARDUST_CATEGORIES;
    case 'miniseries':
      return MINISERIES_CATEGORIES;
    default:
      return [
        { id: 'all', label: 'Trending Now' },
        { id: 'Hidden Identity', label: 'Hidden Identity' },
        { id: 'Love at First Sight', label: 'Romance' },
        { id: 'Revenge & Secrets', label: 'Revenge' },
        { id: 'New Release', label: 'New Releases' },
      ];
  }
}

const ALLOWED_DRAMA_HOST_SUFFIXES = [
  'crazymaplestudios.com',
  'reelshort.com',
  'stardust-tv.com',
  'stardusttv.net',
  'stardusttv.cc',
  'aliyuncs.com',
  'cloudfront.net',
  'dramaboxdb.com',
  'byteimg.com',
  'bytecdn.cn',
  'byteoversea.com',
  'akamaized.net',
  'tmdb.org',
];

function isPrivateOrLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export function isAllowedShortDramaUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || isPrivateOrLocalHostname(host)) return false;
    return ALLOWED_DRAMA_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

export function slugifyDramaTitle(title: string): string {
  const slug = String(title || 'drama')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'drama';
}

export function stripHtmlTags(raw: string): string {
  return String(raw || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|h[1-6]|div|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&mdash;/gi, ' — ')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n >= 32 && n <= 1114111 ? String.fromCodePoint(n) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashShortDramaToVaultId(
  provider: string,
  seriesId: string,
  episodeNum: number = 1,
): number {
  const key = `drama:${provider}:${seriesId}:ep${episodeNum}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 100001;
}

export function convertSrtToVtt(rawContent: string): string {
  const trimmed = String(rawContent || '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) return 'WEBVTT\n\n';
  if (trimmed.startsWith('WEBVTT')) {
    return trimmed;
  }
  const normalized = trimmed
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/((?:\d{2}:)?\d{2}:\d{2}\.\d{3} --> (?:\d{2}:)?\d{2}:\d{2}\.\d{3})([^\n]*)/g, (_m, timing: string, rest: string) =>
      rest.includes('line:') ? `${timing}${rest}` : `${timing} line:82%${rest}`,
    );
  return `WEBVTT\n\n${normalized}\n`;
}

export function rewriteHlsManifestUrls(
  manifestText: string,
  baseManifestUrl: string,
  referer?: string,
): string {
  let parsedBase: URL;
  try {
    parsedBase = new URL(baseManifestUrl);
  } catch {
    return manifestText;
  }

  const makeSegmentUrl = (target: string, isPlaylistChild: boolean): string => {
    const endpoint = isPlaylistChild ? '/api/drama/hls' : '/api/drama/hls-segment';
    const qs = new URLSearchParams({ url: target });
    if (referer) qs.set('referer', referer);
    return `${endpoint}?${qs.toString()}`;
  };

  return String(manifestText || '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (match, uri: string) => {
          try {
            const abs = new URL(uri, parsedBase).href;
            if (!isAllowedShortDramaUrl(abs)) return match;
            const isChildPlaylist = abs.toLowerCase().includes('.m3u8');
            return `URI="${makeSegmentUrl(abs, isChildPlaylist)}"`;
          } catch {
            return match;
          }
        });
      }
      try {
        const abs = new URL(trimmed, parsedBase).href;
        if (!isAllowedShortDramaUrl(abs)) return line;
        const isChildPlaylist = abs.toLowerCase().includes('.m3u8');
        return makeSegmentUrl(abs, isChildPlaylist);
      } catch {
        return line;
      }
    })
    .join('\n');
}

export function classifyStardustCategory(title: string): string {
  const lower = title.toLowerCase();
  if (/(ceo|billionaire|heir|tycoon|boss|rich|lottery|throne|empire|manhattan)/i.test(lower)) {
    return 'CEO & Billionaire';
  }
  if (/(revenge|betray|divorce|regret|expose|kicked|dumped|exiled)/i.test(lower)) {
    return 'Revenge & Secrets';
  }
  if (/(alpha|werewolf|dragon|demon|undead|divine|immortal|awakening|guardian|emperor)/i.test(lower)) {
    return 'Fantasy & Alpha';
  }
  return 'Romance';
}
