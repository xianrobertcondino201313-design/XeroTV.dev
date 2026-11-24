export type ProfileMode = 'main' | 'kids' | 'adult' | 'christmas';

export interface MediaItem {
  id: number;
  media_type?: 'movie' | 'tv';
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  adult?: boolean;
  genre_ids?: number[];
  original_language?: string;
}

export interface ModeThemeConfig {
  id: ProfileMode;
  label: string;
  shortLabel: string;
  tagline: string;
  themeName: string;
  faviconPath: string;
  badgeIconPath: string;
  requiresPinOnEnter: boolean;
  requiresPinOnExit: boolean;
}

export const MODE_CONFIGS: Record<ProfileMode, ModeThemeConfig> = {
  main: {
    id: 'main',
    label: 'Main Profile',
    shortLabel: 'Original',
    tagline: 'Monochrome Liquid Glass Cinema',
    themeName: 'Default Original',
    faviconPath: '/icon.svg',
    badgeIconPath: '/icon.svg',
    requiresPinOnEnter: false,
    requiresPinOnExit: false,
  },
  kids: {
    id: 'kids',
    label: 'Kids Mode (PG)',
    shortLabel: 'Kids PG',
    tagline: 'Family & Cartoonist Safe Theater',
    themeName: 'Cartoonist',
    faviconPath: '/icon-kids.svg',
    badgeIconPath: '/icon-kids.svg',
    requiresPinOnEnter: false,
    requiresPinOnExit: true,
  },
  adult: {
    id: 'adult',
    label: '18+ Movies',
    shortLabel: '18+ Vault',
    tagline: 'Mature & Uncut Cinema Selection',
    themeName: 'Velvet Crimson',
    faviconPath: '/icon-adult.svg',
    badgeIconPath: '/icon-adult.svg',
    requiresPinOnEnter: true,
    requiresPinOnExit: false,
  },
  christmas: {
    id: 'christmas',
    label: 'Christmas Mode',
    shortLabel: 'Christmas',
    tagline: 'Winter Snowfall & Holiday Classics',
    themeName: 'Snow & Santa',
    faviconPath: '/icon-christmas.svg',
    badgeIconPath: '/icon-christmas.svg',
    requiresPinOnEnter: false,
    requiresPinOnExit: false,
  },
};

export function verifyPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin.trim());
}

export async function hashPin(pin: string): Promise<string> {
  const normalized = pin.trim();
  const data = new TextEncoder().encode(`xerotv-pin:${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const KIDS_ALLOWED_GENRES = new Set([16, 10751, 12, 35, 14, 10402, 10762]);
const KIDS_BLOCKED_GENRES = new Set([27, 53, 80, 10752, 10768, 9648]);

export function filterMediaForMode<T extends MediaItem>(items: T[], mode: ProfileMode): T[] {
  if (mode === 'kids') {
    return items.filter((item) => {
      if (item.adult) return false;
      const genres = item.genre_ids || [];
      if (genres.some((g) => KIDS_BLOCKED_GENRES.has(g))) return false;
      if (genres.length === 0) return true;
      return genres.some((g) => KIDS_ALLOWED_GENRES.has(g));
    });
  }
  if (mode === 'main' || mode === 'christmas') {
    return items.filter((item) => !item.adult);
  }
  return items;
}

export interface ChristmasUnlockInfo {
  unlocked: boolean;
  unlockAtMs: number;
  unlockLabel: string;
  daysRemaining: number;
  hoursRemaining: number;
  minutesRemaining: number;
  secondsRemaining: number;
}

export function isChristmasModeUnlocked(nowMs: number = Date.now()): boolean {
  const now = new Date(nowMs);
  // Open starting December 25 at 12:00 AM local time through December 31
  return now.getMonth() === 11 && now.getDate() >= 25;
}

export function getChristmasUnlockInfo(nowMs: number = Date.now()): ChristmasUnlockInfo {
  const now = new Date(nowMs);
  const year = now.getFullYear();
  const target = new Date(year, 11, 25, 0, 0, 0, 0);
  const unlockAtMs = target.getTime();
  const unlocked = now.getMonth() === 11 && now.getDate() >= 25;
  const diffMs = unlocked ? 0 : Math.max(0, unlockAtMs - nowMs);
  const totalSeconds = Math.floor(diffMs / 1000);
  const daysRemaining = Math.floor(totalSeconds / 86400);
  const hoursRemaining = Math.floor((totalSeconds % 86400) / 3600);
  const minutesRemaining = Math.floor((totalSeconds % 3600) / 60);
  const secondsRemaining = totalSeconds % 60;

  return {
    unlocked,
    unlockAtMs,
    unlockLabel: `December 25, ${year} · 12:00 AM`,
    daysRemaining,
    hoursRemaining,
    minutesRemaining,
    secondsRemaining,
  };
}

