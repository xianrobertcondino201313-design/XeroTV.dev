import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { Bookmark, Film, HardDriveDownload, Play, RefreshCw, Search, WifiOff } from 'lucide-react';
import {
  auth,
  db,
  ensureUserDocuments,
  handleFirestoreError,
  isTransientOfflineFirestoreError,
  OperationType,
  saveUserPinHash,
  syncStorageUsedToFirestore,
  upsertPresenceHeartbeat,
} from './lib/firebase';
import {
  listOfflineMovies,
  type OfflineMovieSummary,
} from './lib/offlineVault';
import { DownloadProvider, useDownloadManager } from './lib/downloadContext';
import { WatchlistProvider, useWatchlist } from './lib/watchlistContext';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  filterMediaForMode,
  isChristmasModeUnlocked,
  MODE_CONFIGS,
  type MediaItem,
  type ProfileMode,
} from './utils/modes';
import { cachedTmdbFetch, TMDB_CACHE_TTL } from './utils/tmdbCache';
import type { UserSubscriptionState } from './utils/subscription';
import { playClickFx } from './utils/soundFx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ChristmasSnow } from './components/ChristmasSnow';
import { TopNav, type AppSection } from './components/TopNav';
import { LiveSystemBar } from './components/LiveSystemBar';
import { MobileBottomBar } from './components/MobileBottomBar';
import { ModeSwitcherBar } from './components/ModeSwitcherBar';
import { MediaCard } from './components/MediaCard';
import { NetworksCatalog } from './components/NetworksCatalog';
import { PlayerView } from './components/PlayerView';
import { OfflineVaultView } from './components/OfflineVaultView';
import { DocsAndChangelogView } from './components/DocsAndChangelogView';
import { GetAppsView } from './components/GetAppsView';
import { XeroHotsView } from './components/XeroHotsView';
import { PinModal } from './components/PinModal';
import { AccountModal } from './components/AccountModal';
import { AdminTriggerAndModal } from './components/AdminTriggerAndModal';
import { LegalModal, type LegalDocType } from './components/LegalModal';
import { SiteFooter } from './components/SiteFooter';
import { IntroduceWalkthrough } from './components/IntroduceWalkthrough';
import { SettingsModal } from './components/SettingsModal';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { BackgroundDownloadsTray } from './components/BackgroundDownloadsTray';
import { ChristmasLockModal } from './components/ChristmasLockModal';
import { TiltGlassCard } from './components/TiltGlassCard';

interface FeedSection {
  id: string;
  title: string;
  items: MediaItem[];
}

const HAS_LOGGED_IN_KEY = 'xtv_has_logged_in_before';

const GENRE_FILTERS = [
  { id: '', label: 'All Genres' },
  { id: '28', label: 'Action' },
  { id: '35', label: 'Comedy' },
  { id: '18', label: 'Drama' },
  { id: '878', label: 'Sci-Fi' },
  { id: '16', label: 'Animation' },
  { id: '10751', label: 'Family' },
];

function getInitialSectionFromUrl(): AppSection {
  if (typeof window === 'undefined') return 'home';
  const param = new URLSearchParams(window.location.search).get('section');
  if (
    param === 'movies' ||
    param === 'series' ||
    param === 'hots' ||
    param === 'vault' ||
    param === 'docs' ||
    param === 'apps'
  ) {
    return param;
  }
  return 'home';
}

function shouldShowIntroInitially(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') return false;
  try {
    return window.localStorage.getItem(HAS_LOGGED_IN_KEY) !== '1';
  } catch {
    return false;
  }
}

