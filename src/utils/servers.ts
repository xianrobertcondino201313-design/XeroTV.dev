export interface StreamingServer {
  id: string;
  name: string;
  providerNote: string;
  recommendedByXero: boolean;
  sandboxSupported: boolean;
  defaultSandbox: boolean;
  /** When true (e.g. VidZen), popup-blocking sandbox remains enforced to strip pop-out ads */
  strictNoPopups: boolean;
  sandboxFlags: string;
}

const STRICT_AD_FREE_SANDBOX_FLAGS =
  'allow-scripts allow-same-origin allow-forms allow-presentation';

export const STREAMING_SERVERS: StreamingServer[] = [
  {
    id: 'vidzen',
    name: 'VidZen',
    providerNote: 'mstream Core (NxSha Edge) · Pop-Out Ads Stripped · Strict Sandbox Shield',
    recommendedByXero: true,
    sandboxSupported: true,
    defaultSandbox: true,
    strictNoPopups: true,
    sandboxFlags: STRICT_AD_FREE_SANDBOX_FLAGS,
  },
  {
    id: 'vidlink',
    name: 'VidLink',
    providerNote: 'mstream Server #2 · Ultra-Fast Stream · Sandbox Protected',
    recommendedByXero: true,
    sandboxSupported: true,
    defaultSandbox: true,
    strictNoPopups: false,
    sandboxFlags: STRICT_AD_FREE_SANDBOX_FLAGS,
  },
  {
    id: 'twoembed',
    name: '2Embed',
    providerNote: 'mstream Server #3 · Classic Cinema Player · Sandbox Protected',
    recommendedByXero: true,
    sandboxSupported: true,
    defaultSandbox: true,
    strictNoPopups: false,
    sandboxFlags: STRICT_AD_FREE_SANDBOX_FLAGS,
  },
  {
    id: 'vidzee',
    name: 'VidZee',
    providerNote: 'mstream Server #4 · Multi-Bitrate HLS · Sandbox Protected',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    strictNoPopups: false,
    sandboxFlags: STRICT_AD_FREE_SANDBOX_FLAGS,
  },
  {
    id: 'vidspark',
    name: 'VidSpark',
    providerNote: 'mstream Server #5 · Multi-Source Cinema · Sandbox Protected',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    strictNoPopups: false,
    sandboxFlags: STRICT_AD_FREE_SANDBOX_FLAGS,
  },
  {
    id: 'vidy',
    name: 'Vidy',
    providerNote: 'mstream Server #6 · External HLS Fallback · Sandbox Protected',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    strictNoPopups: false,
    sandboxFlags: STRICT_AD_FREE_SANDBOX_FLAGS,
  },
  {
    id: 'nxsha',
    name: 'NxSha',
    providerNote: 'mstream Server #7 · Direct Embed Mirror · Sandbox Protected',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    strictNoPopups: false,
    sandboxFlags: STRICT_AD_FREE_SANDBOX_FLAGS,
  },
  {
    id: 'zoryva',
    name: 'Zoryva',
    providerNote: 'mstream Server #8 · Adaptive HLS Mirror · Sandbox Protected',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    strictNoPopups: false,
    sandboxFlags: STRICT_AD_FREE_SANDBOX_FLAGS,
  },
  {
    id: 'vidnest',
    name: 'VidNest',
    providerNote: 'mstream Server #9 · Cloud Backup Mirror · Sandbox Protected',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    strictNoPopups: false,
    sandboxFlags: STRICT_AD_FREE_SANDBOX_FLAGS,
  },
  {
    id: 'cinezo',
    name: 'Cinezo API',
    providerNote: 'mstream Server #10 · Direct API Gateway · Sandbox Protected',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    strictNoPopups: false,
    sandboxFlags: STRICT_AD_FREE_SANDBOX_FLAGS,
  },
  {
    id: 'trailer',
    name: 'Official Trailer',
    providerNote: 'TMDB Verified YouTube Stream (Zero Ads)',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    strictNoPopups: false,
    sandboxFlags:
      'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',
  },
];

export function getNextServerId(currentId: string): string {
  const idx = STREAMING_SERVERS.findIndex((s) => s.id === currentId);
  if (idx === -1) return STREAMING_SERVERS[0].id;
  return STREAMING_SERVERS[(idx + 1) % STREAMING_SERVERS.length].id;
}

export function buildEmbedUrl(
  serverId: string,
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  season: number = 1,
  episode: number = 1,
  trailerKey?: string | null,
): string {
  const s = Math.max(1, Math.floor(season || 1));
  const e = Math.max(1, Math.floor(episode || 1));
  const tvSuffix = mediaType === 'tv' ? `/${s}/${e}` : '';

  switch (serverId) {
    case 'vidzen':
      return `https://web.nxsha.app/embed/${mediaType}/${tmdbId}${tvSuffix}`;
    case 'vidlink':
      return `https://vidlink.pro/${mediaType}/${tmdbId}${tvSuffix}`;
    case 'twoembed':
      return mediaType === 'tv'
        ? `https://www.2embed.cc/embedtv/${tmdbId}&s=${s}&e=${e}`
        : `https://www.2embed.cc/embed/${tmdbId}`;
    case 'vidzee':
      return `https://player.vidzee.wtf/embed/${mediaType}/${tmdbId}${tvSuffix}`;
    case 'vidspark':
      return mediaType === 'tv'
        ? `https://moviesapi.to/tv/${tmdbId}-${s}-${e}`
        : `https://moviesapi.to/movie/${tmdbId}`;
    case 'vidy':
      return `https://www.vidy.st/${mediaType}/${tmdbId}${tvSuffix}`;
    case 'nxsha':
      return `https://web.nxsha.app/embed/${mediaType}/${tmdbId}${tvSuffix}`;
    case 'zoryva':
      return `https://zoryva.me/embed/${mediaType}/${tmdbId}${tvSuffix}`;
    case 'vidnest':
      return `https://vidnest.fun/${mediaType}/${tmdbId}${tvSuffix}`;
    case 'cinezo':
      return `https://api.cinezo.net/${mediaType}/${tmdbId}${tvSuffix}`;
    case 'trailer':
      if (trailerKey) {
        return `https://www.youtube.com/embed/${encodeURIComponent(trailerKey)}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
      }
      return `https://web.nxsha.app/embed/${mediaType}/${tmdbId}${tvSuffix}`;
    default:
      return `https://web.nxsha.app/embed/${mediaType}/${tmdbId}${tvSuffix}`;
  }
}
