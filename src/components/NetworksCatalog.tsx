import React, { useEffect, useState } from 'react';
import { Tv, X } from 'lucide-react';
import { filterMediaForMode, type MediaItem, type ProfileMode } from '../utils/modes';
import { cachedTmdbFetch, TMDB_CACHE_TTL } from '../utils/tmdbCache';
import { playClickFx } from '../utils/soundFx';
import { MediaCard } from './MediaCard';
import { TiltGlassCard } from './TiltGlassCard';

export interface StudioBrand {
  id: string;
  name: string;
  subtitle: string;
  accentFrom: string;
  accentTo: string;
  mark: React.ReactNode;
}

export const STUDIO_BRANDS: StudioBrand[] = [
  {
    id: 'netflix',
    name: 'Netflix',
    subtitle: 'Original Series & Hits',
    accentFrom: 'from-red-600/30',
    accentTo: 'to-zinc-950/90',
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
    subtitle: 'Family & Animation',
    accentFrom: 'from-blue-600/30',
    accentTo: 'to-slate-950/90',
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
    subtitle: 'Prestige Drama',
    accentFrom: 'from-indigo-600/30',
    accentTo: 'to-zinc-950/90',
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
    subtitle: 'Cinema & Sci-Fi',
    accentFrom: 'from-zinc-400/25',
    accentTo: 'to-zinc-950/90',
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
    subtitle: 'Blockbuster Vault',
    accentFrom: 'from-cyan-500/25',
    accentTo: 'to-zinc-950/90',
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
    subtitle: 'Multiverse Saga',
    accentFrom: 'from-rose-600/35',
    accentTo: 'to-zinc-950/90',
    mark: (
      <div className="px-2 py-0.5 bg-red-600 text-white font-display font-black text-sm tracking-widest rounded">
        MARVEL
      </div>
    ),
  },
  {
    id: 'pixar',
    name: 'Pixar',
    subtitle: 'Animation Studios',
    accentFrom: 'from-amber-400/20',
    accentTo: 'to-slate-900/90',
    mark: (
      <span className="font-display font-extrabold tracking-[0.28em] text-sm text-white">
        PIXAR
      </span>
    ),
  },
  {
    id: 'warner',
    name: 'Warner Bros.',
    subtitle: 'WB Pictures',
    accentFrom: 'from-yellow-500/25',
    accentTo: 'to-zinc-950/90',
    mark: (
      <span className="px-2 py-0.5 rounded-full border border-amber-300/60 font-display font-extrabold text-xs tracking-wider text-amber-200">
        WB
      </span>
    ),
  },
  {
    id: 'a24',
    name: 'A24',
    subtitle: 'Independent Cinema',
    accentFrom: 'from-white/20',
    accentTo: 'to-black/95',
    mark: (
      <span className="font-display font-black tracking-tighter text-xl text-white">
        A24
      </span>
    ),
  },
];

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
  const [studioItems, setStudioItems] = useState<MediaItem[]>([]);
  const [loadingStudio, setLoadingStudio] = useState(false);

  useEffect(() => {
    if (!selectedStudioId) {
      setStudioItems([]);
      return;
    }
    let active = true;
    setLoadingStudio(true);
    cachedTmdbFetch<{ results?: MediaItem[] }>(
      `/api/tmdb/studios?studio=${encodeURIComponent(selectedStudioId)}&mode=${encodeURIComponent(mode)}`,
      TMDB_CACHE_TTL.MEDIUM,
    )
      .then((data) => {
        if (!active) return;
        setStudioItems(filterMediaForMode(data.results || [], mode));
      })
      .catch(() => {
        if (active) setStudioItems([]);
      })
      .finally(() => {
        if (active) setLoadingStudio(false);
      });
    return () => {
      active = false;
    };
  }, [selectedStudioId, mode]);

  const activeStudio = STUDIO_BRANDS.find((s) => s.id === selectedStudioId) || null;

  return (
    <section className="space-y-4" aria-label="Networks and Studios Catalog">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Tv className="w-5 h-5 opacity-80" />
          <h2 className="text-xl sm:text-2xl font-bold font-display">
            Networks &amp; Studios
          </h2>
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {STUDIO_BRANDS.map((brand) => {
          const isSelected = brand.id === selectedStudioId;
          return (
            <TiltGlassCard key={brand.id} intensity={8} className="rounded-2xl">
              <button
                type="button"
                onClick={() => {
                  playClickFx();
                  setSelectedStudioId((prev) => (prev === brand.id ? null : brand.id));
                }}
                className={`w-full text-left p-4 rounded-2xl bg-gradient-to-br ${brand.accentFrom} ${brand.accentTo} border transition-all cursor-pointer flex flex-col justify-between min-h-[96px] ${
                  isSelected
                    ? 'border-white ring-2 ring-white/50 shadow-xl'
                    : 'border-white/15 hover:border-white/35'
                }`}
              >
                <div className="flex items-center justify-between gap-2">{brand.mark}</div>
                <div className="pt-2">
                  <div className="text-xs font-bold text-white">{brand.name}</div>
                  <div className="text-[11px] text-zinc-300/80">{brand.subtitle}</div>
                </div>
              </button>
            </TiltGlassCard>
          );
        })}
      </div>

      {activeStudio && (
        <div className="pt-2 space-y-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-lg font-bold font-display">
              {activeStudio.name} Spotlight ({studioItems.length} titles)
            </h3>
          </div>
          {loadingStudio ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, idx) => (
                <div key={idx} className="aspect-[2/3] rounded-2xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : studioItems.length === 0 ? (
            <div className="rounded-2xl liquid-glass p-6 text-center text-xs text-zinc-400">
              No titles available for {activeStudio.name} under the active mode filter.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {studioItems.slice(0, 10).map((item) => (
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