function XeroTvShell() {
  const isOnline = useOnlineStatus();
  const { unreadCount, pushNotification } = useDownloadManager();

  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<UserSubscriptionState | null>(null);

  const [mode, setMode] = useState<ProfileMode>('main');
  const [activeSection, setActiveSection] = useState<AppSection>(() => getInitialSectionFromUrl());
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);

  const [sections, setSections] = useState<FeedSection[]>([]);
  const [discoverItems, setDiscoverItems] = useState<MediaItem[]>([]);
  const [selectedGenre, setSelectedGenre] = useState('');
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [feedError, setFeedError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MediaItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [offlineMovies, setOfflineMovies] = useState<OfflineMovieSummary[]>([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [christmasLockOpen, setChristmasLockOpen] = useState(false);
  const [introduceOpen, setIntroduceOpen] = useState<boolean>(() => shouldShowIntroInitially());
  const [legalDoc, setLegalDoc] = useState<LegalDocType>(null);

  const { items: watchlistItems, clearWatchlist } = useWatchlist();
  const [hotsUnlockedThisSession, setHotsUnlockedThisSession] = useState(false);

  const [pinPrompt, setPinPrompt] = useState<{
    open: boolean;
    title: string;
    description: string;
    promptMode: 'create' | 'verify';
    expectedHash?: string;
    pinKind: 'kids' | 'adult' | 'hots';
    targetMode?: ProfileMode;
    targetSection?: AppSection;
  } | null>(null);

  // Refresh local IndexedDB offline vault
  const refreshVault = useCallback(async () => {
    try {
      const items = await listOfflineMovies();
      setOfflineMovies(items);
      return items.reduce((s, x) => s + (x.sizeBytes || 0), 0);
    } catch {
      return 0;
    }
  }, []);

  useEffect(() => {
    void refreshVault();
  }, [refreshVault]);

  // Real Presence Heartbeat (every 45s) for truthful Live Online counts
  useEffect(() => {
    void upsertPresenceHeartbeat(mode);
    const id = window.setInterval(() => {
      void upsertPresenceHeartbeat(mode);
    }, 45_000);
    return () => window.clearInterval(id);
  }, [mode]);

  // Fetch Real TMDB New Releases into Notification Center (deferred 1.5s to keep first paint crisp)
  useEffect(() => {
    if (!isOnline) return;
    const timer = window.setTimeout(() => {
      cachedTmdbFetch<{ releases?: MediaItem[] }>('/api/tmdb/releases', TMDB_CACHE_TTL.MEDIUM)
        .then((data) => {
          const items = (data.releases || []).slice(0, 3);
          for (const rel of items) {
            const name = rel.title || rel.name;
            if (!name) continue;
            pushNotification({
              id: `release-${rel.media_type || 'movie'}-${rel.id}`,
              kind: 'release',
              title: `New Release: ${name}`,
              description: rel.overview
                ? rel.overview.slice(0, 110) + (rel.overview.length > 110 ? '...' : '')
                : 'Now streaming on XEROTV VidZen & mstream servers.',
            });
          }
        })
        .catch(() => {});
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [isOnline, pushNotification]);

  // Firebase Auth & Account listener + mark hasLoggedInBefore so Introduce never auto-opens again
  useEffect(() => {
    let unsubAccount: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (unsubAccount) {
        unsubAccount();
        unsubAccount = null;
      }
      setUser(fbUser);
      if (!fbUser) {
        setAccount(null);
        setHotsUnlockedThisSession(false);
        return;
      }

      // Permanent dismissal of auto-Introduce once logged in at least once
      try {
        window.localStorage.setItem(HAS_LOGGED_IN_KEY, '1');
      } catch {
        // ignore storage failures
      }
      setIntroduceOpen(false);

      try {
        const initialOrCached = await ensureUserDocuments(fbUser);
        setAccount((prev) => prev || initialOrCached);
        const userRef = doc(db, 'users', fbUser.uid);
        unsubAccount = onSnapshot(
          userRef,
          (snap) => {
            if (snap.exists()) {
              setAccount(snap.data() as UserSubscriptionState);
            }
          },
          (err) => {
            if (isTransientOfflineFirestoreError(err)) {
              console.warn('Firestore live listener waiting for network recovery.');
              return;
            }
            handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`);
          },
        );
      } catch (err) {
        if (!isTransientOfflineFirestoreError(err)) {
          console.error(err);
        }
      }
    });

    return () => {
      unsubAuth();
      if (unsubAccount) unsubAccount();
    };
  }, []);

  // Sync mode CSS attribute, browser theme-color, & dynamic tab favicon
  useEffect(() => {
    document.documentElement.setAttribute('data-mode', mode);
    const favicon = document.getElementById('dynamic-favicon') as HTMLLinkElement | null;
    if (favicon) {
      favicon.href = MODE_CONFIGS[mode].faviconPath;
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      const colorMap: Record<ProfileMode, string> = {
        main: '#09090b',
        kids: '#eef6ff',
        adult: '#0b0608',
        christmas: '#061510',
      };
      themeMeta.setAttribute('content', colorMap[mode]);
    }
  }, [mode]);

  // Fetch TMDB feed for active mode (immediately clear stale sections on mode switch)
  const loadFeed = useCallback(async (targetMode: ProfileMode) => {
    setSections([]);
    setLoadingFeed(true);
    setFeedError('');
    try {
      const data = await cachedTmdbFetch<{ sections: FeedSection[] }>(
        `/api/tmdb/feed?mode=${encodeURIComponent(targetMode)}`,
        TMDB_CACHE_TTL.MEDIUM,
      );
      setSections(
        (data.sections || []).map((sec) => ({
          ...sec,
          items: filterMediaForMode(sec.items || [], targetMode),
        })),
      );
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : 'Unable to reach TMDB catalog.');
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed(mode);
    setSearchResults(null);
    setSearchQuery('');
  }, [mode, loadFeed]);

  // Discover Movies or Series when section tab changes
  const [discoverRetryCount, setDiscoverRetryCount] = useState(0);
  useEffect(() => {
    if (activeSection !== 'movies' && activeSection !== 'series') return;
    const mediaType = activeSection === 'series' ? 'tv' : 'movie';
    let active = true;
    setDiscoverItems([]);
    setLoadingFeed(true);
    setFeedError('');
    cachedTmdbFetch<{ results: MediaItem[] }>(
      `/api/tmdb/discover?mediaType=${mediaType}&mode=${encodeURIComponent(mode)}&genre=${encodeURIComponent(selectedGenre)}`,
      TMDB_CACHE_TTL.MEDIUM,
    )
      .then((data) => {
        if (!active) return;
        setDiscoverItems(filterMediaForMode(data.results || [], mode));
      })
      .catch((err) => {
        if (active) {
          setDiscoverItems([]);
          setFeedError(err instanceof Error ? err.message : 'Unable to reach catalog.');
        }
      })
      .finally(() => {
        if (active) setLoadingFeed(false);
      });
    return () => {
      active = false;
    };
  }, [activeSection, mode, selectedGenre, discoverRetryCount]);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    setSelectedMedia(null);
    if (activeSection === 'vault' || activeSection === 'apps' || activeSection === 'docs') {
      setActiveSection('home');
    }
    try {
      const data = await cachedTmdbFetch<{ results?: MediaItem[] }>(
        `/api/tmdb/search?query=${encodeURIComponent(q)}&mode=${encodeURIComponent(mode)}`,
        TMDB_CACHE_TTL.SHORT,
      );
      setSearchResults(filterMediaForMode(data.results || [], mode));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const getSavedPinHash = (kind: 'kids' | 'adult' | 'hots'): string | undefined => {
    if (kind === 'kids') {
      return account?.kidsPinHash || localStorage.getItem('xtv_kids_pin_hash') || undefined;
    }
    if (kind === 'hots') {
      return account?.xerohotsPinHash || localStorage.getItem('xtv_hots_pin_hash') || undefined;
    }
    return account?.adultPinHash || localStorage.getItem('xtv_adult_pin_hash') || undefined;
  };

  const handleRequestHotsPinUnlock = () => {
    const hotsHash = getSavedPinHash('hots');
    setPinPrompt({
      open: true,
      title: hotsHash ? 'XeroHots Secret PIN' : 'Create XeroHots PIN',
      description: hotsHash
        ? 'Enter your private 4-6 digit XeroHots PIN to unlock this VIP session.'
        : 'Set a private 4-6 digit PIN to protect your XeroHots VIP channel.',
      promptMode: hotsHash ? 'verify' : 'create',
      expectedHash: hotsHash,
      pinKind: 'hots',
    });
  };

  const applyModeTransition = (nextMode: ProfileMode) => {
    setSelectedMedia(null);
    setSections([]);
    setDiscoverItems([]);
    setSearchResults(null);
    if (nextMode === 'kids') {
      setHotsUnlockedThisSession(false);
      if (activeSection === 'hots') {
        setActiveSection('home');
      }
    }
    setMode(nextMode);
  };

  const handleRequestModeChange = (target: ProfileMode) => {
    if (target === mode) return;

    // Christmas Mode locked until Dec 25 12:00 AM
    if (target === 'christmas' && !isChristmasModeUnlocked(Date.now())) {
      setChristmasLockOpen(true);
      return;
    }

    // Exiting Kids Mode requires Parental PIN
    if (mode === 'kids') {
      const kidsHash = getSavedPinHash('kids');
      if (kidsHash) {
        setPinPrompt({
          open: true,
          title: 'Parental PIN Required',
          description: 'Enter your Parental PIN to exit Kids Mode (PG).',
          promptMode: 'verify',
          expectedHash: kidsHash,
          pinKind: 'kids',
          targetMode: target,
        });
        return;
      }
    }

    // Entering Kids Mode requires setting a Parental PIN if none exists yet
    if (target === 'kids') {
      const kidsHash = getSavedPinHash('kids');
      if (!kidsHash) {
        setPinPrompt({
          open: true,
          title: 'Set Kids Parental PIN',
          description: 'Create a 4-6 digit PIN so kids cannot exit PG Mode without permission.',
          promptMode: 'create',
          pinKind: 'kids',
          targetMode: 'kids',
        });
        return;
      }
    }

    // Entering 18+ Movies Mode requires Secret PIN
    if (target === 'adult') {
      const adultHash = getSavedPinHash('adult');
      setPinPrompt({
        open: true,
        title: adultHash ? '18+ Secret PIN' : 'Create 18+ Secret PIN',
        description: adultHash
          ? 'Enter your Secret PIN to unlock 18+ Movies.'
          : 'Set a private 4-6 digit Secret PIN to protect 18+ Movies.',
        promptMode: adultHash ? 'verify' : 'create',
        expectedHash: adultHash,
        pinKind: 'adult',
        targetMode: 'adult',
      });
      return;
    }

    applyModeTransition(target);
  };

  const handlePinSuccess = async (pinHash: string) => {
    if (!pinPrompt) return;
    if (pinPrompt.promptMode === 'create') {
      const storageKey =
        pinPrompt.pinKind === 'kids'
          ? 'xtv_kids_pin_hash'
          : pinPrompt.pinKind === 'hots'
            ? 'xtv_hots_pin_hash'
            : 'xtv_adult_pin_hash';
      localStorage.setItem(storageKey, pinHash);
      if (user) {
        saveUserPinHash(user.uid, pinPrompt.pinKind, pinHash).catch(() => {});
      }
    }
    const { pinKind, targetMode, targetSection } = pinPrompt;
    setPinPrompt(null);
    if (pinKind === 'hots') {
      setHotsUnlockedThisSession(true);
      if (targetSection) setActiveSection(targetSection);
      return;
    }
    if (targetMode) {
      applyModeTransition(targetMode);
    }
  };

  const handleVaultChanged = async (newUsedBytes: number) => {
    await refreshVault();
    if (user) {
      syncStorageUsedToFirestore(user.uid, newUsedBytes).catch(() => {});
    }
  };

  const downloadedKeys = new Set(offlineMovies.map((m) => m.key));
  const visibleWatchlist = filterMediaForMode(watchlistItems, mode);
  const heroItem = sections[0]?.items?.[0] || null;
  const isKids = mode === 'kids';
  const modeCfg = MODE_CONFIGS[mode];

  return (
    <div className="min-h-screen flex flex-col relative">
      <ChristmasSnow active={mode === 'christmas'} />

      <TopNav
        activeSection={activeSection}
        onSelectSection={(sec) => {
          setSelectedMedia(null);
          setActiveSection(sec);
        }}
        mode={mode}
        isSignedIn={!!user}
        displayName={user?.displayName}
        unreadNotifications={unreadCount}
        onOpenAccount={() => setAccountOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <LiveSystemBar mode={mode} isOnline={isOnline} />

      {!isOnline && (
        <div className="bg-amber-500 text-zinc-950 text-xs font-semibold px-4 py-2 text-center flex items-center justify-center gap-3">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>You are currently offline. Downloaded movies remain available in your Offline Vault.</span>
          <button
            type="button"
            onClick={() => {
              setSelectedMedia(null);
              setActiveSection('vault');
            }}
            className="underline font-bold cursor-pointer"
          >
            Open Offline Vault
          </button>
        </div>
      )}

      <main className="flex-1">
        {selectedMedia ? (
          <PlayerView
            item={selectedMedia}
            mode={mode}
            account={account}
            downloadedKeys={downloadedKeys}
            onBack={() => setSelectedMedia(null)}
            onSelectMedia={(m) => setSelectedMedia(m)}
            onVaultChanged={handleVaultChanged}
            onOpenAccount={() => setAccountOpen(true)}
          />
        ) : activeSection === 'vault' ? (
          <OfflineVaultView
            items={offlineMovies}
            mode={mode}
            account={account}
            isOnline={isOnline}
            onVaultUpdated={handleVaultChanged}
            onOpenAccount={() => setAccountOpen(true)}
          />
        ) : activeSection === 'docs' ? (
          <DocsAndChangelogView
            mode={mode}
            onReplayIntroduce={() => setIntroduceOpen(true)}
            onOpenAccount={() => setAccountOpen(true)}
            onOpenVault={() => setActiveSection('vault')}
          />
        ) : activeSection === 'apps' ? (
          <GetAppsView
            mode={mode}
            onOpenVault={() => setActiveSection('vault')}
          />
        ) : activeSection === 'hots' ? (
          <XeroHotsView
            isSignedIn={!!user}
            account={account}
            hasPin={!!getSavedPinHash('hots')}
            isPinUnlocked={hotsUnlockedThisSession}
            onRequestPinUnlock={handleRequestHotsPinUnlock}
            onLockNow={() => setHotsUnlockedThisSession(false)}
            onOpenAccount={() => setAccountOpen(true)}
          />
        ) : (
          <>
            <ModeSwitcherBar
              mode={mode}
              onRequestModeChange={handleRequestModeChange}
              searchQuery={searchQuery}
              onSearchChange={(q) => {
                setSearchQuery(q);
                if (!q.trim()) setSearchResults(null);
              }}
              onSearchSubmit={handleSearchSubmit}
              onClearSearch={() => {
                setSearchQuery('');
                setSearchResults(null);
              }}
            />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 space-y-10">
              {/* Search Results View */}
              {searchResults !== null ? (
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold font-display flex items-center gap-2">
                      <Search className="w-5 h-5" />
                      <span>Search Results for &quot;{searchQuery}&quot;</span>
                    </h1>
                    <span className="text-xs tabular-nums opacity-70">
                      {searchResults.length} titles
                    </span>
                  </div>
                  {searching ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                      {Array.from({ length: 10 }).map((_, idx) => (
                        <div key={idx} className="aspect-[2/3] rounded-2xl bg-white/5 animate-pulse" />
                      ))}
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className={`rounded-3xl p-10 text-center space-y-2 ${isKids ? 'bg-white border border-sky-200' : 'liquid-glass'}`}>
                      <Film className="w-8 h-8 mx-auto opacity-50" />
                      <p className="text-sm opacity-75">
                        No matching titles found in {modeCfg.label}.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                      {searchResults.map((item) => (
                        <MediaCard
                          key={`${item.media_type || 'movie'}-${item.id}`}
                          item={item}
                          mode={mode}
                          onSelect={setSelectedMedia}
                          isDownloaded={downloadedKeys.has(`${item.media_type || 'movie'}:${item.id}`)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ) : activeSection === 'movies' || activeSection === 'series' ? (
                /* Movies / Series Discover Grid */
                <section className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h1 className="text-3xl font-bold font-display">
                        {activeSection === 'series' ? 'TV Series Catalog' : 'Movies Catalog'}
                      </h1>
                      <p className={`text-xs mt-1 ${isKids ? 'text-slate-600' : 'text-zinc-400'}`}>
                        {modeCfg.label} · {modeCfg.tagline}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                      {GENRE_FILTERS.map((g) => {
                        const active = selectedGenre === g.id;
                        return (
                          <button
                            key={g.id || 'all'}
                            type="button"
                            onClick={() => {
                              playClickFx();
                              setSelectedGenre(g.id);
                            }}
                            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                              active
                                ? isKids
                                  ? 'bg-sky-600 text-white'
                                  : mode === 'adult'
                                    ? 'bg-rose-500 text-white'
                                    : mode === 'christmas'
                                      ? 'bg-amber-400 text-zinc-950'
                                      : 'bg-white text-zinc-950'
                                : isKids
                                  ? 'bg-white border border-sky-200 text-slate-700 hover:bg-sky-50'
                                  : 'liquid-glass text-zinc-300 hover:text-white'
                            }`}
                          >
                            {g.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {loadingFeed ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                      {Array.from({ length: 10 }).map((_, idx) => (
                        <div key={idx} className="aspect-[2/3] rounded-2xl bg-white/5 animate-pulse" />
                      ))}
                    </div>
                  ) : discoverItems.length === 0 ? (
                    <div className={`rounded-2xl p-8 text-center space-y-3 ${isKids ? 'bg-white border border-sky-200' : 'liquid-glass'}`}>
                      <p className={`text-sm font-medium ${feedError ? 'text-rose-400' : isKids ? 'text-slate-600' : 'text-zinc-300'}`}>
                        {feedError || 'No titles matched this genre filter right now.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setDiscoverRetryCount((c) => c + 1)}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                          isKids ? 'bg-sky-600 text-white' : 'bg-white text-zinc-950'
                        }`}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry Catalog</span>
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                      {discoverItems.map((item) => (
                        <MediaCard
                          key={`${item.media_type || 'movie'}-${item.id}`}
                          item={item}
                          mode={mode}
                          onSelect={setSelectedMedia}
                          isDownloaded={downloadedKeys.has(`${item.media_type || 'movie'}:${item.id}`)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ) : (
                /* Home Spotlight & Real TMDB Sections */
                <>
                  {/* Hero Spotlight */}
                  <TiltGlassCard intensity={3} className="rounded-3xl">
                    <section
                      className={`relative rounded-3xl overflow-hidden min-h-[380px] sm:min-h-[440px] flex items-end ${
                        isKids ? 'bg-sky-900 text-white' : 'bg-zinc-950 text-white border border-white/10'
                      }`}
                    >
                      {heroItem?.backdrop_path ? (
                        <img
                          src={`https://image.tmdb.org/t/p/original${heroItem.backdrop_path}`}
                          alt={heroItem.title || heroItem.name || 'Featured movie'}
                          referrerPolicy="no-referrer"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <img
                          src="/src/assets/images/xerotv_splash_backdrop_1795185549127.jpg"
                          alt="XEROTV Cinema"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/15"
                      />

                      <div className="relative z-10 w-full p-6 sm:p-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div className="max-w-2xl space-y-3">
                          <div className="flex items-center gap-3">
                            <img
                              src={
                                mode === 'christmas'
                                  ? '/src/assets/images/xerotv_christmas_emblem_1795185549050.jpg'
                                  : mode === 'kids'
                                    ? '/src/assets/images/xerotv_kids_emblem_1795185548914.jpg'
                                    : '/src/assets/images/xerotv_app_icon_1795185548315.jpg'
                              }
                              alt={`${modeCfg.label} emblem`}
                              className="w-10 h-10 rounded-xl object-cover border border-white/25"
                            />
                            <div className="text-xs font-medium text-zinc-300">
                              {modeCfg.label} · {modeCfg.themeName} Theme
                            </div>
                          </div>

                          <h1 className="text-3xl sm:text-5xl font-bold font-display text-balance leading-tight">
                            {heroItem ? heroItem.title || heroItem.name : 'XEROTV Liquid Cinema'}
                          </h1>

                          <p className="text-sm sm:text-base text-zinc-200 line-clamp-2 max-w-xl">
                            {heroItem?.overview ||
                              'Stream real TMDB movies and series via sandbox-ready VidZen and NxSha servers or download MP4s in the background to your offline vault.'}
                          </p>

                          <div className="pt-2 flex flex-wrap items-center gap-3">
                            {heroItem && (
                              <button
                                type="button"
                                onClick={() => {
                                  playClickFx();
                                  setSelectedMedia(heroItem);
                                }}
                                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
                              >
                                <Play className="w-4 h-4 fill-current" />
                                <span>Watch Now</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                playClickFx();
                                setActiveSection('vault');
                              }}
                              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-zinc-950/75 border border-white/25 text-white text-sm font-semibold hover:bg-zinc-900/90 transition-colors cursor-pointer"
                            >
                              <HardDriveDownload className="w-4 h-4" />
                              <span>Offline Vault ({offlineMovies.length})</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                playClickFx();
                                setActiveSection('docs');
                              }}
                              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-zinc-950/75 border border-white/25 text-zinc-100 text-xs font-semibold hover:bg-zinc-900/90 transition-colors cursor-pointer"
                            >
                              <span>Improving at 1.0</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </section>
                  </TiltGlassCard>

                  {/* Networks & Studios Catalog Shelf */}
                  <NetworksCatalog
                    mode={mode}
                    downloadedKeys={downloadedKeys}
                    onSelectMedia={setSelectedMedia}
                  />

                  {/* mstream Synced Watchlist Shelf */}
                  {visibleWatchlist.length > 0 && (
                    <section className="space-y-4" aria-label="My Watchlist">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <Bookmark className="w-5 h-5 opacity-80" />
                          <h2 className="text-xl sm:text-2xl font-bold font-display">
                            My Watchlist ({visibleWatchlist.length})
                          </h2>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            playClickFx();
                            clearWatchlist();
                          }}
                          className={`text-xs font-semibold underline opacity-75 hover:opacity-100 cursor-pointer ${
                            isKids ? 'text-slate-600' : 'text-zinc-300'
                          }`}
                        >
                          Clear Watchlist
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                        {visibleWatchlist.slice(0, 10).map((item) => (
                          <MediaCard
                            key={`wl-${item.media_type || 'movie'}-${item.id}`}
                            item={item}
                            mode={mode}
                            onSelect={setSelectedMedia}
                            isDownloaded={downloadedKeys.has(`${item.media_type || 'movie'}:${item.id}`)}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Feed Error State */}
                  {feedError && (
                    <div className={`rounded-2xl p-6 flex items-center justify-between gap-4 ${isKids ? 'bg-white border border-sky-200' : 'liquid-glass'}`}>
                      <p className="text-sm text-rose-500 font-medium">
                        TMDB Sync Notice: {feedError}
                      </p>
                      <button
                        type="button"
                        onClick={() => loadFeed(mode)}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer ${isKids ? 'bg-sky-600 text-white' : 'bg-white text-zinc-950'}`}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    </div>
                  )}

                  {/* TMDB Catalog Sections */}
                  {loadingFeed ? (
                    <div className="space-y-8">
                      {[1, 2].map((row) => (
                        <div key={row} className="space-y-3">
                          <div className="h-6 w-48 rounded-lg bg-white/10 animate-pulse" />
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                            {Array.from({ length: 5 }).map((_, idx) => (
                              <div key={idx} className="aspect-[2/3] rounded-2xl bg-white/5 animate-pulse" />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    sections.map((sec) => (
                      <section key={sec.id} className="space-y-4">
                        <div className="flex items-baseline justify-between">
                          <h2 className="text-xl sm:text-2xl font-bold font-display">{sec.title}</h2>
                          <span className={`text-xs tabular-nums ${isKids ? 'text-slate-500' : 'text-zinc-400'}`}>
                            {sec.items.length} titles
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                          {sec.items.slice(0, 10).map((item) => (
                            <MediaCard
                              key={`${sec.id}-${item.media_type || 'movie'}-${item.id}`}
                              item={item}
                              mode={mode}
                              onSelect={setSelectedMedia}
                              isDownloaded={downloadedKeys.has(`${item.media_type || 'movie'}:${item.id}`)}
                            />
                          ))}
                        </div>
                      </section>
                    ))
                  )}
                </>
              )}
            </div>
          </>
        )}
      </main>

      <SiteFooter
        mode={mode}
        onOpenLegal={setLegalDoc}
        onOpenDocs={() => {
          setSelectedMedia(null);
          setActiveSection('docs');
        }}
      />

      <MobileBottomBar
        activeSection={activeSection}
        onSelectSection={(sec) => {
          setSelectedMedia(null);
          setActiveSection(sec);
        }}
        mode={mode}
      />

      <BackgroundDownloadsTray />

      <IntroduceWalkthrough
        open={introduceOpen}
        onSkip={() => setIntroduceOpen(false)}
        onGetStartedAuth={() => {
          setIntroduceOpen(false);
          setAccountOpen(true);
        }}
      />

      <AccountModal
        open={accountOpen}
        user={user}
        account={account}
        onClose={() => setAccountOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onOpenIntroduce={() => setIntroduceOpen(true)}
        onOpenAccount={() => setAccountOpen(true)}
      />

      <NotificationsDrawer
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onNavigateSection={(sec) => {
          setSelectedMedia(null);
          setActiveSection(sec);
        }}
      />

      <ChristmasLockModal
        open={christmasLockOpen}
        onClose={() => setChristmasLockOpen(false)}
      />

      <PinModal
        open={!!pinPrompt?.open}
        title={pinPrompt?.title || ''}
        description={pinPrompt?.description || ''}
        mode={pinPrompt?.promptMode || 'verify'}
        expectedHash={pinPrompt?.expectedHash}
        onSuccess={handlePinSuccess}
        onCancel={() => setPinPrompt(null)}
      />

      <LegalModal docType={legalDoc} onClose={() => setLegalDoc(null)} />

      <AdminTriggerAndModal
        isSignedIn={!!user}
        onOpenAccount={() => setAccountOpen(true)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <WatchlistProvider>
        <DownloadProvider>
          <XeroTvShell />
        </DownloadProvider>
      </WatchlistProvider>
    </ErrorBoundary>
  );
}
