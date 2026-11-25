export type XeroHotsProviderId =
  | 'all'
  | 'eporner'
  | 'pornhub'
  | 'xhamster'
  | 'hentaicity'
  | 'xvideos'
  | 'xnxx';

export type XeroHotsSortId = 'trending' | 'popular' | 'top-rated' | 'newest' | 'longest';

export interface XeroHotsCategory {
  id: string;
  label: string;
  query: string;
  epornerSlug?: string;
  pornhubCatId?: string;
  xhamsterSlug?: string;
  hentaicitySlug?: string;
  xvideosSlug?: string;
}

export interface XeroHotsVideo {
  id: string;
  title: string;
  duration: string;
  views: string;
  rating: string;
  thumbnail: string;
  embedUrl: string;
  sourceUrl: string;
  provider: Exclude<XeroHotsProviderId, 'all'>;
  uploader: string;
  category?: string;
  directDownloadable?: boolean;
}

export interface XeroHotsVideoDetails {
  ok: true;
  provider: Exclude<XeroHotsProviderId, 'all'>;
  id: string;
  title: string;
  duration: string;
  views: string;
  rating: string;
  upvoted: string;
  downvoted: string;
  uploaded: string;
  thumbnail: string;
  embedUrl: string;
  sourceUrl: string;
  uploader: string;
  tags: string[];
  models: string[];
  directVideoUrl: string | null;
  proxiedStreamUrl: string | null;
  proxiedDownloadUrl: string | null;
  directStreamToken?: string | null;
  hlsUrl: string | null;
  qualities: Array<{ label: string; proxiedStreamUrl: string; proxiedDownloadUrl: string }>;
  relatedVideos: XeroHotsVideo[];
}

export const XEROHOTS_PROVIDERS: Array<{
  id: XeroHotsProviderId;
  label: string;
  badge: string;
  supportsDirectMp4: boolean;
}> = [
  { id: 'all', label: 'All Sources', badge: 'AdultColony Multi', supportsDirectMp4: true },
  { id: 'eporner', label: 'Eporner HD', badge: 'Direct MP4', supportsDirectMp4: true },
  { id: 'pornhub', label: 'Pornhub', badge: 'Trending / MP4', supportsDirectMp4: true },
  { id: 'xhamster', label: 'xHamster', badge: 'HD Stream', supportsDirectMp4: true },
  { id: 'hentaicity', label: 'HentaiCity', badge: 'Anime / 18+', supportsDirectMp4: true },
  { id: 'xvideos', label: 'XVideos', badge: 'MP4 High', supportsDirectMp4: true },
  { id: 'xnxx', label: 'XNXX', badge: 'MP4 High', supportsDirectMp4: true },
];

export const XEROHOTS_SORT_OPTIONS: Array<{ id: XeroHotsSortId; label: string }> = [
  { id: 'trending', label: 'Trending' },
  { id: 'popular', label: 'Most Popular' },
  { id: 'top-rated', label: 'Top Rated' },
  { id: 'newest', label: 'Newest' },
  { id: 'longest', label: 'Longest' },
];

