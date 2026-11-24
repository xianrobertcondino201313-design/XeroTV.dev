import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Download,
  Film,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { MediaItem, ProfileMode } from '../utils/modes';
import { buildEmbedUrl, getNextServerId, STREAMING_SERVERS } from '../utils/servers';
import { cachedTmdbFetch, TMDB_CACHE_TTL } from '../utils/tmdbCache';
import {
  canDownloadMovie,
  formatBytes,
  type UserSubscriptionState,
} from '../utils/subscription';
import {
  deleteOfflineMovie,
  getOfflineMoviePlayUrl,
  markOfflineMovieWatched,
} from '../lib/offlineVault';
import { useDownloadManager } from '../lib/downloadContext';
import { useWatchlist } from '../lib/watchlistContext';
import { loadAppSettings } from '../utils/settings';
import { playClickFx } from '../utils/soundFx';
import { MediaCard } from './MediaCard';

interface PlayerViewProps {
  item: MediaItem;
  mode: ProfileMode;
  account: UserSubscriptionState | null;
  downloadedKeys: Set<string>;
  onBack: () => void;
  onSelectMedia: (item: MediaItem) => void;
  onVaultChanged: (newUsedBytes: number) => void;
  onOpenAccount: () => void;
}

interface TmdbDetailPayload {
  id: number;
  media_type: 'movie' | 'tv';
  title?: string;
  name?: string;
  overview?: string;
  backdrop_path?: string | null;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  vote_average?: number;
  genres?: { id: number; name: string }[];
  seasons?: { season_number: number; name: string; episode_count: number }[];
  credits?: { cast?: { id: number; name: string; character?: string; profile_path?: string | null }[] };
  videos?: { results?: { key: string; site: string; type: string; official?: boolean }[] };
  recommendations?: { results?: MediaItem[] };
}

interface EpisodeItem {
  id: number;
  episode_number: number;
  name: string;
  overview?: string;
  runtime?: number;
  air_date?: string;
}

const SERVER_STORAGE_KEY = 'xerotv_selected_server';

