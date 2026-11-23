import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  Film,
  HardDriveDownload,
  Lock,
  ShieldCheck,
  Sparkles,
  Tv,
  X,
} from 'lucide-react';
import { playClickFx, playTypingFx, playUnlockFx } from '../utils/soundFx';
import { TiltGlassCard } from './TiltGlassCard';

interface IntroduceWalkthroughProps {
  open: boolean;
  onSkip: () => void;
  onGetStartedAuth: () => void;
}

const SLIDES = [
  {
    badge: 'WELCOME TO XEROTV · XIAN IN PRODUCTION',
    title: 'Cinema Inside 3D Liquid Glass',
    body: 'Move your cursor across any card or control to feel hardware-accelerated Liquid Glass depth, specular light slashes, and tactile Web Audio feedback.',
    highlights: [
      'Real-time TMDB movie & series catalog synchronization',
      'Live speed telemetry, precision clock & installable WebApp shortcuts',
      'Built for Desktop, Tablet, iOS, and native Android APK',
    ],
    Icon: Sparkles,
  },
  {
    badge: 'STREAMING & NETWORKS CATALOG',
    title: 'Sandbox-Safe Players & Major Studios',
    body: 'Switch seamlessly between VidZen, NxSha, Zoryva, and PrimeSrc servers with anti-popup sandbox protection and filter directly by Netflix, Disney+, HBO Max, Apple TV+, Marvel, Pixar, and A24.',
    highlights: [
      'VidZen & NxSha 100% sandbox-ready embeds',
      'Direct Networks & Studios shelves with real logos',
      'Kids Mode PG, 18+ Secret Vault, and Dec 25 Christmas Mode',
    ],
    Icon: Tv,
  },
  {
    badge: 'BACKGROUND DOWNLOADS & IMPROVING AT 1.0',
    title: 'Download While You Browse — Watch Offline',
    body: 'Save real MP4 movies directly to your device vault in the background while exploring the catalog. Watch anytime offline on the web shortcut or mobile app.',
    highlights: [
      'Chunked HTTP Range downloads resistant to proxy timeouts',
      'Smart "Delete Watched Movies" button to reclaim storage fast',
      'Use code VER-1-0XEROTV for 20 days access + 5GB bonus storage',
    ],
    Icon: HardDriveDownload,
    includeVideo: true,
  },
  {
    badge: 'ANTI-EXPLOIT SECURITY & PRIVACY',
    title: 'Protected Every Step of the Way',
    body: 'Human bot-verification before login, brute-force locks, sanitized Firestore rules, and honest platform metrics with zero fake numbers.',
    highlights: [
      'You’re-not-a-bot cryptographic verification gate',
      'Firestore owner-isolated accounts & one-time promo ledger',
      'Ready to unlock your XEROTV UserID and start watching?',
    ],
    Icon: ShieldCheck,
    isFinal: true,
  },
];

export const IntroduceWalkthrough: React.FC<IntroduceWalkthroughProps> = ({
  open,
  onSkip,
  onGetStartedAuth,
}) => {
  const [step, setStep] = useState(0);
  const [typedTitle, setTypedTitle] = useState('');

  const slide = SLIDES[step] || SLIDES[0];

  // Typewriter title animation with gentle Web Audio typing sound on step switch
  useEffect(() => {
    if (!open) return;
    setTypedTitle('');
    let idx = 0;
    const full = slide.title;
    const timer = window.setInterval(() => {
      idx += 1;
      setTypedTitle(full.slice(0, idx));
      if (idx % 4 === 1 && idx < full.length) {
        playTypingFx();
      }
      if (idx >= full.length) {
        window.clearInterval(timer);
      }
    }, 22);
    return () => window.clearInterval(timer);
  }, [open, step, slide.title]);

  if (!open) return null;

  const SlideIcon = slide.Icon;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="introduce-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl overflow-y-auto"
    >
      <TiltGlassCard intensity={5} className="w-full max-w-3xl rounded-3xl my-auto">
        <div className="liquid-glass-strong rounded-3xl p-6 sm:p-8 text-white space-y-6 border border-white/20">
          {/* Header Row */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img
                src="/src/assets/images/xerotv_app_icon_1795185548315.jpg"
                alt="XEROTV"
                className="w-10 h-10 rounded-xl object-cover border border-white/20"
              />
              <div>
                <div className="text-[11px] font-mono tracking-widest text-zinc-400">
                  {slide.badge}
                </div>
                <div className="text-xs text-zinc-300">
                  Step {step + 1} of {SLIDES.length}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                playClickFx();
                onSkip();
              }}
              aria-label="Skip introduction"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-xs text-zinc-300 cursor-pointer"
            >
              <span>Skip</span>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Step Content */}
          <div className="space-y-4">
            <div className="inline-flex p-3 rounded-2xl bg-white/10 border border-white/15">
              <SlideIcon className="w-6 h-6" />
            </div>

            <h2
              id="introduce-title"
              className="text-2xl sm:text-3xl font-bold font-display min-h-[2.4rem]"
            >
              {typedTitle || slide.title}
            </h2>

            <p className="text-sm text-zinc-300 leading-relaxed">{slide.body}</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              {slide.highlights.map((h) => (
                <div
                  key={h}
                  className="rounded-2xl bg-white/5 border border-white/10 p-3 text-xs text-zinc-200 leading-relaxed"
                >
                  {h}
                </div>
              ))}
            </div>

            {slide.includeVideo && (
              <div className="rounded-2xl overflow-hidden border border-white/15 bg-black space-y-2 p-3">
                <div className="flex items-center justify-between text-xs text-zinc-300">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Film className="w-4 h-4" />
                    <span>Preview: Improving at 1.0 (90s Release Reel with Sound)</span>
                  </span>
                  <span className="font-mono text-[11px] opacity-75">MP4 · Audio Enabled</span>
                </div>
                <video
                  src="/api/media/improving-v1.mp4"
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full aspect-video rounded-xl bg-black"
                />
              </div>
            )}
          </div>

          {/* Step Dots + Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-white/10">
            <div className="flex items-center gap-2">
              {SLIDES.map((s, i) => (
                <button
                  key={s.badge}
                  type="button"
                  aria-label={`Go to step ${i + 1}`}
                  onClick={() => {
                    playClickFx();
                    setStep(i);
                  }}
                  className={`h-2 rounded-full transition-all cursor-pointer ${
                    i === step ? 'w-8 bg-white' : 'w-2 bg-white/25 hover:bg-white/50'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2 justify-end">
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    playClickFx();
                    setStep((s) => Math.max(0, s - 1));
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>
              )}

              {slide.isFinal ? (
                <button
                  type="button"
                  onClick={() => {
                    playUnlockFx();
                    onGetStartedAuth();
                  }}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white text-zinc-950 text-xs sm:text-sm font-bold hover:bg-zinc-200 transition-colors cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                  <span>Get Started &rarr; Sign In</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    playClickFx();
                    setStep((s) => Math.min(SLIDES.length - 1, s + 1));
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-zinc-950 text-xs sm:text-sm font-bold hover:bg-zinc-200 transition-colors cursor-pointer"
                >
                  <span>Next</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </TiltGlassCard>
    </div>
  );
};
