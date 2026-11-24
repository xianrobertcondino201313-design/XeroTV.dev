import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Flame,
  Gift,
  HardDrive,
  LogIn,
  LogOut,
  RefreshCw,
  Shield,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  formatFirebaseAuthError,
  redeemPromoCodeInFirestore,
  signInWithGoogle,
  signOutUser,
  type FormattedAuthError,
} from '../lib/firebase';
import {
  isBotVerifiedThisSession,
  saveBotVerifiedSession,
} from '../utils/security';
import { playClickFx, playErrorFx, playTypingFx, playUnlockFx } from '../utils/soundFx';
import {
  formatBytes,
  isDownloadAccessActive,
  isXeroStarActive,
  SUBSCRIPTION_PLANS,
  type UserSubscriptionState,
} from '../utils/subscription';

const DEV_FACEBOOK_URL = 'https://web.facebook.com/share/p/1E7E6y8HAD/';

interface AccountModalProps {
  open: boolean;
  user: User | null;
  account: UserSubscriptionState | null;
  onClose: () => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  open,
  user,
  account,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [redeemStatus, setRedeemStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<FormattedAuthError | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [redeemBusy, setRedeemBusy] = useState(false);

  // "You're Not a Bot" Security Check state
  const [botVerified, setBotVerified] = useState<boolean>(() => isBotVerifiedThisSession());
  const [challengeQuestion, setChallengeQuestion] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [botAnswer, setBotAnswer] = useState('');
  const [botBusy, setBotBusy] = useState(false);
  const [botError, setBotError] = useState('');

  const loadBotChallenge = async () => {
    setBotError('');
    setBotAnswer('');
    try {
      const res = await fetch('/api/security/bot-challenge', { cache: 'no-store' });
      const data = await res.json();
      setChallengeQuestion(data.question || 'Verify human: 3 + 4 = ?');
      setChallengeToken(data.challengeToken || '');
    } catch {
      setBotError('Unable to reach verification server.');
    }
  };

  useEffect(() => {
    if (!open || user) return;
    const already = isBotVerifiedThisSession();
    setBotVerified(already);
    if (!already) {
      void loadBotChallenge();
    }
  }, [open, user]);

  if (!open) return null;

  const handleVerifyBot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBotError('');
    setBotBusy(true);
    try {
      const res = await fetch('/api/security/bot-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, answer: botAnswer }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified || !data.botToken) {
        playErrorFx();
        setBotError(data.error || 'Verification failed.');
        await loadBotChallenge();
        return;
      }
      playUnlockFx();
      saveBotVerifiedSession(data.botToken);
      setBotVerified(true);
    } catch {
      playErrorFx();
      setBotError('Verification request failed.');
    } finally {
      setBotBusy(false);
    }
  };

