import React, { useEffect, useState } from 'react';
import { Clock, Globe, Monitor, Server, Settings, Volume2, VolumeX, X } from 'lucide-react';
import { STREAMING_SERVERS } from '../utils/servers';
import {
  formatClockDisplay,
  loadAppSettings,
  saveAppSettings,
  TIMEZONE_OPTIONS,
  type XeroAppSettings,
} from '../utils/settings';
import { playClickFx, playUnlockFx } from '../utils/soundFx';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onOpenIntroduce: () => void;
  onOpenAccount: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  onOpenIntroduce,
  onOpenAccount,
}) => {
  const [settings, setSettings] = useState<XeroAppSettings>(() => loadAppSettings());

  useEffect(() => {
    if (open) {
      setSettings(loadAppSettings());
    }
  }, [open]);

  if (!open) return null;

  const updatePatch = (patch: Partial<XeroAppSettings>) => {
    const next = saveAppSettings(patch);
    setSettings(next);
    if (next.soundEnabled) {
      playClickFx();
    }
  };

  const previewClock = formatClockDisplay(new Date(), settings.timeFormat, settings.timeZone);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto"
    >
      <div className="w-full max-w-lg liquid-glass-strong rounded-2xl p-6 sm:p-7 text-white space-y-5 my-auto max-h-[90vh] overflow-y-auto border border-white/15">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Settings className="w-5 h-5" />
            <div>
              <h2 id="settings-modal-title" className="text-xl font-bold font-display">
                XEROTV Settings
              </h2>
              <p className="text-xs text-zinc-400">
                Preferences saved locally on this device.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="divide-y divide-white/10 rounded-2xl bg-white/[0.03] border border-white/10">
          {/* Audio SFX Toggle */}
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {settings.soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-zinc-400" />}
              <div>
                <div className="text-sm font-semibold">Interactive Sound Effects</div>
                <div className="text-xs text-zinc-400">Tactile click, typing, and download chimes</div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.soundEnabled}
              onClick={() => updatePatch({ soundEnabled: !settings.soundEnabled })}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                settings.soundEnabled ? 'bg-white text-zinc-950' : 'bg-white/10 text-zinc-400'
              }`}
            >
              {settings.soundEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Date, Time & Timezone Configuration */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>Clock &amp; Date Time Zone</span>
              </div>
              <span className="text-[11px] font-mono text-zinc-300 tabular-nums">
                {previewClock.timeText} · {previewClock.zoneLabel}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => updatePatch({ timeFormat: '12h' })}
                className={`py-2 px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                  settings.timeFormat === '12h' ? 'bg-white text-zinc-950' : 'bg-white/10 text-zinc-300'
                }`}
              >
                12-Hour (AM/PM)
              </button>
              <button
                type="button"
                onClick={() => updatePatch({ timeFormat: '24h' })}
                className={`py-2 px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                  settings.timeFormat === '24h' ? 'bg-white text-zinc-950' : 'bg-white/10 text-zinc-300'
                }`}
              >
                24-Hour Clock
              </button>
            </div>

            <div className="space-y-1">
              <label htmlFor="settings-timezone" className="text-xs text-zinc-400 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                <span>Select Time Zone</span>
              </label>
              <select
                id="settings-timezone"
                value={settings.timeZone}
                onChange={(e) => updatePatch({ timeZone: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-white/15 text-sm text-white"
              >
                {TIMEZONE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Default Streaming Server */}
          <div className="p-4 space-y-2">
            <label htmlFor="settings-default-server" className="text-sm font-semibold flex items-center gap-2">
              <Server className="w-4 h-4" />
              <span>Default Streaming Server</span>
            </label>
            <select
              id="settings-default-server"
              value={settings.defaultServerId}
              onChange={(e) => updatePatch({ defaultServerId: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-white/15 text-sm text-white"
            >
              {STREAMING_SERVERS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.recommendedByXero ? '(Recommended by Xero)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Default Offline Quality */}
          <div className="p-4 space-y-2">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Monitor className="w-4 h-4" />
              <span>Default Offline Download Quality</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => updatePatch({ defaultDownloadQuality: 'standard' })}
                className={`py-2 px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                  settings.defaultDownloadQuality === 'standard'
                    ? 'bg-white text-zinc-950'
                    : 'bg-white/10 text-zinc-300'
                }`}
              >
                Standard (Fast MP4)
              </button>
              <button
                type="button"
                onClick={() => updatePatch({ defaultDownloadQuality: 'hd' })}
                className={`py-2 px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                  settings.defaultDownloadQuality === 'hd'
                    ? 'bg-white text-zinc-950'
                    : 'bg-white/10 text-zinc-300'
                }`}
              >
                Full HD (High Bitrate)
              </button>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              playUnlockFx();
              onClose();
              onOpenIntroduce();
            }}
            className="py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
          >
            Replay Introduce Tour
          </button>
          <button
            type="button"
            onClick={() => {
              playClickFx();
              onClose();
              onOpenAccount();
            }}
            className="py-2.5 px-3 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-semibold cursor-pointer"
          >
            Manage Account &amp; Codes
          </button>
        </div>
      </div>
    </div>
  );
};
