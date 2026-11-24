import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Flame,
  KeyRound,
  Lock,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  isXeroStarActive,
  SUBSCRIPTION_PLANS,
  type UserSubscriptionState,
} from '../utils/subscription';
import { playClickFx } from '../utils/soundFx';
import { TiltGlassCard } from './TiltGlassCard';

const DEV_FACEBOOK_URL = 'https://web.facebook.com/share/p/1E7E6y8HAD/';
const STRICT_HOTS_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-presentation';

export interface XeroHotsVideo {
  id: string;
  title: string;
  duration: string;
  views: string;
  rating: string;
  thumbnail: string;
  embedUrl: string;
  sourceUrl: string;
  provider: 'eporner' | 'xvideos' | 'pornhub';
  uploader: string;
}

type ProviderTab = 'all' | 'eporner' | 'xvideos' | 'pornhub';

interface XeroHotsViewProps {
  isSignedIn: boolean;
  account: UserSubscriptionState | null;
  hasPin: boolean;
  isPinUnlocked: boolean;
  onRequestPinUnlock: () => void;
  onLockNow: () => void;
  onOpenAccount: () => void;
}

const PROVIDER_TABS: { id: ProviderTab; label: string }[] = [
  { id: 'all', label: 'All Sources' },
  { id: 'eporner', label: 'Eporner HD' },
  { id: 'xvideos', label: 'XVideos' },
  { id: 'pornhub', label: 'Pornhub' },
];

