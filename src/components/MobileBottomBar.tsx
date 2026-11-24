import React from 'react';
import { BookOpen, Film, Flame, HardDriveDownload, Home, Smartphone, Tv } from 'lucide-react';
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
  const allTabs: { id: AppSection; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'home', label: 'Home', Icon: Home },
    { id: 'movies', label: 'Movies', Icon: Film },
    { id: 'series', label: 'Series', Icon: Tv },
    { id: 'hots', label: 'Hots', Icon: Flame },
    { id: 'vault', label: 'Vault', Icon: HardDriveDownload },
    { id: 'docs', label: 'Docs', Icon: BookOpen },
    { id: 'apps', label: 'Apps', Icon: Smartphone },
  ];
  const tabs = isKids ? allTabs.filter((t) => t.id !== 'hots') : allTabs;

  return (
    <nav
      aria-label="Mobile Navigation"
      className={`md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 border-t grid ${
        isKids ? 'grid-cols-6' : 'grid-cols-7'
      } items-center ${
        isKids
          ? 'bg-white/95 border-sky-200 text-slate-700 backdrop-blur-xl'
          : 'liquid-glass-strong border-white/10 text-zinc-300'
      }`}
    >
      {tabs.map(({ id, label, Icon }) => {
        const active = activeSection === id;
        return (
          <button
            key={id}
            type="button"
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
            <Icon className="w-4 h-4" />
            <span className="mt-1 leading-none">{label}</span>
          </button>
        );
      })}
    </nav>
  );
};
