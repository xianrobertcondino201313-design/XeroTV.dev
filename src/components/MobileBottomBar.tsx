import React from 'react';
import { Clapperboard, Film, Flame, HardDriveDownload, Home, Tv } from 'lucide-react';
import type { AppSection } from './TopNav';
import type { ProfileMode } from '../utils/modes';
import { playClickFx } from '../utils/soundFx';

interface MobileBottomBarProps {
  activeSection: AppSection;
  onSelectSection: (section: AppSection) => void;
  mode: ProfileMode;
}

export const MobileBottomBar: React.FC<MobileBottomBarProps> = ({
  activeSection,
  onSelectSection,
  mode,
}) => {
  const isKids = mode === 'kids';
  const tabs: { id: AppSection; label: string; Icon: React.ComponentType<{ className?: string }> }[] = isKids
    ? [
        { id: 'home', label: 'Home', Icon: Home },
        { id: 'movies', label: 'Movies', Icon: Film },
        { id: 'series', label: 'Series', Icon: Tv },
        { id: 'drama', label: 'Drama', Icon: Clapperboard },
        { id: 'vault', label: 'Vault', Icon: HardDriveDownload },
      ]
    : [
        { id: 'home', label: 'Home', Icon: Home },
        { id: 'movies', label: 'Movies', Icon: Film },
        { id: 'drama', label: 'Drama', Icon: Clapperboard },
        { id: 'hots', label: 'Hots', Icon: Flame },
        { id: 'vault', label: 'Vault', Icon: HardDriveDownload },
      ];

  return (
    <nav
      aria-label="Mobile Navigation"
      className={`md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 border-t grid grid-cols-5 items-center ${
        isKids
          ? 'bg-white/95 border-sky-200 text-slate-700 backdrop-blur-xl'
          : 'liquid-glass-strong border-[var(--surface-border)] text-zinc-300'
      }`}
    >
      {tabs.map(({ id, label, Icon }) => {
        const active = activeSection === id;
        return (
          <button
            key={id}
            type="button"
            data-testid={`mobile-nav-${id}`}
            onClick={() => {
              playClickFx();
              onSelectSection(id);
            }}
            className={`flex flex-col items-center justify-center min-h-[44px] text-[10px] font-medium transition-colors cursor-pointer ${
              active
                ? isKids
                  ? 'text-sky-600 font-semibold'
                  : mode === 'adult'
                    ? 'text-rose-300 font-semibold'
                    : mode === 'christmas'
                      ? 'text-amber-300 font-semibold'
                      : 'text-white font-semibold'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            <Icon className="w-[18px] h-[18px]" />
            <span className="mt-0.5 leading-none">{label}</span>
          </button>
        );
      })}
    </nav>
  );
};
