export interface XeroAppSettings {
  soundEnabled: boolean;
  motion3dEnabled: boolean;
  defaultServerId: string;
  defaultDownloadQuality: 'standard' | 'hd';
  timeFormat: '12h' | '24h';
  timeZone: string; // 'auto' or IANA zone like 'Asia/Manila'
}

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Device Local (Automatic)' },
  { value: 'Asia/Manila', label: 'Manila / Philippines (PHT, UTC+8)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT, UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST, UTC+9)' },
  { value: 'America/Los_Angeles', label: 'US Pacific (PST/PDT)' },
  { value: 'America/New_York', label: 'US Eastern (EST/EDT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'UTC', label: 'Coordinated Universal Time (UTC)' },
];

const SETTINGS_STORAGE_KEY = 'xtv_app_settings_v1';

export const DEFAULT_APP_SETTINGS: XeroAppSettings = {
  soundEnabled: true,
  motion3dEnabled: true,
  defaultServerId: 'vidzen',
  defaultDownloadQuality: 'standard',
  timeFormat: '12h',
  timeZone: 'auto',
};

type Listener = (settings: XeroAppSettings) => void;
const listeners = new Set<Listener>();

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz === 'auto') return true;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function loadAppSettings(): XeroAppSettings {
  if (typeof window === 'undefined') return DEFAULT_APP_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<XeroAppSettings>;
    const tz =
      typeof parsed.timeZone === 'string' && isValidTimeZone(parsed.timeZone)
        ? parsed.timeZone
        : DEFAULT_APP_SETTINGS.timeZone;
    return {
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : DEFAULT_APP_SETTINGS.soundEnabled,
      motion3dEnabled:
        typeof parsed.motion3dEnabled === 'boolean' ? parsed.motion3dEnabled : DEFAULT_APP_SETTINGS.motion3dEnabled,
      defaultServerId:
        typeof parsed.defaultServerId === 'string' && parsed.defaultServerId.trim()
          ? parsed.defaultServerId
          : DEFAULT_APP_SETTINGS.defaultServerId,
      defaultDownloadQuality: parsed.defaultDownloadQuality === 'hd' ? 'hd' : 'standard',
      timeFormat: parsed.timeFormat === '24h' ? '24h' : '12h',
      timeZone: tz,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(patch: Partial<XeroAppSettings>): XeroAppSettings {
  const next = { ...loadAppSettings(), ...patch };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      if (patch.defaultServerId) {
        window.localStorage.setItem('xerotv_selected_server', patch.defaultServerId);
      }
    } catch {
      // ignore storage quota failures
    }
  }
  for (const fn of listeners) {
    fn(next);
  }
  return next;
}

export function subscribeAppSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function formatClockDisplay(
  date: Date,
  timeFormat: '12h' | '24h' = '12h',
  timeZone: string = 'auto',
): { timeText: string; dateText: string; shortDateText: string; zoneLabel: string } {
  const effectiveZone =
    timeZone && timeZone !== 'auto' && isValidTimeZone(timeZone) ? timeZone : undefined;

  try {
    const timeText = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: timeFormat === '12h',
      ...(effectiveZone ? { timeZone: effectiveZone } : {}),
    }).format(date);

    const dateText = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...(effectiveZone ? { timeZone: effectiveZone } : {}),
    }).format(date);

    const shortDateText = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      ...(effectiveZone ? { timeZone: effectiveZone } : {}),
    }).format(date);

    const tzParts = new Intl.DateTimeFormat('en-US', {
      timeZoneName: 'short',
      ...(effectiveZone ? { timeZone: effectiveZone } : {}),
    }).formatToParts(date);
    const zoneLabel = tzParts.find((p) => p.type === 'timeZoneName')?.value || 'Local';

    return { timeText, dateText, shortDateText, zoneLabel };
  } catch {
    return {
      timeText: date.toLocaleTimeString([], { hour12: timeFormat === '12h' }),
      dateText: date.toLocaleDateString(),
      shortDateText: date.toLocaleDateString(),
      zoneLabel: 'Local',
    };
  }
}
