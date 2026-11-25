import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  Film,
  HardDriveDownload,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Search,
  SkipBack,
  SkipForward,
  Subtitles,
  X,
} from 'lucide-react';
import type { ProfileMode } from '../utils/modes';
import {
  getShortDramaCategories,
  hashShortDramaToVaultId,
  SHORT_DRAMA_PROVIDERS,
  type ShortDramaDetail,
  type ShortDramaEpisode,
  type ShortDramaProviderId,
  type ShortDramaSeries,
  type ShortDramaWatchStream,
} from '../utils/shortDrama';
import { canDownloadMovie, type UserSubscriptionState } from '../utils/subscription';
import { useDownloadManager } from '../lib/downloadContext';
import { playClickFx } from '../utils/soundFx';

interface ShortDramaViewProps {
  mode: ProfileMode;
  account: UserSubscriptionState | null;
  downloadedKeys: Set<string>;
  initialSeries?: ShortDramaSeries | null;
  onConsumeInitialSeries?: () => void;
  onVaultChanged: (newUsedBytes: number) => void;
  onOpenAccount: () => void;
}

export const ShortDramaView: React.FC<ShortDramaViewProps> = ({
  mode,
  account,
  downloadedKeys,
  initialSeries,
  onConsumeInitialSeries,
  onVaultChanged,
  onOpenAccount,
}) => {
  const isKids = mode === 'kids';
  const { jobs, startBackgroundDownload } = useDownloadManager();

  const [provider, setProvider] = useState<ShortDramaProviderId>('all');
  const [category, setCategory] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');

  const [seriesList, setSeriesList] = useState<ShortDramaSeries[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [feedError, setFeedError] = useState('');

  const [selectedSeries, setSelectedSeries] = useState<ShortDramaSeries | null>(null);
  const [detail, setDetail] = useState<ShortDramaDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [activeEpisode, setActiveEpisode] = useState<ShortDramaEpisode | null>(null);
  const [watchStream, setWatchStream] = useState<ShortDramaWatchStream | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState('');
  const [autoNext, setAutoNext] = useState(true);
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [brokenPosters, setBrokenPosters] = useState<Set<string>>(() => new Set());
  const [vaultNotice, setVaultNotice] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const feedSeqRef = useRef(0);

  const categories = useMemo(() => getShortDramaCategories(provider), [provider]);

  const loadFeed = useCallback(
    async (prov: ShortDramaProviderId, cat: string, q: string) => {
      const seq = ++feedSeqRef.current;
      setLoadingFeed(true);
      setFeedError('');
      setSeriesList([]);
      try {
        const endpoint = q.trim()
          ? `/api/drama/search?provider=${encodeURIComponent(prov)}&q=${encodeURIComponent(q.trim())}&mode=${encodeURIComponent(mode)}`
          : `/api/drama/feed?provider=${encodeURIComponent(prov)}&category=${encodeURIComponent(cat)}&mode=${encodeURIComponent(mode)}`;
        const res = await fetch(endpoint);
        const data = (await res.json()) as {
          ok?: boolean;
          items?: ShortDramaSeries[];
          error?: string;
        };
        if (seq !== feedSeqRef.current) return;
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `Unable to reach Short Drama engine (HTTP ${res.status})`);
        }
        setSeriesList(data.items || []);
      } catch (err) {
        if (seq !== feedSeqRef.current) return;
        setFeedError(err instanceof Error ? err.message : 'Unable to load Short Drama feed.');
      } finally {
        if (seq === feedSeqRef.current) {
          setLoadingFeed(false);
        }
      }
    },
    [mode],
  );

  useEffect(() => {
    void loadFeed(provider, category, activeQuery);
  }, [provider, category, activeQuery, loadFeed]);

  // Load Drama Detail & Episodes when a series is picked
  const openSeries = useCallback(async (series: ShortDramaSeries) => {
    playClickFx();
    setSelectedSeries(series);
    setDetail(null);
    setActiveEpisode(null);
    setWatchStream(null);
    setDetailError('');
    setStreamError('');
    setVaultNotice('');
    setLoadingDetail(true);

    try {
      const qs = new URLSearchParams({
        provider: series.provider,
        id: series.id,
        slug: series.slug,
      });
      const res = await fetch(`/api/drama/detail?${qs.toString()}`);
      const data = (await res.json()) as ShortDramaDetail & { ok?: boolean; error?: string };
      if (!res.ok || !data.ok || !data.series) {
        throw new Error(data.error || 'Failed to load episodes.');
      }
      setDetail(data);
      const firstEp = data.episodes?.[0] || null;
      if (firstEp) {
        setActiveEpisode(firstEp);
      }
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Unable to fetch episode catalog.');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (initialSeries) {
      void openSeries(initialSeries);
      onConsumeInitialSeries?.();
    }
  }, [initialSeries, openSeries, onConsumeInitialSeries]);

  // Resolve playable stream whenever activeEpisode changes
  useEffect(() => {
    if (!selectedSeries || !activeEpisode) return;
    let cancelled = false;
    setLoadingStream(true);
    setStreamError('');
    setWatchStream(null);

    const qs = new URLSearchParams({
      provider: detail?.series.provider || selectedSeries.provider,
      id: detail?.series.id || selectedSeries.id,
      chapterId: activeEpisode.chapterId,
      episodeNum: String(activeEpisode.episodeNum),
      slug: detail?.series.slug || selectedSeries.slug,
    });

    fetch(`/api/drama/watch?${qs.toString()}`)
      .then((r) => r.json())
      .then((data: ShortDramaWatchStream & { ok?: boolean; error?: string }) => {
        if (cancelled) return;
        if (!data?.ok) {
          throw new Error(data?.error || 'Unable to load episode stream.');
        }
        setWatchStream(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setStreamError(err instanceof Error ? err.message : 'Stream connection interrupted.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingStream(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSeries, detail, activeEpisode]);

  // Attach hls.js to portrait <video> element for universal HLS playback
  useEffect(() => {
    const videoEl = videoRef.current;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (!videoEl || !watchStream?.proxiedStreamUrl || watchStream.streamType !== 'hls') {
      return;
    }

    const srcUrl = watchStream.proxiedStreamUrl;
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(srcUrl);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoEl.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          setStreamError('HLS stream encountered a playback error. Try another episode or source.');
        }
      });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = srcUrl;
      videoEl.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [watchStream?.proxiedStreamUrl, watchStream?.streamType]);

  // Toggle WebVTT subtitle track cleanly
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !videoEl.textTracks) return;
    for (let i = 0; i < videoEl.textTracks.length; i++) {
      videoEl.textTracks[i].mode = subtitlesOn ? 'showing' : 'hidden';
    }
  }, [subtitlesOn, watchStream?.proxiedSubtitleUrl]);

  const handleEpisodeEnded = () => {
    if (!autoNext || !detail?.episodes || !activeEpisode) return;
    const idx = detail.episodes.findIndex((e) => e.episodeNum === activeEpisode.episodeNum);
    if (idx !== -1 && idx + 1 < detail.episodes.length) {
      const nextEp = detail.episodes[idx + 1];
      if (nextEp.isFree) {
        setActiveEpisode(nextEp);
      }
    }
  };

  const handleStepEpisode = (delta: -1 | 1) => {
    if (!detail?.episodes || !activeEpisode) return;
    const idx = detail.episodes.findIndex((e) => e.episodeNum === activeEpisode.episodeNum);
    const target = detail.episodes[idx + delta];
    if (target) {
      playClickFx();
      setActiveEpisode(target);
    }
  };

  const handleSaveDramaOffline = async () => {
    if (!selectedSeries || !activeEpisode) return;
    playClickFx();
    setVaultNotice('');
    const estimatedBytes = 15 * 1024 * 1024;
    const gate = canDownloadMovie(account, estimatedBytes, Date.now());
    if (!gate.allowed) {
      setVaultNotice(gate.reason || 'Sign in and activate Download Access to save offline.');
      return;
    }

    const numericId = hashShortDramaToVaultId(
      selectedSeries.provider,
      selectedSeries.id,
      activeEpisode.episodeNum,
    );
    await startBackgroundDownload({
      tmdbId: numericId,
      mediaType: 'tv',
      title: `${detail?.series.title || selectedSeries.title} — Ep ${activeEpisode.episodeNum}`,
      overview: detail?.series.overview || selectedSeries.overview,
      releaseDate: `${selectedSeries.provider.toUpperCase()} Ep ${activeEpisode.episodeNum}`,
      posterPath: detail?.series.poster || selectedSeries.poster,
      quality: 'standard',
      estimatedBytes,
      onVaultUpdated: (newUsed) => {
        onVaultChanged(newUsed);
        setVaultNotice(`Saved Ep ${activeEpisode.episodeNum} to Offline Vault.`);
      },
    });
  };

  const handleSelectProvider = (nextProv: ShortDramaProviderId) => {
    playClickFx();
    setProvider(nextProv);
    const nextCats = getShortDramaCategories(nextProv);
    if (!nextCats.some((c) => c.id === category)) {
      setCategory('all');
    }
  };

  const markPosterBroken = (id: string) => {
    setBrokenPosters((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // Portrait Theatre View (SekaiDrama-inspired 9:16 theatre + interactive episode grid)
  if (selectedSeries) {
    const rawDetailSeries = detail?.series;
    const activeSeriesInfo = rawDetailSeries
      ? {
          ...rawDetailSeries,
          title:
            rawDetailSeries.title && !/^StardustTV Series #\d+$/i.test(rawDetailSeries.title)
              ? rawDetailSeries.title
              : selectedSeries.title,
        }
      : selectedSeries;
    const episodes = detail?.episodes || [];
    const currentIdx = activeEpisode
      ? episodes.findIndex((e) => e.episodeNum === activeEpisode.episodeNum)
      : -1;
    const vaultNumericId = activeEpisode
      ? hashShortDramaToVaultId(activeSeriesInfo.provider, activeSeriesInfo.id, activeEpisode.episodeNum)
      : 0;
    const vaultKey = `tv:${vaultNumericId}`;
    const savedOffline = downloadedKeys.has(vaultKey);
    const activeJob = jobs[vaultKey];

    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6" data-testid="short-drama-theatre">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              playClickFx();
              setSelectedSeries(null);
              setDetail(null);
              setWatchStream(null);
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer min-h-[44px] border ${
              isKids
                ? 'bg-white border-sky-200 text-slate-800 hover:bg-sky-50'
                : 'border-[var(--surface-border)] bg-[var(--surface-card)] text-white hover:bg-white/10'
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Short Dramas</span>
          </button>

          <div className={`text-xs tabular-nums ${isKids ? 'text-slate-600' : 'text-zinc-400'}`}>
            {activeSeriesInfo.provider.toUpperCase()} · {episodes.length || activeSeriesInfo.episodeCount} Episodes
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Stage: Vertical 9:16 Portrait Player (or 16:9 for TMDB mini-series) */}
          <div className="lg:col-span-5 flex flex-col items-center">
            <div
              className={`w-full ${
                activeSeriesInfo.provider === 'miniseries' ? 'aspect-video' : 'max-w-[340px] aspect-[9/16]'
              } rounded-2xl overflow-hidden bg-black border border-white/15 relative shadow-2xl flex items-center justify-center`}
            >
              {loadingDetail || loadingStream ? (
                <div className="flex flex-col items-center gap-2.5 px-6 text-center text-xs text-zinc-300">
                  <Loader2 className="w-7 h-7 animate-spin" />
                  <span>Loading Episode {activeEpisode?.episodeNum || 1} stream...</span>
                </div>
              ) : watchStream?.streamType === 'tmdb' && watchStream.tmdbId ? (
                <iframe
                  key={`ms-${watchStream.tmdbId}-${watchStream.episodeNum}`}
                  src={`https://vidzen.fun/tv/${watchStream.tmdbId}/1/${watchStream.episodeNum}`}
                  title={`${activeSeriesInfo.title} Ep ${watchStream.episodeNum}`}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
                  allow="autoplay; fullscreen; encrypted-media"
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="w-full h-full border-0"
                />
              ) : watchStream && !watchStream.isFree ? (
                <div className="p-6 text-center space-y-3 text-white max-w-xs">
                  <Lock className="w-8 h-8 mx-auto opacity-80" />
                  <h3 className="text-base font-bold font-display">
                    Preview Limit Reached (Ep {watchStream.episodeNum})
                  </h3>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Free vertical preview covers episodes 1–
                    {activeSeriesInfo.freeEpisodesCount || 15} on ReelShort. Pick an earlier free episode or watch StardustTV &amp; Asian Mini-Series for full free playback.
                  </p>
                  {episodes[0] && (
                    <button
                      type="button"
                      onClick={() => setActiveEpisode(episodes[0])}
                      className="px-4 py-2 rounded-xl bg-white text-zinc-950 text-xs font-semibold cursor-pointer"
                    >
                      Play Episode 1
                    </button>
                  )}
                </div>
              ) : watchStream?.proxiedStreamUrl ? (
                <video
                  ref={videoRef}
                  data-testid="short-drama-video"
                  key={`${watchStream.seriesId}-${watchStream.episodeNum}`}
                  poster={watchStream.poster || activeSeriesInfo.poster}
                  controls
                  playsInline
                  crossOrigin="anonymous"
                  onEnded={handleEpisodeEnded}
                  className="w-full h-full object-contain bg-black"
                >
                  {watchStream.proxiedSubtitleUrl && (
                    <track
                      kind="subtitles"
                      src={watchStream.proxiedSubtitleUrl}
                      srcLang="en"
                      label="English"
                      default
                    />
                  )}
                </video>
              ) : (
                <div className="p-6 text-center space-y-2 text-xs text-zinc-300">
                  <Clapperboard className="w-7 h-7 mx-auto opacity-60" />
                  <p>{streamError || detailError || 'Select an episode from the panel to start playback.'}</p>
                </div>
              )}
            </div>

            {/* Playback Transport Bar */}
            <div className="w-full max-w-[340px] pt-3 flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                disabled={currentIdx <= 0}
                onClick={() => handleStepEpisode(-1)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border font-semibold cursor-pointer disabled:opacity-40 min-h-[40px] ${
                  isKids
                    ? 'bg-white border-sky-200 text-slate-800 hover:bg-sky-50'
                    : 'border-[var(--surface-border)] bg-[var(--surface-card)] text-zinc-200 hover:bg-white/10'
                }`}
              >
                <SkipBack className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>

              <button
                type="button"
                aria-pressed={autoNext}
                onClick={() => {
                  playClickFx();
                  setAutoNext((p) => !p);
                }}
                className={`px-3 py-2 rounded-xl border font-semibold cursor-pointer min-h-[40px] ${
                  autoNext
                    ? isKids
                      ? 'bg-sky-600 border-sky-600 text-white'
                      : 'bg-white text-zinc-950 border-white'
                    : isKids
                      ? 'bg-white border-sky-200 text-slate-600'
                      : 'border-[var(--surface-border)] bg-[var(--surface-card)] text-zinc-400'
                }`}
              >
                Auto-Next {autoNext ? 'ON' : 'OFF'}
              </button>

              {watchStream?.proxiedSubtitleUrl && (
                <button
                  type="button"
                  aria-pressed={subtitlesOn}
                  onClick={() => setSubtitlesOn((s) => !s)}
                  aria-label="Toggle captions"
                  className={`p-2 rounded-xl border cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center ${
                    subtitlesOn
                      ? isKids
                        ? 'bg-sky-600 border-sky-600 text-white'
                        : 'bg-white text-zinc-950 border-white'
                      : isKids
                        ? 'bg-white border-sky-200 text-slate-600'
                        : 'border-[var(--surface-border)] bg-[var(--surface-card)] text-zinc-400'
                  }`}
                >
                  <Subtitles className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                disabled={currentIdx === -1 || currentIdx >= episodes.length - 1}
                onClick={() => handleStepEpisode(1)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border font-semibold cursor-pointer disabled:opacity-40 min-h-[40px] ${
                  isKids
                    ? 'bg-white border-sky-200 text-slate-800 hover:bg-sky-50'
                    : 'border-[var(--surface-border)] bg-[var(--surface-card)] text-zinc-200 hover:bg-white/10'
                }`}
              >
                <span>Next</span>
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Right Column: Editorial Metadata & Episode Selector Grid */}
          <div className="lg:col-span-7 space-y-6">
            <div
              className={`rounded-2xl p-6 space-y-4 border ${
                isKids
                  ? 'bg-white border-sky-200 text-slate-900'
                  : 'border-[var(--surface-border)] bg-[var(--surface-card)] text-white'
              }`}
            >
              <div className="space-y-1.5">
                <div className={`text-xs font-medium tabular-nums ${isKids ? 'text-sky-700' : 'text-zinc-400'}`}>
                  {activeSeriesInfo.provider.toUpperCase()} · {activeSeriesInfo.category} ·{' '}
                  {episodes.length || activeSeriesInfo.episodeCount} Episodes
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold font-display text-balance">
                  {activeSeriesInfo.title}
                </h1>
              </div>

              <p className={`text-sm leading-relaxed line-clamp-4 ${isKids ? 'text-slate-600' : 'text-zinc-300'}`}>
                {activeSeriesInfo.overview}
              </p>

              <div className="pt-1 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleSaveDramaOffline()}
                  disabled={activeJob?.status === 'downloading'}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer min-h-[44px] transition-colors ${
                    savedOffline
                      ? isKids
                        ? 'bg-emerald-50 border border-emerald-300 text-emerald-700'
                        : 'bg-emerald-500/15 border border-emerald-400/40 text-emerald-300'
                      : isKids
                        ? 'bg-sky-600 text-white hover:bg-sky-700'
                        : 'bg-white text-zinc-950 hover:bg-zinc-200'
                  }`}
                >
                  {savedOffline ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Ep {activeEpisode?.episodeNum || 1} Saved Offline</span>
                    </>
                  ) : activeJob?.status === 'downloading' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving Episode...</span>
                    </>
                  ) : (
                    <>
                      <HardDriveDownload className="w-4 h-4" />
                      <span>Save Ep {activeEpisode?.episodeNum || 1} Offline</span>
                    </>
                  )}
                </button>

                {!account && (
                  <button
                    type="button"
                    onClick={onOpenAccount}
                    className={`text-xs font-semibold underline cursor-pointer ${
                      isKids ? 'text-sky-700' : 'text-zinc-300'
                    }`}
                  >
                    Sign In for Offline Vault
                  </button>
                )}
              </div>

              {vaultNotice && (
                <p className={`text-xs font-medium ${isKids ? 'text-sky-700' : 'text-amber-300'}`} role="status">
                  {vaultNotice}
                </p>
              )}
            </div>

            {/* Episode Selector Grid */}
            <div
              className={`rounded-2xl p-5 space-y-4 border ${
                isKids
                  ? 'bg-white border-sky-200 text-slate-900'
                  : 'border-[var(--surface-border)] bg-[var(--surface-card)] text-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-bold font-display">Episodes</h2>
                <span className={`text-xs tabular-nums ${isKids ? 'text-slate-500' : 'text-zinc-400'}`}>
                  {episodes.filter((e) => e.isFree).length} Free · {episodes.length} Total
                </span>
              </div>

              {loadingDetail ? (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="h-11 rounded-xl bg-white/10 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-h-72 overflow-y-auto pr-1">
                  {episodes.map((ep) => {
                    const selected = activeEpisode?.episodeNum === ep.episodeNum;
                    return (
                      <button
                        key={ep.chapterId}
                        type="button"
                        data-testid={`drama-ep-${ep.episodeNum}`}
                        onClick={() => {
                          playClickFx();
                          setActiveEpisode(ep);
                        }}
                        className={`h-11 rounded-xl text-xs font-semibold tabular-nums flex items-center justify-center gap-1 transition-colors cursor-pointer border ${
                          selected
                            ? isKids
                              ? 'bg-sky-600 border-sky-600 text-white'
                              : mode === 'adult'
                                ? 'bg-rose-600 border-rose-500 text-white'
                                : 'bg-white border-white text-zinc-950'
                            : isKids
                              ? 'bg-sky-50 border-sky-200 text-slate-800 hover:bg-sky-100'
                              : 'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/15'
                        }`}
                      >
                        <span>{ep.episodeNum}</span>
                        {!ep.isFree && <Lock className="w-3 h-3 opacity-55" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Short Drama Catalog Browser
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6" data-testid="short-drama-view">
      {/* Header & Search */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-[var(--surface-border)] pb-5">
        <div className="space-y-1">
          <div className={`text-xs font-medium ${isKids ? 'text-sky-700' : 'text-zinc-400'}`}>
            {isKids
              ? 'Kids PG Mode · Family Stories & Animated Mini-Series'
              : 'Vertical Micro-Series · ReelShort, StardustTV & TMDB Mini-Series'}
          </div>
          <h1 className="text-3xl font-bold font-display tracking-tight">Short Drama</h1>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            playClickFx();
            setActiveQuery(searchInput.trim());
          }}
          className="relative w-full lg:w-80 shrink-0"
        >
          <label htmlFor="short-drama-search" className="sr-only">
            Search short dramas
          </label>
          <Search
            className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${
              isKids ? 'text-slate-500' : 'text-zinc-400'
            }`}
          />
          <input
            id="short-drama-search"
            type="search"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              if (!e.target.value.trim() && activeQuery) {
                setActiveQuery('');
              }
            }}
            placeholder="Search CEO, revenge, werewolf, romance..."
            className={`w-full pl-10 pr-9 py-2.5 rounded-xl text-sm border focus:outline-none focus:ring-2 ${
              isKids
                ? 'bg-white border-sky-200 text-slate-900 placeholder:text-slate-400 focus:ring-sky-500'
                : 'bg-[var(--surface-card)] border-[var(--surface-border)] text-white placeholder:text-zinc-500 focus:ring-white/40'
            }`}
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setActiveQuery('');
              }}
              aria-label="Clear short drama search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>

      {/* Provider Switcher + Categories */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1" role="tablist" aria-label="Drama Providers">
          {SHORT_DRAMA_PROVIDERS.map((prov) => {
            const active = provider === prov.id;
            return (
              <button
                key={prov.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`drama-provider-${prov.id}`}
                onClick={() => handleSelectProvider(prov.id)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer border transition-colors min-h-[40px] ${
                  active
                    ? isKids
                      ? 'bg-sky-600 border-sky-600 text-white'
                      : mode === 'adult'
                        ? 'bg-rose-600 border-rose-500 text-white'
                        : mode === 'christmas'
                          ? 'bg-amber-400 border-amber-300 text-zinc-950'
                          : 'bg-white border-white text-zinc-950'
                    : isKids
                      ? 'bg-white border-sky-200 text-slate-700 hover:bg-sky-50'
                      : 'bg-[var(--surface-card)] border-[var(--surface-border)] text-zinc-300 hover:text-white'
                }`}
              >
                {prov.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1" aria-label="Drama Categories">
          {categories.map((cat) => {
            const active = category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  playClickFx();
                  setCategory(cat.id);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer border transition-colors ${
                  active
                    ? isKids
                      ? 'bg-sky-100 border-sky-400 text-sky-900 font-semibold'
                      : 'bg-white/15 border-white/30 text-white font-semibold'
                    : isKids
                      ? 'bg-transparent border-sky-200/70 text-slate-600 hover:bg-sky-50'
                      : 'bg-transparent border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results */}
      {loadingFeed ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, idx) => (
            <div
              key={idx}
              className={`aspect-[2/3] rounded-2xl animate-pulse ${
                isKids ? 'bg-sky-200/50' : 'bg-white/5'
              }`}
            />
          ))}
        </div>
      ) : feedError ? (
        <div
          className={`rounded-2xl p-6 flex items-center justify-between gap-4 border ${
            isKids ? 'bg-white border-sky-200' : 'bg-[var(--surface-card)] border-[var(--surface-border)]'
          }`}
        >
          <p className="text-xs text-rose-400">{feedError}</p>
          <button
            type="button"
            onClick={() => void loadFeed(provider, category, activeQuery)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
              isKids ? 'bg-sky-600 text-white' : 'bg-white text-zinc-950'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : seriesList.length === 0 ? (
        <div
          className={`rounded-2xl p-10 text-center space-y-2 text-xs border ${
            isKids
              ? 'bg-white border-sky-200 text-slate-600'
              : 'bg-[var(--surface-card)] border-[var(--surface-border)] text-zinc-400'
          }`}
        >
          <p>No short dramas matched your current filter.</p>
          <button
            type="button"
            onClick={() => {
              setCategory('all');
              setSearchInput('');
              setActiveQuery('');
            }}
            className="underline font-semibold cursor-pointer"
          >
            Show All Short Dramas
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {seriesList.map((item) => {
            const key = `${item.provider}:${item.id}`;
            const posterBroken = !item.poster || brokenPosters.has(key);
            return (
              <button
                key={key}
                type="button"
                data-testid={`drama-card-${item.provider}-${item.id}`}
                onClick={() => void openSeries(item)}
                className={`group text-left rounded-2xl overflow-hidden border transition-all cursor-pointer flex flex-col ${
                  isKids
                    ? 'bg-white border-sky-200 hover:border-sky-400 shadow-sm'
                    : 'bg-[var(--surface-card)] border-[var(--surface-border)] hover:border-white/30'
                }`}
              >
                <div className={`relative aspect-[2/3] w-full overflow-hidden ${isKids ? 'bg-sky-100' : 'bg-zinc-900'}`}>
                  {!posterBroken ? (
                    <img
                      src={item.poster}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={() => markPosterBroken(key)}
                      className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div
                      className={`w-full h-full flex flex-col items-center justify-center p-4 text-center ${
                        isKids
                          ? 'bg-gradient-to-br from-sky-100 to-sky-200 text-sky-700'
                          : 'bg-gradient-to-br from-zinc-800 to-zinc-950 text-zinc-400'
                      }`}
                    >
                      <Film className="w-8 h-8 mb-2 opacity-60" />
                      <span className="text-xs font-medium line-clamp-2">{item.title}</span>
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent flex items-end justify-end p-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="w-9 h-9 rounded-full bg-white text-zinc-950 flex items-center justify-center shadow-lg">
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    </span>
                  </div>
                </div>

                <div className="p-3.5 space-y-1">
                  <h3 className={`text-sm font-semibold leading-snug line-clamp-1 ${isKids ? 'text-slate-900' : 'text-white'}`}>
                    {item.title}
                  </h3>
                  <div className={`text-xs tabular-nums truncate ${isKids ? 'text-slate-500' : 'text-zinc-400'}`}>
                    {item.provider === 'miniseries'
                      ? 'Mini-Series'
                      : item.provider === 'stardusttv'
                        ? 'StardustTV'
                        : 'ReelShort'}{' '}
                    · {item.episodeCount} Eps
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