const UNIFIED_CATEGORIES: XeroHotsCategory[] = [
  { id: 'all', label: 'All Featured', query: '' },
  { id: 'hd', label: '4K & Ultra HD', query: 'hd 4k', epornerSlug: '4k-uhd', pornhubCatId: '38', xhamsterSlug: 'hd-videos', hentaicitySlug: 'hd', xvideosSlug: 'hd' },
  { id: 'amateur', label: 'Amateur', query: 'amateur', epornerSlug: 'amateur', pornhubCatId: '3', xhamsterSlug: 'amateur', hentaicitySlug: 'amateur', xvideosSlug: 'amateur' },
  { id: 'milf', label: 'MILF', query: 'milf', epornerSlug: 'milf', pornhubCatId: '29', xhamsterSlug: 'milf', xvideosSlug: 'milf' },
  { id: 'asian', label: 'Asian', query: 'asian', epornerSlug: 'asian', pornhubCatId: '1', xhamsterSlug: 'asian', xvideosSlug: 'asian' },
  { id: 'japanese', label: 'Japanese / JAV', query: 'japanese', epornerSlug: 'japanese', pornhubCatId: '111', xhamsterSlug: 'japanese', xvideosSlug: 'japanese' },
  { id: 'hentai', label: 'Hentai / Anime', query: 'hentai', epornerSlug: 'hentai', pornhubCatId: '36', xhamsterSlug: 'hentai', hentaicitySlug: 'hentai', xvideosSlug: 'hentai' },
  { id: 'pov', label: 'POV', query: 'pov', epornerSlug: 'pov', pornhubCatId: '41', xhamsterSlug: 'pov', xvideosSlug: 'pov' },
  { id: 'teen', label: 'Teen 18+', query: 'teen', epornerSlug: 'teens', pornhubCatId: '37', xhamsterSlug: 'teens', xvideosSlug: 'teen' },
  { id: 'big-tits', label: 'Big Tits', query: 'big tits', epornerSlug: 'big-tits', pornhubCatId: '8', xhamsterSlug: 'big-boobs', xvideosSlug: 'big-tits' },
  { id: 'anal', label: 'Anal', query: 'anal', epornerSlug: 'anal', pornhubCatId: '35', xhamsterSlug: 'anal', xvideosSlug: 'anal' },
  { id: 'lesbian', label: 'Lesbian', query: 'lesbian', epornerSlug: 'lesbian', pornhubCatId: '27', xhamsterSlug: 'lesbian', xvideosSlug: 'lesbian' },
  { id: 'latina', label: 'Latina', query: 'latina', epornerSlug: 'latina', pornhubCatId: '26', xhamsterSlug: 'latina', xvideosSlug: 'latina' },
  { id: 'ebony', label: 'Ebony', query: 'ebony', epornerSlug: 'ebony', pornhubCatId: '17', xhamsterSlug: 'ebony', xvideosSlug: 'ebony' },
  { id: 'cosplay', label: 'Cosplay', query: 'cosplay', epornerSlug: 'cosplay', pornhubCatId: '241', xhamsterSlug: 'cosplay', hentaicitySlug: 'cosplay', xvideosSlug: 'cosplay' },
  { id: 'threesome', label: 'Threesome', query: 'threesome', epornerSlug: 'threesome', pornhubCatId: '65', xhamsterSlug: 'threesomes', xvideosSlug: 'threesome' },
  { id: 'massage', label: 'Massage', query: 'massage', epornerSlug: 'massage', pornhubCatId: '78', xhamsterSlug: 'massage', xvideosSlug: 'massage' },
  { id: 'solo', label: 'Solo Girl', query: 'solo', epornerSlug: 'solo', pornhubCatId: '492', xhamsterSlug: 'masturbation', xvideosSlug: 'solo' },
];