export const PlayerView: React.FC<PlayerViewProps> = ({
  item,
  mode,
  account,
  downloadedKeys,
  onBack,
  onSelectMedia,
  onVaultChanged,
  onOpenAccount,
}) => {
  const mediaType: 'movie' | 'tv' = item.media_type === 'tv' || (!item.title && !!item.name) ? 'tv' : 'movie';
  const itemKey = `${mediaType}:${item.id}`;
  const isKids = mode === 'kids';

  const [details, setDetails] = useState<TmdbDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverId, setServerId] = useState<string>(() => {
    const preferred = loadAppSettings().defaultServerId;
    try {
      const saved = localStorage.getItem(SERVER_STORAGE_KEY);
      if (saved && STREAMING_SERVERS.some((s) => s.id === saved)) {
        return saved;
      }
    } catch {
      // ignore storage errors
    }
    return STREAMING_SERVERS.some((s) => s.id === preferred) ? preferred : STREAMING_SERVERS[0].id;
  });
  const [iframeLoading, setIframeLoading] = useState<boolean>(true);
  const [iframeSlowWarning, setIframeSlowWarning] = useState<boolean>(false);
  const [isSandboxEnabled, setIsSandboxEnabled] = useState<boolean>(true);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);

  const [quality, setQuality] = useState<'standard' | 'hd'>(() => loadAppSettings().defaultDownloadQuality);
  const [localDownloadError, setLocalDownloadError] = useState('');
  const [offlinePlaybackUrl, setOfflinePlaybackUrl] = useState<string | null>(null);
  const { jobs, startBackgroundDownload, cancelBackgroundDownload, dismissJobError } = useDownloadManager();
  const { isInWatchlist, toggleWatchlist } = useWatchlist();
  const inWatchlist = isInWatchlist(item.id, mediaType);

  const activeJob = jobs[itemKey];
  const downloading = activeJob?.status === 'downloading';
  const downloadProgress =
    activeJob?.status === 'downloading'
      ? { loaded: activeJob.loadedBytes, total: activeJob.totalBytes }
      : null;
  const displayedDownloadError =
    localDownloadError || (activeJob?.status === 'error' ? activeJob.errorMessage || 'Download failed.' : '');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setOfflinePlaybackUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setLocalDownloadError('');

    cachedTmdbFetch<TmdbDetailPayload>(
      `/api/tmdb/details/${mediaType}/${item.id}`,
      TMDB_CACHE_TTL.LONG,
    )
      .then((data) => {
        if (!active) return;
        setDetails(data);
        setSeason(1);
        setEpisode(1);
      })
      .catch(() => {
        if (active) setDetails(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [item.id, mediaType]);

  useEffect(() => {
    if (mediaType !== 'tv') {
      setEpisodes([]);
      return;
    }
    let active = true;
    cachedTmdbFetch<{ episodes?: EpisodeItem[] }>(
      `/api/tmdb/season/${item.id}/${season}`,
      TMDB_CACHE_TTL.LONG,
    )
      .then((data) => {
        if (!active || !data?.episodes) return;
        setEpisodes(data.episodes);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [item.id, mediaType, season]);

  useEffect(() => {
    return () => {
      if (offlinePlaybackUrl) URL.revokeObjectURL(offlinePlaybackUrl);
    };
  }, [offlinePlaybackUrl]);

  const title = details?.title || details?.name || item.title || item.name || 'Untitled';
  const overview = details?.overview || item.overview || 'No synopsis available.';
  const releaseDate = details?.release_date || details?.first_air_date || item.release_date || item.first_air_date || '';
  const rating =
    typeof (details?.vote_average ?? item.vote_average) === 'number'
      ? (details?.vote_average ?? item.vote_average ?? 0).toFixed(1)
      : 'NR';

  const trailerKey =
    details?.videos?.results?.find((v) => v.site === 'YouTube' && v.type === 'Trailer')?.key ||
    details?.videos?.results?.find((v) => v.site === 'YouTube')?.key ||
    null;

  const activeServer = STREAMING_SERVERS.find((s) => s.id === serverId) || STREAMING_SERVERS[0];
  const isStrictNoPopups = activeServer.strictNoPopups;
  const effectiveSandbox = isStrictNoPopups ? true : isSandboxEnabled;
  const embedSrc = buildEmbedUrl(activeServer.id, mediaType, item.id, season, episode, trailerKey);
  const isAlreadyDownloaded = downloadedKeys.has(itemKey);

  useEffect(() => {
    if (offlinePlaybackUrl) {
      setIframeLoading(false);
      setIframeSlowWarning(false);
      return;
    }
    setIframeLoading(true);
    setIframeSlowWarning(false);
    const loadFallback = window.setTimeout(() => {
      setIframeLoading(false);
    }, 3500);
    const slowTimer = window.setTimeout(() => {
      setIframeSlowWarning(true);
    }, 4500);
    return () => {
      window.clearTimeout(loadFallback);
      window.clearTimeout(slowTimer);
    };
  }, [embedSrc, offlinePlaybackUrl, effectiveSandbox]);

  const handleSelectServer = (nextId: string) => {
    playClickFx();
    if (offlinePlaybackUrl) {
      URL.revokeObjectURL(offlinePlaybackUrl);
      setOfflinePlaybackUrl(null);
    }
    const targetSrv = STREAMING_SERVERS.find((s) => s.id === nextId) || STREAMING_SERVERS[0];
    setServerId(targetSrv.id);
    setIsSandboxEnabled(targetSrv.strictNoPopups ? true : targetSrv.defaultSandbox);
    try {
      localStorage.setItem(SERVER_STORAGE_KEY, targetSrv.id);
    } catch {
      // ignore storage errors
    }
  };

  const handleCancelDownload = () => {
    playClickFx();
    cancelBackgroundDownload(itemKey);
    setLocalDownloadError('Download cancelled.');
  };

  const handleStartDownload = () => {
    playClickFx();
    setLocalDownloadError('');
    dismissJobError(itemKey);
    const estimatedBytes = quality === 'hd' ? 62 * 1024 * 1024 : 2 * 1024 * 1024;
    const gate = canDownloadMovie(account, estimatedBytes, Date.now());
    if (!gate.allowed) {
      setLocalDownloadError(gate.reason || 'Subscription required for downloads.');
      return;
    }

    void startBackgroundDownload({
      tmdbId: item.id,
      mediaType,
      title,
      overview,
      releaseDate,
      posterPath: details?.poster_path ?? item.poster_path,
      quality,
      estimatedBytes,
      onVaultUpdated: onVaultChanged,
    });
  };

  const handlePlayOffline = async () => {
    playClickFx();
    const res = await getOfflineMoviePlayUrl(itemKey);
    if (!res) {
      setLocalDownloadError('Offline file not found in local vault.');
      return;
    }
    await markOfflineMovieWatched(itemKey).catch(() => {});
    setOfflinePlaybackUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return res.objectUrl;
    });
  };

  const handleDeleteOffline = async () => {
    const newTotal = await deleteOfflineMovie(itemKey);
    if (offlinePlaybackUrl) {
      URL.revokeObjectURL(offlinePlaybackUrl);
      setOfflinePlaybackUrl(null);
    }
    onVaultChanged(newTotal);
  };

  const seasons = (details?.seasons || []).filter((s) => s.season_number > 0);
  const recommendations = (details?.recommendations?.results || []).slice(0, 10);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer min-h-[44px] ${
            isKids
              ? 'bg-white border border-sky-200 text-slate-800 hover:bg-sky-50'
              : 'liquid-glass text-white hover:bg-white/10'
          }`}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Catalog</span>
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="player-watchlist-btn"
            onClick={() => {
              playClickFx();
              toggleWatchlist(item);
            }}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
              inWatchlist
                ? isKids
                  ? 'bg-sky-600 border-sky-600 text-white'
                  : 'bg-white border-white text-zinc-950'
                : isKids
                  ? 'bg-white border-sky-200 text-slate-800 hover:bg-sky-50'
                  : 'liquid-glass text-white hover:bg-white/10'
            }`}
          >
            {inWatchlist ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
            <span>{inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}</span>
          </button>

          <div className="text-xs tabular-nums opacity-75">
            TMDB #{item.id} · {mediaType === 'tv' ? 'Series' : 'Movie'}
          </div>
        </div>
      </div>

      {/* Video Player Surface */}
      <div className="space-y-4">
        <div className="relative w-full aspect-video rounded-3xl overflow-hidden bg-zinc-950 border border-white/15 shadow-2xl">
          {!offlinePlaybackUrl && (details?.backdrop_path || item.backdrop_path) && (
            <img
              src={`https://image.tmdb.org/t/p/w1280${details?.backdrop_path || item.backdrop_path}`}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none"
            />
          )}
          {offlinePlaybackUrl ? (
            <video
              key={offlinePlaybackUrl}
              src={offlinePlaybackUrl}
              controls
              autoPlay
              playsInline
              className="relative z-10 w-full h-full object-contain bg-black"
            />
          ) : (
            <>
              <iframe
                key={`${activeServer.id}-${item.id}-${season}-${episode}-${effectiveSandbox}`}
                src={embedSrc}
                title={`${title} — ${activeServer.name}`}
                sandbox={effectiveSandbox ? activeServer.sandboxFlags : undefined}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={() => setIframeLoading(false)}
                className="relative z-10 w-full h-full border-0"
              />
              {iframeLoading && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/55 backdrop-blur-sm">
                  <div className="rounded-2xl bg-zinc-900/90 border border-white/15 px-4 py-2.5 flex items-center gap-2.5 text-xs text-white font-semibold shadow-xl">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting {activeServer.name} stream...</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sandbox Streaming Server Switcher (mstream Multi-Server + Pop-Out Ad Shield) */}
        <div
          className={`rounded-2xl p-4 flex flex-col gap-3 ${
            isKids ? 'bg-white border border-sky-200 text-slate-900' : 'liquid-glass'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Streaming Servers (mstream 10-Provider Sync)</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!offlinePlaybackUrl && (
                <button
                  type="button"
                  data-testid="try-next-server-btn"
                  onClick={() => handleSelectServer(getNextServerId(activeServer.id))}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                    isKids
                      ? 'bg-sky-100 text-sky-900 hover:bg-sky-200'
                      : 'bg-white/15 text-white hover:bg-white/25'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Try Next Server</span>
                </button>
              )}
              {isStrictNoPopups ? (
                <div
                  data-testid="vidzen-adblock-shield"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                    isKids
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Pop-Out Ads Blocked (Locked)</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsSandboxEnabled((prev) => !prev)}
                  aria-pressed={effectiveSandbox}
                  title="Sandbox blocks popups and redirects while keeping playback smooth"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                    effectiveSandbox
                      ? isKids
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                        : 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                      : isKids
                        ? 'bg-rose-50 border-rose-300 text-rose-700'
                        : 'bg-rose-500/15 border-rose-400/40 text-rose-300'
                  }`}
                >
                  {effectiveSandbox ? (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  ) : (
                    <ShieldAlert className="w-3.5 h-3.5" />
                  )}
                  <span>{effectiveSandbox ? 'Sandbox: ON' : 'Sandbox: OFF'}</span>
                </button>
              )}
              {offlinePlaybackUrl && (
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(offlinePlaybackUrl);
                    setOfflinePlaybackUrl(null);
                  }}
                  className="text-xs underline opacity-80 hover:opacity-100 cursor-pointer"
                >
                  Switch back to Online Server
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {STREAMING_SERVERS.map((srv) => {
              const selected = !offlinePlaybackUrl && srv.id === activeServer.id;
              return (
                <button
                  key={srv.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handleSelectServer(srv.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer min-h-[40px] flex items-center gap-2 ${
                    selected
                      ? isKids
                        ? 'bg-sky-600 text-white'
                        : 'bg-white text-zinc-950'
                      : isKids
                        ? 'bg-sky-50 text-slate-700 hover:bg-sky-100'
                        : 'bg-white/10 text-zinc-200 hover:bg-white/20'
                  }`}
                >
                  <span>{srv.name}</span>
                  {srv.recommendedByXero && (
                    <span className="opacity-70 font-normal">· Xero Pick</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <p className={isKids ? 'text-slate-500' : 'text-zinc-400'}>
              Active Server: {activeServer.name} — {activeServer.providerNote}
            </p>
            {iframeSlowWarning && !offlinePlaybackUrl && (
              <span className={isKids ? 'text-sky-700 font-medium' : 'text-amber-300/90'}>
                Video not loading on {activeServer.name}? Tap Try Next Server or Official Trailer.
              </span>
            )}
          </div>
        </div>

        {/* TV Season & Episode Picker */}
        {mediaType === 'tv' && seasons.length > 0 && (
          <div
            className={`rounded-2xl p-4 space-y-3 ${
              isKids ? 'bg-white border border-sky-200 text-slate-900' : 'liquid-glass'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Episodes</h3>
              <div className="flex items-center gap-2">
                <label htmlFor="season-select" className="text-xs opacity-75">
                  Season
                </label>
                <select
                  id="season-select"
                  value={season}
                  onChange={(e) => {
                    setSeason(Number(e.target.value));
                    setEpisode(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                    isKids
                      ? 'bg-sky-50 border border-sky-200 text-slate-900'
                      : 'bg-zinc-900 border border-white/15 text-white'
                  }`}
                >
                  {seasons.map((s) => (
                    <option key={s.season_number} value={s.season_number}>
                      {s.name} ({s.episode_count} eps)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-44 overflow-y-auto pr-1">
              {(episodes.length > 0
                ? episodes
                : Array.from(
                    { length: 10 },
                    (_, idx): EpisodeItem => ({
                      id: idx + 1,
                      episode_number: idx + 1,
                      name: `Episode ${idx + 1}`,
                    }),
                  )
              ).map((ep) => {
                const active = ep.episode_number === episode;
                return (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() => setEpisode(ep.episode_number)}
                    className={`px-3 py-2 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                      active
                        ? isKids
                          ? 'bg-sky-600 text-white font-semibold'
                          : 'bg-white text-zinc-950 font-semibold'
                        : isKids
                          ? 'bg-sky-50 text-slate-700 hover:bg-sky-100'
                          : 'bg-white/5 text-zinc-300 hover:bg-white/15'
                    }`}
                  >
                    <div className="tabular-nums flex items-center justify-between gap-1">
                      <span>Ep {ep.episode_number}</span>
                      {typeof ep.runtime === 'number' && ep.runtime > 0 ? (
                        <span className="text-[10px] opacity-65">{ep.runtime}m</span>
                      ) : null}
                    </div>
                    <div className="truncate opacity-75">{ep.name}</div>
                    {ep.air_date ? (
                      <div className="text-[10px] opacity-55 tabular-nums truncate">
                        {ep.air_date}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Details + Real Offline Download Vault Box */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div
          className={`lg:col-span-2 rounded-3xl p-6 space-y-4 ${
            isKids ? 'bg-white border border-sky-200 text-slate-900' : 'liquid-glass'
          }`}
        >
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold font-display text-balance">{title}</h1>
            <div className={`text-xs tabular-nums flex flex-wrap items-center gap-2 ${isKids ? 'text-slate-500' : 'text-zinc-400'}`}>
              <span>{releaseDate ? releaseDate.slice(0, 4) : '—'}</span>
              <span aria-hidden="true">·</span>
              <span>Rating {rating}/10</span>
              {details?.runtime ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{details.runtime} min</span>
                </>
              ) : null}
              {details?.genres?.length ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{details.genres.map((g) => g.name).join(', ')}</span>
                </>
              ) : null}
            </div>
          </div>

          <p className={`text-sm leading-relaxed ${isKids ? 'text-slate-600' : 'text-zinc-300'}`}>
            {loading ? 'Loading TMDB metadata...' : overview}
          </p>

          {details?.credits?.cast && details.credits.cast.length > 0 && (
            <div className="pt-2 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider opacity-70">Cast</h3>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                {details.credits.cast.slice(0, 10).map((person) => (
                  <div key={person.id} className="w-24 shrink-0 space-y-1">
                    <div className="w-24 h-24 rounded-2xl overflow-hidden bg-zinc-800">
                      {person.profile_path ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w185${person.profile_path}`}
                          alt={person.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-500">
                          <Film className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                    <div className="text-xs font-medium truncate">{person.name}</div>
                    {person.character && (
                      <div className="text-[11px] opacity-65 truncate">{person.character}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Real Offline Download Panel */}
        <div
          className={`rounded-3xl p-6 space-y-4 flex flex-col justify-between ${
            isKids ? 'bg-white border border-sky-200 text-slate-900' : 'liquid-glass-strong'
          }`}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <HardDrive className="w-5 h-5" />
              <h2 className="text-lg font-bold font-display">Offline Download</h2>
            </div>
            <p className={`text-xs leading-relaxed ${isKids ? 'text-slate-600' : 'text-zinc-400'}`}>
              Save an encrypted playable MP4 file directly into your device vault so you can watch
              anytime offline in the web shortcut or mobile app.
            </p>

            {account ? (
              <div
                className={`p-3 rounded-xl text-xs space-y-1 tabular-nums ${
                  isKids ? 'bg-sky-50 text-slate-700' : 'bg-white/5 text-zinc-300'
                }`}
              >
                <div className="flex justify-between">
                  <span>Vault Used</span>
                  <span className="font-mono font-semibold">
                    {formatBytes(account.storageUsedBytes)} / {formatBytes(account.storageQuotaBytes)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Download Access</span>
                  <span className="font-semibold">
                    {account.downloadExpiresAtMs > Date.now()
                      ? `Active until ${new Date(account.downloadExpiresAtMs).toLocaleDateString()}`
                      : 'Subscription Required'}
                  </span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenAccount}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  isKids
                    ? 'bg-sky-600 text-white hover:bg-sky-700'
                    : 'bg-white text-zinc-950 hover:bg-zinc-200'
                }`}
              >
                Sign In to Unlock Offline Vault
              </button>
            )}
          </div>

          <div className="space-y-3">
            {isAlreadyDownloaded ? (
              <div className="space-y-2">
                <div
                  className={`flex items-center gap-2 text-xs font-semibold ${
                    isKids ? 'text-emerald-700' : 'text-emerald-400'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Saved in Local Offline Vault</span>
                </div>
                <button
                  type="button"
                  onClick={handlePlayOffline}
                  className={`w-full py-3 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                    isKids
                      ? 'bg-sky-600 text-white hover:bg-sky-700'
                      : 'bg-white text-zinc-950 hover:bg-zinc-200'
                  }`}
                >
                  <Play className="w-4 h-4" />
                  <span>Watch Offline Now</span>
                </button>
                <button
                  type="button"
                  onClick={handleDeleteOffline}
                  className={`w-full py-2.5 px-4 rounded-xl border text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                    isKids
                      ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
                      : 'border-white/15 text-rose-400 hover:bg-rose-500/10'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Offline File</span>
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setQuality('standard')}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      quality === 'standard'
                        ? isKids
                          ? 'bg-sky-600 text-white'
                          : 'bg-white text-zinc-950'
                        : isKids
                          ? 'bg-sky-50 text-slate-700'
                          : 'bg-white/10 text-zinc-300'
                    }`}
                  >
                    Standard (~15 MB)
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuality('hd')}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      quality === 'hd'
                        ? isKids
                          ? 'bg-sky-600 text-white'
                          : 'bg-white text-zinc-950'
                        : isKids
                          ? 'bg-sky-50 text-slate-700'
                          : 'bg-white/10 text-zinc-300'
                    }`}
                  >
                    Full HD (~160 MB)
                  </button>
                </div>

                {downloading && downloadProgress && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs tabular-nums">
                      <span>Downloading real MP4...</span>
                      <span>
                        {formatBytes(downloadProgress.loaded)} / {formatBytes(downloadProgress.total)}
                      </span>
                    </div>
                    <div className={`w-full h-2 rounded-full overflow-hidden ${isKids ? 'bg-sky-100' : 'bg-white/10'}`}>
                      <div
                        className={`h-full transition-all duration-150 ${isKids ? 'bg-sky-600' : 'bg-white'}`}
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round((downloadProgress.loaded / Math.max(1, downloadProgress.total)) * 100),
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {displayedDownloadError && (
                  <div className="space-y-2">
                    <p className={`text-xs font-medium ${isKids ? 'text-rose-600' : 'text-rose-400'}`} role="alert">
                      {displayedDownloadError}
                    </p>
                    <button
                      type="button"
                      onClick={onOpenAccount}
                      className="text-xs underline font-semibold hover:opacity-80 cursor-pointer"
                    >
                      Get Download Access or Redeem VER-1-0XEROTV
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={downloading}
                    onClick={handleStartDownload}
                    className={`flex-1 py-3 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${
                      isKids
                        ? 'bg-sky-600 text-white hover:bg-sky-700'
                        : 'bg-white text-zinc-950 hover:bg-zinc-200'
                    }`}
                  >
                    <Download className="w-4 h-4" />
                    <span>{downloading ? 'Saving to Vault...' : 'Download for Offline'}</span>
                  </button>
                  {downloading && (
                    <button
                      type="button"
                      onClick={handleCancelDownload}
                      aria-label="Cancel download"
                      className={`p-3 rounded-xl border cursor-pointer ${
                        isKids
                          ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
                          : 'border-white/20 text-rose-400 hover:bg-rose-500/15'
                      }`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold font-display">More Like This</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {recommendations.map((rec) => (
              <MediaCard
                key={`${rec.media_type || mediaType}-${rec.id}`}
                item={{ ...rec, media_type: rec.media_type || mediaType }}
                mode={mode}
                onSelect={onSelectMedia}
                isDownloaded={downloadedKeys.has(`${rec.media_type || mediaType}:${rec.id}`)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
