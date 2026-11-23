import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromCache,
  getDocFromServer,
  getDocs,
  getFirestore,
  initializeFirestore,
  limit,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { ProfileMode } from '../utils/modes';
import { sanitizePlainText, sanitizePromoCode } from '../utils/security';
import {
  BUILT_IN_PROMO_CODES,
  calculateAdminGrantUpdate,
  calculateGrantAmountPesos,
  calculateRedemptionUpdate,
  formatBytes,
  generateShortUserId,
  ONE_GB_BYTES,
  type AdminGrantType,
  type CustomPromoDefinition,
  type UserSubscriptionState,
} from '../utils/subscription';

const app = initializeApp(firebaseConfig);

function initResilientFirestore() {
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId,
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = initResilientFirestore();
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function isTransientOfflineFirestoreError(error: unknown): boolean {
  if (!error) return false;
  const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    code === 'unavailable' ||
    msg.includes('client is offline') ||
    msg.includes('failed to get document because') ||
    msg.includes('network')
  );
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore backend temporarily unreachable; waiting for network recovery.');
    }
  }
}
void testConnection();

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutUser() {
  return signOut(auth);
}

export async function ensureUserDocuments(user: User): Promise<UserSubscriptionState> {
  const userRef = doc(db, 'users', user.uid);
  const shortUserId = generateShortUserId(user.uid);
  const fallbackAccount: UserSubscriptionState = {
    uid: user.uid,
    shortUserId,
    downloadTier: 'free',
    downloadExpiresAtMs: 0,
    storageTier: 'none',
    storageQuotaBytes: 0,
    storageUsedBytes: 0,
    redeemedCodes: [],
  };

  let snap = null;
  try {
    snap = await getDoc(userRef);
  } catch (error) {
    if (!isTransientOfflineFirestoreError(error)) {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    }
    try {
      snap = await getDocFromCache(userRef);
    } catch {
      snap = null;
    }
    if (!snap) {
      return fallbackAccount;
    }
  }

  if (snap.exists()) {
    return snap.data() as UserSubscriptionState;
  }
  const batch = writeBatch(db);

  const initialAccount: UserSubscriptionState = {
    uid: user.uid,
    shortUserId,
    downloadTier: 'free',
    downloadExpiresAtMs: 0,
    storageTier: 'none',
    storageQuotaBytes: 0,
    storageUsedBytes: 0,
    redeemedCodes: [],
  };

  batch.set(userRef, {
    ...initialAccount,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const privateRef = doc(db, 'users', user.uid, 'private', 'profile');
  batch.set(privateRef, {
    uid: user.uid,
    email: user.email || `${user.uid}@xerotv.user`,
    displayName: user.displayName || 'XEROTV Member',
    ...(user.photoURL ? { photoURL: user.photoURL } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const lookupRef = doc(db, 'userLookup', shortUserId);
  batch.set(lookupRef, {
    shortUserId,
    uid: user.uid,
    createdAt: serverTimestamp(),
  });

  // Atomically update honest registered user counter
  const statsRef = doc(db, 'stats', 'public');
  try {
    const statsSnap = await getDoc(statsRef);
    if (!statsSnap.exists()) {
      batch.set(statsRef, {
        registeredUsersCount: 1,
        totalEarningsPesos: 0,
        updatedAt: serverTimestamp(),
      });
    } else {
      const prev = statsSnap.data() as { registeredUsersCount?: number; totalEarningsPesos?: number };
      batch.update(statsRef, {
        registeredUsersCount: (prev.registeredUsersCount || 0) + 1,
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // non-fatal if stats read temporarily offline
  }

  try {
    await batch.commit();
  } catch (error) {
    if (!isTransientOfflineFirestoreError(error)) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
    }
  }

  return initialAccount;
}

export async function redeemPromoCodeInFirestore(
  account: UserSubscriptionState,
  rawCode: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const code = sanitizePromoCode(rawCode);
  if (!code) {
    return { ok: false, error: 'Please enter a valid promo code.' };
  }

  let customPromo: CustomPromoDefinition | null = null;
  if (!BUILT_IN_PROMO_CODES[code]) {
    try {
      const promoSnap = await getDoc(doc(db, 'promoCodes', code));
      if (promoSnap.exists()) {
        customPromo = promoSnap.data() as CustomPromoDefinition;
      }
    } catch {
      customPromo = null;
    }
  }

  const result = calculateRedemptionUpdate(account, code, Date.now(), customPromo);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const userRef = doc(db, 'users', account.uid);
  const redemptionRef = doc(db, 'users', account.uid, 'redemptions', result.code);

  try {
    const existingReceipt = await getDoc(redemptionRef);
    if (existingReceipt.exists()) {
      return { ok: false, error: 'This code is already redeemed.' };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${account.uid}/redemptions/${result.code}`);
  }

  const batch = writeBatch(db);
  batch.set(redemptionRef, {
    uid: account.uid,
    code: result.code,
    daysGranted: result.daysGranted,
    storageBonusBytes: result.storageBonusBytes,
    redeemedAt: serverTimestamp(),
  });
  batch.update(userRef, {
    ...result.patch,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return {
      ok: true,
      message: `Code ${result.code} redeemed: +${result.daysGranted} Days Download Access & +${formatBytes(result.storageBonusBytes)} Storage unlocked.`,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${account.uid}`);
  }
}

export async function saveUserPinHash(
  uid: string,
  kind: 'kids' | 'adult',
  pinHash: string,
) {
  const userRef = doc(db, 'users', uid);
  try {
    await updateDoc(userRef, {
      ...(kind === 'kids' ? { kidsPinHash: pinHash } : { adultPinHash: pinHash }),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function syncStorageUsedToFirestore(uid: string, storageUsedBytes: number) {
  const userRef = doc(db, 'users', uid);
  try {
    await updateDoc(userRef, {
      storageUsedBytes: Math.max(0, Math.round(storageUsedBytes)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function adminGrantSubscriptionByUserId(
  inputUserId: string,
  grantType: AdminGrantType,
  customDays: number = 30,
): Promise<{
  targetUid: string;
  shortUserId: string;
  amountPesos: number;
  patch: ReturnType<typeof calculateAdminGrantUpdate>;
}> {
  const cleaned = inputUserId.trim();
  if (!cleaned) {
    throw new Error('Please enter a valid UserID.');
  }

  let targetUid = cleaned;
  if (cleaned.toUpperCase().startsWith('XTV-')) {
    const shortId = cleaned.toUpperCase();
    const lookupRef = doc(db, 'userLookup', shortId);
    let lookupSnap;
    try {
      lookupSnap = await getDoc(lookupRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `userLookup/${shortId}`);
    }
    if (!lookupSnap.exists()) {
      throw new Error(`No user found with UserID "${shortId}".`);
    }
    targetUid = String((lookupSnap.data() as { uid: string }).uid);
  }

  const targetRef = doc(db, 'users', targetUid);
  let targetSnap;
  try {
    targetSnap = await getDoc(targetRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${targetUid}`);
  }
  if (!targetSnap.exists()) {
    throw new Error(`User document "${targetUid}" does not exist.`);
  }

  const targetAccount = targetSnap.data() as UserSubscriptionState;
  const patch = calculateAdminGrantUpdate(targetAccount, grantType, customDays, Date.now());
  const amountPesos = calculateGrantAmountPesos(grantType);

  try {
    const batch = writeBatch(db);
    batch.update(targetRef, {
      ...patch,
      updatedAt: serverTimestamp(),
    });

    if (amountPesos > 0) {
      const statsRef = doc(db, 'stats', 'public');
      const statsSnap = await getDoc(statsRef);
      if (statsSnap.exists()) {
        const cur = statsSnap.data() as { registeredUsersCount?: number; totalEarningsPesos?: number };
        batch.update(statsRef, {
          registeredUsersCount: cur.registeredUsersCount || 0,
          totalEarningsPesos: (cur.totalEarningsPesos || 0) + amountPesos,
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUid}`);
  }

  return {
    targetUid,
    shortUserId: targetAccount.shortUserId,
    amountPesos,
    patch,
  };
}

export async function adminFetchUsersList(): Promise<UserSubscriptionState[]> {
  try {
    const q = query(collection(db, 'users'), limit(100));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as UserSubscriptionState);

    // Ensure honest public registeredUsersCount reflects reality if needed
    const statsRef = doc(db, 'stats', 'public');
    const statsSnap = await getDoc(statsRef);
    if (statsSnap.exists()) {
      const cur = statsSnap.data() as { registeredUsersCount?: number; totalEarningsPesos?: number };
      if ((cur.registeredUsersCount || 0) < list.length) {
        updateDoc(statsRef, {
          registeredUsersCount: list.length,
          totalEarningsPesos: cur.totalEarningsPesos || 0,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }

    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
  }
}

// -----------------------------------------------------------------------------
// Admin Promo Code Generator (Firestore /promoCodes/{codeId})
// -----------------------------------------------------------------------------
export interface FirestorePromoCode extends CustomPromoDefinition {
  createdAt?: unknown;
  updatedAt?: unknown;
}

export async function adminListPromoCodes(): Promise<FirestorePromoCode[]> {
  try {
    const snap = await getDocs(query(collection(db, 'promoCodes'), limit(50)));
    return snap.docs.map((d) => d.data() as FirestorePromoCode);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'promoCodes');
  }
}

export async function adminCreatePromoCode(params: {
  code: string;
  daysGranted: number;
  storageBonusGb: number;
}): Promise<FirestorePromoCode> {
  const code = sanitizePromoCode(params.code);
  if (code.length < 3) {
    throw new Error('Promo code must be at least 3 characters (A-Z, 0-9, -, _).');
  }
  const daysGranted = Math.max(0, Math.min(3650, Math.floor(params.daysGranted || 0)));
  const storageBonusGb = Math.max(0, Math.min(1024, Math.floor(params.storageBonusGb || 0)));
  const storageBonusBytes = storageBonusGb * ONE_GB_BYTES;

  const ref = doc(db, 'promoCodes', code);
  try {
    await setDoc(ref, {
      code,
      daysGranted,
      storageBonusBytes,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { code, daysGranted, storageBonusBytes, active: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `promoCodes/${code}`);
  }
}

export async function adminTogglePromoCode(code: string, active: boolean) {
  const clean = sanitizePromoCode(code);
  try {
    await updateDoc(doc(db, 'promoCodes', clean), {
      active,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `promoCodes/${clean}`);
  }
}

export async function adminDeletePromoCode(code: string) {
  const clean = sanitizePromoCode(code);
  try {
    await deleteDoc(doc(db, 'promoCodes', clean));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `promoCodes/${clean}`);
  }
}

// -----------------------------------------------------------------------------
// Honest Platform Metrics (Live Online Presence, Earnings, Ratings/Popularity)
// -----------------------------------------------------------------------------
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
  createdAt?: unknown;
}

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
    await setDoc(doc(db, 'presence', sessionId), {
      sessionId,
      mode,
      lastSeenAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // non-fatal when offline
  }
}

export async function fetchHonestPlatformPulse(): Promise<HonestPlatformPulse> {
  const now = Date.now();
  const activeCutoff = now - 3 * 60 * 1000;

  let registeredUsers: number | null = null;
  let totalEarningsPesos = 0;
  let onlineUsers = 1;
  let popularityPct: number | null = null;
  let ratingCount = 0;

  try {
    const statsSnap = await getDoc(doc(db, 'stats', 'public'));
    if (statsSnap.exists()) {
      const data = statsSnap.data() as { registeredUsersCount?: number; totalEarningsPesos?: number };
      registeredUsers = data.registeredUsersCount ?? 0;
      totalEarningsPesos = data.totalEarningsPesos ?? 0;
    } else {
      registeredUsers = 0;
    }
  } catch {
    registeredUsers = null;
  }

  try {
    const presenceSnap = await getDocs(
      query(collection(db, 'presence'), where('lastSeenAtMs', '>=', activeCutoff), limit(200)),
    );
    onlineUsers = Math.max(1, presenceSnap.size);
  } catch {
    onlineUsers = 1;
  }

  try {
    const feedbackSnap = await getDocs(query(collection(db, 'feedbackReports'), limit(200)));
    const ratings = feedbackSnap.docs
      .map((d) => (d.data() as FeedbackReportItem).rating)
      .filter((r) => typeof r === 'number' && r >= 1 && r <= 5);
    ratingCount = ratings.length;
    if (ratingCount > 0) {
      const avg = ratings.reduce((s, r) => s + r, 0) / ratingCount;
      popularityPct = Math.round((avg / 5) * 100);
    }
  } catch {
    ratingCount = 0;
  }

  return {
    registeredUsers,
    onlineUsers,
    totalEarningsPesos,
    popularityPct,
    ratingCount,
  };
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
  const id = `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const payload: FeedbackReportItem = {
    id,
    category: params.category,
    rating,
    title: cleanTitle,
    message: cleanMessage,
    appVersion: 'v1.0',
    status: 'open',
  };

  try {
    await setDoc(doc(db, 'feedbackReports', id), {
      ...payload,
      createdAt: serverTimestamp(),
    });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `feedbackReports/${id}`);
  }
}

export async function fetchFeedbackReports(): Promise<FeedbackReportItem[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'feedbackReports'), orderBy('createdAt', 'desc'), limit(50)),
    );
    return snap.docs.map((d) => d.data() as FeedbackReportItem);
  } catch {
    return [];
  }
}

export async function adminSetFeedbackStatus(reportId: string, status: 'open' | 'resolved') {
  try {
    await updateDoc(doc(db, 'feedbackReports', reportId), { status });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `feedbackReports/${reportId}`);
  }
}
