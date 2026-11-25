import React, { useState } from 'react';
import { Bookmark, BookmarkCheck, Film } from 'lucide-react';
import type { MediaItem, ProfileMode } from '../utils/modes';
import { useWatchlist } from '../lib/watchlistContext';
import { playClickFx } from '../utils/soundFx';

interface MediaCardProps {
  item: MediaItem;
  mode: ProfileMode;
  onSelect: (item: MediaItem) => void;
  isDownloaded?: boolean;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  item,
  mode,
  onSelect,
  isDownloaded,
}) => {
  const [imgError, setImgError] = useState(false);
  const { isInWatchlist, toggleWatchlist } = useWatchlist();
  const title = item.title || item.name || 'Untitled';
  const dateStr = item.release_date || item.first_air_date || '';
  const year = dateStr ? dateStr.slice(0, 4) : '—';
  const rating =
    typeof item.vote_average === 'number' && item.vote_average > 0
      ? item.vote_average.toFixed(1)
      : 'NR';
  const mediaType: 'movie' | 'tv' =
    item.media_type === 'tv' || (!item.title && !!item.name) ? 'tv' : 'movie';
  const mediaLabel = mediaType === 'tv' ? 'Series' : 'Movie';
  const isKids = mode === 'kids';
  const saved = isInWatchlist(item.id, mediaType);

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => {
          playClickFx();
          onSelect(item);
        }}
        className={`w-full text-left flex flex-col rounded-2xl overflow-hidden border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 cursor-pointer ${
          isKids
            ? 'bg-white border-sky-200 hover:border-sky-400 shadow-sm focus-visible:ring-sky-500'
            : 'bg-[var(--surface-card)] border-[var(--surface-border)] hover:border-white/30 focus-visible:ring-white/60'
        }`}
      >
        <div
          className={`relative aspect-[2/3] w-full overflow-hidden ${
            isKids ? 'bg-sky-100' : 'bg-zinc-900'
          }`}
        >
          {item.poster_path && !imgError ? (
            <img
              src={`https://image.tmdb.org/t/p/w500${item.poster_path}`}
              alt={title}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
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
              <span className="text-xs font-medium line-clamp-2">{title}</span>
            </div>
          )}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/65 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          />
        </div>

        <div className="p-3.5 space-y-1">
          <h3
            className={`text-sm font-semibold leading-snug line-clamp-1 ${
              isKids ? 'text-slate-900' : 'text-white'
            }`}
          >
            {title}
          </h3>
          <div
            className={`flex items-center gap-1.5 text-xs tabular-nums ${
              isKids ? 'text-slate-500' : 'text-zinc-400'
            }`}
          >
            <span>{year}</span>
            <span aria-hidden="true">·</span>
            <span>{rating}</span>
            <span aria-hidden="true">·</span>
            <span
              className={
                isDownloaded
                  ? isKids
                    ? 'text-emerald-600 font-semibold'
                    : 'text-emerald-400 font-semibold'
                  : undefined
              }
            >
              {isDownloaded ? 'Offline' : mediaLabel}
            </span>
          </div>
        </div>
      </button>

      <button
        type="button"
        data-testid={`watchlist-toggle-${mediaType}-${item.id}`}
        aria-label={saved ? `Remove ${title} from Watchlist` : `Add ${title} to Watchlist`}
        title={saved ? 'Remove from mstream Watchlist' : 'Add to mstream Watchlist'}
        onClick={(e) => {
          e.stopPropagation();
          playClickFx();
          toggleWatchlist(item);
        }}
        className={`absolute top-2.5 right-2.5 z-10 w-9 h-9 rounded-xl flex items-center justify-center border transition-all cursor-pointer backdrop-blur-md ${
          saved
            ? isKids
              ? 'bg-sky-600 border-sky-500 text-white shadow-md'
              : 'bg-white border-white text-zinc-950 shadow-md'
            : 'bg-black/60 border-white/20 text-white/90 opacity-85 hover:opacity-100 hover:bg-black/80'
        }`}
      >
        {saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
      </button>
    </div>
  );
};