const PROVIDER_EXTRA_CATEGORIES: Partial<Record<XeroHotsProviderId, XeroHotsCategory[]>> = {
  eporner: [
    { id: 'ep-60fps', label: '60 FPS Smooth', query: '60fps', epornerSlug: '60fps' },
    { id: 'ep-hqporn', label: 'HQ Studios', query: 'hqporn', epornerSlug: 'hqporn' },
    { id: 'ep-vr', label: 'VR Porn', query: 'vr', epornerSlug: 'vr-porn' },
    { id: 'ep-uncensored', label: 'Uncensored', query: 'uncensored', epornerSlug: 'uncensored' },
  ],
  pornhub: [
    { id: 'ph-verified', label: 'Verified Amateurs', query: 'verified amateur', pornhubCatId: '138' },
    { id: 'ph-romantic', label: 'Romantic', query: 'romantic', pornhubCatId: '522' },
    { id: 'ph-pinay', label: 'Pinay / Filipino', query: 'pinay' },
    { id: 'ph-korean', label: 'Korean', query: 'korean' },
  ],
  xhamster: [
    { id: 'xh-trending', label: 'Homemade', query: 'homemade', xhamsterSlug: 'homemade' },
    { id: 'xh-casting', label: 'Casting', query: 'casting', xhamsterSlug: 'casting' },
    { id: 'xh-stepmom', label: 'Step Family', query: 'stepmom', xhamsterSlug: 'milf' },
    { id: 'xh-fullhd', label: '1080p Full HD', query: '1080p', xhamsterSlug: 'hd-videos' },
  ],
  hentaicity: [
    { id: 'hc-uncensored', label: 'Uncensored Hentai', query: 'uncensored hentai', hentaicitySlug: 'uncensored' },
    { id: 'hc-3d', label: '3D / SFM', query: '3d hentai', hentaicitySlug: '3d' },
    { id: 'hc-milf', label: 'Hentai MILF', query: 'milf hentai', hentaicitySlug: 'milf' },
    { id: 'hc-elf', label: 'Fantasy & Elf', query: 'elf hentai', hentaicitySlug: 'fantasy' },
    { id: 'hc-school', label: 'Anime Academy', query: 'anime school', hentaicitySlug: 'school' },
  ],
  xvideos: [
    { id: 'xv-best', label: 'XVideos Hits', query: 'best', xvideosSlug: 'best' },
    { id: 'xv-pinay', label: 'Pinay', query: 'pinay' },
    { id: 'xv-creampie', label: 'Creampie', query: 'creampie', xvideosSlug: 'creampie' },
    { id: 'xv-squirt', label: 'Squirt', query: 'squirt', xvideosSlug: 'squirt' },
  ],
  xnxx: [
    { id: 'xn-hits', label: 'XNXX Hits', query: 'hits' },
    { id: 'xn-best', label: 'Best Videos', query: 'best' },
    { id: 'xn-pinay', label: 'Pinay', query: 'pinay' },
    { id: 'xn-creampie', label: 'Creampie', query: 'creampie' },
  ],
};

export function getCategoriesForProvider(provider: XeroHotsProviderId): XeroHotsCategory[] {
  const extras = PROVIDER_EXTRA_CATEGORIES[provider] || [];
  if (provider === 'hentaicity') {
    return [
      UNIFIED_CATEGORIES[0],
      ...extras,
      ...UNIFIED_CATEGORIES.filter((c) => ['hentai', 'cosplay', 'asian', 'japanese', 'big-tits', 'lesbian'].includes(c.id)),
    ];
  }
  if (extras.length === 0) {
    return UNIFIED_CATEGORIES;
  }
  return [UNIFIED_CATEGORIES[0], ...extras, ...UNIFIED_CATEGORIES.slice(1)];
}

export function findCategoryById(provider: XeroHotsProviderId, categoryId: string): XeroHotsCategory | null {
  const clean = String(categoryId || '').trim().toLowerCase();
  if (!clean || clean === 'all') return null;
  const list = getCategoriesForProvider(provider);
  return list.find((c) => c.id === clean) || UNIFIED_CATEGORIES.find((c) => c.id === clean) || null;
}

const ALLOWED_PROVIDER_HOST_SUFFIXES = [
  'eporner.com',
  'pornhub.com',
  'pornhub.org',
  'phncdn.com',
  'xhamster.com',
  'xhcdn.com',
  'xheve2.com',
  'hentaicity.com',
  'xvideos.com',
  'xvideos-cdn.com',
  'xnxx.com',
  'xnxx-cdn.com',
  'spankbang.com',
  'spankbang.party',
  'sb-cd.com',
];

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

export function isAllowedXeroHotsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrLoopbackHost(host)) return false;
    return ALLOWED_PROVIDER_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

export function normalizeExternalThumbUrl(raw: string | undefined): string {
  const s = String(raw || '').trim();
  if (!s || s.startsWith('data:')) return '';
  if (s.startsWith('//')) return `https:${s}`;
  return s;
}

export function hashProviderKeyToNumericId(provider: string, id: string): number {
  const str = `xerohots:${provider}:${id}`;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 900_000_000 + (Math.abs(h >>> 0) % 99_000_000);
}
