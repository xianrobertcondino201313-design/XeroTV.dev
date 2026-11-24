import type { ProfileMode } from '../utils/modes';
import { formatLocalAuthError, type FormattedAuthError } from '../utils/authError';
import type { AuthUser } from '../utils/authHelpers';
import { sanitizePlainText, sanitizePromoCode, saveBotVerifiedSession } from '../utils/security';
import {
  ONE_GB_BYTES,
  type AdminGrantType,
  type CustomPromoDefinition,
  type UserSubscriptionState,
} from '../utils/subscription';

export type { AuthUser, FormattedAuthError };
export { formatLocalAuthError };

export interface AuthSessionSnapshot {
  user: AuthUser | null;
  account: UserSubscriptionState | null;
}

export interface HonestPlatformPulse {
  registeredUsers: number | null;
  onlineUsers: number;
  totalEarningsPesos: number;
  popularityPct: number | null;
  ratingCount: number;
}

export interface FeedbackReportItem {
  id: string;
  category: 'feedback' | 'bug';
  rating: number;
  title: string;
  message: string;
  appVersion: string;
  status: 'open' | 'resolved';
  createdAtMs?: number;
}

// Keep session bearer token strictly in JS memory (never localStorage/sessionStorage)
let inMemoryAuthToken: string | null = null;
let currentSnapshot: AuthSessionSnapshot = { user: null, account: null };
const authListeners = new Set<(snapshot: AuthSessionSnapshot) => void>();

function notifyAuthListeners(next: AuthSessionSnapshot) {
  currentSnapshot = next;
  for (const listener of authListeners) {
    try {
      listener(next);
    } catch {
      // isolate subscriber errors
    }
  }
}

export function subscribeAuthState(listener: (snapshot: AuthSessionSnapshot) => void): () => void {
  authListeners.add(listener);
  listener(currentSnapshot);
  return () => {
    authListeners.delete(listener);
  };
}

function authRequestHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XEROTV',
    ...extra,
  };
  if (inMemoryAuthToken) {
    headers.Authorization = `Bearer ${inMemoryAuthToken}`;
  }
  return headers;
}

export async function refreshAuthSession(tokenOverride?: string): Promise<AuthSessionSnapshot> {
  if (tokenOverride) {
    inMemoryAuthToken = tokenOverride;
  }
  try {
    const res = await fetch('/api/auth/me', {
      credentials: 'include',
      cache: 'no-store',
      headers: authRequestHeaders(),
    });
    if (!res.ok) {
      return currentSnapshot;
    }
    const data = (await res.json()) as {
      authenticated?: boolean;
      user?: AuthUser | null;
      account?: UserSubscriptionState | null;
      token?: string;
    };
    if (data.authenticated && data.user && data.account) {
      if (data.token) {
        inMemoryAuthToken = data.token;
      }
      const next = { user: data.user, account: data.account };
      notifyAuthListeners(next);
      return next;
    }
    inMemoryAuthToken = null;
    const empty = { user: null, account: null };
    notifyAuthListeners(empty);
    return empty;
  } catch {
    return currentSnapshot;
  }
}

export async function registerBuiltInAccount(params: {
  displayName: string;
  email: string;
  password: string;
  confirmPassword?: string;
  botToken?: string | null;
  challengeToken?: string;
  botAnswer?: string;
}): Promise<AuthSessionSnapshot> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'include',
    headers: authRequestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    code?: string;
    error?: string;
    user?: AuthUser;
    account?: UserSubscriptionState;
    token?: string;
    botToken?: string;
  };
  if (!res.ok || !data.ok || !data.user || !data.account) {
    throw Object.assign(new Error(data.error || 'Unable to create account.'), {
      code: data.code || 'auth/error',
    });
  }
  if (data.botToken) {
    saveBotVerifiedSession(data.botToken);
  }
  if (data.token) {
    inMemoryAuthToken = data.token;
  }
  const snap = { user: data.user, account: data.account };
  notifyAuthListeners(snap);
  return snap;
}

