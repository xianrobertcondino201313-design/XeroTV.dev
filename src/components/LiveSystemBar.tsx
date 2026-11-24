import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Clock, RefreshCw, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import type { ProfileMode } from '../utils/modes';
import { formatClockDisplay, loadAppSettings, subscribeAppSettings } from '../utils/settings';
import { playClickFx } from '../utils/soundFx';

interface LiveSystemBarProps {
  mode: ProfileMode;
  isOnline: boolean;
}

export const LiveSystemBar: React.FC<LiveSystemBarProps> = ({ mode, isOnline }) => {
  const isKids = mode === 'kids';
  const [now, setNow] = useState<Date>(() => new Date());
  const [settings, setSettings] = useState(() => loadAppSettings());
  const [speedMbps, setSpeedMbps] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [testingSpeed, setTestingSpeed] = useState(false);

  useEffect(() => {
    return subscribeAppSettings(setSettings);
  }, []);

  // Real-time clock (updates once per second cleanly)
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const runSpeedTest = useCallback(async () => {
    if (!navigator.onLine) {
      setSpeedMbps(0);
      setLatencyMs(null);
      return;
    }
    setTestingSpeed(true);
    try {
      const t0 = performance.now();
      const pingRes = await fetch(`/api/speedtest/ping?t=${Date.now()}`, { cache: 'no-store' });
      const t1 = performance.now();
      if (pingRes.ok) {
        setLatencyMs(Math.max(1, Math.round(t1 - t0)));
      }

      const bytes = 262144; // 256 KB fast real probe (never slows initial page loads)
      const d0 = performance.now();
      const dlRes = await fetch(`/api/speedtest/payload?bytes=${bytes}&t=${Date.now()}`, {
        cache: 'no-store',
      });
      await dlRes.arrayBuffer();
      const d1 = performance.now();
      const elapsedSec = Math.max(0.005, (d1 - d0) / 1000);
      const mbps = (bytes * 8) / elapsedSec / 1_000_000;
      setSpeedMbps(Number(mbps.toFixed(1)));
    } catch {
      const navConn = (navigator as unknown as { connection?: { downlink?: number } }).connection;
      if (typeof navConn?.downlink === 'number' && navConn.downlink > 0) {
        setSpeedMbps(Number(navConn.downlink.toFixed(1)));
      }
    } finally {
      setTestingSpeed(false);
    }
  }, []);

  useEffect(() => {
    if (!isOnline) {
      setSpeedMbps(0);
      setLatencyMs(null);
      return;
    }
    // Defer initial speed test slightly so TMDB catalog & hero art load first
    const timer = window.setTimeout(() => {
      void runSpeedTest();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [isOnline, runSpeedTest]);

  const { timeText, dateText, shortDateText, zoneLabel } = formatClockDisplay(
    now,
    settings.timeFormat,
    settings.timeZone,
  );

  const barThemeClass =
    isKids
      ? 'bg-sky-50/95 border-sky-200 text-slate-700'
      : mode === 'adult'
        ? 'bg-[#17090f]/95 border-rose-500/20 text-rose-100'
        : mode === 'christmas'
          ? 'bg-[#081d16]/95 border-amber-400/20 text-emerald-50'
          : 'bg-black/45 border-white/10 text-zinc-300';

  return (
    <div className={`border-b text-xs transition-colors ${barThemeClass}`}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-10 flex items-center justify-between gap-2 sm:gap-3 overflow-x-auto no-scrollbar">
        {/* Live Clock + Date + Timezone */}
        <div className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 tabular-nums">
          <Clock className="w-3.5 h-3.5 opacity-75 shrink-0" />
          <span className="font-mono font-semibold" data-testid="live-clock">
            {timeText}
          </span>
          <span className="opacity-65 hidden sm:inline" data-testid="live-date">
            · {dateText}
          </span>
          <span className="opacity-65 sm:hidden" data-testid="live-date-mobile">
            · {shortDateText}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
              isKids ? 'bg-sky-200/70 text-sky-900' : 'bg-white/10 text-zinc-200'
            }`}
          >
            {zoneLabel}
          </span>
        </div>

        {/* Security Shield Indicator */}
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] opacity-80 whitespace-nowrap">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>XEROTV v1.0 Shield Active · Zero-Exploit Sandbox</span>
        </div>

        {/* Live Internet Speed & Ping */}
        <div className="flex items-center gap-1.5 sm:gap-3 whitespace-nowrap shrink-0 tabular-nums">
          <div className="flex items-center gap-1 sm:gap-1.5" data-testid="live-speed">
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            )}
            <span className="font-mono font-semibold">
              {!isOnline
                ? 'Offline'
                : speedMbps !== null
                  ? `${speedMbps} Mbps`
                  : 'Ready'}
            </span>
          </div>

          {isOnline && latencyMs !== null && (
            <div className="hidden sm:flex items-center gap-1 opacity-75 font-mono">
              <Activity className="w-3 h-3" />
              <span>{latencyMs} ms</span>
            </div>
          )}

          <button
            type="button"
            disabled={!isOnline || testingSpeed}
            onClick={() => {
              playClickFx();
              void runSpeedTest();
            }}
            aria-label="Retest internet speed"
            title="Test live connection speed"
            className={`p-1.5 rounded-lg shrink-0 disabled:opacity-40 cursor-pointer ${
              isKids ? 'hover:bg-sky-200/70' : 'hover:bg-white/10'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testingSpeed ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
};
