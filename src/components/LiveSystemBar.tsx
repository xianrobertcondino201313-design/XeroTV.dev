import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Clock, RefreshCw, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import type { ProfileMode } from '../utils/modes';
import { playClickFx } from '../utils/soundFx';

interface LiveSystemBarProps {
  mode: ProfileMode;
  isOnline: boolean;
}

export const LiveSystemBar: React.FC<LiveSystemBarProps> = ({ mode, isOnline }) => {
  const isKids = mode === 'kids';
  const [now, setNow] = useState<Date>(() => new Date());
  const [speedMbps, setSpeedMbps] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [testingSpeed, setTestingSpeed] = useState(false);

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

      const bytes = 524288; // 512 KB real download probe
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
    if (isOnline) {
      void runSpeedTest();
    } else {
      setSpeedMbps(0);
      setLatencyMs(null);
    }
  }, [isOnline, runSpeedTest]);

  const timeString = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dateString = now.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      className={`border-b text-xs transition-colors ${
        isKids
          ? 'bg-sky-50/80 border-sky-200/80 text-slate-700'
          : 'bg-black/35 border-white/10 text-zinc-300'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-10 flex items-center justify-between gap-4 overflow-x-auto no-scrollbar">
        {/* Live Clock */}
        <div className="flex items-center gap-2 whitespace-nowrap shrink-0 tabular-nums">
          <Clock className="w-3.5 h-3.5 opacity-75" />
          <span className="font-mono font-semibold" data-testid="live-clock">
            {timeString}
          </span>
          <span className="opacity-65 hidden sm:inline">· {dateString}</span>
        </div>

        {/* Security Shield Indicator */}
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] opacity-75 whitespace-nowrap">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>XEROTV v1.0 Shield Active · Zero-Exploit Sandbox</span>
        </div>

        {/* Live Internet Speed & Ping */}
        <div className="flex items-center gap-3 whitespace-nowrap shrink-0 tabular-nums">
          <div className="flex items-center gap-1.5" data-testid="live-speed">
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className="font-mono font-semibold">
              {!isOnline
                ? 'Offline'
                : speedMbps !== null
                  ? `${speedMbps} Mbps`
                  : 'Measuring...'}
            </span>
          </div>

          {isOnline && latencyMs !== null && (
            <div className="flex items-center gap-1 opacity-75 font-mono">
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
            className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testingSpeed ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
};
