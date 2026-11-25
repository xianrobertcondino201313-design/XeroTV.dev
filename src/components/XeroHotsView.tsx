import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Flame,
  HardDrive,
  KeyRound,
  Loader2,
  Lock,
  MonitorPlay,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Shuffle,
  Tag,
  ThumbsUp,
  UserCheck,
  X,
} from 'lucide-react';
import {
  isXeroStarActive,
  SUBSCRIPTION_PLANS,
  type UserSubscriptionState,
} from '../utils/subscription';
import {
  findCategoryById,
  getCategoriesForProvider,
  hashProviderKeyToNumericId,
  XEROHOTS_PROVIDERS,
  XEROHOTS_SORT_OPTIONS,
  type XeroHotsProviderId,
  type XeroHotsSortId,
  type XeroHotsVideo,
  type XeroHotsVideoDetails,
} from '../utils/xerohots';
import { useDownloadManager } from '../lib/downloadContext';
import { playClickFx } from '../utils/soundFx';

const DEV_FACEBOOK_URL = 'https://web.facebook.com/share/p/1E7E6y8HAD/';
const STRICT_HOTS_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-presentation';

interface XeroHotsViewProps {
  isSignedIn: boolean;
  account: UserSubscriptionState | null;
  hasPin: boolean;
  isPinUnlocked: boolean;
  downloadedKeys?: Set<string>;
  onVaultChanged?: (newUsedBytes: number) => void;
  onRequestPinUnlock: () => void;
  onLockNow: () => void;
  onOpenAccount: () => void;
}

