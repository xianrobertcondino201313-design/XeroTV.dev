import React, { useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  Bug,
  CheckCircle2,
  ExternalLink,
  Film,
  Gift,
  HeartHandshake,
  MessageSquarePlus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import {
  fetchHonestPlatformPulse,
  submitFeedbackReport,
  type HonestPlatformPulse,
} from '../lib/authClient';
import type { ProfileMode } from '../utils/modes';
import { playClickFx, playErrorFx, playUnlockFx } from '../utils/soundFx';
import { TiltGlassCard } from './TiltGlassCard';

interface DocsAndChangelogViewProps {
  mode: ProfileMode;
  onReplayIntroduce: () => void;
  onOpenAccount: () => void;
  onOpenVault: () => void;
}

const DEV_FACEBOOK_URL = 'https://web.facebook.com/share/p/1E7E6y8HAD/';

const IMPROVING_1_0_ITEMS = [
  {
    title: 'Background Offline Downloads + Watched Cleanup',
    detail:
      'Start a movie download and keep browsing or switch tabs freely. Manage watched movies in your Offline Vault with 1-click "Delete Watched Movies" to reclaim quota.',
  },
  {
    title: '3D Liquid Glass & Interactive Sound Engine',
    detail:
      'Pointer-driven 3D tilt depth, specular light slashes, tactile Web Audio SFX, and customizable motion/audio toggles inside Settings.',
  },
  {
    title: 'Networks & Studios Catalog',
    detail:
      'Filter real TMDB movies & series directly by Netflix, Disney+, HBO / Max, Apple TV+, Prime Video, Marvel Studios, Pixar, Warner Bros., and A24.',
  },
  {
    title: 'Anti-Bot Gate & Exploit Protection',
    detail:
      'Added You’re-Not-a-Bot verification on built-in sign-in & registration, API rate limiting, admin brute-force lockout, and dynamic server promo code validation.',
  },
  {
    title: 'Promo Code VER-1-0XEROTV & Admin Code Generator',
    detail:
      'Redeem VER-1-0XEROTV once per account for +20 days offline access & +5GB storage, or redeem custom codes generated in the Admin Console.',
  },
];

export const DocsAndChangelogView: React.FC<DocsAndChangelogViewProps> = ({
  mode,
  onReplayIntroduce,
  onOpenAccount,
  onOpenVault,
}) => {
  const isKids = mode === 'kids';
  const [pulse, setPulse] = useState<HonestPlatformPulse | null>(null);
  const [loadingPulse, setLoadingPulse] = useState(true);

  const [category, setCategory] = useState<'feedback' | 'bug'>('feedback');
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const loadPulse = async () => {
    setLoadingPulse(true);
    try {
      const data = await fetchHonestPlatformPulse();
      setPulse(data);
    } finally {
      setLoadingPulse(false);
    }
  };

  useEffect(() => {
    void loadPulse();
  }, []);

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitStatus(null);
    setSubmitting(true);
    try {
      await submitFeedbackReport({ category, rating, title, message });
      playUnlockFx();
      setSubmitStatus({
        ok: true,
        text:
          category === 'bug'
            ? 'Bug report saved to developer inbox. Thank you for helping improve XEROTV 1.0!'
            : 'Thank you! Your genuine rating & feedback now updates the live Popularity % metric.',
      });
      setTitle('');
      setMessage('');
      await loadPulse();
    } catch (err) {
      playErrorFx();
      setSubmitStatus({
        ok: false,
        text: err instanceof Error ? err.message : 'Unable to submit report.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const cardClass = isKids
    ? 'bg-white border border-sky-200 text-slate-900 shadow-sm'
    : 'liquid-glass-strong text-white';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest opacity-70">
            <BookOpen className="w-4 h-4" />
            <span>Documentation · Version 1.0</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold font-display">
            Improving at 1.0 &amp; Platform Guide
          </h1>
          <p className={`text-sm ${isKids ? 'text-slate-600' : 'text-zinc-400'}`}>
            Explore XEROTV 1.0 upgrades, watch the 90s changelog video with sound, inspect real live telemetry, or report a bug.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              playClickFx();
              onReplayIntroduce();
            }}
            className={`px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer ${
              isKids
                ? 'bg-sky-600 text-white hover:bg-sky-700'
                : 'bg-white text-zinc-950 hover:bg-zinc-200'
            }`}
          >
            Replay Introduce Tour
          </button>
          <a
            href={DEV_FACEBOOK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold border ${
              isKids
                ? 'border-sky-300 text-sky-900 hover:bg-sky-50'
                : 'border-white/20 text-white hover:bg-white/10'
            }`}
          >
            <HeartHandshake className="w-4 h-4" />
            <span>Support Developer</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Honest Live Platform Pulse (Zero Fake Numbers) */}
      <section aria-label="Live Platform Pulse" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold font-display flex items-center gap-2">
            <Activity className="w-4 h-4" />
            <span>Live XEROTV Metrics (100% Real Database Data)</span>
          </h2>
          <button
            type="button"
            onClick={() => {
              playClickFx();
              void loadPulse();
            }}
            className="inline-flex items-center gap-1 text-xs opacity-75 hover:opacity-100 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingPulse ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
          <TiltGlassCard intensity={6} className="rounded-2xl">
            <div className={`rounded-2xl p-5 space-y-1.5 ${cardClass}`}>
              <div className="text-xs opacity-70 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>Registered Users</span>
              </div>
              <div className="text-2xl font-bold font-display" data-testid="pulse-registered-users">
                {pulse?.registeredUsers ?? '—'}
              </div>
              <div className="text-[11px] opacity-65">Verified XEROTV accounts</div>
            </div>
          </TiltGlassCard>

          <TiltGlassCard intensity={6} className="rounded-2xl">
            <div className={`rounded-2xl p-5 space-y-1.5 ${cardClass}`}>
              <div className="text-xs opacity-70 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span>Live Online Now</span>
              </div>
              <div className="text-2xl font-bold font-display" data-testid="pulse-online-users">
                {pulse ? pulse.onlineUsers : '—'}
              </div>
              <div className="text-[11px] opacity-65">Active sessions (3 min window)</div>
            </div>
          </TiltGlassCard>

          <TiltGlassCard intensity={6} className="rounded-2xl">
            <div className={`rounded-2xl p-5 space-y-1.5 ${cardClass}`}>
              <div className="text-xs opacity-70 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5" />
                <span>Verified Earnings</span>
              </div>
              <div className="text-2xl font-bold font-display" data-testid="pulse-earnings">
                ₱{(pulse?.totalEarningsPesos ?? 0).toLocaleString()}
              </div>
              <div className="text-[11px] opacity-65">Real recorded subscription grants</div>
            </div>
          </TiltGlassCard>

          <TiltGlassCard intensity={6} className="rounded-2xl">
            <div className={`rounded-2xl p-5 space-y-1.5 ${cardClass}`}>
              <div className="text-xs opacity-70 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Real Popularity</span>
              </div>
              <div className="text-2xl font-bold font-display" data-testid="pulse-popularity">
                {pulse?.popularityPct !== null && pulse?.popularityPct !== undefined
                  ? `${pulse.popularityPct}%`
                  : 'No ratings yet'}
              </div>
              <div className="text-[11px] opacity-65">
                From {pulse?.ratingCount ?? 0} verified user review(s)
              </div>
            </div>
          </TiltGlassCard>
        </div>
      </section>

      {/* Improving at 1.0 Video + Changelog Log */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <div className={`rounded-3xl p-6 space-y-4 ${cardClass}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Film className="w-5 h-5" />
              <h2 className="text-xl font-bold font-display">Improving at 1.0 (Video)</h2>
            </div>
            <span
              className={`text-xs font-mono px-2.5 py-1 rounded-lg ${
                isKids ? 'bg-sky-100 text-sky-900' : 'bg-white/10'
              }`}
            >
              90s MP4 + Sound
            </span>
          </div>
          <p className={`text-xs ${isKids ? 'text-slate-600' : 'text-zinc-400'}`}>
            Official 90-second XEROTV v1.0 upgrade showcase video with synthesized audio soundtrack.
          </p>
          <div className="rounded-2xl overflow-hidden bg-black border border-white/15">
            <video
              data-testid="improving-v1-video"
              src="/api/media/improving-v1.mp4"
              controls
              playsInline
              preload="metadata"
              className="w-full aspect-video object-contain bg-black"
            />
          </div>
          <div
            className={`rounded-2xl p-3.5 flex items-center justify-between gap-3 flex-wrap ${
              isKids
                ? 'bg-sky-50 border border-sky-200 text-slate-800'
                : 'bg-white/5 border border-white/10'
            }`}
          >
            <div className="flex items-center gap-2 text-xs">
              <Gift className={`w-4 h-4 ${isKids ? 'text-emerald-600' : 'text-emerald-400'}`} />
              <span>
                Promo Code: <code className="font-mono font-bold">VER-1-0XEROTV</code> (+20 Days &amp; +5GB)
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenAccount}
              className="text-xs font-semibold underline cursor-pointer"
            >
              Redeem in Account
            </button>
          </div>
        </div>

        <div className={`rounded-3xl p-6 space-y-4 ${cardClass}`}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            <h2 className="text-xl font-bold font-display">What&apos;s New &amp; Improved in 1.0</h2>
          </div>

          <div className="space-y-3">
            {IMPROVING_1_0_ITEMS.map((entry) => (
              <div
                key={entry.title}
                className={`rounded-2xl p-3.5 space-y-1 ${
                  isKids ? 'bg-sky-50 border border-sky-200' : 'bg-white/5 border border-white/10'
                }`}
              >
                <div className="text-sm font-bold font-display">{entry.title}</div>
                <p className={`text-xs leading-relaxed ${isKids ? 'text-slate-600' : 'text-zinc-300'}`}>
                  {entry.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Docs Quick Reference + Feedback / Bug Report Form */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={`rounded-3xl p-6 space-y-4 ${cardClass}`}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            <h2 className="text-xl font-bold font-display">XEROTV Documentation</h2>
          </div>

          <div className="space-y-3 text-xs leading-relaxed">
            <div
              className={`rounded-2xl p-3.5 space-y-1 ${
                isKids ? 'bg-sky-50 border border-sky-200 text-slate-800' : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="font-bold text-sm">1. WebApp Shortcuts &amp; Offline Support</div>
              <p className={isKids ? 'text-slate-600' : 'text-zinc-300'}>
                Open <strong>Get Apps</strong> to install XEROTV as a standalone WebApp shortcut on Desktop, Android, or iOS. Long-press the app icon to jump straight into Offline Vault, Movies, or Docs even while offline.
              </p>
              <button type="button" onClick={onOpenVault} className="underline font-semibold cursor-pointer">
                Open Offline Vault
              </button>
            </div>

            <div
              className={`rounded-2xl p-3.5 space-y-1 ${
                isKids ? 'bg-sky-50 border border-sky-200 text-slate-800' : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="font-bold text-sm">2. Subscriptions &amp; Contact Developer</div>
              <p className={isKids ? 'text-slate-600' : 'text-zinc-300'}>
                Download Access (₱500 / 2 Months), 1TB Permanent Storage (₱1,090), and XEROSTAR VIP (₱150) require sending your unique UserID (<code className="font-mono">XTV-...</code>) directly to XIAN IN PRODUCTION via the Support Developer / Facebook button.
              </p>
            </div>

            <div
              className={`rounded-2xl p-3.5 space-y-1 ${
                isKids ? 'bg-sky-50 border border-sky-200 text-slate-800' : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="font-bold text-sm">3. Modes &amp; Christmas Lock</div>
              <p className={isKids ? 'text-slate-600' : 'text-zinc-300'}>
                Kids Mode enforces a Parental PIN and PG filters; 18+ Vault &amp; XeroHots use private Secret PINs; Christmas Mode stays locked until December 25 at 12:00 AM local time.
              </p>
            </div>
          </div>
        </div>

        {/* Feedback & Bug Report Form */}
        <form onSubmit={handleSubmitReport} className={`rounded-3xl p-6 space-y-4 ${cardClass}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {category === 'bug' ? <Bug className="w-5 h-5" /> : <MessageSquarePlus className="w-5 h-5" />}
              <h2 className="text-xl font-bold font-display">Feedback &amp; Report Bugs</h2>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                playClickFx();
                setCategory('feedback');
              }}
              className={`py-2 px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                category === 'feedback'
                  ? isKids
                    ? 'bg-sky-600 text-white'
                    : 'bg-white text-zinc-950'
                  : isKids
                    ? 'bg-sky-50 text-slate-700 hover:bg-sky-100'
                    : 'bg-white/10 opacity-75'
              }`}
            >
              Rate &amp; Feedback
            </button>
            <button
              type="button"
              onClick={() => {
                playClickFx();
                setCategory('bug');
              }}
              className={`py-2 px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                category === 'bug'
                  ? isKids
                    ? 'bg-sky-600 text-white'
                    : 'bg-white text-zinc-950'
                  : isKids
                    ? 'bg-sky-50 text-slate-700 hover:bg-sky-100'
                    : 'bg-white/10 opacity-75'
              }`}
            >
              Report a Bug
            </button>
          </div>

          {/* Real Star Rating (computes genuine Popularity %) */}
          <div className="space-y-1">
            <span className="text-xs opacity-75">Experience Rating (updates Live Popularity %)</span>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => {
                    playClickFx();
                    setRating(star);
                  }}
                  aria-label={`Rate ${star} out of 5`}
                  className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
                >
                  <Star
                    className={`w-5 h-5 ${
                      star <= rating ? 'fill-amber-400 text-amber-400' : 'text-zinc-500'
                    }`}
                  />
                </button>
              ))}
              <span className="text-xs font-mono ml-2">{rating}/5</span>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="report-title" className="block text-xs opacity-80">
              {category === 'bug' ? 'Bug Summary' : 'Feedback Headline'}
            </label>
            <input
              id="report-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                category === 'bug'
                  ? 'e.g. Video player buffer issue on mobile'
                  : 'e.g. Love the 3D Liquid Glass vault'
              }
              className={`w-full px-3.5 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 ${
                isKids
                  ? 'bg-sky-50 border border-sky-200 text-slate-900 focus:ring-sky-500'
                  : 'bg-black/45 border border-white/15 text-white focus:ring-white/40'
              }`}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="report-message" className="block text-xs opacity-80">
              Details
            </label>
            <textarea
              id="report-message"
              required
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your experience, device, or steps to reproduce..."
              className={`w-full px-3.5 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 ${
                isKids
                  ? 'bg-sky-50 border border-sky-200 text-slate-900 focus:ring-sky-500'
                  : 'bg-black/45 border border-white/15 text-white focus:ring-white/40'
              }`}
            />
          </div>

          {submitStatus && (
            <p
              role="status"
              className={`text-xs font-medium flex items-center gap-1.5 ${
                submitStatus.ok ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {submitStatus.ok && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              <span>{submitStatus.text}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`w-full py-3 rounded-xl text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-50 ${
              isKids
                ? 'bg-sky-600 text-white hover:bg-sky-700'
                : 'bg-white text-zinc-950 hover:bg-zinc-200'
            }`}
          >
            {submitting ? 'Submitting...' : category === 'bug' ? 'Submit Bug Report' : 'Submit Feedback'}
          </button>
        </form>
      </section>
    </div>
  );
};
