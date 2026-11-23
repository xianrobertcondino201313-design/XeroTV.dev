export interface XeroAppSettings {
  soundEnabled: boolean;
  motion3dEnabled: boolean;
  defaultServerId: string;
  defaultDownloadQuality: 'standard' | 'hd';
}

const SETTINGS_STORAGE_KEY = 'xtv_app_settings_v1';

export const DEFAULT_APP_SETTINGS: XeroAppSettings = {
  soundEnabled: true,
  motion3dEnabled: true,
  defaultServerId: 'vidzen',
  defaultDownloadQuality: 'standard',
};

type Listener = (settings: XeroAppSettings) => void;
const listeners = new Set<Listener>();

export function loadAppSettings(): XeroAppSettings {
  if (typeof window === 'undefined') return DEFAULT_APP_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<XeroAppSettings>;
    return {
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : DEFAULT_APP_SETTINGS.soundEnabled,
      motion3dEnabled:
        typeof parsed.motion3dEnabled === 'boolean' ? parsed.motion3dEnabled : DEFAULT_APP_SETTINGS.motion3dEnabled,
      defaultServerId:
        typeof parsed.defaultServerId === 'string' && parsed.defaultServerId.trim()
          ? parsed.defaultServerId
          : DEFAULT_APP_SETTINGS.defaultServerId,
      defaultDownloadQuality: parsed.defaultDownloadQuality === 'hd' ? 'hd' : 'standard',
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
