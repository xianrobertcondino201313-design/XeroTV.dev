import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck, X } from 'lucide-react';
import { hashPin, verifyPinFormat } from '../utils/modes';

interface PinModalProps {
  open: boolean;
  title: string;
  description: string;
  mode: 'create' | 'verify';
  expectedHash?: string;
  onSuccess: (pinHash: string) => void;
  onCancel: () => void;
}

export const PinModal: React.FC<PinModalProps> = ({
  open,
  title,
  description,
  mode,
  expectedHash,
  onSuccess,
  onCancel,
}) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPin('');
    setConfirmPin('');
    setError('');
    setBusy(false);
  }, [open, mode, title]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!verifyPinFormat(pin)) {
      setError('PIN must be 4 to 6 numeric digits.');
      return;
    }

    if (mode === 'create' && pin !== confirmPin) {
      setError('PIN confirmation does not match.');
      return;
    }

    setBusy(true);
    try {
      const digest = await hashPin(pin);
      if (mode === 'verify' && expectedHash && digest !== expectedHash) {
        setError('Incorrect PIN. Please try again.');
        setBusy(false);
        return;
      }
      setPin('');
      setConfirmPin('');
      onSuccess(digest);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
    >
      <div className="w-full max-w-sm liquid-glass-strong rounded-3xl p-6 text-white space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              {mode === 'create' ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <h2 id="pin-modal-title" className="text-lg font-bold font-display">
                {title}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">{description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close PIN dialog"
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="pin-input" className="block text-xs font-medium text-zinc-300 mb-1.5">
              {mode === 'create' ? 'Create 4-6 Digit PIN' : 'Enter PIN'}
            </label>
            <input
              id="pin-input"
              type="password"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/15 text-white text-center text-lg tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-white/40"
            />
          </div>

          {mode === 'create' && (
            <div>
              <label htmlFor="pin-confirm" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Confirm PIN
              </label>
              <input
                id="pin-confirm"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/15 text-white text-center text-lg tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-white/40"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-400 font-medium" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2.5 px-4 rounded-xl border border-white/15 text-sm font-medium text-zinc-300 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 py-2.5 px-4 rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-60"
            >
              {busy ? 'Verifying...' : mode === 'create' ? 'Save PIN' : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
