import React, { useEffect, useState } from 'react';
import { Monitor, Server, Settings, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { STREAMING_SERVERS } from '../utils/servers';
import { loadAppSettings, saveAppSettings, type XeroAppSettings } from '../utils/settings';
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto"
    >
      <div className="w-full max-w-lg liquid-glass-strong rounded-3xl p-6 sm:p-7 text-white space-y-6 my-auto border border-white/20">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Settings className="w-5 h-5" />
            <div>
              <h2 id="settings-modal-title" className="text-xl font-bold font-display">
                XEROTV Settings
              </h2>
              <p className="text-xs text-zinc-400">
                Working preferences saved locally on this device.
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

        <div className="space-y-4">
          {/* Audio SFX Toggle */}
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 flex items-center justify-between gap-4">
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

          {/* 3D Liquid Glass Tilt Toggle */}
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Sparkles className="w-4 h-4" />
              <div>
                <div className="text-sm font-semibold">3D Liquid Glass Cursor Motion</div>
                <div className="text-xs text-zinc-400">Pointer-triggered tilt &amp; specular slash highlights</div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.motion3dEnabled}
              onClick={() => updatePatch({ motion3dEnabled: !settings.motion3dEnabled })}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                settings.motion3dEnabled ? 'bg-white text-zinc-950' : 'bg-white/10 text-zinc-400'
              }`}
            >
              {settings.motion3dEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Default Streaming Server */}
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
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
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
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
    </div>
  );
};