export const XeroHotsView: React.FC<XeroHotsViewProps> = ({
  isSignedIn,
  account,
  hasPin,
  isPinUnlocked,
  downloadedKeys,
  onVaultChanged,
  onRequestPinUnlock,
  onLockNow,
  onOpenAccount,
}) => {
  const hasVip = isXeroStarActive(account);
  const { jobs, startBackgroundDownload, cancelBackgroundDownload } = useDownloadManager();

  const [provider, setProvider] = useState<XeroHotsProviderId>('all');
  const [category, setCategory] = useState<string>('all');
  const [sort, setSort] = useState<XeroHotsSortId>('trending');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');

  const [videos, setVideos] = useState<XeroHotsVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [selectedVideo, setSelectedVideo] = useState<XeroHotsVideo | null>(null);
  const [videoDetails, setVideoDetails] = useState<XeroHotsVideoDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [activeQualityIdx, setActiveQualityIdx] = useState(0);
  const [playerMode, setPlayerMode] = useState<'direct' | 'embed'>('direct');
  const [actionNotice, setActionNotice] = useState('');
  const [copiedId, setCopiedId] = useState(false);
  const [randomBusy, setRandomBusy] = useState(false);

  const categories = useMemo(() => getCategoriesForProvider(provider), [provider]);

  const loadSeqRef = React.useRef(0);

  const loadVideos = useCallback(
    async (prov: XeroHotsProviderId, cat: string, srt: XeroHotsSortId, query: string, pageNum: number) => {
      const seq = ++loadSeqRef.current;
      setLoading(true);
      setVideos([]);
      setErrorMsg('');
      try {
        const qs = new URLSearchParams({
          provider: prov,
          category: cat,
          sort: srt,
          page: String(pageNum),
        });
        if (query.trim()) {
          qs.set('q', query.trim());
        }
        const endpoint = query.trim()
          ? `/api/xerohots/search?${qs.toString()}`
          : `/api/xerohots/feed?${qs.toString()}`;
        const res = await fetch(endpoint);
        const data = (await res.json()) as { ok?: boolean; items?: XeroHotsVideo[]; error?: string };
        if (seq !== loadSeqRef.current) return;
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `Unable to reach XeroHots feed (HTTP ${res.status})`);
        }
        setVideos(data.items || []);
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        setVideos([]);
        setErrorMsg(err instanceof Error ? err.message : 'Unable to fetch AdultColony-API streams.');
      } finally {
        if (seq === loadSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!hasVip || !isPinUnlocked) return;
    void loadVideos(provider, category, sort, activeQuery, page);
  }, [hasVip, isPinUnlocked, provider, category, sort, activeQuery, page, loadVideos]);

  // Load full AdultColony video metadata, direct MP4 URLs, tags & related videos when a card is opened
  useEffect(() => {
    if (!selectedVideo) {
      setVideoDetails(null);
      setDetailsLoading(false);
      return;
    }

    let cancelled = false;
    setDetailsLoading(true);
    setVideoDetails(null);
    setActiveQualityIdx(0);
    setPlayerMode('direct');
    setActionNotice('');

    const qs = new URLSearchParams({
      provider: selectedVideo.provider,
      id: selectedVideo.id,
      sourceUrl: selectedVideo.sourceUrl,
      title: selectedVideo.title,
      thumbnail: selectedVideo.thumbnail,
      duration: selectedVideo.duration,
      uploader: selectedVideo.uploader,
    });

    fetch(`/api/xerohots/video?${qs.toString()}`)
      .then((res) => res.json())
      .then((data: XeroHotsVideoDetails & { ok?: boolean }) => {
        if (cancelled) return;
        if (data && data.ok) {
          setVideoDetails(data);
          setPlayerMode(data.proxiedStreamUrl || (data.qualities && data.qualities.length > 0) ? 'direct' : 'embed');
        } else {
          setPlayerMode('embed');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerMode('embed');
        }
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedVideo]);

  const handleSelectProvider = (nextProv: XeroHotsProviderId) => {
    playClickFx();
    setProvider(nextProv);
    setPage(1);
    const nextCats = getCategoriesForProvider(nextProv);
    if (!nextCats.some((c) => c.id === category)) {
      setCategory('all');
    }
  };

  const handleSelectCategory = (catId: string) => {
    playClickFx();
    setCategory(catId);
    setPage(1);
  };

  const handleRandomVideo = async () => {
    playClickFx();
    setRandomBusy(true);
    try {
      const res = await fetch(`/api/xerohots/random?provider=${encodeURIComponent(provider)}`);
      const data = (await res.json()) as { ok?: boolean; item?: XeroHotsVideo; error?: string };
      if (res.ok && data.ok && data.item) {
        setSelectedVideo(data.item);
      } else {
        setActionNotice(data.error || 'No random clip available right now. Try another source.');
      }
    } catch {
      setActionNotice('Unable to pick a random video right now.');
    } finally {
      setRandomBusy(false);
    }
  };

  const resolveVideoDetailsForAction = async (v: XeroHotsVideo): Promise<XeroHotsVideoDetails | null> => {
    if (
      videoDetails &&
      videoDetails.provider === v.provider &&
      videoDetails.id === v.id
    ) {
      return videoDetails;
    }
    try {
      const qs = new URLSearchParams({
        provider: v.provider,
        id: v.id,
        sourceUrl: v.sourceUrl,
        title: v.title,
        thumbnail: v.thumbnail,
        duration: v.duration,
        uploader: v.uploader,
      });
      const res = await fetch(`/api/xerohots/video?${qs.toString()}`);
      const data = (await res.json()) as XeroHotsVideoDetails;
      return data?.ok ? data : null;
    } catch {
      return null;
    }
  };

  const handleDirectMp4Download = async (v: XeroHotsVideo) => {
    playClickFx();
    setActionNotice(`Preparing MP4 download for "${v.title}"...`);
    const details = await resolveVideoDetailsForAction(v);
    const chosenQuality = details?.qualities?.[activeQualityIdx] || details?.qualities?.[0];
    const directUrl = chosenQuality?.proxiedDownloadUrl || details?.proxiedDownloadUrl;
    const numericId = hashProviderKeyToNumericId(v.provider, v.id);
    const fallbackUrl = `/api/download/stream?tmdbId=${encodeURIComponent(String(numericId))}&mediaType=xerohots&quality=hd&title=${encodeURIComponent(v.title)}`;

    const targetHref = directUrl || fallbackUrl;
    const link = document.createElement('a');
    link.href = targetHref;
    const safeName = v.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'xerohots-video';
    link.download = `${safeName}.mp4`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setActionNotice(
      directUrl
        ? `Downloading direct ${v.provider.toUpperCase()} MP4 to your device.`
        : `Downloading offline MP4 package for "${v.title}".`,
    );
    setTimeout(() => setActionNotice(''), 5000);
  };

  const handleSaveToOfflineVault = async (v: XeroHotsVideo) => {
    playClickFx();
    const numericId = hashProviderKeyToNumericId(v.provider, v.id);
    const vaultKey = `xerohots:${numericId}`;
    if (downloadedKeys?.has(vaultKey)) {
      setActionNotice(`"${v.title}" is already saved in your Offline Vault.`);
      return;
    }
    if (jobs[vaultKey]?.status === 'downloading') {
      cancelBackgroundDownload(vaultKey);
      return;
    }

    setActionNotice(`Resolving stream to save "${v.title}" in Offline Vault...`);
    const details = await resolveVideoDetailsForAction(v);

    await startBackgroundDownload({
      tmdbId: numericId,
      mediaType: 'xerohots',
      title: v.title,
      overview: `${v.provider.toUpperCase()} · ${v.uploader} · ${v.duration}`,
      releaseDate: details?.uploaded || v.duration,
      posterPath: v.thumbnail,
      quality: 'hd',
      directToken: details?.directStreamToken || undefined,
      estimatedBytes: 35_000_000,
      onVaultUpdated: (newUsed) => {
        onVaultChanged?.(newUsed);
        setActionNotice(`Saved "${v.title}" in Offline Vault for off-WiFi playback.`);
      },
    });
  };

  const handleCopyShortId = async () => {
    if (!account?.shortUserId) return;
    playClickFx();
    await navigator.clipboard?.writeText(account.shortUserId).catch(() => {});
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  // Gate 1: Paid XEROSTAR Subscription (₱150 Pesos · NOT Free)
  if (!hasVip) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div
          data-testid="xerohots-paywall"
          className="rounded-2xl p-6 sm:p-10 border border-rose-500/30 bg-gradient-to-br from-[#230b14] to-zinc-950 text-white space-y-6 shadow-2xl"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center text-rose-300 shrink-0">
                <Flame className="w-6 h-6" />
              </div>
              <div>
                <div className="text-xs font-mono uppercase tracking-widest text-rose-300">
                  18+ PIN-Protected VIP Channel
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold font-display">
                  XeroHots · XEROSTAR VIP
                </h1>
              </div>
            </div>
            <div className="text-left sm:text-right border-l-2 sm:border-l-0 sm:border-r-2 border-rose-500/50 pl-3 sm:pl-0 sm:pr-3">
              <div className="text-xs text-rose-200">{SUBSCRIPTION_PLANS.XEROSTAR.durationLabel}</div>
              <div className="text-xl font-bold font-display">
                ₱{SUBSCRIPTION_PLANS.XEROSTAR.pricePesos} Pesos
              </div>
            </div>
          </div>

          <p className="text-sm text-zinc-300 leading-relaxed max-w-2xl">
            XeroHots streams open-source 18+ AdultColony-API channels (Eporner HD, Pornhub, xHamster, HentaiCity, XVideos, and XNXX) with tailored source categories, ad-free native MP4 playback, direct MP4 downloading, and Offline Vault support guarded by your private PIN. Requires{' '}
            <span className="font-semibold text-white">XEROSTAR (₱150)</span> membership.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/10 rounded-2xl bg-white/[0.03] border border-white/10 text-xs">
            <div className="p-4 space-y-1">
              <div className="font-bold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Direct Ad-Free MP4</span>
              </div>
              <p className="text-zinc-400">
                Proxies clean direct MP4 streams into the native HTML5 player plus popup-blocked embeds.
              </p>
            </div>
            <div className="p-4 space-y-1">
              <div className="font-bold text-white flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-rose-300" />
                <span>Private XeroHots PIN</span>
              </div>
              <p className="text-zinc-400">
                Requires your personal 4-6 digit PIN every session so others cannot open it.
              </p>
            </div>
            <div className="p-4 space-y-1">
              <div className="font-bold text-white flex items-center gap-1.5">
                <Download className="w-4 h-4 text-rose-400" />
                <span>MP4 &amp; Offline Vault</span>
              </div>
              <p className="text-zinc-400">
                Download clips directly as MP4 files or save to Offline Vault for off-WiFi viewing.
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-black/40 border border-white/15 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {isSignedIn && account ? (
              <>
                <div className="space-y-1">
                  <div className="text-xs text-zinc-400">
                    Send ₱{SUBSCRIPTION_PLANS.XEROSTAR.pricePesos} Pesos with your UserID to activate XEROSTAR:
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/15 font-mono text-xs font-bold text-white">
                      {account.shortUserId}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyShortId}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
                    >
                      {copiedId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedId ? 'Copied' : 'Copy UserID'}</span>
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <a
                    href={DEV_FACEBOOK_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors"
                  >
                    <span>Subscribe ₱150 on Facebook</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      playClickFx();
                      onOpenAccount();
                    }}
                    className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold cursor-pointer"
                  >
                    View Account Plans
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-zinc-300">
                  Sign in or create a free XEROTV account first to receive your UserID, then activate the ₱150 XEROSTAR VIP plan.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    playClickFx();
                    onOpenAccount();
                  }}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
                >
                  Sign In &amp; Subscribe (₱150)
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Gate 2: Session XeroHots PIN Protection
  if (!isPinUnlocked) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-12">
        <div
          data-testid="xerohots-pin-gate"
          className="rounded-2xl p-8 text-center space-y-5 border border-rose-500/30 bg-[var(--surface-card)] text-white"
        >
          <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center text-rose-300">
            <KeyRound className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold font-display">
              {hasPin ? 'Unlock XeroHots PIN' : 'Create XeroHots PIN'}
            </h1>
            <p className="text-xs text-zinc-300 max-w-sm mx-auto leading-relaxed">
              Your XEROSTAR VIP subscription is active.{' '}
              {hasPin
                ? 'Enter your 4-6 digit XeroHots PIN to unlock the private video library for this session.'
                : 'Create a private 4-6 digit PIN to lock XeroHots against unauthorized access.'}
            </p>
          </div>
          <button
            type="button"
            data-testid="xerohots-unlock-btn"
            onClick={() => {
              playClickFx();
              onRequestPinUnlock();
            }}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold cursor-pointer"
          >
            <Lock className="w-4 h-4" />
            <span>{hasPin ? 'Enter XeroHots PIN' : 'Set XeroHots PIN & Enter'}</span>
          </button>
        </div>
      </div>
    );
  }

  const activeCategoryLabel = findCategoryById(provider, category)?.label || 'All Featured';
  const activeQuality = videoDetails?.qualities?.[activeQualityIdx] || videoDetails?.qualities?.[0] || null;
  const activeStreamUrl = activeQuality?.proxiedStreamUrl || videoDetails?.proxiedStreamUrl || null;
  const selectedNumericId = selectedVideo ? hashProviderKeyToNumericId(selectedVideo.provider, selectedVideo.id) : 0;
  const selectedVaultKey = selectedVideo ? `xerohots:${selectedNumericId}` : '';
  const selectedSavedOffline = selectedVideo ? Boolean(downloadedKeys?.has(selectedVaultKey)) : false;
  const selectedJob = selectedVideo ? jobs[selectedVaultKey] : undefined;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* XeroHots Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-600/25 border border-rose-400/40 flex items-center justify-center text-rose-300">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <h1 className="text-2xl font-bold font-display">XeroHots VIP</h1>
              <span className="text-xs font-semibold text-rose-300">
                · XEROSTAR
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              AdultColony-API Full Suite · Direct MP4 Stream + Per-Source Categories + Downloads
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              playClickFx();
              setPage(1);
              setActiveQuery(searchInput.trim());
            }}
            className="relative flex-1 sm:w-64"
          >
            <label htmlFor="xerohots-search" className="sr-only">
              Search XeroHots videos
            </label>
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="xerohots-search"
              type="search"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                if (!e.target.value.trim() && activeQuery) {
                  setPage(1);
                  setActiveQuery('');
                }
              }}
              placeholder="Search channels, tags, models..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-400/50"
            />
          </form>

          <button
            type="button"
            onClick={() => void handleRandomVideo()}
            disabled={randomBusy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/35 border border-rose-400/40 text-xs font-semibold text-rose-100 cursor-pointer disabled:opacity-50"
          >
            {randomBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shuffle className="w-3.5 h-3.5" />}
            <span>Random</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playClickFx();
              setSelectedVideo(null);
              onLockNow();
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-semibold text-white cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Lock</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <div
          role="status"
          className="rounded-2xl px-4 py-2.5 bg-rose-500/15 border border-rose-400/35 text-xs text-rose-100 flex items-center justify-between gap-3"
        >
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice('')}
            aria-label="Dismiss notification"
            className="p-1 rounded-md hover:bg-white/10 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Inline AdultColony Direct MP4 + Sandboxed Video Player */}
      {selectedVideo && (
        <div
          data-testid="xerohots-player"
          className="rounded-2xl p-4 sm:p-5 space-y-4 border border-rose-500/30 bg-[var(--surface-card)]"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap text-xs text-rose-300 font-semibold uppercase tracking-wider">
                <span>{selectedVideo.provider}</span>
                <span>·</span>
                <span>{videoDetails?.duration || selectedVideo.duration}</span>
                {videoDetails?.views && (
                  <>
                    <span>·</span>
                    <span className="text-zinc-300 normal-case font-normal">{videoDetails.views} views</span>
                  </>
                )}
              </div>
              <h2 className="text-lg font-bold font-display truncate">
                {videoDetails?.title || selectedVideo.title}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {activeStreamUrl && (
                <button
                  type="button"
                  onClick={() => {
                    playClickFx();
                    setPlayerMode((prev) => (prev === 'direct' ? 'embed' : 'direct'));
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
                >
                  <MonitorPlay className="w-3.5 h-3.5 text-rose-300" />
                  <span>{playerMode === 'direct' ? 'Switch to Embed' : 'Switch to Direct MP4'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => void handleDirectMp4Download(selectedVideo)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download MP4</span>
              </button>

              <button
                type="button"
                onClick={() => void handleSaveToOfflineVault(selectedVideo)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  selectedSavedOffline
                    ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-200'
                    : 'bg-white text-zinc-950 hover:bg-zinc-200'
                }`}
              >
                {selectedJob?.status === 'downloading' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>
                      {selectedJob.totalBytes > 0
                        ? `${Math.round((selectedJob.loadedBytes / selectedJob.totalBytes) * 100)}%`
                        : 'Saving...'}
                    </span>
                  </>
                ) : selectedSavedOffline ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Saved Offline</span>
                  </>
                ) : (
                  <>
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Save Offline</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setSelectedVideo(null)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Close</span>
              </button>
            </div>
          </div>

          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border border-white/15">
            {detailsLoading ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-xs text-zinc-300">
                <Loader2 className="w-6 h-6 animate-spin text-rose-400" />
                <span>Extracting ad-free direct MP4 stream via AdultColony-API...</span>
              </div>
            ) : playerMode === 'direct' && activeStreamUrl ? (
              <video
                key={`${selectedVideo.provider}-${selectedVideo.id}-${activeQualityIdx}`}
                src={activeStreamUrl}
                poster={videoDetails?.thumbnail || selectedVideo.thumbnail}
                controls
                autoPlay
                playsInline
                onError={() => {
                  setActionNotice('Direct MP4 stream blocked by origin; switched to sandboxed embed player.');
                  setPlayerMode('embed');
                }}
                className="w-full h-full object-contain bg-black"
              />
            ) : (
              <iframe
                key={`${selectedVideo.provider}-${selectedVideo.id}-embed`}
                src={videoDetails?.embedUrl || selectedVideo.embedUrl}
                title={videoDetails?.title || selectedVideo.title}
                sandbox={STRICT_HOTS_SANDBOX}
                referrerPolicy="no-referrer"
                allow="autoplay; fullscreen; encrypted-media"
                className="w-full h-full border-0"
              />
            )}
          </div>

          {/* Quality Selector & AdultColony Metadata */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-300">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-emerald-300 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{playerMode === 'direct' && activeStreamUrl ? 'Native MP4 Proxy' : 'Ad-Blocked Sandbox'}</span>
                </span>
                <span aria-hidden="true">·</span>
                <span>Uploader: {videoDetails?.uploader || selectedVideo.uploader}</span>
                {videoDetails?.upvoted && videoDetails.upvoted !== '—' && (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <ThumbsUp className="w-3 h-3" />
                    <span>{videoDetails.upvoted}</span>
                  </span>
                )}
              </div>

              {videoDetails && videoDetails.qualities.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-zinc-400">Quality:</span>
                  {videoDetails.qualities.map((q, idx) => (
                    <button
                      key={q.proxiedStreamUrl}
                      type="button"
                      onClick={() => {
                        playClickFx();
                        setActiveQualityIdx(idx);
                        setPlayerMode('direct');
                      }}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-semibold cursor-pointer ${
                        idx === activeQualityIdx && playerMode === 'direct'
                          ? 'bg-rose-600 text-white'
                          : 'bg-white/10 text-zinc-300 hover:bg-white/20'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {videoDetails && (videoDetails.models.length > 0 || videoDetails.tags.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {videoDetails.models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setSearchInput(m);
                      setActiveQuery(m);
                      setPage(1);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-400/30 text-rose-200 hover:bg-rose-500/35 cursor-pointer"
                  >
                    <UserCheck className="w-3 h-3" />
                    <span>{m}</span>
                  </button>
                ))}
                {videoDetails.tags.slice(0, 8).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setSearchInput(t);
                      setActiveQuery(t);
                      setPage(1);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/15 cursor-pointer"
                  >
                    <Tag className="w-3 h-3" />
                    <span>{t}</span>
                  </button>
                ))}
              </div>
            )}

            {videoDetails && videoDetails.relatedVideos.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="text-xs font-semibold text-zinc-300">Related Videos from {selectedVideo.provider}</div>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                  {videoDetails.relatedVideos.map((rv) => (
                    <button
                      key={`${rv.provider}-${rv.id}`}
                      type="button"
                      onClick={() => {
                        playClickFx();
                        setSelectedVideo(rv);
                      }}
                      className="w-44 shrink-0 text-left rounded-xl overflow-hidden bg-black/40 border border-white/10 hover:border-rose-400/50 cursor-pointer"
                    >
                      <div className="relative aspect-video w-full bg-zinc-900">
                        <img
                          src={rv.thumbnail}
                          alt={rv.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono">
                          {rv.duration}
                        </span>
                      </div>
                      <div className="p-2 text-[11px] font-medium line-clamp-2 text-zinc-200">{rv.title}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Provider Tabs (All 7 AdultColony Sources) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {XEROHOTS_PROVIDERS.map((tab) => {
              const active = provider === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSelectProvider(tab.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer border transition-colors ${
                    active
                      ? 'bg-rose-600 border-rose-500 text-white'
                      : 'bg-[var(--surface-card)] border-[var(--surface-border)] text-zinc-300 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="xerohots-sort" className="sr-only">
              Sort videos
            </label>
            <select
              id="xerohots-sort"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as XeroHotsSortId);
                setPage(1);
              }}
              className="px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-400/50 cursor-pointer"
            >
              {XEROHOTS_SORT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  Sort: {opt.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-2 rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border)] disabled:opacity-40 cursor-pointer"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono px-1.5">Pg {page}</span>
            <button
              type="button"
              disabled={loading || videos.length === 0}
              onClick={() => setPage((p) => p + 1)}
              className="p-2 rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border)] disabled:opacity-40 cursor-pointer"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Per-Source Dynamic Categories Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1" aria-label="Source categories">
          {categories.map((cat) => {
            const active = category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                aria-pressed={active}
                onClick={() => handleSelectCategory(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors border ${
                  active
                    ? 'bg-rose-500/25 border-rose-400/60 text-white'
                    : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white hover:bg-white/10'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-video rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : errorMsg ? (
        <div className="rounded-2xl p-6 flex items-center justify-between gap-4 bg-[var(--surface-card)] border border-[var(--surface-border)]">
          <p className="text-xs text-rose-400">{errorMsg}</p>
          <button
            type="button"
            onClick={() => void loadVideos(provider, category, sort, activeQuery, page)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-zinc-950 text-xs font-semibold cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : videos.length === 0 ? (
        <div className="rounded-2xl p-10 text-center space-y-2 text-xs text-zinc-400 bg-[var(--surface-card)] border border-[var(--surface-border)]">
          <p>
            No videos returned for {provider === 'all' ? 'All Sources' : provider} ({activeCategoryLabel}).
          </p>
          <button
            type="button"
            onClick={() => {
              setCategory('all');
              setActiveQuery('');
              setSearchInput('');
              setPage(1);
            }}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold cursor-pointer"
          >
            Reset Category Filter
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {videos.map((v) => {
            const numId = hashProviderKeyToNumericId(v.provider, v.id);
            const vKey = `xerohots:${numId}`;
            const savedOffline = Boolean(downloadedKeys?.has(vKey));
            const job = jobs[vKey];
            const isSaving = job?.status === 'downloading';

            return (
              <div
                key={`${v.provider}-${v.id}`}
                className="w-full group rounded-2xl overflow-hidden bg-[var(--surface-card)] border border-[var(--surface-border)] flex flex-col hover:border-rose-400/50 transition-colors h-full"
              >
                <button
                  type="button"
                  onClick={() => {
                    playClickFx();
                    setSelectedVideo(v);
                  }}
                  className="w-full text-left flex-1 flex flex-col cursor-pointer"
                >
                  <div className="relative aspect-video w-full bg-zinc-900 overflow-hidden">
                    <img
                      src={v.thumbnail}
                      alt={v.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-11 h-11 rounded-full bg-rose-600/90 text-white flex items-center justify-center shadow-lg">
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                    </div>
                    <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] font-mono tabular-nums">
                      {v.duration}
                    </div>
                  </div>
                  <div className="p-3.5 pb-2 space-y-1">
                    <h3 className="text-xs font-semibold text-white line-clamp-2 leading-snug">
                      {v.title}
                    </h3>
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 gap-2">
                      <span className="truncate">
                        <span className="uppercase text-rose-300 font-semibold">{v.provider}</span> · {v.uploader}
                      </span>
                      <span className="shrink-0 tabular-nums">{v.rating}</span>
                    </div>
                  </div>
                </button>

                {/* Card Download Bar */}
                <div className="px-3.5 pb-3 pt-1 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleDirectMp4Download(v)}
                    aria-label={`Download ${v.title} MP4`}
                    className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/35 border border-rose-400/30 text-[11px] font-semibold text-rose-100 cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    <span>MP4</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveToOfflineVault(v)}
                    aria-label={`Save ${v.title} to Offline Vault`}
                    className={`flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                      savedOffline
                        ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                        : 'bg-white/5 hover:bg-white/15 border-white/10 text-zinc-200'
                    }`}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>
                          {job.totalBytes > 0 ? `${Math.round((job.loadedBytes / job.totalBytes) * 100)}%` : '...'}
                        </span>
                      </>
                    ) : savedOffline ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Offline</span>
                      </>
                    ) : (
                      <>
                        <HardDrive className="w-3 h-3" />
                        <span>Save Offline</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
