import React, { useEffect, useState } from 'react';
import { Lock, Snowflake, X } from 'lucide-react';
import { getChristmasUnlockInfo } from '../utils/modes';

interface ChristmasLockModalProps {
  open: boolean;
  onClose: () => void;
}

export const ChristmasLockModal: React.FC<ChristmasLockModalProps> = ({ open, onClose }) => {
  const [info, setInfo] = useState(() => getChristmasUnlockInfo(Date.now()));

  useEffect(() => {
    if (!open) return;
    setInfo(getChristmasUnlockInfo(Date.now()));
    const id = window.setInterval(() => {
      setInfo(getChristmasUnlockInfo(Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="christmas-lock-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
    >
      <div className="w-full max-w-md liquid-glass-strong rounded-3xl p-6 sm:p-8 text-white space-y-5 border border-emerald-400/25 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-red-600/25 border border-red-400/35 text-red-200">
              <Snowflake className="w-6 h-6" />
            </div>
            <div>
              <h2 id="christmas-lock-title" className="text-xl font-bold font-display">
                Christmas Mode Locked
              </h2>
              <p className="text-xs text-zinc-400">Opens on {info.unlockLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-zinc-300 leading-relaxed">
          Santa &amp; Snowfall Cinema stays locked until <strong>December 25 at 12:00 AM</strong>. Come back on Christmas Day to unlock holiday specials and interactive snow effects!
        </p>

        <div className="grid grid-cols-4 gap-2 text-center tabular-nums">
          {[
            { label: 'Days', value: info.daysRemaining },
            { label: 'Hours', value: info.hoursRemaining },
            { label: 'Min', value: info.minutesRemaining },
            { label: 'Sec', value: info.secondsRemaining },
          ].map((unit) => (
            <div
              key={unit.label}
              className="rounded-2xl bg-white/5 border border-white/15 py-3 px-2"
            >
              <div className="text-2xl font-bold font-display">{unit.value}</div>
              <div className="text-[11px] text-zinc-400 uppercase tracking-wider">{unit.label}</div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-200 flex items-center justify-center gap-2 cursor-pointer"
        >
          <Lock className="w-4 h-4" />
          <span>Back to Catalog</span>
        </button>
      </div>
    </div>
  );
};
