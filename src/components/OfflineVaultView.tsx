import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  Film,
  HardDrive,
  Play,
  Trash2,
  WifiOff,
} from 'lucide-react';
import {
  deleteOfflineMovie,
  deleteWatchedOfflineMovies,
  getDeviceStorageEstimate,
  getOfflineMoviePlayUrl,
  markOfflineMovieWatched,
  type OfflineMovieSummary,
} from '../lib/offlineVault';
import { formatBytes, type UserSubscriptionState } from '../utils/subscription';
import type { ProfileMode } from '../utils/modes';
import { playClickFx, playUnlockFx } from '../utils/soundFx';
import { TiltGlassCard } from './TiltGlassCard';

interface OfflineVaultViewProps {
  items: OfflineMovieSummary[];
  mode: ProfileMode;
  account: UserSubscriptionState | null;
  isOnline: boolean;
  onVaultUpdated: (newUsedBytes: number) => void;
  onOpenAccount: () => void;
}

export const OfflineVaultView: React.FC<OfflineVaultViewProps> = ({
  items,
  mode,
  account,
  isOnline,
  onVaultUpdated,
  onOpenAccount,
}) => {
  const [playing, setPlaying] = useState<{ summary: OfflineMovieSummary; url: string } | null>(null);
  const [deviceEst, setDeviceEst] = useState<{ usage: number; quota: number } | null>(null);
  const [cleanupMsg, setCleanupMsg] = useState('');
  const isKids = mode === 'kids';

  useEffect(() => {
    getDeviceStorageEstimate().then(setDeviceEst).catch(() => {});
  }, []);

  useEffect(() => {
    const activeUrl = playing?.url;
    return () => {
      if (activeUrl) URL.revokeObjectURL(activeUrl);
    };
  }, [playing?.url]);

  const totalVaultBytes = items.reduce((s, x) => s + x.sizeBytes, 0);
  const watchedCount = items.filter((x) => x.watched).length;
  const quotaBytes = account?.storageQuotaBytes || 0;
  const pct = quotaBytes > 0 ? Math.min(100, Math.round((totalVaultBytes / quotaBytes) * 100)) : 0;

  const handlePlay = async (key: string) => {
    playClickFx();
    const res = await getOfflineMoviePlayUrl(key);
    if (!res) return;
    if (playing?.url) URL.revokeObjectURL(playing.url);
    setPlaying({ summary: res.record, url: res.objectUrl });
  };

  const handleToggleWatched = async (rec: OfflineMovieSummary) => {
    playClickFx();
    await markOfflineMovieWatched(rec.key, !rec.watched);
    onVaultUpdated(totalVaultBytes);
  };

  const handleVideoEnded = async () => {
    if (!playing) return;
    await markOfflineMovieWatched(playing.summary.key, true);
    onVaultUpdated(totalVaultBytes);
  };

  const handleDelete = async (key: string) => {
    playClickFx();
    if (playing?.summary.key === key) {
      URL.revokeObjectURL(playing.url);
      setPlaying(null);
    }
    const updatedBytes = await deleteOfflineMovie(key);
    onVaultUpdated(updatedBytes);
  };

  const handleDeleteWatched = async () => {
    playClickFx();
    if (playing?.summary.watched) {
      URL.revokeObjectURL(playing.url);
      setPlaying(null);
    }
    const res = await deleteWatchedOfflineMovies();
    onVaultUpdated(res.remainingBytes);
    setCleanupMsg(
      res.removedCount > 0
        ? `Removed ${res.removedCount} watched title(s) to free vault storage.`
        : 'No watched titles flagged yet. Finish watching or mark a movie Watched first.',
    );
    setTimeout(() => setCleanupMsg(''), 4000);
  };

  const handleExportMp4 = async (rec: OfflineMovieSummary) => {
    playUnlockFx();
    const res = await getOfflineMoviePlayUrl(rec.key);
    if (!res) return;
    const link = document.createElement('a');
    link.href = res.objectUrl;
    const safeName = rec.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'xerotv-movie';
    link.download = `${safeName}.mp4`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(res.objectUrl), 5000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold font-display">Offline Cinema Vault</h1>
          <p className={`text-sm ${isKids ? 'text-slate-600' : 'text-zinc-400'}`}>
            Real MP4 downloads stored on your device. Watch anytime with or without internet.
          </p>
        </div>

        {!isOnline && (
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-200 text-xs font-semibold">
            <WifiOff className="w-4 h-4" />
            <span>Offline Mode Active — Local Playback Ready</span>
          </div>
        )}
      </div>

      {/* Storage Telemetry & Cleanup Card */}
      <div
        className={`rounded-3xl p-6 space-y-4 ${
          isKids ? 'bg-white border border-sky-200 text-slate-900' : 'liquid-glass-strong'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <HardDrive className="w-5 h-5" />
            <div>
              <h2 className="text-base font-bold font-display">Vault Storage Allocation</h2>
              <p className={`text-xs tabular-nums ${isKids ? 'text-slate-500' : 'text-zinc-400'}`}>
                {formatBytes(totalVaultBytes)} used of {formatBytes(quotaBytes)} subscription quota
                {deviceEst ? ` · Device capacity: ${formatBytes(deviceEst.quota - deviceEst.usage)} free` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {items.length > 0 && (
              <button
                type="button"
                onClick={handleDeleteWatched}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                  isKids
                    ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    : 'border-rose-400/40 text-rose-300 hover:bg-rose-500/15'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Watched Movies ({watchedCount})</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenAccount}
              className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                isKids
                  ? 'bg-sky-600 text-white hover:bg-sky-700'
                  : 'bg-white text-zinc-950 hover:bg-zinc-200'
              }`}
            >
              Upgrade to 1TB Permanent Storage
            </button>
          </div>
        </div>

        <div className={`w-full h-2.5 rounded-full overflow-hidden ${isKids ? 'bg-sky-100' : 'bg-white/10'}`}>
          <div
            className={`h-full transition-all duration-300 ${isKids ? 'bg-sky-600' : 'bg-white'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {cleanupMsg && (
          <p className={`text-xs font-medium ${isKids ? 'text-emerald-700' : 'text-emerald-400'}`} role="status">
            {cleanupMsg}
          </p>
        )}
      </div>

      {/* Offline HTML5 Video Player */}
      {playing && (
        <div
          className={`rounded-3xl overflow-hidden p-4 space-y-3 ${
            isKids ? 'bg-white border border-sky-200 text-slate-900 shadow-sm' : 'liquid-glass-strong'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold font-display">{playing.summary.title}</h3>
              <p className={`text-xs tabular-nums ${isKids ? 'text-slate-500' : 'text-zinc-400'}`}>
                Playing from local device storage · {formatBytes(playing.summary.sizeBytes)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(playing.url);
                setPlaying(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                isKids
                  ? 'bg-sky-100 text-sky-900 hover:bg-sky-200'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              Close Player
            </button>
          </div>
          <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black">
            <video
              src={playing.url}
              controls
              autoPlay
              playsInline
              onEnded={handleVideoEnded}
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      )}

      {/* Downloaded Movies Grid */}
      {items.length === 0 ? (
        <div
          className={`rounded-3xl p-12 text-center space-y-3 ${
            isKids ? 'bg-white border border-sky-200 text-slate-900' : 'liquid-glass'
          }`}
        >
          <Film className="w-10 h-10 mx-auto opacity-50" />
          <h3 className="text-lg font-bold font-display">Your Offline Vault is Empty</h3>
          <p className={`text-sm max-w-md mx-auto ${isKids ? 'text-slate-600' : 'text-zinc-400'}`}>
            Open any movie or series and choose Download for Offline to store a real playable video file
            on your device in the background.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((rec) => (
            <TiltGlassCard key={rec.key} intensity={5} className="rounded-2xl">
              <div
                className={`rounded-2xl overflow-hidden flex gap-4 p-4 h-full ${
                  isKids ? 'bg-white border border-sky-200 text-slate-900' : 'liquid-glass'
                }`}
              >
                <div className="w-24 aspect-[2/3] rounded-xl overflow-hidden bg-zinc-900 shrink-0">
                  {rec.posterDataUrl ? (
                    <img
                      src={rec.posterDataUrl}
                      alt={rec.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-500">
                      <Film className="w-6 h-6" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-bold font-display truncate">{rec.title}</h3>
                      {rec.watched && (
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold shrink-0 ${
                            isKids ? 'text-emerald-600' : 'text-emerald-400'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Watched</span>
                        </span>
                      )}
                    </div>
                    <div className={`text-xs tabular-nums mt-0.5 ${isKids ? 'text-slate-500' : 'text-zinc-400'}`}>
                      {rec.quality.toUpperCase()} · {formatBytes(rec.sizeBytes)}
                    </div>
                    <p className={`text-xs line-clamp-2 mt-2 ${isKids ? 'text-slate-600' : 'text-zinc-400'}`}>
                      {rec.overview}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handlePlay(rec.key)}
                      className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer ${
                        isKids
                          ? 'bg-sky-600 text-white hover:bg-sky-700'
                          : 'bg-white text-zinc-950 hover:bg-zinc-200'
                      }`}
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Play</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleWatched(rec)}
                      title={rec.watched ? 'Mark as unwatched' : 'Mark as watched'}
                      aria-label={rec.watched ? `Unmark ${rec.title} as watched` : `Mark ${rec.title} as watched`}
                      className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                        rec.watched
                          ? isKids
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                          : isKids
                            ? 'border-sky-200 text-slate-600 hover:bg-sky-50'
                            : 'border-white/15 text-zinc-300 hover:bg-white/10'
                      }`}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportMp4(rec)}
                      aria-label={`Save ${rec.title} MP4 to device`}
                      title="Save MP4 file"
                      className={`p-2 rounded-xl border cursor-pointer ${
                        isKids
                          ? 'border-sky-200 text-slate-700 hover:bg-sky-50'
                          : 'border-white/15 text-zinc-200 hover:bg-white/10'
                      }`}
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(rec.key)}
                      aria-label={`Delete ${rec.title}`}
                      className={`p-2 rounded-xl border cursor-pointer ${
                        isKids
                          ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                          : 'border-white/15 text-rose-400 hover:bg-rose-500/10'
                      }`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </TiltGlassCard>
          ))}
        </div>
      )}
    </div>
  );
};