export const XeroHotsView: React.FC<XeroHotsViewProps> = ({
  isSignedIn,
  account,
  hasPin,
  isPinUnlocked,
  onRequestPinUnlock,
  onLockNow,
  onOpenAccount,
}) => {
  const hasVip = isXeroStarActive(account);
  const [provider, setProvider] = useState<ProviderTab>('all');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [videos, setVideos] = useState<XeroHotsVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<XeroHotsVideo | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const loadVideos = useCallback(async (prov: ProviderTab, query: string, pageNum: number) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const endpoint = query.trim()
        ? `/api/xerohots/search?provider=${encodeURIComponent(prov)}&q=${encodeURIComponent(query.trim())}&page=${pageNum}`
        : `/api/xerohots/feed?provider=${encodeURIComponent(prov)}&page=${pageNum}`;
      const res = await fetch(endpoint);
      const data = (await res.json()) as { ok?: boolean; items?: XeroHotsVideo[]; error?: string };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Unable to reach XeroHots feed (HTTP ${res.status})`);
      }
      setVideos(data.items || []);
    } catch (err) {
      setVideos([]);
      setErrorMsg(err instanceof Error ? err.message : 'Unable to fetch AdultColony-API streams.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasVip || !isPinUnlocked) return;
    void loadVideos(provider, activeQuery, page);
  }, [hasVip, isPinUnlocked, provider, activeQuery, page, loadVideos]);

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
          className="liquid-glass-strong rounded-3xl p-6 sm:p-10 border border-rose-500/30 bg-gradient-to-br from-[#230b14]/95 to-zinc-950/95 text-white space-y-6 shadow-2xl"
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
            <div className="px-4 py-2 rounded-2xl bg-rose-600/25 border border-rose-400/40 text-left sm:text-right">
              <div className="text-xs text-rose-200">{SUBSCRIPTION_PLANS.XEROSTAR.durationLabel}</div>
              <div className="text-xl font-bold font-display">
                ₱{SUBSCRIPTION_PLANS.XEROSTAR.pricePesos} Pesos
              </div>
            </div>
          </div>

          <p className="text-sm text-zinc-300 leading-relaxed max-w-2xl">
            XeroHots streams open-source 18+ multi-provider adult channels (Eporner HD, XVideos, and Pornhub via AdultColony-API) inside a pop-up-blocked sandbox player guarded by a private XeroHots PIN. This channel requires an active{' '}
            <span className="font-semibold text-white">XEROSTAR (₱150)</span> membership.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-1">
              <div className="font-bold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Ad-Free Sandbox</span>
              </div>
              <p className="text-zinc-400">
                External embed popups and intrusive redirects stripped inside the player sandbox.
              </p>
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-1">
              <div className="font-bold text-white flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-rose-300" />
                <span>Private XeroHots PIN</span>
              </div>
              <p className="text-zinc-400">
                Requires your personal 4-6 digit PIN every session so others cannot open it.
              </p>
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-1">
              <div className="font-bold text-white flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-rose-400" />
                <span>Open-Source Sources</span>
              </div>
              <p className="text-zinc-400">
                Live search &amp; trending feeds across Eporner, XVideos, and Pornhub channels.
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
                  Sign in with Google first to receive your UserID, then activate the ₱150 XEROSTAR VIP plan.
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
          className="liquid-glass-strong rounded-3xl p-8 text-center space-y-5 border border-rose-500/30 text-white"
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* XeroHots Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-600/25 border border-rose-400/40 flex items-center justify-center text-rose-300">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold font-display">XeroHots VIP</h1>
              <span className="px-2 py-0.5 rounded-md bg-rose-600/25 border border-rose-400/40 text-rose-200 text-[10px] font-bold">
                XEROSTAR ACTIVE
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              AdultColony-API Multi-Provider · Sandboxed Ad-Free Playback
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
            className="relative flex-1 sm:w-72"
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
              placeholder="Search AdultColony channels..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-400/50"
            />
          </form>

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
            <span>Lock XeroHots</span>
          </button>
        </div>
      </div>

      {/* Inline Sandboxed Video Player */}
      {selectedVideo && (
        <div className="liquid-glass-strong rounded-3xl p-4 sm:p-5 space-y-3 border border-rose-500/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-rose-300 font-semibold uppercase tracking-wider">
                {selectedVideo.provider} · {selectedVideo.duration}
              </div>
              <h2 className="text-lg font-bold font-display truncate">{selectedVideo.title}</h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-[11px] font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Pop-Out Ads Blocked</span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedVideo(null)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Close Player</span>
              </button>
            </div>
          </div>

          <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black border border-white/15">
            <iframe
              key={`${selectedVideo.provider}-${selectedVideo.id}`}
              src={selectedVideo.embedUrl}
              title={selectedVideo.title}
              sandbox={STRICT_HOTS_SANDBOX}
              referrerPolicy="no-referrer"
              allow="autoplay; fullscreen; encrypted-media"
              className="w-full h-full border-0"
            />
          </div>

          <p className="text-[11px] text-zinc-400">
            Stream sandboxed cleanly via AdultColony-API ({selectedVideo.uploader}). Switch providers below anytime if a mirror is slow.
          </p>
        </div>
      )}

      {/* Provider Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {PROVIDER_TABS.map((tab) => {
            const active = provider === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  playClickFx();
                  setProvider(tab.id);
                  setPage(1);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                  active
                    ? 'bg-rose-600 text-white'
                    : 'liquid-glass text-zinc-300 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="p-2 rounded-xl liquid-glass disabled:opacity-40 cursor-pointer"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono px-2">Page {page}</span>
          <button
            type="button"
            disabled={loading || videos.length === 0}
            onClick={() => setPage((p) => p + 1)}
            className="p-2 rounded-xl liquid-glass disabled:opacity-40 cursor-pointer"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
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
        <div className="liquid-glass rounded-2xl p-6 flex items-center justify-between gap-4">
          <p className="text-xs text-rose-400">{errorMsg}</p>
          <button
            type="button"
            onClick={() => void loadVideos(provider, activeQuery, page)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-zinc-950 text-xs font-semibold cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : videos.length === 0 ? (
        <div className="liquid-glass rounded-2xl p-10 text-center text-xs text-zinc-400">
          No videos returned for this provider or query. Try switching channels above.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {videos.map((v) => (
            <TiltGlassCard key={`${v.provider}-${v.id}`} intensity={5} className="rounded-2xl">
              <button
                type="button"
                onClick={() => {
                  playClickFx();
                  setSelectedVideo(v);
                }}
                className="w-full group text-left rounded-2xl overflow-hidden liquid-glass flex flex-col cursor-pointer hover:border-rose-400/50 transition-colors"
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
                  <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/80 text-white text-[10px] font-mono">
                    {v.duration}
                  </div>
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-rose-600/85 text-white text-[10px] font-bold uppercase">
                    {v.provider}
                  </div>
                </div>
                <div className="p-3.5 space-y-1">
                  <h3 className="text-xs font-semibold text-white line-clamp-2 leading-snug">
                    {v.title}
                  </h3>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="truncate max-w-[140px]">{v.uploader}</span>
                    <span>{v.rating}</span>
                  </div>
                </div>
              </button>
            </TiltGlassCard>
          ))}
        </div>
      )}
    </div>
  );
};
