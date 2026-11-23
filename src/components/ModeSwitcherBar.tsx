import React from 'react';
import { Baby, Flame, Lock, Search, Snowflake, Sparkles, X } from 'lucide-react';
import {
  isChristmasModeUnlocked,
  MODE_CONFIGS,
  type ProfileMode,
} from '../utils/modes';
import { playClickFx } from '../utils/soundFx';

interface ModeSwitcherBarProps {
  mode: ProfileMode;
  onRequestModeChange: (target: ProfileMode) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onClearSearch: () => void;
}

const MODE_ORDER: ProfileMode[] = ['main', 'kids', 'adult', 'christmas'];

export const ModeSwitcherBar: React.FC<ModeSwitcherBarProps> = ({
  mode,
  onRequestModeChange,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onClearSearch,
}) => {
  const isKids = mode === 'kids';
  const christmasUnlocked = isChristmasModeUnlocked(Date.now());

  const renderIcon = (m: ProfileMode) => {
    switch (m) {
      case 'kids':
        return <Baby className="w-4 h-4 shrink-0" />;
      case 'adult':
        return <Flame className="w-4 h-4 shrink-0" />;
      case 'christmas':
        return <Snowflake className="w-4 h-4 shrink-0" />;
      default:
        return <Sparkles className="w-4 h-4 shrink-0" />;
    }
  };

  return (
    <section
      aria-label="Workspace Toolbar"
      className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
    >
      {/* Profile Modes */}
      <div
        className={`flex items-center gap-1.5 p-1.5 rounded-xl overflow-x-auto no-scrollbar ${
          isKids ? 'bg-sky-100/90 border border-sky-200' : 'liquid-glass'
        }`}
        role="tablist"
        aria-label="Profile Modes"
      >
        {MODE_ORDER.map((m) => {
          const cfg = MODE_CONFIGS[m];
          const active = mode === m;
          const isChristmasLocked = m === 'christmas' && !christmasUnlocked;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={active}
              title={
                isChristmasLocked
                  ? 'Locked until December 25 12:00 AM'
                  : cfg.tagline
              }
              onClick={() => {
                playClickFx();
                onRequestModeChange(m);
              }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[40px] ${
                active
                  ? m === 'kids'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : m === 'adult'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : m === 'christmas'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'bg-white text-zinc-950 shadow-sm'
                  : isChristmasLocked
                    ? isKids
                      ? 'text-slate-500 bg-white/40 hover:bg-white/70'
                      : 'text-zinc-400 hover:text-white hover:bg-white/10'
                    : isKids
                      ? 'text-slate-700 hover:bg-white/70'
                      : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
            >
              {renderIcon(m)}
              <span>{cfg.label}</span>
              {(m === 'kids' || m === 'adult' || isChristmasLocked) && (
                <Lock className="w-3 h-3 opacity-75 shrink-0" aria-hidden="true" />
              )}
              {isChristmasLocked && (
                <span className="text-[10px] opacity-65 font-normal">Dec 25</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Real TMDB Search */}
      <form onSubmit={onSearchSubmit} className="relative w-full lg:w-80 shrink-0">
        <label htmlFor="xerotv-search" className="sr-only">
          Search movies and series
        </label>
        <Search
          className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${
            isKids ? 'text-slate-500' : 'text-zinc-400'
          }`}
        />
        <input
          id="xerotv-search"
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={`Search ${MODE_CONFIGS[mode].shortLabel} catalog...`}
          className={`w-full pl-10 pr-9 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 transition-colors ${
            isKids
              ? 'bg-white border border-sky-200 text-slate-900 placeholder:text-slate-400 focus:ring-sky-500'
              : 'liquid-glass text-white placeholder:text-zinc-400 focus:ring-white/40'
          }`}
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              playClickFx();
              onClearSearch();
            }}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </form>
    </section>
  );
};