export async function loginBuiltInAccount(params: {
  identifier: string;
  password: string;
  botToken?: string | null;
  challengeToken?: string;
  botAnswer?: string;
}): Promise<AuthSessionSnapshot> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: authRequestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    code?: string;
    error?: string;
    user?: AuthUser;
    account?: UserSubscriptionState;
    token?: string;
    botToken?: string;
  };
  if (!res.ok || !data.ok || !data.user || !data.account) {
    throw Object.assign(new Error(data.error || 'Sign-in failed.'), {
      code: data.code || 'auth/error',
    });
  }
  if (data.botToken) {
    saveBotVerifiedSession(data.botToken);
  }
  if (data.token) {
    inMemoryAuthToken = data.token;
  }
  const snap = { user: data.user, account: data.account };
  notifyAuthListeners(snap);
  return snap;
}

export async function signOutUser(): Promise<void> {
  inMemoryAuthToken = null;
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: authRequestHeaders({ 'Content-Type': 'application/json' }),
  }).catch(() => {});
  notifyAuthListeners({ user: null, account: null });
}

export async function redeemPromoCode(
  rawCode: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const code = sanitizePromoCode(rawCode);
  if (!code) {
    return { ok: false, error: 'Please enter a valid promo code.' };
  }
  const res = await fetch('/api/account/redeem', {
    method: 'POST',
    credentials: 'include',
    headers: authRequestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    message?: string;
    error?: string;
    user?: AuthUser;
    account?: UserSubscriptionState;
    token?: string;
  };
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error || 'Failed to redeem promo code.' };
  }
  if (data.token) inMemoryAuthToken = data.token;
  if (data.user && data.account) {
    notifyAuthListeners({ user: data.user, account: data.account });
  } else {
    await refreshAuthSession();
  }
  return { ok: true, message: data.message || `Code ${code} redeemed.` };
}

export async function saveUserPinHash(
  kind: 'kids' | 'adult' | 'hots',
  pinHash: string,
): Promise<void> {
  const res = await fetch('/api/account/pin', {
    method: 'POST',
    credentials: 'include',
    headers: authRequestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ kind, pinHash }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    account?: UserSubscriptionState;
    token?: string;
  };
  if (res.ok && data.ok) {
    if (data.token) inMemoryAuthToken = data.token;
    if (data.account && currentSnapshot.user) {
      notifyAuthListeners({ user: currentSnapshot.user, account: data.account });
    }
  }
}

export async function syncStorageUsed(storageUsedBytes: number): Promise<void> {
  const res = await fetch('/api/account/storage', {
    method: 'POST',
    credentials: 'include',
    headers: authRequestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ storageUsedBytes: Math.max(0, Math.round(storageUsedBytes)) }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    account?: UserSubscriptionState;
    token?: string;
  };
  if (res.ok && data.ok) {
    if (data.token) inMemoryAuthToken = data.token;
    if (data.account && currentSnapshot.user) {
      notifyAuthListeners({ user: currentSnapshot.user, account: data.account });
    }
  }
}

// -----------------------------------------------------------------------------
// Admin Console API Helpers (Authenticated via Admin Verification Token)
// -----------------------------------------------------------------------------
function adminHeaders(adminToken: string | null, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    'X-Requested-With': 'XEROTV',
    ...extra,
  };
  if (adminToken) h.Authorization = `Bearer ${adminToken}`;
  return h;
}

export async function adminFetchUsersList(adminToken: string | null): Promise<UserSubscriptionState[]> {
  const res = await fetch('/api/admin/users', {
    credentials: 'include',
    cache: 'no-store',
    headers: adminHeaders(adminToken),
  });
  const data = (await res.json()) as { users?: UserSubscriptionState[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load user directory.');
  }
  return data.users || [];
}

export async function adminGrantSubscriptionByUserId(
  adminToken: string | null,
  inputUserId: string,
  grantType: AdminGrantType,
  customDays: number = 30,
): Promise<{
  targetUid: string;
  shortUserId: string;
  amountPesos: number;
  patch: Partial<UserSubscriptionState> & {
    downloadTier: UserSubscriptionState['downloadTier'];
    storageQuotaBytes: number;
    xerostarActive?: boolean;
  };
}> {
  const res = await fetch('/api/admin/grant', {
    method: 'POST',
    credentials: 'include',
    headers: adminHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ userId: inputUserId.trim(), grantType, customDays }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to grant subscription.');
  }
  if (currentSnapshot.user && currentSnapshot.user.uid === data.targetUid) {
    await refreshAuthSession();
  }
  return data;
}

export async function adminListPromoCodes(adminToken: string | null): Promise<CustomPromoDefinition[]> {
  const res = await fetch('/api/admin/promos', {
    credentials: 'include',
    cache: 'no-store',
    headers: adminHeaders(adminToken),
  });
  const data = (await res.json()) as { promos?: CustomPromoDefinition[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load promo codes.');
  }
  return data.promos || [];
}

export async function adminCreatePromoCode(
  adminToken: string | null,
  params: { code: string; daysGranted: number; storageBonusGb: number },
): Promise<CustomPromoDefinition> {
  const code = sanitizePromoCode(params.code);
  if (code.length < 3) {
    throw new Error('Promo code must be at least 3 characters (A-Z, 0-9, -, _).');
  }
  const daysGranted = Math.max(0, Math.min(3650, Math.floor(params.daysGranted || 0)));
  const storageBonusGb = Math.max(0, Math.min(1024, Math.floor(params.storageBonusGb || 0)));
  const res = await fetch('/api/admin/promos', {
    method: 'POST',
    credentials: 'include',
    headers: adminHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code, daysGranted, storageBonusGb }),
  });
  const data = (await res.json()) as { promo?: CustomPromoDefinition; error?: string };
  if (!res.ok || !data.promo) {
    throw new Error(
      data.error ||
        `Unable to create promo code (+${daysGranted}d / ${storageBonusGb * ONE_GB_BYTES} bytes).`,
    );
  }
  return data.promo;
}

