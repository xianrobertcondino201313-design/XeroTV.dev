import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Tv, X } from 'lucide-react';
import { filterMediaForMode, type MediaItem, type ProfileMode } from '../utils/modes';
import { cachedTmdbFetch, TMDB_CACHE_TTL } from '../utils/tmdbCache';
import { playClickFx } from '../utils/soundFx';
import { MediaCard } from './MediaCard';
import { TiltGlassCard } from './TiltGlassCard';

export interface StudioBrand {
  id: string;
  name: string;
  subtitle: string;
  kidsSubtitle?: string;
  kidsSafe: boolean;
  accentFrom: string;
  accentTo: string;
  mark: React.ReactNode;
}

export const STUDIO_BRANDS: StudioBrand[] = [
  {
    id: 'netflix',
    name: 'Netflix',
    subtitle: 'Original Movies & Series',
    kidsSubtitle: 'Netflix Family & Kids Originals',
    kidsSafe: true,
    accentFrom: 'from-red-600/35',
    accentTo: 'to-zinc-950/95',
    mark: (
      <svg viewBox="0 0 135 30" className="h-6 w-auto fill-red-500" aria-hidden="true">
        <text x="0" y="24" fontFamily="Outfit, sans-serif" fontWeight="900" fontSize="24" letterSpacing="1.5">
          NETFLIX
        </text>
      </svg>
    ),
  },
  {
    id: 'disney',
    name: 'Disney+',
    subtitle: 'Movies, Family & Animation',
    kidsSubtitle: 'Disney Family & Cartoons',
    kidsSafe: true,
    accentFrom: 'from-blue-600/35',
    accentTo: 'to-slate-950/95',
    mark: (
      <svg viewBox="0 0 135 32" className="h-6 w-auto fill-sky-300" aria-hidden="true">
        <text x="0" y="24" fontFamily="Outfit, sans-serif" fontWeight="800" fontSize="22" letterSpacing="0.5">
          Disney+
        </text>
      </svg>
    ),
  },
  {
    id: 'hbo',
    name: 'HBO / Max',
    subtitle: 'Blockbusters & Drama',
    kidsSafe: false,
    accentFrom: 'from-indigo-600/35',
    accentTo: 'to-zinc-950/95',
    mark: (
      <svg viewBox="0 0 140 30" className="h-6 w-auto fill-white" aria-hidden="true">
        <text x="0" y="24" fontFamily="Outfit, sans-serif" fontWeight="900" fontSize="22" letterSpacing="1">
          HBO MAX
        </text>
      </svg>
    ),
  },
  {
    id: 'apple',
    name: 'Apple TV+',
    subtitle: 'Original Cinema & Sci-Fi',
    kidsSubtitle: 'Apple Kids & Family',
    kidsSafe: true,
    accentFrom: 'from-zinc-500/30',
    accentTo: 'to-zinc-950/95',
    mark: (
      <div className="inline-flex items-center gap-1.5 text-white" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white -mt-0.5">
          <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
        </svg>
        <span className="font-display font-bold text-xl leading-none tracking-tight">tv+</span>
      </div>
    ),
  },
  {
    id: 'prime',
    name: 'Prime Video',
    subtitle: 'Blockbuster Vault & Series',
    kidsSubtitle: 'Prime Kids & Animated',
    kidsSafe: true,
    accentFrom: 'from-cyan-500/30',
    accentTo: 'to-zinc-950/95',
    mark: (
      <svg viewBox="0 0 145 30" className="h-6 w-auto fill-cyan-300" aria-hidden="true">
        <text x="0" y="23" fontFamily="Outfit, sans-serif" fontWeight="800" fontSize="19">
          prime video
        </text>
      </svg>
    ),
  },
  {
    id: 'marvel',
    name: 'Marvel Studios',
    subtitle: 'Multiverse Movies & Shows',
    kidsSafe: false,
    accentFrom: 'from-rose-600/35',
    accentTo: 'to-zinc-950/95',
    mark: (
      <div className="px-2 py-0.5 bg-red-600 text-white font-display font-black text-sm tracking-widest rounded">
        MARVEL
      </div>
    ),
  },
  {
    id: 'pixar',
    name: 'Pixar',
    subtitle: 'Animation & Shorts',
    kidsSubtitle: 'Pixar Animation & Family',
    kidsSafe: true,
    accentFrom: 'from-amber-400/25',
    accentTo: 'to-slate-900/95',
    mark: (
      <span className="font-display font-extrabold tracking-[0.28em] text-sm text-white">
        PIXAR
      </span>
    ),
  },
  {
    id: 'warner',
    name: 'Warner Bros.',
    subtitle: 'WB Pictures & Television',
    kidsSubtitle: 'WB Cartoons & Family',
    kidsSafe: true,
    accentFrom: 'from-yellow-500/30',
    accentTo: 'to-zinc-950/95',
    mark: (
      <span className="px-2 py-0.5 rounded-full border border-amber-300/60 font-display font-extrabold text-xs tracking-wider text-amber-200">
        WB
      </span>
    ),
  },
  {
    id: 'a24',
    name: 'A24',
    subtitle: 'Independent Cinema & TV',
    kidsSafe: false,
    accentFrom: 'from-zinc-400/25',
    accentTo: 'to-black/95',
    mark: (
      <span className="font-display font-black tracking-tighter text-xl text-white">
        A24
      </span>
    ),
  },
];