  const handleGoogleAuth = async () => {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    if (!botVerified) {
      setAuthError({
        code: 'security/bot-required',
        message: 'Please complete the human verification check first.',
        isUnauthorizedDomain: false,
        hostname: host,
      });
      return;
    }
    setAuthError(null);
    setAuthBusy(true);
    try {
      await signInWithGoogle();
      playUnlockFx();
    } catch (err) {
      playErrorFx();
      setAuthError(formatFirebaseAuthError(err, host));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCopyBlockedDomain = async (domain: string) => {
    if (!domain) return;
    playClickFx();
    try {
      await navigator.clipboard.writeText(domain);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleCopyUserId = async () => {
    if (!account?.shortUserId) return;
    playClickFx();
    await navigator.clipboard.writeText(account.shortUserId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;
    setRedeemStatus(null);
    setRedeemBusy(true);
    try {
      const res = await redeemPromoCodeInFirestore(account, promoCode);
      if (res.ok) {
        playUnlockFx();
        setRedeemStatus({ ok: true, text: res.message });
        setPromoCode('');
      } else {
        playErrorFx();
        setRedeemStatus({ ok: false, text: res.error });
      }
    } catch (err) {
      playErrorFx();
      setRedeemStatus({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to redeem code.',
      });
    } finally {
      setRedeemBusy(false);
    }
  };

  const downloadActive = isDownloadAccessActive(account);
  const xerostarActive = isXeroStarActive(account);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto"
    >
      <div className="w-full max-w-2xl liquid-glass-strong rounded-3xl p-6 sm:p-8 text-white space-y-6 my-auto max-h-[90vh] overflow-y-auto border border-white/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="account-modal-title" className="text-2xl font-bold font-display">
              XEROTV Account &amp; Subscriptions
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Sign in with Google to generate your UserID, redeem codes, and activate offline downloads.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account modal"
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!user ? (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-6 space-y-5">
            <div className="text-center space-y-2">
              <Shield className="w-10 h-10 mx-auto text-zinc-300" />
              <h3 className="text-lg font-bold font-display">Protected Authentication</h3>
              <p className="text-sm text-zinc-400 max-w-md mx-auto">
                Complete human verification below to unlock Google Sign-In and receive your unique XEROTV UserID.
              </p>
            </div>

            {!botVerified ? (
              <form
                onSubmit={handleVerifyBot}
                className="max-w-sm mx-auto rounded-2xl bg-black/40 border border-white/15 p-4 space-y-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>You&apos;re Not a Bot Verification</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadBotChallenge()}
                    aria-label="New human verification challenge"
                    className="p-1 text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="text-sm font-mono font-semibold text-zinc-100">
                  {challengeQuestion || 'Loading challenge...'}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={botAnswer}
                    onChange={(e) => {
                      playTypingFx();
                      setBotAnswer(e.target.value);
                    }}
                    placeholder="Answer..."
                    aria-label="Human verification answer"
                    className="flex-1 px-3 py-2 rounded-xl bg-zinc-900 border border-white/15 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                  />
                  <button
                    type="submit"
                    disabled={botBusy || !challengeToken}
                    className="px-4 py-2 rounded-xl bg-white text-zinc-950 text-xs font-bold hover:bg-zinc-200 cursor-pointer disabled:opacity-50"
                  >
                    {botBusy ? 'Checking...' : 'Verify Human'}
                  </button>
                </div>

                {botError && (
                  <p className="text-xs text-rose-400" role="alert">
                    {botError}
                  </p>
                )}
              </form>
            ) : (
              <div className="text-center space-y-4">
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verified Human · Auth Unlocked</span>
                </div>

                {authError && (
                  <div
                    role="alert"
                    className="max-w-md mx-auto rounded-2xl bg-rose-500/15 border border-rose-400/35 p-4 text-left space-y-2.5"
                  >
                    <div className="text-xs font-bold text-rose-300">
                      {authError.isUnauthorizedDomain
                        ? 'Action Required: Authorize This Vercel Domain in Firebase'
                        : 'Google Sign-In Notice'}
                    </div>
                    <p className="text-xs text-rose-100 leading-relaxed">{authError.message}</p>
                    {authError.isUnauthorizedDomain && authError.hostname && (
                      <div className="space-y-2 pt-1">
                        <p className="text-[11px] text-zinc-300">
                          Copy the hostname below and add it under{' '}
                          <span className="font-semibold text-white">
                            Firebase Console &rarr; Authentication &rarr; Settings &rarr; Authorized domains
                          </span>
                          . You can continue streaming freely as a guest meanwhile.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/15 font-mono text-[11px] text-white truncate max-w-full">
                            {authError.hostname}
                          </code>
                          <button
                            type="button"
                            onClick={() => void handleCopyBlockedDomain(authError.hostname)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white text-zinc-950 text-[11px] font-semibold cursor-pointer hover:bg-zinc-200"
                          >
                            {copiedDomain ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedDomain ? 'Copied' : 'Copy Domain'}</span>
                          </button>
                          <a
                            href="https://console.firebase.google.com/project/gen-lang-client-0171219951/authentication/settings"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/15 text-white text-[11px] font-semibold hover:bg-white/25"
                          >
                            <span>Open Firebase Settings</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={handleGoogleAuth}
                    className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{authBusy ? 'Connecting Google...' : 'Continue with Google'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : !account ? (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-6 space-y-4 text-center">
            <RefreshCw className="w-8 h-8 mx-auto text-zinc-300 animate-spin" />
            <div className="space-y-1">
              <div className="text-base font-bold font-display">Syncing Your XEROTV Account</div>
              <p className="text-xs text-zinc-400">
                Signed in as {user.email || user.displayName || 'Google Member'}. Connecting to Cloud Firestore...
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                playClickFx();
                void signOutUser();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 text-xs font-semibold text-zinc-300 hover:bg-white/10 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Identity & Copyable UserID */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <div className="text-sm font-semibold truncate">{user.displayName || 'XEROTV Member'}</div>
                <div className="text-xs text-zinc-400 truncate">{user.email}</div>
                <div className="pt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-400">Your UserID:</span>
                  <code className="px-2.5 py-1 rounded-lg bg-black/50 border border-white/15 font-mono text-xs font-semibold tracking-wider text-white">
                    {account.shortUserId}
                  </code>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyUserId}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-zinc-950 text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy UserID'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playClickFx();
                    void signOutUser();
                  }}
                  aria-label="Sign out"
                  className="p-2 rounded-xl border border-white/15 text-zinc-300 hover:bg-white/10 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Active Plan Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 tabular-nums">
              <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-1">
                <div className="text-xs text-zinc-400">Offline Download Access</div>
                <div className="text-base font-bold font-display">
                  {downloadActive ? 'Active' : 'Locked (Free Tier)'}
                </div>
                <div className="text-xs text-zinc-400">
                  {downloadActive && account.downloadExpiresAtMs > 0
                    ? `Expires ${new Date(account.downloadExpiresAtMs).toLocaleString()}`
                    : 'Buy ₱500 / 2 Months or redeem code'}
                </div>
              </div>

              <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-1">
                <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Vault Storage Quota</span>
                </div>
                <div className="text-base font-bold font-display">
                  {formatBytes(account.storageUsedBytes)} / {formatBytes(account.storageQuotaBytes)}
                </div>
                <div className="text-xs text-zinc-400">
                  {account.storageTier === 'permanent_1tb'
                    ? '1TB Permanent Plan Active'
                    : account.storageTier === 'bonus_2gb'
                      ? 'Bonus Storage Active'
                      : 'No Storage Allocated Yet'}
                </div>
              </div>

              <div className="rounded-2xl bg-rose-500/10 border border-rose-400/25 p-4 space-y-1">
                <div className="text-xs text-rose-300 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5" />
                  <span>XEROSTAR VIP (XeroHots)</span>
                </div>
                <div className="text-base font-bold font-display">
                  {xerostarActive ? 'VIP Active' : 'Locked (₱150)'}
                </div>
                <div className="text-xs text-zinc-400">
                  {xerostarActive && account.xerostarExpiresAtMs
                    ? `Expires ${new Date(account.xerostarExpiresAtMs).toLocaleString()}`
                    : '30 Days PIN-locked XeroHots access'}
                </div>
              </div>
            </div>

            {/* Code Redeemer */}
            <form
              onSubmit={handleRedeem}
              className="rounded-2xl bg-white/5 border border-white/10 p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Gift className="w-4 h-4" />
                <span>Redeem Promo Code</span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Redeem <code className="font-mono text-white">VER-1-0XEROTV</code> (+20 Days Download Access &amp; +5GB Storage),{' '}
                <code className="font-mono text-white">NEWUSER2026</code> (+2 Days &amp; +2GB), or any admin-generated code.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <label htmlFor="redeem-code-input" className="sr-only">
                  Promo code
                </label>
                <input
                  id="redeem-code-input"
                  type="text"
                  value={promoCode}
                  onChange={(e) => {
                    playTypingFx();
                    setPromoCode(e.target.value.toUpperCase());
                  }}
                  placeholder="Enter code (e.g. VER-1-0XEROTV)"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm font-mono text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/40"
                />
                <button
                  type="submit"
                  disabled={redeemBusy}
                  className="px-5 py-2.5 rounded-xl bg-white text-zinc-950 text-xs font-semibold hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {redeemBusy ? 'Redeeming...' : 'Redeem Code'}
                </button>
              </div>
              {redeemStatus && (
                <p
                  role="status"
                  className={`text-xs font-medium ${
                    redeemStatus.ok ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {redeemStatus.text}
                </p>
              )}
            </form>

            {/* Real Subscription Plans + Developer Payment Contact */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Official Subscriptions (Direct Developer Payment)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
                  <div className="text-xs text-zinc-400">{SUBSCRIPTION_PLANS.DOWNLOAD_2M.durationLabel}</div>
                  <div className="text-lg font-bold font-display">
                    ₱{SUBSCRIPTION_PLANS.DOWNLOAD_2M.pricePesos} Pesos
                  </div>
                  <div className="text-xs font-semibold text-white">
                    {SUBSCRIPTION_PLANS.DOWNLOAD_2M.name}
                  </div>
                  <p className="text-xs text-zinc-400">{SUBSCRIPTION_PLANS.DOWNLOAD_2M.description}</p>
                </div>

                <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
                  <div className="text-xs text-zinc-400">{SUBSCRIPTION_PLANS.STORAGE_1TB.durationLabel}</div>
                  <div className="text-lg font-bold font-display">
                    ₱{SUBSCRIPTION_PLANS.STORAGE_1TB.pricePesos} Pesos
                  </div>
                  <div className="text-xs font-semibold text-white">
                    {SUBSCRIPTION_PLANS.STORAGE_1TB.name}
                  </div>
                  <p className="text-xs text-zinc-400">{SUBSCRIPTION_PLANS.STORAGE_1TB.description}</p>
                </div>

                <div className="rounded-2xl bg-rose-500/10 border border-rose-400/25 p-4 space-y-2">
                  <div className="text-xs text-rose-300">{SUBSCRIPTION_PLANS.XEROSTAR.durationLabel}</div>
                  <div className="text-lg font-bold font-display">
                    ₱{SUBSCRIPTION_PLANS.XEROSTAR.pricePesos} Pesos
                  </div>
                  <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-rose-400" />
                    <span>{SUBSCRIPTION_PLANS.XEROSTAR.name}</span>
                  </div>
                  <p className="text-xs text-zinc-300">{SUBSCRIPTION_PLANS.XEROSTAR.description}</p>
                </div>
              </div>

              <div className="rounded-2xl bg-white/10 border border-white/15 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-zinc-300 leading-relaxed">
                  Copy your UserID (<span className="font-mono font-semibold text-white">{account.shortUserId}</span>) and message
                  the developer on Facebook to arrange payment and instant account activation.
                </div>
                <a
                  href={DEV_FACEBOOK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-zinc-950 text-xs font-semibold whitespace-nowrap shrink-0 hover:bg-zinc-200 transition-colors"
                >
                  <span>Contact Developer</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
