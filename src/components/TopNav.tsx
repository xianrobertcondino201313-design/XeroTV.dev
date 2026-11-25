import React from 'react';
import { Bell, Settings } from 'lucide-react';
import { MODE_CONFIGS, type ProfileMode } from '../utils/modes';
import { playClickFx } from '../utils/soundFx';

export type AppSection =
  | 'home'
  | 'movies'
  | 'series'
  | 'drama'
  | 'hots'
  | 'vault'
  | 'docs'
  | 'apps';

interface TopNavProps {
  activeSection: AppSection;
  onSelectSection: (section: AppSection) => void;
  mode: ProfileMode;
  isSignedIn: boolean;
  displayName?: string | null;
  unreadNotifications: number;
  onOpenAccount: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeSection,
  onSelectSection,
  mode,
  isSignedIn,
  displayName,
  unreadNotifications,
  onOpenAccount,
  onOpenNotifications,
  onOpenSettings,
}) => {
  const modeConfig = MODE_CONFIGS[mode];
  const isKids = mode === 'kids';

  const baseNavItems: { id: AppSection; label: string }[] = isKids
    ? [
        { id: 'home', label: 'Home' },
        { id: 'movies', label: 'Movies' },
        { id: 'series', label: 'Series' },
        { id: 'drama', label: 'Short Drama' },
        { id: 'vault', label: 'Vault' },
      ]
    : [
        { id: 'home', label: 'Home' },
        { id: 'movies', label: 'Movies' },
        { id: 'series', label: 'Series' },
        { id: 'drama', label: 'Short Drama' },
        { id: 'hots', label: 'XeroHots' },
        { id: 'vault', label: 'Vault' },
      ];

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors ${
        isKids
          ? 'bg-white/95 border-sky-200 text-slate-900 backdrop-blur-xl'
          : 'liquid-glass-strong border-[var(--surface-border)]'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Brand Title */}
        <button
          type="button"
          onClick={() => {
            playClickFx();
            onSelectSection('home');
          }}
          className="flex items-center gap-2.5 text-lg font-bold tracking-tight font-display whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 rounded-lg cursor-pointer"
        >
          <img
            src={modeConfig.badgeIconPath}
            alt="XEROTV emblem"
            className="w-7 h-7 rounded-lg object-cover shrink-0"
          />
          <span>XEROTV</span>
        </button>

        {/* Zone 2: Concise Single-Line Nav Links */}
        <nav
          className="hidden md:flex items-center gap-5 lg:gap-7 text-sm font-medium"
          aria-label="Primary"
        >
          {baseNavItems.map((item) => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`nav-${item.id}`}
                onClick={() => {
                  playClickFx();
                  onSelectSection(item.id);
                }}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                  active
                    ? isKids
                      ? 'border-sky-600 text-sky-900 font-semibold'
                      : mode === 'adult'
                        ? 'border-rose-400 text-white font-semibold'
                        : mode === 'christmas'
                          ? 'border-amber-300 text-white font-semibold'
                          : 'border-white text-white font-semibold'
                    : isKids
                      ? 'border-transparent text-slate-600 hover:text-slate-900'
                      : 'border-transparent text-zinc-400 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Alerts, Settings & Single Primary Account CTA */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              playClickFx();
              onOpenNotifications();
            }}
            aria-label="Open notifications"
            className={`relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl transition-colors cursor-pointer ${
              isKids ? 'text-slate-700 hover:bg-sky-100' : 'text-zinc-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Bell className="w-4 h-4" />
            {unreadNotifications > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              playClickFx();
              onOpenSettings();
            }}
            aria-label="Open settings"
            className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl transition-colors cursor-pointer ${
              isKids ? 'text-slate-700 hover:bg-sky-100' : 'text-zinc-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              playClickFx();
              onOpenAccount();
            }}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer min-h-[40px] ${
              isKids
                ? 'bg-sky-600 text-white hover:bg-sky-700'
                : 'bg-white text-zinc-950 hover:bg-zinc-200'
            }`}
          >
            {isSignedIn ? (displayName ? displayName.split(' ')[0] : 'Account') : 'Sign In'}
          </button>
        </div>
      </div>
    </header>
  );
};
