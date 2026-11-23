import React, { useState } from 'react';
import { Film } from 'lucide-react';
import type { MediaItem, ProfileMode } from '../utils/modes';
import { playClickFx } from '../utils/soundFx';
import { TiltGlassCard } from './TiltGlassCard';

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
  const title = item.title || item.name || 'Untitled';
  const dateStr = item.release_date || item.first_air_date || '';
  const year = dateStr ? dateStr.slice(0, 4) : '—';
  const rating =
    typeof item.vote_average === 'number' && item.vote_average > 0
      ? item.vote_average.toFixed(1)
      : 'NR';
  const mediaLabel = item.media_type === 'tv' ? 'Series' : 'Movie';
  const isKids = mode === 'kids';

  return (
    <TiltGlassCard intensity={6} className="rounded-2xl">
      <button
        type="button"
        onClick={() => {
          playClickFx();
          onSelect(item);
        }}
        className={`w-full group text-left flex flex-col rounded-2xl overflow-hidden focus-visible:outline-none focus-visible:ring-2 cursor-pointer ${
          isKids
            ? 'bg-white border border-sky-200 shadow-sm focus-visible:ring-sky-500'
            : 'liquid-glass focus-visible:ring-white/60'
        }`}
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-zinc-900">
          {item.poster_path && !imgError ? (
            <img
              src={`https://image.tmdb.org/t/p/w500${item.poster_path}`}
              alt={title}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-zinc-800 to-zinc-950 text-zinc-400">
              <Film className="w-8 h-8 mb-2 opacity-60" />
              <span className="text-xs font-medium line-clamp-2">{title}</span>
            </div>
          )}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
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
            <span>{isDownloaded ? 'Offline Ready' : mediaLabel}</span>
          </div>
        </div>
      </button>
    </TiltGlassCard>
  );
};
