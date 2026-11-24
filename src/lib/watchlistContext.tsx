import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { MediaItem } from '../utils/modes';

const WATCHLIST_STORAGE_KEY = 'xtv_mstream_library_v1';

interface WatchlistContextValue {
  items: MediaItem[];
  isInWatchlist: (id: number, mediaType?: 'movie' | 'tv') => boolean;
  toggleWatchlist: (item: MediaItem) => void;
  removeFromWatchlist: (id: number, mediaType?: 'movie' | 'tv') => void;
  clearWatchlist: () => void;
}

const WatchlistContext = createContext<WatchlistContextValue>({
  items: [],
  isInWatchlist: () => false,
  toggleWatchlist: () => {},
  removeFromWatchlist: () => {},
  clearWatchlist: () => {},
});

function readStoredLibrary(): MediaItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MediaItem[]) : [];
  } catch {
    return [];
  }
}

export const WatchlistProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<MediaItem[]>(() => readStoredLibrary());

  const persist = useCallback((next: MediaItem[]) => {
    try {
      window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === WATCHLIST_STORAGE_KEY) {
        setItems(readStoredLibrary());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const isInWatchlist = useCallback(
    (id: number, mediaType?: 'movie' | 'tv') =>
      items.some(
        (x) =>
          x.id === id &&
          (!mediaType || (x.media_type || (x.name && !x.title ? 'tv' : 'movie')) === mediaType),
      ),
    [items],
  );

  const toggleWatchlist = useCallback(
    (item: MediaItem) => {
      const mType: 'movie' | 'tv' =
        item.media_type === 'tv' || (!item.title && !!item.name) ? 'tv' : 'movie';
      setItems((prev) => {
        const exists = prev.some(
          (x) =>
            x.id === item.id &&
            (x.media_type || (x.name && !x.title ? 'tv' : 'movie')) === mType,
        );
        const next = exists
          ? prev.filter(
              (x) =>
                !(
                  x.id === item.id &&
                  (x.media_type || (x.name && !x.title ? 'tv' : 'movie')) === mType
                ),
            )
          : [{ ...item, media_type: mType }, ...prev].slice(0, 120);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeFromWatchlist = useCallback(
    (id: number, mediaType?: 'movie' | 'tv') => {
      setItems((prev) => {
        const next = prev.filter(
          (x) =>
            !(
              x.id === id &&
              (!mediaType || (x.media_type || (x.name && !x.title ? 'tv' : 'movie')) === mediaType)
            ),
        );
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const clearWatchlist = useCallback(() => {
    setItems([]);
    persist([]);
  }, [persist]);

  return (
    <WatchlistContext.Provider
      value={{ items, isInWatchlist, toggleWatchlist, removeFromWatchlist, clearWatchlist }}
    >
      {children}
    </WatchlistContext.Provider>
  );
};

export function useWatchlist() {
  return useContext(WatchlistContext);
}