type StudioTypeFilter = 'all' | 'movie' | 'tv';

interface NetworksCatalogProps {
  mode: ProfileMode;
  downloadedKeys: Set<string>;
  onSelectMedia: (item: MediaItem) => void;
}

export const NetworksCatalog: React.FC<NetworksCatalogProps> = ({
  mode,
  downloadedKeys,
  onSelectMedia,
}) => {
  const isKids = mode === 'kids';
  const [selectedStudioId, setSelectedStudioId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<StudioTypeFilter>('all');
  const [studioItems, setStudioItems] = useState<MediaItem[]>([]);
  const [loadingStudio, setLoadingStudio] = useState(false);
  const [studioError, setStudioError] = useState('');

  const visibleBrands = isKids ? STUDIO_BRANDS.filter((b) => b.kidsSafe) : STUDIO_BRANDS;

  const fetchStudioCatalog = useCallback(
    async (studioId: string, nextType: StudioTypeFilter) => {
      setLoadingStudio(true);
      setStudioError('');
      setStudioItems([]);
      try {
        const data = await cachedTmdbFetch<{ results?: MediaItem[]; error?: string }>(
          `/api/tmdb/studios?studio=${encodeURIComponent(studioId)}&mode=${encodeURIComponent(mode)}&type=${encodeURIComponent(nextType)}`,
          TMDB_CACHE_TTL.MEDIUM,
        );
        const filtered = filterMediaForMode(data.results || [], mode);
        setStudioItems(filtered);
      } catch (err) {
        setStudioItems([]);
        setStudioError(err instanceof Error ? err.message : 'Unable to reach studio catalog.');
      } finally {
        setLoadingStudio(false);
      }
    },
    [mode],
  );

  useEffect(() => {
    setStudioItems([]);
    if (isKids && selectedStudioId) {
      const target = STUDIO_BRANDS.find((s) => s.id === selectedStudioId);
      if (!target?.kidsSafe) {
        setSelectedStudioId(null);
      }
    }
  }, [mode, isKids, selectedStudioId]);

  useEffect(() => {
    if (!selectedStudioId) {
      setStudioItems([]);
      setStudioError('');
      return;
    }
    void fetchStudioCatalog(selectedStudioId, typeFilter);
  }, [selectedStudioId, typeFilter, fetchStudioCatalog]);

  const activeStudio = visibleBrands.find((s) => s.id === selectedStudioId) || null;

  return (
    <section className="space-y-4" aria-label="Networks and Studios Catalog">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Tv className="w-5 h-5 opacity-80" />
          <h2 className="text-xl sm:text-2xl font-bold font-display">
            Networks &amp; Studios
          </h2>
          {isKids && (
            <span className="px-2.5 py-0.5 rounded-lg bg-sky-100 border border-sky-200 text-sky-800 text-[11px] font-semibold">
              Kids PG Studios Only
            </span>
          )}
        </div>
        {activeStudio && (
          <button
            type="button"
            onClick={() => {
              playClickFx();
              setSelectedStudioId(null);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
              isKids ? 'bg-white border border-sky-200 text-slate-800' : 'liquid-glass text-white'
            }`}
          >
            <X className="w-3.5 h-3.5" />
            <span>Close {activeStudio.name}</span>
          </button>
        )}
      </div>

      <div className={`grid grid-cols-2 sm:grid-cols-3 ${isKids ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} gap-3`}>
        {visibleBrands.map((brand) => {
          const isSelected = brand.id === selectedStudioId;
          return (
            <TiltGlassCard key={brand.id} intensity={6} className="rounded-2xl">
              <button
                type="button"
                data-testid={`studio-btn-${brand.id}`}
                onClick={() => {
                  playClickFx();
                  if (selectedStudioId === brand.id) {
                    setSelectedStudioId(null);
                  } else {
                    setTypeFilter('all');
                    setSelectedStudioId(brand.id);
                  }
                }}
                className={`w-full text-left p-4 rounded-2xl bg-gradient-to-br ${brand.accentFrom} ${brand.accentTo} border transition-all cursor-pointer flex flex-col justify-between min-h-[96px] ${
                  isSelected
                    ? isKids
                      ? 'border-sky-600 ring-2 ring-sky-500/60 shadow-lg'
                      : 'border-white ring-2 ring-white/50 shadow-xl'
                    : 'border-white/15 hover:border-white/35'
                }`}
              >
                <div className="flex items-center justify-between gap-2">{brand.mark}</div>
                <div className="pt-2">
                  <div className="text-xs font-bold text-white">{brand.name}</div>
                  <div className="text-[11px] text-zinc-300/85">
                    {isKids && brand.kidsSubtitle ? brand.kidsSubtitle : brand.subtitle}
                  </div>
                </div>
              </button>
            </TiltGlassCard>
          );
        })}
      </div>

      {activeStudio && (
        <div className="pt-2 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold font-display" data-testid="studio-spotlight-heading">
              {activeStudio.name} Spotlight ({studioItems.length} titles)
            </h3>

            <div className="flex items-center gap-1.5">
              {(
                [
                  { id: 'all', label: 'All Movies & Series' },
                  { id: 'movie', label: 'Movies Only' },
                  { id: 'tv', label: 'Series Only' },
                ] as { id: StudioTypeFilter; label: string }[]
              ).map((tab) => {
                const active = typeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      playClickFx();
                      setTypeFilter(tab.id);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                      active
                        ? isKids
                          ? 'bg-sky-600 text-white'
                          : mode === 'adult'
                            ? 'bg-rose-600 text-white'
                            : mode === 'christmas'
                              ? 'bg-red-600 text-white'
                              : 'bg-white text-zinc-950'
                        : isKids
                          ? 'bg-white border border-sky-200 text-slate-700 hover:bg-sky-50'
                          : 'liquid-glass text-zinc-300 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {loadingStudio ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, idx) => (
                <div key={idx} className="aspect-[2/3] rounded-2xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : studioError ? (
            <div
              className={`rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 ${
                isKids ? 'bg-white border border-sky-200 text-slate-800' : 'liquid-glass'
              }`}
            >
              <p className="text-xs text-rose-400">
                Could not load {activeStudio.name} catalog: {studioError}
              </p>
              <button
                type="button"
                onClick={() => void fetchStudioCatalog(activeStudio.id, typeFilter)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                  isKids ? 'bg-sky-600 text-white' : 'bg-white text-zinc-950'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          ) : studioItems.length === 0 ? (
            <div
              className={`rounded-2xl p-6 text-center text-xs space-y-2 ${
                isKids ? 'bg-white border border-sky-200 text-slate-600' : 'liquid-glass text-zinc-400'
              }`}
            >
              <p>No titles matched {activeStudio.name} ({typeFilter}) under {mode} mode.</p>
              {typeFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setTypeFilter('all')}
                  className="underline font-semibold cursor-pointer"
                >
                  Show All Movies &amp; Series
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {studioItems.slice(0, 15).map((item) => (
                <MediaCard
                  key={`studio-${activeStudio.id}-${item.media_type || 'movie'}-${item.id}`}
                  item={item}
                  mode={mode}
                  onSelect={onSelectMedia}
                  isDownloaded={downloadedKeys.has(`${item.media_type || 'movie'}:${item.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
