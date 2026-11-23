export interface StreamingServer {
  id: string;
  name: string;
  providerNote: string;
  recommendedByXero: boolean;
  sandboxSupported: boolean;
  defaultSandbox: boolean;
  sandboxFlags: string;
}

export const STREAMING_SERVERS: StreamingServer[] = [
  {
    id: 'vidzen',
    name: 'VidZen',
    providerNote: 'Xero Recommended · mstream VidZee Engine · 100% Sandbox Ready',
    recommendedByXero: true,
    sandboxSupported: true,
    defaultSandbox: true,
    sandboxFlags: 'allow-scripts allow-same-origin allow-presentation',
  },
  {
    id: 'nxsha',
    name: 'NxSha',
    providerNote: 'Xero Recommended · mstream NxSha Engine · 100% Sandbox Ready',
    recommendedByXero: true,
    sandboxSupported: true,
    defaultSandbox: true,
    sandboxFlags: 'allow-scripts allow-same-origin allow-presentation',
  },
  {
    id: 'zoryva',
    name: 'Zoryva',
    providerNote: 'mstream Server 4 · Adaptive HLS · 100% Sandbox Ready',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    sandboxFlags: 'allow-scripts allow-same-origin allow-presentation',
  },
  {
    id: 'primesrc',
    name: 'PrimeSrc',
    providerNote: 'Multi-Mirror Voe/Cloud Backup · 100% Sandbox Compatible',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    sandboxFlags: 'allow-scripts allow-same-origin allow-forms allow-presentation',
  },
  {
    id: 'twoembed',
    name: '2Embed HD',
    providerNote: 'Backup Cinema Mirror · 100% Sandbox Compatible',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    sandboxFlags: 'allow-scripts allow-same-origin allow-forms allow-presentation',
  },
  {
    id: 'trailer',
    name: 'Official Trailer',
    providerNote: 'TMDB Verified YouTube Stream (Error 153 Fixed)',
    recommendedByXero: false,
    sandboxSupported: true,
    defaultSandbox: true,
    sandboxFlags:
      'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',
  },
];

export function buildEmbedUrl(
  serverId: string,
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  season: number = 1,
  episode: number = 1,
  trailerKey?: string | null,
): string {
  switch (serverId) {
    case 'vidzen':
      return mediaType === 'tv'
        ? `https://player.vidzee.wtf/embed/tv/${tmdbId}/${season}/${episode}`
        : `https://player.vidzee.wtf/embed/movie/${tmdbId}`;
    case 'nxsha':
      return mediaType === 'tv'
        ? `https://web.nxsha.app/embed/tv/${tmdbId}/${season}/${episode}`
        : `https://web.nxsha.app/embed/movie/${tmdbId}`;
    case 'zoryva':
      return mediaType === 'tv'
        ? `https://zoryva.me/embed/tv/${tmdbId}/${season}/${episode}`
        : `https://zoryva.me/embed/movie/${tmdbId}`;
    case 'primesrc':
      return mediaType === 'tv'
        ? `https://primesrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`
        : `https://primesrc.me/embed/movie?tmdb=${tmdbId}`;
    case 'twoembed':
      return mediaType === 'tv'
        ? `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`
        : `https://www.2embed.cc/embed/${tmdbId}`;
    case 'trailer':
      if (trailerKey) {
        return `https://www.youtube.com/embed/${encodeURIComponent(trailerKey)}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
      }
      return mediaType === 'tv'
        ? `https://player.vidzee.wtf/embed/tv/${tmdbId}/${season}/${episode}`
        : `https://player.vidzee.wtf/embed/movie/${tmdbId}`;
    default:
      return mediaType === 'tv'
        ? `https://player.vidzee.wtf/embed/tv/${tmdbId}/${season}/${episode}`
        : `https://player.vidzee.wtf/embed/movie/${tmdbId}`;
  }
}
