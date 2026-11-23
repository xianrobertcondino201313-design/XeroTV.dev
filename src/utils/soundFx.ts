import { loadAppSettings } from './settings';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!loadAppSettings().soundEnabled) return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctor();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function playTone(params: {
  freq: number;
  endFreq?: number;
  durationSec: number;
  gainPeak: number;
  type?: OscillatorType;
  delaySec?: number;
}) {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const start = ctx.currentTime + (params.delaySec || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = params.type || 'sine';
    osc.frequency.setValueAtTime(params.freq, start);
    if (params.endFreq) {
      osc.frequency.exponentialRampToValueAtTime(params.endFreq, start + params.durationSec);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(params.gainPeak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + params.durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + params.durationSec + 0.02);
  } catch {
    // ignore Web Audio blocks prior to gesture
  }
}

export function playClickFx() {
  playTone({ freq: 520, endFreq: 260, durationSec: 0.055, gainPeak: 0.045, type: 'triangle' });
}

export function playTypingFx() {
  const jitter = 680 + Math.random() * 140;
  playTone({ freq: jitter, endFreq: 380, durationSec: 0.032, gainPeak: 0.028, type: 'sine' });
}

export function playUnlockFx() {
  playTone({ freq: 440, durationSec: 0.14, gainPeak: 0.05, type: 'triangle', delaySec: 0 });
  playTone({ freq: 659.25, durationSec: 0.16, gainPeak: 0.055, type: 'triangle', delaySec: 0.07 });
  playTone({ freq: 880, durationSec: 0.22, gainPeak: 0.055, type: 'sine', delaySec: 0.14 });
}

export function playDownloadDoneFx() {
  playTone({ freq: 523.25, durationSec: 0.16, gainPeak: 0.055, type: 'sine', delaySec: 0 });
  playTone({ freq: 659.25, durationSec: 0.16, gainPeak: 0.055, type: 'sine', delaySec: 0.1 });
  playTone({ freq: 783.99, durationSec: 0.28, gainPeak: 0.06, type: 'sine', delaySec: 0.2 });
}

export function playErrorFx() {
  playTone({ freq: 240, endFreq: 160, durationSec: 0.18, gainPeak: 0.055, type: 'sawtooth' });
}