export async function adminTogglePromoCode(adminToken: string | null, code: string, active: boolean) {
  const res = await fetch(`/api/admin/promos/${encodeURIComponent(sanitizePromoCode(code))}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: adminHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ active }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || 'Failed to update promo status.');
  }
}

export async function adminDeletePromoCode(adminToken: string | null, code: string) {
  const res = await fetch(`/api/admin/promos/${encodeURIComponent(sanitizePromoCode(code))}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: adminHeaders(adminToken),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || 'Failed to delete promo code.');
  }
}

export async function adminSetFeedbackStatus(
  adminToken: string | null,
  reportId: string,
  status: 'open' | 'resolved',
) {
  const res = await fetch(`/api/admin/feedback/${encodeURIComponent(reportId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: adminHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || 'Failed to update feedback status.');
  }
}

// -----------------------------------------------------------------------------
// Honest Platform Metrics (Live Online Presence, Earnings, Ratings/Popularity)
// -----------------------------------------------------------------------------
export function getOrCreatePresenceSessionId(): string {
  const KEY = 'xtv_presence_session_id';
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing && /^[a-zA-Z0-9_-]{6,64}$/.test(existing)) return existing;
    const next = `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(KEY, next);
    return next;
  } catch {
    return `ses_${Date.now().toString(36)}`;
  }
}

export async function upsertPresenceHeartbeat(mode: ProfileMode): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const sessionId = getOrCreatePresenceSessionId();
  try {
    await fetch('/api/platform/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, mode }),
    });
  } catch {
    // non-fatal when offline
  }
}

export async function fetchHonestPlatformPulse(): Promise<HonestPlatformPulse> {
  try {
    const res = await fetch('/api/platform/pulse', { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('Pulse endpoint failed');
    }
    return (await res.json()) as HonestPlatformPulse;
  } catch {
    return {
      registeredUsers: null,
      onlineUsers: 1,
      totalEarningsPesos: 0,
      popularityPct: null,
      ratingCount: 0,
    };
  }
}

export async function submitFeedbackReport(params: {
  category: 'feedback' | 'bug';
  rating: number;
  title: string;
  message: string;
}): Promise<FeedbackReportItem> {
  const cleanTitle = sanitizePlainText(params.title, 120);
  const cleanMessage = sanitizePlainText(params.message, 800);
  if (cleanTitle.length < 2 || cleanMessage.length < 4) {
    throw new Error('Please provide a clear title and description.');
  }
  const rating = Math.max(1, Math.min(5, Math.round(params.rating || 5)));

  const res = await fetch('/api/platform/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: params.category,
      rating,
      title: cleanTitle,
      message: cleanMessage,
    }),
  });
  const data = (await res.json()) as { report?: FeedbackReportItem; error?: string };
  if (!res.ok || !data.report) {
    throw new Error(data.error || 'Unable to submit feedback report.');
  }
  return data.report;
}

export async function fetchFeedbackReports(): Promise<FeedbackReportItem[]> {
  try {
    const res = await fetch('/api/platform/feedback', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { reports?: FeedbackReportItem[] };
    return data.reports || [];
  } catch {
    return [];
  }
}
