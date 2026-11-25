import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  Gift,
  HardDrive,
  Lock,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  ShieldCheck,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import {
  formatLocalAuthError,
  loginBuiltInAccount,
  redeemPromoCode,
  registerBuiltInAccount,
  signOutUser,
  type AuthUser,
  type FormattedAuthError,
} from '../lib/authClient';
import {
  getBotVerifiedToken,
  isBotVerifiedThisSession,
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

type AuthModeTab = 'signin' | 'register';

interface AccountModalProps {
  open: boolean;
  user: AuthUser | null;
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
  const [redeemBusy, setRedeemBusy] = useState(false);

  // Built-in Auth Form State (Zero External APIs)
  const [authTab, setAuthTab] = useState<AuthModeTab>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<FormattedAuthError | null>(null);

  // Inline "You're Not a Bot" Security Check
  const [botVerified, setBotVerified] = useState<boolean>(() => isBotVerifiedThisSession());
  const [challengeQuestion, setChallengeQuestion] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [botAnswer, setBotAnswer] = useState('');

  const loadBotChallenge = async () => {
    setBotAnswer('');
    try {
      const res = await fetch('/api/security/bot-challenge', { cache: 'no-store' });
      const data = await res.json();
      setChallengeQuestion(data.question || 'Human Check: What is 3 + 4?');
      setChallengeToken(data.challengeToken || '');
    } catch {
      setChallengeQuestion('Unable to load human verification check.');
      setChallengeToken('');
    }
  };

  useEffect(() => {
    if (!open || user) return;
    const already = isBotVerifiedThisSession();
    setBotVerified(already);
    setAuthError(null);
    if (!already) {
      void loadBotChallenge();
    }
  }, [open, user]);

  if (!open) return null;

  const handleSwitchTab = (tab: AuthModeTab) => {
    playClickFx();
    setAuthTab(tab);
    setAuthError(null);
  };

  const handleSignOut = () => {
    playClickFx();
    setAuthTab('signin');
    setDisplayName('');
    setEmail('');
    setIdentifier('');
    setPassword('');
    setConfirmPassword('');
    setAuthError(null);
    setRedeemStatus(null);
    void signOutUser();
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);

    const existingBotToken = getBotVerifiedToken();

    try {
      if (authTab === 'register') {
        await registerBuiltInAccount({
          displayName,
          email,
          password,
          confirmPassword,
          botToken: existingBotToken,
          challengeToken: existingBotToken ? undefined : challengeToken,
          botAnswer: existingBotToken ? undefined : botAnswer,
        });
      } else {
        await loginBuiltInAccount({
          identifier,
          password,
          botToken: existingBotToken,
          challengeToken: existingBotToken ? undefined : challengeToken,
          botAnswer: existingBotToken ? undefined : botAnswer,
        });
      }
      playUnlockFx();
      setBotVerified(true);
      setPassword('');
      setConfirmPassword('');
      setBotAnswer('');
    } catch (err) {
      playErrorFx();
      const typed = err as { code?: string };
      setAuthError(formatLocalAuthError(err, typed?.code));
      if (!existingBotToken || typed?.code === 'auth/bot-check-failed') {
        setBotVerified(false);
        void loadBotChallenge();
      }
    } finally {
      setAuthBusy(false);
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
      const res = await redeemPromoCode(promoCode);
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
      <div className="w-full max-w-2xl liquid-glass-strong rounded-2xl p-6 sm:p-8 text-white space-y-6 my-auto max-h-[90vh] overflow-y-auto border border-white/15">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="account-modal-title" className="text-2xl font-bold font-display">
              XEROTV Account &amp; Subscriptions
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Sign in or create your built-in XEROTV account to get your UserID, redeem codes, and unlock offline downloads.
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
          <div className="rounded-2xl bg-white/5 border border-white/10 p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                  <Shield className="w-5 h-5 text-zinc-200" />
                </div>
                <div>
                  <h3 className="text-base font-bold font-display">
                    {authTab === 'signin' ? 'Sign In to XEROTV' : 'Create XEROTV Account'}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Built-in XEROTV authentication — no external apps or API keys required.
                  </p>
                </div>
              </div>

              <div className="inline-flex shrink-0 rounded-xl bg-black/50 border border-white/15 p-1 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => handleSwitchTab('signin')}
                  data-testid="auth-tab-signin"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    authTab === 'signin'
                      ? 'bg-white text-zinc-950'
                      : 'text-zinc-300 hover:text-white'
                  }`}
                >
                  <LogIn className="w-3.5 h-3.5 shrink-0" />
                  <span>Sign In</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchTab('register')}
                  data-testid="auth-tab-register"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    authTab === 'register'
                      ? 'bg-white text-zinc-950'
                      : 'text-zinc-300 hover:text-white'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5 shrink-0" />
                  <span>Create Account</span>
                </button>
              </div>
            </div>

            {authError && (
              <div
                role="alert"
                className="rounded-xl bg-rose-500/15 border border-rose-400/35 px-4 py-3 text-xs text-rose-200"
              >
                {authError.message}
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              {authTab === 'register' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="auth-display-name" className="block text-xs font-medium text-zinc-300">
                        Display Name / Username
                      </label>
                      <div className="relative">
                        <User className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          id="auth-display-name"
                          type="text"
                          required
                          minLength={2}
                          maxLength={50}
                          value={displayName}
                          onChange={(e) => {
                            playTypingFx();
                            setDisplayName(e.target.value);
                          }}
                          placeholder="e.g. Xian"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/40"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="auth-register-email" className="block text-xs font-medium text-zinc-300">
                        Email Address
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          id="auth-register-email"
                          type="email"
                          required
                          value={email}
                          onChange={(e) => {
                            playTypingFx();
                            setEmail(e.target.value);
                          }}
                          placeholder="you@example.com"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/40"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="auth-register-password" className="block text-xs font-medium text-zinc-300">
                        Password (6+ chars)
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          id="auth-register-password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          maxLength={128}
                          value={password}
                          onChange={(e) => {
                            playTypingFx();
                            setPassword(e.target.value);
                          }}
                          placeholder="Create a password"
                          className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/40"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="p-1 text-zinc-400 hover:text-white absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="auth-register-confirm" className="block text-xs font-medium text-zinc-300">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          id="auth-register-confirm"
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          maxLength={128}
                          value={confirmPassword}
                          onChange={(e) => {
                            playTypingFx();
                            setConfirmPassword(e.target.value);
                          }}
                          placeholder="Repeat password"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/40"
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="auth-login-identifier" className="block text-xs font-medium text-zinc-300">
                      Email, Username, or UserID
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="auth-login-identifier"
                        type="text"
                        required
                        value={identifier}
                        onChange={(e) => {
                          playTypingFx();
                          setIdentifier(e.target.value);
                        }}
                        placeholder="you@example.com or XTV-..."
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/40"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="auth-login-password" className="block text-xs font-medium text-zinc-300">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="auth-login-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => {
                          playTypingFx();
                          setPassword(e.target.value);
                        }}
                        placeholder="Enter your password"
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/40"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="p-1 text-zinc-400 hover:text-white absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Compact Inline Human Verification */}
              {!botVerified ? (
                <div className="rounded-xl bg-black/40 border border-white/15 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                      <ShieldCheck className="w-4 h-4" />
                      <span>You&apos;re Not a Bot Check</span>
                      <button
                        type="button"
                        onClick={() => void loadBotChallenge()}
                        aria-label="New human verification challenge"
                        className="p-1 text-zinc-400 hover:text-white cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-xs font-mono text-zinc-200">
                      {challengeQuestion || 'Loading challenge...'}
                    </div>
                  </div>
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
                    className="sm:w-32 px-3 py-2 rounded-lg bg-zinc-900 border border-white/15 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                  />
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Human Check Verified for Session</span>
                </div>
              )}

              <button
                type="submit"
                disabled={authBusy || (!botVerified && !challengeToken)}
                data-testid="auth-submit-btn"
                className="w-full py-3 rounded-xl bg-white text-zinc-950 text-sm font-bold hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
              >
                {authBusy
                  ? authTab === 'register'
                    ? 'Creating Account...'
                    : 'Signing In...'
                  : authTab === 'register'
                    ? 'Create Account & Generate UserID'
                    : 'Sign In to XEROTV'}
              </button>
            </form>
          </div>
        ) : !account ? (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-6 space-y-4 text-center">
            <RefreshCw className="w-8 h-8 mx-auto text-zinc-300 animate-spin" />
            <div className="space-y-1">
              <div className="text-base font-bold font-display">Syncing Your XEROTV Account</div>
              <p className="text-xs text-zinc-400">
                Signed in as {user.email || user.displayName}. Loading subscription profile...
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
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
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold truncate">{user.displayName || 'XEROTV Member'}</span>
                  <span className="text-[11px] uppercase font-mono text-zinc-400">
                    · XEROTV ID
                  </span>
                </div>
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
                  onClick={handleSignOut}
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

              <div className="rounded-2xl bg-white/5 border border-white/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-zinc-300 leading-relaxed">
                  To activate Download Access, 1TB Storage, or XEROSTAR VIP, send your UserID{' '}
                  <code className="font-mono text-white">{account.shortUserId}</code> to XIAN IN PRODUCTION.
                </p>
                <a
                  href={DEV_FACEBOOK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-zinc-950 text-xs font-semibold hover:bg-zinc-200 transition-colors shrink-0"
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
