import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Clock, RefreshCw, Wifi, WifiOff } from 'lucide-react';
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

      const bytes = 262144;
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

  const barThemeClass = isKids
    ? 'bg-sky-50 border-sky-200/80 text-slate-600'
    : mode === 'adult'
      ? 'bg-[#14070c] border-rose-500/20 text-rose-100/85'
      : mode === 'christmas'
        ? 'bg-[#071913] border-amber-400/20 text-emerald-100/85'
        : 'bg-zinc-950 border-white/10 text-zinc-400';

  return (
    <div className={`border-b text-xs transition-colors ${barThemeClass}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-8 flex items-center justify-between gap-3 overflow-x-auto no-scrollbar">
        {/* Live Clock · Date · Zone */}
        <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0 tabular-nums">
          <Clock className="w-3 h-3 opacity-70 shrink-0" />
          <span className="font-mono font-medium" data-testid="live-clock">
            {timeText}
          </span>
          <span className="opacity-65 hidden sm:inline" data-testid="live-date">
            · {dateText} · {zoneLabel}
          </span>
          <span className="opacity-65 sm:hidden" data-testid="live-date-mobile">
            · {shortDateText} · {zoneLabel}
          </span>
        </div>

        {/* Live Internet Speed · Ping */}
        <div className="flex items-center gap-2 whitespace-nowrap shrink-0 tabular-nums">
          <div className="flex items-center gap-1.5" data-testid="live-speed">
            {isOnline ? (
              <Wifi className="w-3 h-3 text-emerald-500 shrink-0" />
            ) : (
              <WifiOff className="w-3 h-3 text-amber-500 shrink-0" />
            )}
            <span className="font-mono font-medium">
              {!isOnline
                ? 'Offline'
                : speedMbps !== null
                  ? `${speedMbps} Mbps`
                  : 'Ready'}
            </span>
          </div>

          {isOnline && latencyMs !== null && (
            <div className="hidden sm:flex items-center gap-1 opacity-70 font-mono">
              <span>·</span>
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
            className={`p-1 rounded-md shrink-0 disabled:opacity-40 cursor-pointer ${
              isKids ? 'hover:bg-sky-200/60' : 'hover:bg-white/10'
            }`}
          >
            <RefreshCw className={`w-3 h-3 ${testingSpeed ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
};
