import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import * as cheerio from 'cheerio';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  normalizeAuthEmail,
  normalizeAuthUsername,
  validateLoginInput,
  validateRegistrationInput,
  type AuthUser,
} from '../src/utils/authHelpers';
import { sanitizePlainText, sanitizePromoCode } from '../src/utils/security';
import {
  calculateAdminGrantUpdate,
  calculateGrantAmountPesos,
  calculateRedemptionUpdate,
  formatBytes,
  generateShortUserId,
  ONE_GB_BYTES,
  type AdminGrantType,
  type CustomPromoDefinition,
  type UserSubscriptionState,
} from '../src/utils/subscription';

const execFileAsync = promisify(execFile);

const DEFAULT_SHARED_APP_URL = 'https://xerotv.vercel.app';

function normalizeFallbackUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    if (u.hostname.toLowerCase().startsWith('ais-dev-')) {
      u.hostname = `ais-pre-${u.hostname.slice('ais-dev-'.length)}`;
    }
    return u.origin.replace(/\/+$/, '');
  } catch {
    return DEFAULT_SHARED_APP_URL;
  }
}

function resolvePublicAppOrigin(
  rawOrigin?: string | null,
  fallbackPublicUrl: string = DEFAULT_SHARED_APP_URL,
): string {
  const safeFallback = normalizeFallbackUrl(fallbackPublicUrl);
  const candidate = (rawOrigin || '').trim();
  if (!candidate) {
    return safeFallback;
  }

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    return safeFallback;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return safeFallback;
  }

  let hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    return safeFallback;
  }

  if (hostname.startsWith('ais-dev-')) {
    hostname = `ais-pre-${hostname.slice('ais-dev-'.length)}`;
  }

  const portPart = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${hostname}${portPart}`.replace(/\/+$/, '');
}

interface ZipArchiveInstance extends NodeJS.ReadableStream {
  on(event: string, listener: (...args: unknown[]) => void): this;
  pipe<T extends NodeJS.WritableStream>(dest: T): T;
  file(filepath: string, data: { name: string }): this;
  directory(dirpath: string, destpath: string): this;
  append(source: string | Buffer, data: { name: string }): this;
  finalize(): Promise<void>;
}

async function createZipArchiver(): Promise<ZipArchiveInstance> {
  const archiverPkg = await import('archiver');
  const pkg = archiverPkg as unknown as {
    default?: unknown;
    ZipArchive?: new (opts: { zlib?: { level?: number } }) => ZipArchiveInstance;
  };
  const resolved = (pkg?.default ?? pkg) as {
    ZipArchive?: new (opts: { zlib?: { level?: number } }) => ZipArchiveInstance;
    (format: 'zip', opts?: { zlib?: { level?: number } }): ZipArchiveInstance;
  };
  if (resolved && resolved.ZipArchive) {
    return new resolved.ZipArchive({ zlib: { level: 9 } });
  }
  if (typeof resolved === 'function') {
    return resolved('zip', { zlib: { level: 9 } });
  }
  throw new Error('Zip archiver module did not resolve to a callable factory.');
}

function appendFilteredDirectory(
  archive: ZipArchiveInstance,
  diskDir: string,
  zipPrefix: string,
  skipSubdirs: string[] = [],
) {
  const entries = fs.readdirSync(diskDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.DS_Store') || entry.name.endsWith('.idsig')) continue;
    if (skipSubdirs.includes(entry.name)) continue;
    const diskPath = path.join(diskDir, entry.name);
    const zipPath = `${zipPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      appendFilteredDirectory(archive, diskPath, zipPath);
    } else if (entry.isFile()) {
      archive.file(diskPath, { name: zipPath });
    }
  }
}

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const DEFAULT_TMDB_READ_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIyM2JmYjg4ZmRkMGYyYWIyZDViZTdkN2JhYjAwNDA2NSIsIm5iZiI6MTc5NDQ5NzA2MC42MjQsInN1YiI6IjZhZjVkYTI0NzNhYmYxYzg5YjJiZGZmYSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.ygPWQOs_w9L5obHG6T36n5Y03AAHsoMC_WnL1GEnfqw';
const DEFAULT_TMDB_API_KEY = '23bfb88fdd0f2ab2d5be7d7bab004065';

const EPHEMERAL_SIGNING_FALLBACK = crypto.randomBytes(32).toString('hex');
const ADMIN_SECRET_SIGNING_KEY = crypto
  .createHash('sha256')
  .update(
    process.env.SESSION_SECRET ||
      process.env.ADMIN_SESSION_SECRET ||
      process.env.ADMIN_ACCESS_CODE ||
      EPHEMERAL_SIGNING_FALLBACK,
  )
  .digest();

const OPEN_CINEMA_STREAMS_HD = [
  'https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4',
  'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
  'https://archive.org/download/ElephantsDream/ed_hd_512kb.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
];

const OPEN_CINEMA_STREAMS_COMPACT = [
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4',
  'https://archive.org/download/ElephantsDream/ed_hd_512kb.mp4',
  'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
];

const LOCAL_FALLBACK_MIRROR_INDEX = 999;
const MAX_CHUNK_BYTES = 1572864; // 1.5 MB per HTTP request (safe for Vercel 4.5MB & Cloud Run 32MB limits)

interface StudioQueryConfig {
  name: string;
  movieParams?: Record<string, string | number>;
  tvParams?: Record<string, string | number>;
}

const STUDIO_QUERIES: Record<string, StudioQueryConfig> = {
  netflix: {
    name: 'Netflix',
    tvParams: { with_networks: '213', sort_by: 'popularity.desc' },
    movieParams: { with_watch_providers: '8', watch_region: 'US', sort_by: 'popularity.desc' },
  },
  disney: {
    name: 'Disney+',
    tvParams: { with_networks: '2739', sort_by: 'popularity.desc' },
    movieParams: { with_watch_providers: '337', watch_region: 'US', sort_by: 'popularity.desc' },
  },
  hbo: {
    name: 'HBO / Max',
    tvParams: { with_networks: '49|3186', sort_by: 'popularity.desc' },
    movieParams: { with_watch_providers: '1899|384', watch_region: 'US', sort_by: 'popularity.desc' },
  },
  apple: {
    name: 'Apple TV+',
    tvParams: { with_networks: '2552', sort_by: 'popularity.desc' },
    movieParams: { with_watch_providers: '350', watch_region: 'US', sort_by: 'popularity.desc' },
  },
  prime: {
    name: 'Prime Video',
    tvParams: { with_networks: '1024', sort_by: 'popularity.desc' },
    movieParams: { with_watch_providers: '9|119', watch_region: 'US', sort_by: 'popularity.desc' },
  },
  marvel: {
    name: 'Marvel Studios',
    movieParams: { with_companies: '420', sort_by: 'popularity.desc' },
    tvParams: { with_companies: '420|13252', sort_by: 'popularity.desc' },
  },
  pixar: {
    name: 'Pixar',
    movieParams: { with_companies: '3', sort_by: 'popularity.desc' },
    tvParams: { with_companies: '3', sort_by: 'popularity.desc' },
  },
  warner: {
    name: 'Warner Bros.',
    movieParams: { with_companies: '174', sort_by: 'popularity.desc' },
    tvParams: { with_companies: '1957|174', sort_by: 'popularity.desc' },
  },
  a24: {
    name: 'A24',
    movieParams: { with_companies: '41077', sort_by: 'popularity.desc' },
    tvParams: { with_companies: '41077', sort_by: 'popularity.desc' },
  },
};

function parseContentRangeTotal(headerValue: string | null): number {
  if (!headerValue) return 0;
  const slashIdx = headerValue.lastIndexOf('/');
  if (slashIdx === -1) return 0;
  const total = Number(headerValue.slice(slashIdx + 1).trim());
  return Number.isFinite(total) && total > 0 ? total : 0;
}

async function probeSingleStreamMirror(
  url: string,
  mirrorIndex: number,
  timeoutMs: number,
): Promise<{ url: string; mirrorIndex: number; totalBytes: number; contentType: string }> {
  const probe = await fetch(url, {
    redirect: 'follow',
    headers: { Range: 'bytes=0-0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const contentType = (probe.headers.get('content-type') || 'video/mp4').toLowerCase();
  if ((!probe.ok && probe.status !== 206) || contentType.includes('text/html') || contentType.includes('application/json')) {
    await probe.body?.cancel().catch(() => {});
    throw new Error(`Invalid stream mirror (${probe.status})`);
  }
  const totalFromRange = parseContentRangeTotal(probe.headers.get('content-range'));
  const totalFromLength = Number(probe.headers.get('content-length') || 0);
  const totalBytes = totalFromRange || (probe.status === 200 ? totalFromLength : 0);
  await probe.body?.cancel().catch(() => {});
  if (totalBytes <= 0) {
    throw new Error('Zero byte length');
  }
  return { url, mirrorIndex, totalBytes, contentType: 'video/mp4' };
}

function getLocalImprovingMp4Path(): string | null {
  const videoPath = path.resolve(process.cwd(), 'public', 'media', 'improving-v1.mp4');
  return fs.existsSync(videoPath) ? videoPath : null;
}

interface CachedStreamMeta {
  value: { url: string; mirrorIndex: number; totalBytes: number; contentType: string };
  expiresAt: number;
}
const streamMetaCache = new Map<string, CachedStreamMeta>();

async function resolveWorkingStreamMeta(
  tmdbId: number,
  quality: string,
  reqOrigin?: string,
  preferredMirror?: number,
): Promise<{ url: string; mirrorIndex: number; totalBytes: number; contentType: string } | null> {
  const pool = quality === 'hd' ? OPEN_CINEMA_STREAMS_HD : OPEN_CINEMA_STREAMS_COMPACT;
  const startIdx =
    typeof preferredMirror === 'number' && Number.isFinite(preferredMirror) && preferredMirror >= 0
      ? preferredMirror % pool.length
      : tmdbId % pool.length;

  const cacheKey = `${quality}:${startIdx}`;
  const cached = streamMetaCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const ordered = pool.map((_, offset) => {
    const idx = (startIdx + offset) % pool.length;
    return { idx, url: pool[idx] };
  });

  // Fast 2.2s primary race so Vercel never hits serverless timeouts
  try {
    const found = await Promise.any(
      ordered.slice(0, 2).map((item) => probeSingleStreamMirror(item.url, item.idx, 2200)),
    );
    streamMetaCache.set(cacheKey, { value: found, expiresAt: Date.now() + 90_000 });
    return found;
  } catch {
    // try remaining remote mirrors quickly
  }

  try {
    const found = await Promise.any(
      ordered.slice(2).map((item) => probeSingleStreamMirror(item.url, item.idx, 2500)),
    );
    streamMetaCache.set(cacheKey, { value: found, expiresAt: Date.now() + 90_000 });
    return found;
  } catch {
    // final local MP4 asset fallback (never 502s)
  }

  const localPath = getLocalImprovingMp4Path();
  if (localPath) {
    const stat = fs.statSync(localPath);
    if (stat.size > 0) {
      return {
        url: localPath,
        mirrorIndex: LOCAL_FALLBACK_MIRROR_INDEX,
        totalBytes: stat.size,
        contentType: 'video/mp4',
      };
    }
  }

  if (reqOrigin && /^https?:\/\//i.test(reqOrigin)) {
    try {
      return await probeSingleStreamMirror(
        `${reqOrigin.replace(/\/+$/, '')}/media/improving-v1.mp4`,
        LOCAL_FALLBACK_MIRROR_INDEX,
        3000,
      );
    } catch {
      // give up cleanly
    }
  }

  return null;
}

function resolvePublicOrigin(req: Request): string {
  const vercelHost = (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '').trim();
  const vercelOrigin = vercelHost ? `https://${vercelHost.replace(/^https?:\/\//i, '')}` : '';
  const defaultPublic = resolvePublicAppOrigin(
    process.env.PUBLIC_APP_URL || process.env.SHARED_APP_URL || vercelOrigin || process.env.APP_URL,
    DEFAULT_SHARED_APP_URL,
  );

  const queryOrigin = typeof req.query.origin === 'string' ? req.query.origin.trim() : '';
  if (queryOrigin && /^https?:\/\/[a-zA-Z0-9._:-]+$/i.test(queryOrigin)) {
    return resolvePublicAppOrigin(queryOrigin, defaultPublic);
  }
  const envUrl = (process.env.APP_URL || '').trim();
  if (envUrl && envUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(envUrl)) {
    return resolvePublicAppOrigin(envUrl, defaultPublic);
  }
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const proto = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : req.protocol || 'https';
  const host = String(req.get('x-forwarded-host') || req.get('host') || '')
    .split(',')[0]
    .trim();
  return host ? resolvePublicAppOrigin(`${proto}://${host}`, defaultPublic) : defaultPublic;
}

function getTmdbAuth(): { token: string; apiKey: string } {
  return {
    token: process.env.TMDB_READ_TOKEN || DEFAULT_TMDB_READ_TOKEN,
    apiKey: process.env.TMDB_API_KEY || DEFAULT_TMDB_API_KEY,
  };
}

interface TmdbServerCacheEntry {
  data: unknown;
  expiresAt: number;
}
const tmdbServerCache = new Map<string, TmdbServerCacheEntry>();
const tmdbInFlight = new Map<string, Promise<unknown>>();

async function tmdbFetch<T = unknown>(
  endpoint: string,
  params: Record<string, string | number | boolean> = {},
  ttlMs: number = 5 * 60 * 1000,
): Promise<T> {
  const { token, apiKey } = getTmdbAuth();
  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
  url.searchParams.set('language', 'en-US');
  const sortedEntries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of sortedEntries) {
    url.searchParams.set(k, String(v));
  }
  const cacheKey = url.toString();

  const cached = tmdbServerCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }

  const inflight = tmdbInFlight.get(cacheKey);
  if (inflight) {
    return inflight as Promise<T>;
  }

  if (!token) {
    url.searchParams.set('api_key', apiKey);
  }

  const reqPromise = (async () => {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`TMDB API ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as T;
    if (tmdbServerCache.size > 300) {
      const oldestKey = tmdbServerCache.keys().next().value;
      if (oldestKey) tmdbServerCache.delete(oldestKey);
    }
    tmdbServerCache.set(cacheKey, { data: json, expiresAt: Date.now() + ttlMs });
    return json;
  })();

  tmdbInFlight.set(cacheKey, reqPromise);
  try {
    return await reqPromise;
  } finally {
    tmdbInFlight.delete(cacheKey);
  }
}

function createAdminToken(): string {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_SECRET_SIGNING_KEY).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token: string | undefined): boolean {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expectedSig = crypto
    .createHmac('sha256', ADMIN_SECRET_SIGNING_KEY)
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
    };
    return parsed.role === 'admin' && typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function getAdminTokenFromReq(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req);
  return cookies.xtv_admin_session;
}

function getClientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || 'unknown';
}

function signHmacPayload(obj: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_SECRET_SIGNING_KEY).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyHmacPayload<T = Record<string, unknown>>(token: string | undefined): T | null {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', ADMIN_SECRET_SIGNING_KEY)
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T & { exp?: number };
    if (typeof parsed.exp === 'number' && parsed.exp <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Server-Side Persistent Store (Replaces Cloud Firestore cleanly)
// -----------------------------------------------------------------------------
const STORE_FILE_PATH = process.env.XEROTV_STORE_PATH || '/tmp/xerotv-store.json';

interface StoredUserRecord {
  user: AuthUser;
  account: UserSubscriptionState;
  passwordHash?: string;
  emailNormalized?: string;
  usernameNormalized?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

interface StoredPromoRecord extends CustomPromoDefinition {
  createdAtMs: number;
  updatedAtMs: number;
}

interface StoredFeedbackRecord {
  id: string;
  category: 'feedback' | 'bug';
  rating: number;
  title: string;
  message: string;
  appVersion: string;
  status: 'open' | 'resolved';
  createdAtMs: number;
}

interface PersistentStoreData {
  users: Record<string, StoredUserRecord>;
  shortIdToUid: Record<string, string>;
  promoCodes: Record<string, StoredPromoRecord>;
  presence: Record<string, { sessionId: string; mode: string; lastSeenAtMs: number }>;
  feedbackReports: StoredFeedbackRecord[];
  totalEarningsPesos: number;
}

function createEmptyStore(): PersistentStoreData {
  return {
    users: {},
    shortIdToUid: {},
    promoCodes: {},
    presence: {},
    feedbackReports: [],
    totalEarningsPesos: 0,
  };
}

let inMemoryStore: PersistentStoreData | null = null;

function readStore(): PersistentStoreData {
  if (inMemoryStore) return inMemoryStore;
  try {
    if (fs.existsSync(STORE_FILE_PATH)) {
      const raw = fs.readFileSync(STORE_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistentStoreData>;
      inMemoryStore = {
        users: parsed.users || {},
        shortIdToUid: parsed.shortIdToUid || {},
        promoCodes: parsed.promoCodes || {},
        presence: parsed.presence || {},
        feedbackReports: Array.isArray(parsed.feedbackReports) ? parsed.feedbackReports : [],
        totalEarningsPesos: typeof parsed.totalEarningsPesos === 'number' ? parsed.totalEarningsPesos : 0,
      };
      return inMemoryStore;
    }
  } catch {
    // start fresh if store file unreadable
  }
  inMemoryStore = createEmptyStore();
  return inMemoryStore;
}

function writeStore(store: PersistentStoreData): void {
  inMemoryStore = store;
  try {
    const tmpPath = `${STORE_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(store), 'utf8');
    fs.renameSync(tmpPath, STORE_FILE_PATH);
  } catch {
    // non-fatal on read-only paths; in-memory state remains active
  }
}

interface SignedUserSessionPayload {
  kind: 'user_auth';
  user: AuthUser;
  account: UserSubscriptionState;
  exp: number;
}

function signUserAuthToken(user: AuthUser, account: UserSubscriptionState): string {
  return signHmacPayload({
    kind: 'user_auth',
    user,
    account,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
}

function getUserTokenFromReq(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const candidate = authHeader.slice(7).trim();
    const parsed = verifyHmacPayload<{ kind?: string }>(candidate);
    if (parsed?.kind === 'user_auth') {
      return candidate;
    }
  }
  const cookies = parseCookies(req);
  return cookies.xtv_auth_session;
}

function hydrateSessionRecord(req: Request): { user: AuthUser; account: UserSubscriptionState } | null {
  const token = getUserTokenFromReq(req);
  const parsed = verifyHmacPayload<SignedUserSessionPayload>(token);
  if (!parsed || parsed.kind !== 'user_auth' || !parsed.user?.uid) {
    return null;
  }

  const store = readStore();
  const uid = parsed.user.uid;
  const existing = store.users[uid];
  if (existing) {
    return { user: existing.user, account: existing.account };
  }

  // Rehydrate cleanly from HMAC-signed token after serverless cold start
  const shortUserId = parsed.account?.shortUserId || generateShortUserId(uid);
  const restoredAccount: UserSubscriptionState = {
    uid,
    shortUserId,
    downloadTier: parsed.account?.downloadTier || 'free',
    downloadExpiresAtMs: parsed.account?.downloadExpiresAtMs || 0,
    storageTier: parsed.account?.storageTier || 'none',
    storageQuotaBytes: parsed.account?.storageQuotaBytes || 0,
    storageUsedBytes: parsed.account?.storageUsedBytes || 0,
    redeemedCodes: Array.isArray(parsed.account?.redeemedCodes) ? parsed.account.redeemedCodes : [],
    xerostarActive: Boolean(parsed.account?.xerostarActive),
    xerostarExpiresAtMs: parsed.account?.xerostarExpiresAtMs || 0,
    kidsPinHash: parsed.account?.kidsPinHash,
    adultPinHash: parsed.account?.adultPinHash,
    xerohotsPinHash: parsed.account?.xerohotsPinHash,
    grantedBy: parsed.account?.grantedBy,
  };

  store.users[uid] = {
    user: parsed.user,
    account: restoredAccount,
    emailNormalized: normalizeAuthEmail(parsed.user.email),
    usernameNormalized: normalizeAuthUsername(parsed.user.username || parsed.user.displayName),
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  store.shortIdToUid[shortUserId] = uid;
  writeStore(store);
  return { user: parsed.user, account: restoredAccount };
}

function hashUserPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyUserPassword(password: string, storedHash: string | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hex] = storedHash.split(':');
  if (!salt || !hex) return false;
  try {
    const expected = Buffer.from(hex, 'hex');
    const actual = crypto.scryptSync(password, salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function verifyBotTokenOrChallenge(body: Record<string, unknown> | undefined):
  | { ok: true; botToken: string }
  | { ok: false; error: string } {
  const existingBotToken = typeof body?.botToken === 'string' ? body.botToken.trim() : '';
  if (existingBotToken) {
    const verified = verifyHmacPayload<{ kind?: string }>(existingBotToken);
    if (verified?.kind === 'bot-verified') {
      return { ok: true, botToken: existingBotToken };
    }
  }

  const challengeToken = typeof body?.challengeToken === 'string' ? body.challengeToken.trim() : '';
  const botAnswer = typeof body?.botAnswer === 'string' ? body.botAnswer.trim() : '';
  if (!challengeToken || !botAnswer) {
    return { ok: false, error: 'Please answer the human verification check.' };
  }

  const parsedChallenge = verifyHmacPayload<{ kind?: string; expected?: string }>(challengeToken);
  if (!parsedChallenge || parsedChallenge.kind !== 'bot-challenge' || !parsedChallenge.expected) {
    return { ok: false, error: 'Verification challenge expired. Please try again.' };
  }

  const a = Buffer.from(botAnswer);
  const b = Buffer.from(parsedChallenge.expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    return { ok: false, error: 'Incorrect human verification answer. Please check the math.' };
  }

  const freshBotToken = signHmacPayload({
    kind: 'bot-verified',
    exp: Date.now() + 30 * 60 * 1000,
  });
  return { ok: true, botToken: freshBotToken };
}

function buildAuthCookieHeader(token: string, maxAgeSec: number): string {
  return `xtv_auth_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${maxAgeSec}`;
}

function isSafeBrowserMutation(req: Request): boolean {
  if (req.headers.authorization?.startsWith('Bearer ')) return true;
  if (String(req.get('x-requested-with') || '') === 'XEROTV') return true;
  const origin = String(req.get('origin') || '').trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function createApiApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Normalize Vercel-rewritten /api/index?__xero_path=$1 requests without altering SPA/static paths
  app.use('/api', (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const xeroPath = parsed.searchParams.get('__xero_path');
      if (xeroPath !== null) {
        parsed.searchParams.delete('__xero_path');
        const cleaned = xeroPath.replace(/^\/+/, '').replace(/^api\/+/, '');
        const qs = parsed.searchParams.toString();
        req.url = `/${cleaned || 'health'}${qs ? `?${qs}` : ''}`;
      } else if (
        parsed.pathname === '/' ||
        parsed.pathname === '/index' ||
        parsed.pathname === '/index.ts'
      ) {
        const qs = parsed.searchParams.toString();
        req.url = `/health${qs ? `?${qs}` : ''}`;
      }
    } catch {
      // keep req.url unchanged on malformed URL
    }
    next();
  });

  // Anti-Exploit Security Headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Sliding-window API rate limiter (excludes movie download chunk streaming)
  const apiRateMap = new Map<string, { count: number; resetAt: number }>();
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/download/stream' || req.path === '/health') {
      return next();
    }
    if (apiRateMap.size > 5000) {
      apiRateMap.clear();
    }
    const ip = getClientIp(req);
    const now = Date.now();
    const record = apiRateMap.get(ip);
    if (!record || record.resetAt <= now) {
      apiRateMap.set(ip, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    record.count += 1;
    if (record.count > 240) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment.' });
    }
    return next();
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'XEROTV', version: '1.0', developer: 'XIAN IN PRODUCTION' });
  });

  // ---------------------------------------------------------------------------
  // Live Speed Test & Ping Endpoints
  // ---------------------------------------------------------------------------
  app.get('/api/speedtest/ping', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, serverTimeMs: Date.now() });
  });

  app.get('/api/speedtest/payload', (req: Request, res: Response) => {
    const requested = Number(req.query.bytes || 524288) || 524288;
    const size = Math.max(1024, Math.min(2_097_152, Math.floor(requested)));
    const payload = Buffer.alloc(size, 0x55);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.send(payload);
  });

  // ---------------------------------------------------------------------------
  // Anti-Bot Human Verification Gate for Auth
  // ---------------------------------------------------------------------------
  app.get('/api/security/bot-challenge', (_req: Request, res: Response) => {
    const a = 3 + crypto.randomInt(15);
    const b = 1 + crypto.randomInt(9);
    const useSub = crypto.randomInt(2) === 1 && a > b;
    const expected = useSub ? a - b : a + b;
    const question = `Human Check: What is ${a} ${useSub ? '-' : '+'} ${b}?`;
    const challengeToken = signHmacPayload({
      kind: 'bot-challenge',
      expected: String(expected),
      nonce: crypto.randomBytes(6).toString('hex'),
      exp: Date.now() + 5 * 60 * 1000,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ question, challengeToken });
  });

  app.post('/api/security/bot-verify', (req: Request, res: Response) => {
    const challengeToken = String(req.body?.challengeToken || '');
    const answer = String(req.body?.answer || '').trim();
    const parsed = verifyHmacPayload<{ kind?: string; expected?: string }>(challengeToken);
    if (!parsed || parsed.kind !== 'bot-challenge' || !parsed.expected) {
      return res.status(400).json({ verified: false, error: 'Verification challenge expired. Refreshing...' });
    }
    const a = Buffer.from(answer);
    const b = Buffer.from(parsed.expected);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      return res.status(400).json({ verified: false, error: 'Incorrect answer. Please solve the math check.' });
    }
    const botToken = signHmacPayload({
      kind: 'bot-verified',
      exp: Date.now() + 30 * 60 * 1000,
    });
    return res.json({ verified: true, botToken });
  });

  // ---------------------------------------------------------------------------
  // Built-In XEROTV Authentication (Zero External APIs Needed)
  // ---------------------------------------------------------------------------
  const authFailMap = new Map<string, { attempts: number; lockedUntil: number }>();

  app.post('/api/auth/register', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ ok: false, code: 'auth/forbidden', error: 'Invalid request origin.' });
    }

    const botCheck = verifyBotTokenOrChallenge(req.body as Record<string, unknown>);
    if (!botCheck.ok) {
      return res.status(400).json({ ok: false, code: 'auth/bot-check-failed', error: botCheck.error });
    }

    const validation = validateRegistrationInput({
      displayName: String(req.body?.displayName || ''),
      email: String(req.body?.email || ''),
      password: String(req.body?.password || ''),
      confirmPassword:
        req.body?.confirmPassword !== undefined ? String(req.body.confirmPassword) : undefined,
    });
    if (!validation.ok) {
      return res.status(400).json({ ok: false, code: 'auth/invalid-input', error: validation.error });
    }

    const store = readStore();
    const existingEmail = Object.values(store.users).find(
      (r) => (r.emailNormalized || normalizeAuthEmail(r.user.email)) === validation.email,
    );
    if (existingEmail) {
      return res.status(409).json({
        ok: false,
        code: 'auth/email-in-use',
        error: 'An account with this email already exists. Switch to Sign In.',
      });
    }

    const uid = `xtv_${crypto.createHash('sha256').update(validation.email).digest('hex').slice(0, 16)}`;
    const shortUserId = generateShortUserId(uid);

    const usernameConflict = Object.values(store.users).some(
      (r) => (r.usernameNormalized || normalizeAuthUsername(r.user.username || '')) === validation.username,
    );
    const finalUsername = usernameConflict
      ? `${validation.username.slice(0, 24)}_${shortUserId.slice(-4).toLowerCase()}`
      : validation.username;

    const authUser: AuthUser = {
      uid,
      provider: 'xerotv',
      username: finalUsername,
      displayName: validation.displayName,
      email: validation.email,
      photoURL: null,
    };

    const account: UserSubscriptionState = {
      uid,
      shortUserId,
      downloadTier: 'free',
      downloadExpiresAtMs: 0,
      storageTier: 'none',
      storageQuotaBytes: 0,
      storageUsedBytes: 0,
      redeemedCodes: [],
      xerostarActive: false,
      xerostarExpiresAtMs: 0,
    };

    const now = Date.now();
    store.users[uid] = {
      user: authUser,
      account,
      passwordHash: hashUserPassword(validation.password),
      emailNormalized: validation.email,
      usernameNormalized: finalUsername,
      createdAtMs: now,
      updatedAtMs: now,
    };
    store.shortIdToUid[shortUserId] = uid;
    writeStore(store);

    const token = signUserAuthToken(authUser, account);
    res.setHeader('Set-Cookie', buildAuthCookieHeader(token, 30 * 24 * 60 * 60));
    return res.status(201).json({
      ok: true,
      user: authUser,
      account,
      token,
      botToken: botCheck.botToken,
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ ok: false, code: 'auth/forbidden', error: 'Invalid request origin.' });
    }

    const ip = getClientIp(req);
    const now = Date.now();
    const failTracker = authFailMap.get(ip);
    if (failTracker && failTracker.lockedUntil > now) {
      const waitSec = Math.ceil((failTracker.lockedUntil - now) / 1000);
      return res.status(429).json({
        ok: false,
        code: 'auth/too-many-requests',
        error: `Too many failed sign-in attempts. Locked for ${waitSec}s.`,
      });
    }

    const botCheck = verifyBotTokenOrChallenge(req.body as Record<string, unknown>);
    if (!botCheck.ok) {
      return res.status(400).json({ ok: false, code: 'auth/bot-check-failed', error: botCheck.error });
    }

    const validation = validateLoginInput({
      identifier: String(req.body?.identifier || ''),
      password: String(req.body?.password || ''),
    });
    if (!validation.ok) {
      return res.status(400).json({ ok: false, code: 'auth/invalid-input', error: validation.error });
    }

    const store = readStore();
    const cleanId = validation.identifier;
    const cleanHandle = normalizeAuthUsername(cleanId);
    const record = Object.values(store.users).find((r) => {
      const em = r.emailNormalized || normalizeAuthEmail(r.user.email);
      const un = r.usernameNormalized || normalizeAuthUsername(r.user.username || '');
      const sid = (r.account.shortUserId || '').toLowerCase();
      return em === cleanId || (cleanHandle && un === cleanHandle) || sid === cleanId;
    });

    if (!record || !verifyUserPassword(validation.password, record.passwordHash)) {
      const nextAttempts =
        (failTracker && failTracker.lockedUntil <= now ? failTracker.attempts : 0) + 1;
      if (nextAttempts >= 5) {
        authFailMap.set(ip, { attempts: 0, lockedUntil: now + 60_000 });
        return res.status(429).json({
          ok: false,
          code: 'auth/too-many-requests',
          error: 'Too many failed sign-in attempts. Locked for 60s.',
        });
      }
      authFailMap.set(ip, { attempts: nextAttempts, lockedUntil: 0 });
      return res.status(401).json({
        ok: false,
        code: 'auth/invalid-credentials',
        error: 'Incorrect email/username or password.',
      });
    }

    authFailMap.delete(ip);
    record.updatedAtMs = now;
    writeStore(store);

    const token = signUserAuthToken(record.user, record.account);
    res.setHeader('Set-Cookie', buildAuthCookieHeader(token, 30 * 24 * 60 * 60));
    return res.json({
      ok: true,
      user: record.user,
      account: record.account,
      token,
      botToken: botCheck.botToken,
    });
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const session = hydrateSessionRecord(req);
    if (!session) {
      return res.json({ authenticated: false, user: null, account: null });
    }
    const freshToken = signUserAuthToken(session.user, session.account);
    return res.json({
      authenticated: true,
      user: session.user,
      account: session.account,
      token: freshToken,
    });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
    res.setHeader('Set-Cookie', buildAuthCookieHeader('', 0));
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Authenticated Account Mutations (Promos, PIN Hashes, Storage Usage)
  // ---------------------------------------------------------------------------
  app.post('/api/account/redeem', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ ok: false, error: 'Invalid request origin.' });
    }
    const session = hydrateSessionRecord(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Please sign in first.' });
    }

    const code = sanitizePromoCode(String(req.body?.code || ''));
    if (!code) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid promo code.' });
    }

    const store = readStore();
    const record = store.users[session.user.uid];
    if (!record) {
      return res.status(404).json({ ok: false, error: 'Account record not found.' });
    }

    const customPromo = store.promoCodes[code] || null;
    const calc = calculateRedemptionUpdate(record.account, code, Date.now(), customPromo);
    if (!calc.ok) {
      return res.status(400).json({ ok: false, error: calc.error });
    }

    record.account = {
      ...record.account,
      ...calc.patch,
    };
    record.updatedAtMs = Date.now();
    writeStore(store);

    const token = signUserAuthToken(record.user, record.account);
    res.setHeader('Set-Cookie', buildAuthCookieHeader(token, 30 * 24 * 60 * 60));
    return res.json({
      ok: true,
      message: `Code ${calc.code} redeemed: +${calc.daysGranted} Days Download Access & +${formatBytes(calc.storageBonusBytes)} Storage unlocked.`,
      account: record.account,
      user: record.user,
      token,
    });
  });

  app.post('/api/account/pin', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ ok: false, error: 'Invalid request origin.' });
    }
    const session = hydrateSessionRecord(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Sign in required.' });
    }
    const kind = String(req.body?.kind || '');
    const pinHash = String(req.body?.pinHash || '').trim();
    if (!['kids', 'adult', 'hots'].includes(kind) || !/^[a-f0-9]{16,128}$/i.test(pinHash)) {
      return res.status(400).json({ ok: false, error: 'Invalid PIN payload.' });
    }

    const store = readStore();
    const record = store.users[session.user.uid];
    if (!record) {
      return res.status(404).json({ ok: false, error: 'Account not found.' });
    }

    if (kind === 'kids') record.account.kidsPinHash = pinHash;
    else if (kind === 'adult') record.account.adultPinHash = pinHash;
    else record.account.xerohotsPinHash = pinHash;

    record.updatedAtMs = Date.now();
    writeStore(store);

    const token = signUserAuthToken(record.user, record.account);
    res.setHeader('Set-Cookie', buildAuthCookieHeader(token, 30 * 24 * 60 * 60));
    return res.json({ ok: true, account: record.account, token });
  });

  app.post('/api/account/storage', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ ok: false, error: 'Invalid request origin.' });
    }
    const session = hydrateSessionRecord(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Sign in required.' });
    }
    const bytes = Math.max(0, Math.round(Number(req.body?.storageUsedBytes || 0)));
    const store = readStore();
    const record = store.users[session.user.uid];
    if (!record) {
      return res.status(404).json({ ok: false, error: 'Account not found.' });
    }

    record.account.storageUsedBytes = bytes;
    record.updatedAtMs = Date.now();
    writeStore(store);

    const token = signUserAuthToken(record.user, record.account);
    res.setHeader('Set-Cookie', buildAuthCookieHeader(token, 30 * 24 * 60 * 60));
    return res.json({ ok: true, account: record.account, token });
  });

  // ---------------------------------------------------------------------------
  // Honest Platform Metrics, Presence & Feedback (Server-Backed)
  // ---------------------------------------------------------------------------
  app.post('/api/platform/presence', (req: Request, res: Response) => {
    const sessionId = sanitizePlainText(String(req.body?.sessionId || ''), 64);
    const mode = sanitizePlainText(String(req.body?.mode || 'main'), 24);
    if (!sessionId || !/^[a-zA-Z0-9_-]{6,64}$/.test(sessionId)) {
      return res.status(400).json({ ok: false });
    }
    const store = readStore();
    const now = Date.now();
    store.presence[sessionId] = { sessionId, mode, lastSeenAtMs: now };
    for (const [k, entry] of Object.entries(store.presence)) {
      if (now - entry.lastSeenAtMs > 10 * 60 * 1000) {
        delete store.presence[k];
      }
    }
    writeStore(store);
    return res.json({ ok: true });
  });

  app.get('/api/platform/pulse', (_req: Request, res: Response) => {
    const store = readStore();
    const cutoff = Date.now() - 3 * 60 * 1000;
    const onlineUsers = Math.max(
      1,
      Object.values(store.presence).filter((p) => p.lastSeenAtMs >= cutoff).length,
    );
    const registeredUsers = Object.keys(store.users).length;
    const ratings = store.feedbackReports
      .map((r) => r.rating)
      .filter((n) => typeof n === 'number' && n >= 1 && n <= 5);
    const ratingCount = ratings.length;
    const popularityPct =
      ratingCount > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratingCount / 5) * 100) : null;

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      registeredUsers,
      onlineUsers,
      totalEarningsPesos: store.totalEarningsPesos,
      popularityPct,
      ratingCount,
    });
  });

  app.get('/api/platform/feedback', (_req: Request, res: Response) => {
    const store = readStore();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      reports: store.feedbackReports.slice(0, 50),
    });
  });

  app.post('/api/platform/feedback', (req: Request, res: Response) => {
    const category = req.body?.category === 'bug' ? 'bug' : 'feedback';
    const title = sanitizePlainText(String(req.body?.title || ''), 120);
    const message = sanitizePlainText(String(req.body?.message || ''), 800);
    if (title.length < 2 || message.length < 4) {
      return res.status(400).json({ error: 'Please provide a clear title and description.' });
    }
    const rating = Math.max(1, Math.min(5, Math.round(Number(req.body?.rating || 5))));
    const report: StoredFeedbackRecord = {
      id: `rep_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      category,
      rating,
      title,
      message,
      appVersion: 'v1.0',
      status: 'open',
      createdAtMs: Date.now(),
    };
    const store = readStore();
    store.feedbackReports.unshift(report);
    if (store.feedbackReports.length > 200) {
      store.feedbackReports = store.feedbackReports.slice(0, 200);
    }
    writeStore(store);
    return res.status(201).json({ report });
  });

  // ---------------------------------------------------------------------------
  // 90-Second "Improving at 1.0" MP4 Video with Sound (HTTP Range Streamer)
  // ---------------------------------------------------------------------------
  app.get('/api/media/improving-v1.mp4', (req: Request, res: Response) => {
    const videoPath = path.resolve(process.cwd(), 'public', 'media', 'improving-v1.mp4');
    if (process.env.VERCEL || !fs.existsSync(videoPath)) {
      return res.redirect(307, '/media/improving-v1.mp4');
    }
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Math.max(0, parseInt(parts[0], 10) || 0);
      const end = parts[1] ? Math.min(fileSize - 1, parseInt(parts[1], 10)) : fileSize - 1;
      if (start >= fileSize || end < start) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', String(chunkSize));
      const stream = fs.createReadStream(videoPath, { start, end });
      stream.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      return stream.pipe(res);
    }

    res.status(200);
    res.setHeader('Content-Length', String(fileSize));
    const stream = fs.createReadStream(videoPath);
    stream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    return stream.pipe(res);
  });

  // ---------------------------------------------------------------------------
  // TMDB Real Catalog Endpoints
  // ---------------------------------------------------------------------------
  // Edge/CDN cache headers on TMDB metadata for instant page switches & zero lag
  app.use('/api/tmdb', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'public, max-age=180, s-maxage=300, stale-while-revalidate=600');
    next();
  });

  app.get('/api/tmdb/feed', async (req: Request, res: Response) => {
    const mode = String(req.query.mode || 'main');
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));

    try {
      if (mode === 'kids') {
        const kidsBlocked = new Set([27, 53, 80, 10752, 10768, 9648]);
        const [movies, animated, familyTv] = await Promise.all([
          tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', {
            page,
            include_adult: false,
            certification_country: 'US',
            'certification.lte': 'PG',
            with_genres: '16|10751',
            without_genres: '27,53,80,10752,10768,9648',
            sort_by: 'popularity.desc',
          }),
          tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', {
            page,
            include_adult: false,
            certification_country: 'US',
            'certification.lte': 'PG',
            with_genres: '16',
            without_genres: '27,53,80,10752,10768,9648',
            'vote_count.gte': 50,
            sort_by: 'vote_average.desc',
          }),
          tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/tv', {
            page,
            include_adult: false,
            with_genres: '10762,16',
            without_genres: '27,53,80,10752,10768,9648',
            sort_by: 'popularity.desc',
          }),
        ]);

        const tag = (list: Record<string, unknown>[], media_type: 'movie' | 'tv') =>
          (list || [])
            .filter(
              (item) =>
                !item.adult &&
                !(Array.isArray(item.genre_ids) && item.genre_ids.some((g) => kidsBlocked.has(Number(g)))),
            )
            .map((item) => ({ ...item, media_type }));

        return res.json({
          mode,
          sections: [
            { id: 'featured', title: 'Kids PG Cinema', items: tag(movies.results, 'movie') },
            { id: 'animated', title: 'Animated Adventures', items: tag(animated.results, 'movie') },
            { id: 'series', title: 'Family & Kids Series', items: tag(familyTv.results, 'tv') },
          ],
        });
      }

      if (mode === 'adult') {
        const [matureRomance, thrillerR, darkDrama] = await Promise.all([
          tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', {
            page,
            include_adult: true,
            certification_country: 'US',
            'certification.gte': 'R',
            with_genres: '10749,18',
            sort_by: 'popularity.desc',
          }),
          tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', {
            page,
            include_adult: true,
            certification_country: 'US',
            'certification.gte': 'R',
            with_genres: '53,80',
            sort_by: 'popularity.desc',
          }),
          tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/tv', {
            page,
            include_adult: true,
            with_genres: '18,80',
            'vote_count.gte': 100,
            sort_by: 'popularity.desc',
          }),
        ]);

        const tag = (list: Record<string, unknown>[], media_type: 'movie' | 'tv') =>
          (list || []).map((item) => ({ ...item, media_type }));

        return res.json({
          mode,
          sections: [
            { id: 'featured', title: '18+ Mature & Romance', items: tag(matureRomance.results, 'movie') },
            { id: 'thriller', title: 'R-Rated Thrillers & Noir', items: tag(thrillerR.results, 'movie') },
            { id: 'series', title: 'Uncut Mature Series', items: tag(darkDrama.results, 'tv') },
          ],
        });
      }

      if (mode === 'christmas') {
        const [holidayMovies, santaSearch, holidayTv] = await Promise.all([
          tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', {
            page,
            include_adult: false,
            with_keywords: '207317',
            sort_by: 'popularity.desc',
          }),
          tmdbFetch<{ results: Record<string, unknown>[] }>('/search/movie', {
            query: 'Christmas',
            page,
            include_adult: false,
          }),
          tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/tv', {
            page,
            include_adult: false,
            with_keywords: '207317',
            sort_by: 'popularity.desc',
          }),
        ]);

        const tag = (list: Record<string, unknown>[], media_type: 'movie' | 'tv') =>
          (list || []).map((item) => ({ ...item, media_type }));

        return res.json({
          mode,
          sections: [
            { id: 'featured', title: 'Christmas Spotlight', items: tag(holidayMovies.results, 'movie') },
            { id: 'santa', title: 'Santa & Holiday Classics', items: tag(santaSearch.results, 'movie') },
            { id: 'series', title: 'Winter Holiday Specials', items: tag(holidayTv.results, 'tv') },
          ],
        });
      }

      const [trending, popularMovies, nowPlaying, topTv] = await Promise.all([
        tmdbFetch<{ results: Record<string, unknown>[] }>('/trending/all/week', { page, include_adult: false }),
        tmdbFetch<{ results: Record<string, unknown>[] }>('/movie/popular', { page, include_adult: false }),
        tmdbFetch<{ results: Record<string, unknown>[] }>('/movie/now_playing', { page, include_adult: false }),
        tmdbFetch<{ results: Record<string, unknown>[] }>('/tv/top_rated', { page, include_adult: false }),
      ]);

      const tag = (list: Record<string, unknown>[], defaultType?: 'movie' | 'tv') =>
        (list || [])
          .filter((item) => item.media_type !== 'person' && !item.adult)
          .map((item) => ({ ...item, media_type: item.media_type || defaultType || 'movie' }));

      return res.json({
        mode: 'main',
        sections: [
          { id: 'featured', title: 'Trending Worldwide', items: tag(trending.results) },
          { id: 'popular', title: 'Popular Cinema', items: tag(popularMovies.results, 'movie') },
          { id: 'now_playing', title: 'Now Playing in Theaters', items: tag(nowPlaying.results, 'movie') },
          { id: 'series', title: 'Acclaimed Series', items: tag(topTv.results, 'tv') },
        ],
      });
    } catch (error) {
      res.status(502).json({
        error: 'Failed to fetch TMDB catalog',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/tmdb/search', async (req: Request, res: Response) => {
    const query = String(req.query.query || '').trim();
    const mode = String(req.query.mode || 'main');
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));

    if (!query) {
      return res.json({ results: [] });
    }

    try {
      const data = await tmdbFetch<{
        results: Array<{ media_type?: string; adult?: boolean; genre_ids?: number[] }>;
      }>('/search/multi', {
        query,
        page,
        include_adult: mode === 'adult',
      });

      let items = (data.results || []).filter(
        (item) => item.media_type === 'movie' || item.media_type === 'tv',
      );
      if (mode !== 'adult') {
        items = items.filter((item) => !item.adult);
      }
      if (mode === 'kids') {
        const blocked = new Set([27, 53, 80, 10752]);
        items = items.filter((item) => !(item.genre_ids || []).some((g) => blocked.has(g)));
      }
      res.json({ results: items });
    } catch (error) {
      res.status(502).json({
        error: 'Search failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/tmdb/discover', async (req: Request, res: Response) => {
    const mediaType = req.query.mediaType === 'tv' ? 'tv' : 'movie';
    const genre = String(req.query.genre || '');
    const mode = String(req.query.mode || 'main');
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));

    try {
      const params: Record<string, string | number | boolean> = {
        page,
        include_adult: mode === 'adult',
        sort_by: 'popularity.desc',
      };
      if (genre) params.with_genres = genre;
      if (mode === 'kids') {
        // Avoid passing invalid certification.lte on /discover/tv (causes 0 TV results on TMDB)
        if (mediaType === 'movie') {
          params.certification_country = 'US';
          params['certification.lte'] = 'PG';
        }
        if (!genre) params.with_genres = mediaType === 'tv' ? '10762|16|10751' : '16|10751';
      }
      if (mode === 'christmas') {
        params.with_keywords = '207317';
      }

      const data = await tmdbFetch<{ results: Record<string, unknown>[] }>(`/discover/${mediaType}`, params);
      res.json({
        results: (data.results || []).map((item) => ({ ...item, media_type: mediaType })),
      });
    } catch (error) {
      res.status(502).json({
        error: 'Discover failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/tmdb/details/:mediaType/:id', async (req: Request, res: Response) => {
    const mediaType = req.params.mediaType === 'tv' ? 'tv' : 'movie';
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid TMDB ID' });
    }

    try {
      const data = await tmdbFetch<Record<string, unknown>>(
        `/${mediaType}/${id}`,
        {
          append_to_response: 'credits,videos,recommendations,similar,release_dates,content_ratings',
        },
        15 * 60 * 1000,
      );
      res.json({ ...data, media_type: mediaType });
    } catch (error) {
      res.status(502).json({
        error: 'Failed to load TMDB details',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/tmdb/season/:tvId/:seasonNumber', async (req: Request, res: Response) => {
    const tvId = Number(req.params.tvId);
    const seasonNumber = Number(req.params.seasonNumber);
    if (!Number.isFinite(tvId) || !Number.isFinite(seasonNumber)) {
      return res.status(400).json({ error: 'Invalid TV ID or season number' });
    }

    try {
      const data = await tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`, {}, 15 * 60 * 1000);
      res.json(data);
    } catch (error) {
      res.status(502).json({
        error: 'Failed to load season episodes',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/tmdb/studios', async (req: Request, res: Response) => {
    const studioId = String(req.query.studio || 'netflix').toLowerCase();
    const mode = String(req.query.mode || 'main');
    const typeFilter = String(req.query.type || 'all').toLowerCase(); // all | movie | tv
    const page = Math.max(1, Math.min(10, Number(req.query.page || 1) || 1));

    const studioCfg = STUDIO_QUERIES[studioId];
    if (!studioCfg) {
      return res.status(400).json({ error: 'Unknown network or studio' });
    }

    try {
      const wantMovies = typeFilter !== 'tv' && Boolean(studioCfg.movieParams);
      const wantTv = typeFilter !== 'movie' && Boolean(studioCfg.tvParams);

      const emptyDiscover = { results: [] as Record<string, unknown>[] };
      const moviePromise = wantMovies
        ? tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', {
            ...studioCfg.movieParams!,
            page,
            include_adult: mode === 'adult',
            ...(mode === 'kids'
              ? {
                  certification_country: 'US',
                  'certification.lte': 'PG',
                  with_genres: '16|10751|12|35|14',
                  without_genres: '27,53,80,10752,10768,9648',
                }
              : {}),
          }).catch(() => emptyDiscover)
        : Promise.resolve(emptyDiscover);

      const tvPromise = wantTv
        ? tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/tv', {
            ...studioCfg.tvParams!,
            page,
            include_adult: mode === 'adult',
            ...(mode === 'kids'
              ? {
                  with_genres: '10762|16|10751',
                  without_genres: '27,53,80,10752,10768,9648',
                }
              : {}),
          }).catch(() => emptyDiscover)
        : Promise.resolve(emptyDiscover);

      const [movieData, tvData] = await Promise.all([moviePromise, tvPromise]);

      let movieItems: Record<string, unknown>[] = (movieData.results || []).map((item) => ({
        ...item,
        media_type: 'movie' as const,
      }));
      let tvItems: Record<string, unknown>[] = (tvData.results || []).map((item) => ({
        ...item,
        media_type: 'tv' as const,
      }));

      if (mode === 'kids') {
        const blocked = new Set([27, 53, 80, 10752, 10768, 9648]);
        const kidsSafe = (item: Record<string, unknown>) =>
          !item.adult &&
          !(Array.isArray(item.genre_ids) && item.genre_ids.some((g) => blocked.has(Number(g))));
        movieItems = movieItems.filter(kidsSafe);
        tvItems = tvItems.filter(kidsSafe);
      }

      // Interleave movies and series cleanly so both are well-represented at top of shelf
      const combined: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      const maxLen = Math.max(movieItems.length, tvItems.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < movieItems.length) {
          const m = movieItems[i];
          const k = `movie:${String(m.id)}`;
          if (!seen.has(k)) {
            seen.add(k);
            combined.push(m);
          }
        }
        if (i < tvItems.length) {
          const t = tvItems[i];
          const k = `tv:${String(t.id)}`;
          if (!seen.has(k)) {
            seen.add(k);
            combined.push(t);
          }
        }
      }

      res.json({
        studio: studioId,
        name: studioCfg.name,
        mediaType: typeFilter === 'movie' || typeFilter === 'tv' ? typeFilter : 'mixed',
        movieCount: movieItems.length,
        tvCount: tvItems.length,
        results: combined,
      });
    } catch (error) {
      res.status(502).json({
        error: 'Failed to load studio catalog',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/tmdb/releases', async (_req: Request, res: Response) => {
    try {
      const [nowPlaying, airingToday] = await Promise.all([
        tmdbFetch<{ results: Record<string, unknown>[] }>('/movie/now_playing', { page: 1, include_adult: false }),
        tmdbFetch<{ results: Record<string, unknown>[] }>('/tv/airing_today', { page: 1, include_adult: false }),
      ]);
      const items = [
        ...(nowPlaying.results || []).slice(0, 4).map((m) => ({ ...m, media_type: 'movie' })),
        ...(airingToday.results || []).slice(0, 3).map((t) => ({ ...t, media_type: 'tv' })),
      ];
      res.json({ releases: items });
    } catch (error) {
      res.status(502).json({
        error: 'Failed to fetch releases',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Real Playable Offline Movie Stream Proxy (Chunked Range Safe for Cloud Run & Vercel)
  // ---------------------------------------------------------------------------
  app.get('/api/download/info', async (req: Request, res: Response) => {
    try {
      const tmdbId = Math.abs(Number(req.query.tmdbId || 1) || 1);
      const quality = String(req.query.quality || 'standard');
      const title = String(req.query.title || 'xerotv-movie')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .slice(0, 48);

      const origin = `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
      const meta = await resolveWorkingStreamMeta(tmdbId, quality, origin);
      if (!meta) {
        return res.status(502).json({
          error: 'No upstream video mirror is currently reachable. Please try again in a moment.',
        });
      }

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        mirrorIndex: meta.mirrorIndex,
        totalBytes: meta.totalBytes,
        contentType: meta.contentType,
        chunkBytes: MAX_CHUNK_BYTES,
        filename: `${title}-${tmdbId}.mp4`,
      });
    } catch (error) {
      return res.status(502).json({
        error: 'Failed to resolve downloadable stream metadata.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/download/stream', async (req: Request, res: Response) => {
    const tmdbId = Math.abs(Number(req.query.tmdbId || 1) || 1);
    const quality = String(req.query.quality || 'standard');
    const mirrorIndexParam =
      req.query.mirrorIndex !== undefined ? Number(req.query.mirrorIndex) : undefined;
    const title = String(req.query.title || 'xerotv-movie')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 48);

    const hasExplicitChunk = req.query.start !== undefined && req.query.end !== undefined;
    const startByte = hasExplicitChunk ? Math.max(0, Math.floor(Number(req.query.start) || 0)) : 0;
    const requestedEnd = hasExplicitChunk
      ? Math.max(startByte, Math.floor(Number(req.query.end) || startByte))
      : 0;
    const cappedEnd = hasExplicitChunk
      ? Math.min(requestedEnd, startByte + MAX_CHUNK_BYTES - 1)
      : 0;

    const rangeHeader = hasExplicitChunk
      ? `bytes=${startByte}-${cappedEnd}`
      : req.headers.range
        ? String(req.headers.range)
        : undefined;

    // Serve bundled MP4 cleanly when local fallback mirror is selected
    if (mirrorIndexParam === LOCAL_FALLBACK_MIRROR_INDEX) {
      const localPath = getLocalImprovingMp4Path();
      if (localPath) {
        const fileSize = fs.statSync(localPath).size;
        const start = rangeHeader ? startByte : 0;
        const end = rangeHeader ? Math.min(fileSize - 1, cappedEnd || fileSize - 1) : fileSize - 1;
        const chunkLen = Math.max(1, end - start + 1);
        res.status(rangeHeader ? 206 : 200);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', String(chunkLen));
        if (rangeHeader) {
          res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        }
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', `inline; filename="${title}-${tmdbId}.mp4"`);
        res.setHeader('Cache-Control', 'no-store');
        return fs.createReadStream(localPath, { start, end }).pipe(res);
      }
      const fallbackUrl = `${resolvePublicOrigin(req)}/media/improving-v1.mp4`;
      const upstreamLocal = await fetch(fallbackUrl, {
        redirect: 'follow',
        headers: rangeHeader ? { Range: rangeHeader } : undefined,
        signal: AbortSignal.timeout(12000),
      }).catch(() => null);
      if (upstreamLocal && (upstreamLocal.ok || upstreamLocal.status === 206) && upstreamLocal.body) {
        const buf = Buffer.from(await upstreamLocal.arrayBuffer());
        res.status(upstreamLocal.status);
        res.setHeader('Content-Type', upstreamLocal.headers.get('content-type') || 'video/mp4');
        res.setHeader('Content-Length', String(buf.byteLength));
        const cr = upstreamLocal.headers.get('content-range');
        if (cr) res.setHeader('Content-Range', cr);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', `inline; filename="${title}-${tmdbId}.mp4"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.send(buf);
      }
    }

    const pool = quality === 'hd' ? OPEN_CINEMA_STREAMS_HD : OPEN_CINEMA_STREAMS_COMPACT;
    const baseIdx =
      typeof mirrorIndexParam === 'number' && Number.isFinite(mirrorIndexParam) && mirrorIndexParam >= 0
        ? mirrorIndexParam % pool.length
        : tmdbId % pool.length;

    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
    });

    try {
      let upstream: globalThis.Response | null = null;
      const maxAttempts = hasExplicitChunk && mirrorIndexParam !== undefined ? 2 : pool.length;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (clientDisconnected) return;
        const candidateUrl =
          hasExplicitChunk && mirrorIndexParam !== undefined
            ? pool[baseIdx]
            : pool[(baseIdx + attempt) % pool.length];

        const attemptRes = await fetch(candidateUrl, {
          redirect: 'follow',
          headers: rangeHeader ? { Range: rangeHeader } : undefined,
          signal: AbortSignal.timeout(12000),
        }).catch(() => null);

        const ct = (attemptRes?.headers.get('content-type') || '').toLowerCase();
        if (
          attemptRes &&
          (attemptRes.ok || attemptRes.status === 206) &&
          !ct.includes('text/html') &&
          !ct.includes('application/json')
        ) {
          upstream = attemptRes;
          break;
        }
        await attemptRes?.body?.cancel().catch(() => {});
      }

      if (!upstream) {
        const localPath = getLocalImprovingMp4Path();
        if (localPath) {
          const fileSize = fs.statSync(localPath).size;
          const start = rangeHeader ? startByte : 0;
          const end = rangeHeader ? Math.min(fileSize - 1, cappedEnd || fileSize - 1) : fileSize - 1;
          const chunkLen = Math.max(1, end - start + 1);
          res.status(rangeHeader ? 206 : 200);
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Length', String(chunkLen));
          if (rangeHeader) {
            res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
          }
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Disposition', `inline; filename="${title}-${tmdbId}.mp4"`);
          res.setHeader('Cache-Control', 'no-store');
          return fs.createReadStream(localPath, { start, end }).pipe(res);
        }
        const fallbackUrl = `${resolvePublicOrigin(req)}/media/improving-v1.mp4`;
        const publicFallback = await fetch(fallbackUrl, {
          redirect: 'follow',
          headers: rangeHeader ? { Range: rangeHeader } : undefined,
          signal: AbortSignal.timeout(8000),
        }).catch(() => null);
        if (publicFallback && (publicFallback.ok || publicFallback.status === 206) && publicFallback.body) {
          upstream = publicFallback;
        } else {
          return res.status(502).json({ error: 'All upstream video mirrors failed or timed out' });
        }
      }

      const contentType = upstream.headers.get('content-type') || 'video/mp4';
      const contentLength = upstream.headers.get('content-length');
      const contentRange = upstream.headers.get('content-range');

      if (!upstream.body) {
        return res.status(502).json({ error: 'Upstream video stream returned empty body' });
      }

      if (hasExplicitChunk) {
        const chunkBuffer = Buffer.from(await upstream.arrayBuffer());
        if (clientDisconnected) return;
        res.status(upstream.status);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', String(chunkBuffer.byteLength));
        if (contentRange) res.setHeader('Content-Range', contentRange);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', `inline; filename="${title}-${tmdbId}.mp4"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.send(chunkBuffer);
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', contentType);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      if (contentRange) res.setHeader('Content-Range', contentRange);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', `inline; filename="${title}-${tmdbId}.mp4"`);
      res.setHeader('Cache-Control', 'no-store');

      const reader = upstream.body.getReader();
      req.on('close', () => {
        reader.cancel().catch(() => {});
      });

      while (true) {
        if (clientDisconnected || res.writableEnded || res.destroyed) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (value && !res.writableEnded && !res.destroyed) {
          const canContinue = res.write(Buffer.from(value));
          if (!canContinue) {
            await new Promise<void>((resolve) => res.once('drain', resolve));
          }
        }
      }
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    } catch (error) {
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Failed to stream offline video file',
          details: error instanceof Error ? error.message : String(error),
        });
      } else if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Admin Verification & Full-Stack ZIP Export
  // ---------------------------------------------------------------------------
  const adminFailMap = new Map<string, { attempts: number; lockedUntil: number }>();

  app.post('/api/admin/verify', (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const tracker = adminFailMap.get(ip);
    if (tracker && tracker.lockedUntil > now) {
      const waitSec = Math.ceil((tracker.lockedUntil - now) / 1000);
      return res.status(429).json({
        verified: false,
        error: `Too many invalid attempts. Locked for ${waitSec}s.`,
      });
    }

    const provided = String(req.body?.accessCode || '');
    const expected = process.env.ADMIN_ACCESS_CODE || 'xiancondino';

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!match) {
      const nextAttempts = (tracker && tracker.lockedUntil <= now ? tracker.attempts : 0) + 1;
      if (nextAttempts >= 5) {
        adminFailMap.set(ip, { attempts: 0, lockedUntil: now + 60_000 });
        return res.status(429).json({
          verified: false,
          error: 'Too many invalid attempts. Locked for 60s.',
        });
      }
      adminFailMap.set(ip, { attempts: nextAttempts, lockedUntil: 0 });
      return res.status(401).json({
        verified: false,
        error: `Invalid developer access code. (${5 - nextAttempts} attempt(s) left)`,
      });
    }

    adminFailMap.delete(ip);
    const token = createAdminToken();
    res.setHeader(
      'Set-Cookie',
      `xtv_admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=43200`,
    );
    return res.json({ verified: true, token });
  });

  app.get('/api/admin/status', (req: Request, res: Response) => {
    const verified = verifyAdminToken(getAdminTokenFromReq(req));
    res.json({ verified });
  });

  app.post('/api/admin/logout', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
    res.setHeader(
      'Set-Cookie',
      'xtv_admin_session=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0',
    );
    return res.json({ ok: true });
  });

  app.get('/api/admin/users', (req: Request, res: Response) => {
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: 'Admin verification required.' });
    }
    const store = readStore();
    const users = Object.values(store.users)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, 100)
      .map((r) => r.account);
    return res.json({ users });
  });

  app.post('/api/admin/grant', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: 'Admin verification required.' });
    }
    const rawUserId = String(req.body?.userId || '').trim();
    const grantType = String(req.body?.grantType || '') as AdminGrantType;
    const customDays = Number(req.body?.customDays || 30);
    const validGrants: AdminGrantType[] = [
      'download_2m',
      'storage_1tb',
      'bundle_2m_1tb',
      'xerostar',
      'custom_days',
      'revoke',
    ];
    if (!rawUserId || !validGrants.includes(grantType)) {
      return res.status(400).json({ error: 'Invalid target UserID or subscription grant type.' });
    }

    const store = readStore();
    let targetUid = rawUserId;
    if (rawUserId.toUpperCase().startsWith('XTV-')) {
      const mapped = store.shortIdToUid[rawUserId.toUpperCase()];
      if (!mapped) {
        return res.status(404).json({ error: `No user found with UserID "${rawUserId.toUpperCase()}".` });
      }
      targetUid = mapped;
    }

    const record = store.users[targetUid];
    if (!record) {
      return res.status(404).json({ error: `User "${rawUserId}" does not exist.` });
    }

    const patch = calculateAdminGrantUpdate(record.account, grantType, customDays, Date.now());
    const amountPesos = calculateGrantAmountPesos(grantType);
    record.account = {
      ...record.account,
      ...patch,
    };
    record.updatedAtMs = Date.now();
    if (amountPesos > 0) {
      store.totalEarningsPesos += amountPesos;
    }
    writeStore(store);

    return res.json({
      targetUid,
      shortUserId: record.account.shortUserId,
      amountPesos,
      patch,
    });
  });

  app.get('/api/admin/promos', (req: Request, res: Response) => {
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: 'Admin verification required.' });
    }
    const store = readStore();
    const promos = Object.values(store.promoCodes).sort((a, b) => b.createdAtMs - a.createdAtMs);
    return res.json({ promos });
  });

  app.post('/api/admin/promos', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: 'Admin verification required.' });
    }
    const code = sanitizePromoCode(String(req.body?.code || ''));
    if (code.length < 3) {
      return res.status(400).json({ error: 'Promo code must be at least 3 characters (A-Z, 0-9, -, _).' });
    }
    const daysGranted = Math.max(0, Math.min(3650, Math.floor(Number(req.body?.daysGranted || 0))));
    const storageBonusGb = Math.max(0, Math.min(1024, Math.floor(Number(req.body?.storageBonusGb || 0))));
    const storageBonusBytes = storageBonusGb * ONE_GB_BYTES;

    const now = Date.now();
    const promo: StoredPromoRecord = {
      code,
      daysGranted,
      storageBonusBytes,
      active: true,
      createdAtMs: now,
      updatedAtMs: now,
    };
    const store = readStore();
    store.promoCodes[code] = promo;
    writeStore(store);
    return res.status(201).json({ promo });
  });

  app.patch('/api/admin/promos/:code', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: 'Admin verification required.' });
    }
    const clean = sanitizePromoCode(String(req.params.code || ''));
    const store = readStore();
    if (!store.promoCodes[clean]) {
      return res.status(404).json({ error: 'Promo code not found.' });
    }
    store.promoCodes[clean].active = Boolean(req.body?.active);
    store.promoCodes[clean].updatedAtMs = Date.now();
    writeStore(store);
    return res.json({ promo: store.promoCodes[clean] });
  });

  app.delete('/api/admin/promos/:code', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: 'Admin verification required.' });
    }
    const clean = sanitizePromoCode(String(req.params.code || ''));
    const store = readStore();
    delete store.promoCodes[clean];
    writeStore(store);
    return res.json({ ok: true });
  });

  app.patch('/api/admin/feedback/:id', (req: Request, res: Response) => {
    if (!isSafeBrowserMutation(req)) {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: 'Admin verification required.' });
    }
    const reportId = String(req.params.id || '');
    const nextStatus = req.body?.status === 'resolved' ? 'resolved' : 'open';
    const store = readStore();
    const item = store.feedbackReports.find((r) => r.id === reportId);
    if (!item) {
      return res.status(404).json({ error: 'Feedback report not found.' });
    }
    item.status = nextStatus;
    writeStore(store);
    return res.json({ report: item });
  });

  app.get('/api/admin/download-source-zip', async (req: Request, res: Response) => {
    const token = getAdminTokenFromReq(req) || (typeof req.query.token === 'string' ? req.query.token : undefined);
    if (!verifyAdminToken(token)) {
      return res.status(403).json({ error: 'Admin verification required.' });
    }

    try {
      const rootDir = process.cwd();
      const archive = await createZipArchiver();

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="XEROTV-Vercel-FullStack.zip"');

      archive.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) {
          res.status(500).json({ error: msg });
        } else if (!res.writableEnded) {
          res.end();
        }
      });

      archive.pipe(res);

      const includeFiles = [
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'vercel.json',
        'index.html',
        'server.ts',
        'metadata.json',
        '.npmrc',
        '.gitignore',
        '.gitattributes',
        '.env.example',
        'eslint.config.js',
        '.github/workflows/ci.yml',
      ];

      for (const relPath of includeFiles) {
        const fullPath = path.join(rootDir, relPath);
        if (fs.existsSync(fullPath)) {
          archive.file(fullPath, { name: relPath });
        }
      }

      const skipPublicSubdirs = process.env.VERCEL ? ['apps', 'media'] : [];
      const includeDirs = ['src', 'public', 'api'];
      for (const dirName of includeDirs) {
        const fullDir = path.join(rootDir, dirName);
        if (fs.existsSync(fullDir)) {
          appendFilteredDirectory(archive, fullDir, dirName, dirName === 'public' ? skipPublicSubdirs : []);
        }
      }

      archive.append(
        `# XEROTV — GitHub & Vercel Full-Stack Deployment Guide\n\n` +
          `1. Extract \`XEROTV-Vercel-FullStack.zip\`.\n` +
          `2. Push cleanly to GitHub (all binary rules, \`.gitignore\`, and GitHub Actions CI are preconfigured):\n` +
          `   \`\`\`bash\n` +
          `   git init -b main\n` +
          `   git add .\n` +
          `   git commit -m "Deploy XEROTV"\n` +
          `   git remote add origin https://github.com/<your-username>/<your-repo>.git\n` +
          `   git push -u origin main\n` +
          `   \`\`\`\n` +
          `3. Import the GitHub repository into **Vercel** (auto-detected via \`vercel.json\` + \`.npmrc\`), OR run \`npx vercel --prod\` directly in the folder.\n` +
          `4. Environment Variables in Vercel Project Settings:\n` +
          `   - \`ADMIN_ACCESS_CODE\` (defaults cleanly if unset)\n` +
          `   - \`TMDB_READ_TOKEN\` (preconfigured default included)\n` +
          `   - \`SESSION_SECRET\` (optional HMAC secret for session cookies; built-in XEROTV Sign In / Sign Up requires zero external auth APIs)\n`,
        { name: 'DEPLOY_VERCEL.md' },
      );

      await archive.finalize();
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Failed to export source ZIP archive.',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Native Mobile App (Flutter + Android WebView Wrapper) Cloud-Build APK Bundle
  // ---------------------------------------------------------------------------
  app.get('/api/apps/mobile-bundle', async (req: Request, res: Response) => {
    try {
      const hostUrl = resolvePublicOrigin(req);

      const archive = await createZipArchiver();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="XEROTV-Mobile-Native-App.zip"');

      archive.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) {
          res.status(500).json({ error: msg });
        } else if (!res.writableEnded) {
          res.end();
        }
      });

      archive.pipe(res);

      const rootDir = process.cwd();
      const iconPath = path.join(rootDir, 'public', 'pwa-512x512.png');
      if (fs.existsSync(iconPath)) {
        archive.file(iconPath, { name: 'assets/icon.png' });
      }

      archive.append(
        `name: xerotv_mobile
description: XEROTV Official Mobile App — Developed by XIAN IN PRODUCTION
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.3.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  webview_flutter: ^4.8.0
  connectivity_plus: ^6.0.3
  url_launcher: ^6.3.0

dev_dependencies:
  flutter_launcher_icons: ^0.13.1

flutter_launcher_icons:
  android: true
  ios: false
  image_path: "assets/icon.png"
  adaptive_icon_background: "#0A0A0C"
  adaptive_icon_foreground: "assets/icon.png"

flutter:
  uses-material-design: true
  assets:
    - assets/icon.png
`,
        { name: 'pubspec.yaml' },
      );

      archive.append(
        `import 'dart:async';
import 'dart:ui';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

const String kXeroTvHomeUrl = '${hostUrl}';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: Color(0xFF0A0A0C),
    systemNavigationBarIconBrightness: Brightness.light,
  ));
  runApp(const XeroTvApp());
}

class XeroTvApp extends StatelessWidget {
  const XeroTvApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'XEROTV',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF0A0A0C),
        colorScheme: const ColorScheme.dark(
          primary: Colors.white,
          surface: Color(0xFF121216),
        ),
      ),
      home: const XeroTvShell(),
    );
  }
}

class XeroTvShell extends StatefulWidget {
  const XeroTvShell({super.key});

  @override
  State<XeroTvShell> createState() => _XeroTvShellState();
}

class _XeroTvShellState extends State<XeroTvShell> {
  late final WebViewController _controller;
  late final StreamSubscription<List<ConnectivityResult>> _connectivitySub;
  bool _isSplashVisible = true;
  bool _isOffline = false;
  bool _hasLoadedOnce = false;
  int _progress = 0;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0A0A0C))
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (p) {
            if (mounted) setState(() => _progress = p);
          },
          onPageFinished: (_) {
            if (mounted) {
              setState(() {
                _hasLoadedOnce = true;
                _isSplashVisible = false;
              });
            }
          },
          onWebResourceError: (err) {
            if (err.isForMainFrame == true && !_hasLoadedOnce && mounted) {
              setState(() {
                _isOffline = true;
                _isSplashVisible = false;
              });
            }
          },
          onNavigationRequest: (request) {
            final uri = Uri.tryParse(request.url);
            if (uri != null && request.url.contains('facebook.com')) {
              launchUrl(uri, mode: LaunchMode.externalApplication);
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
        ),
      );

    _checkInitialConnectivityAndLoad();

    _connectivitySub = Connectivity().onConnectivityChanged.listen((results) {
      final offline = results.every((r) => r == ConnectivityResult.none);
      if (mounted) {
        setState(() => _isOffline = offline);
        if (!offline && !_hasLoadedOnce) {
          _controller.loadRequest(Uri.parse(kXeroTvHomeUrl));
        }
      }
    });

    Future.delayed(const Duration(seconds: 3), () {
      if (mounted && _isSplashVisible) {
        setState(() => _isSplashVisible = false);
      }
    });
  }

  Future<void> _checkInitialConnectivityAndLoad() async {
    final results = await Connectivity().checkConnectivity();
    final offline = results.every((r) => r == ConnectivityResult.none);
    if (mounted) {
      setState(() => _isOffline = offline);
    }
    if (!offline) {
      await _controller.loadRequest(Uri.parse(kXeroTvHomeUrl));
    } else if (mounted) {
      setState(() => _isSplashVisible = false);
    }
  }

  Future<void> _retryConnection() async {
    setState(() {
      _isSplashVisible = true;
      _isOffline = false;
    });
    await _checkInitialConnectivityAndLoad();
  }

  @override
  void dispose() {
    _connectivitySub.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _controller.canGoBack()) {
          await _controller.goBack();
        } else {
          await SystemNavigator.pop();
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              if (!_isOffline || _hasLoadedOnce)
                WebViewWidget(controller: _controller),
              if (_isOffline && !_hasLoadedOnce)
                _OfflineGlassCard(onRetry: _retryConnection),
              if (_isSplashVisible)
                _LiquidGlassSplash(progress: _progress),
            ],
          ),
        ),
      ),
    );
  }
}

class _LiquidGlassSplash extends StatelessWidget {
  final int progress;
  const _LiquidGlassSplash({required this.progress});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: RadialGradient(
          center: Alignment.topCenter,
          radius: 1.3,
          colors: [Color(0xFF1E1E24), Color(0xFF0A0A0C)],
        ),
      ),
      child: Center(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(28),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
            child: Container(
              width: 280,
              padding: const EdgeInsets.all(28),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(28),
                border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(20),
                    child: Image.asset('assets/icon.png', width: 76, height: 76),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'XEROTV',
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 2.2,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'XIAN IN PRODUCTION',
                    style: TextStyle(
                      fontSize: 11,
                      letterSpacing: 1.4,
                      color: Colors.white.withValues(alpha: 0.65),
                    ),
                  ),
                  const SizedBox(height: 20),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: LinearProgressIndicator(
                      value: progress > 0 && progress < 100 ? progress / 100.0 : null,
                      backgroundColor: Colors.white.withValues(alpha: 0.12),
                      color: Colors.white,
                      minHeight: 4,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OfflineGlassCard extends StatelessWidget {
  final VoidCallback onRetry;
  const _OfflineGlassCard({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      color: const Color(0xFF0A0A0C),
      child: Center(
        child: Container(
          padding: const EdgeInsets.all(28),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.07),
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: Colors.white.withValues(alpha: 0.16)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.wifi_off_rounded, size: 48, color: Colors.white70),
              const SizedBox(height: 14),
              const Text(
                'Internet Required to Sync',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
              ),
              const SizedBox(height: 8),
              Text(
                'Connect once to load your XEROTV catalog or play previously saved Offline Vault movies.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.7)),
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: onRetry,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: const Color(0xFF0A0A0C),
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('Retry Connection', style: TextStyle(fontWeight: FontWeight.w700)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
`,
        { name: 'lib/main.dart' },
      );

      archive.append(
        `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:label="XEROTV"
        android:name="\${applicationName}"
        android:icon="@mipmap/ic_launcher"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTop"
            android:taskAffinity=""
            android:theme="@style/LaunchTheme"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode"
            android:hardwareAccelerated="true"
            android:windowSoftInputMode="adjustResize">
            <meta-data
              android:name="io.flutter.embedding.android.NormalTheme"
              android:resource="@style/NormalTheme"
              />
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>
        <meta-data
            android:name="flutterEmbedding"
            android:value="2" />
    </application>
    <queries>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="https" />
        </intent>
    </queries>
</manifest>
`,
        { name: 'android-template/AndroidManifest.xml' },
      );

      archive.append(
        `#!/usr/bin/env bash
set -euo pipefail
flutter pub get
flutter create . --platforms=android --org com.xianinproduction --project-name xerotv_mobile
cp android-template/AndroidManifest.xml android/app/src/main/AndroidManifest.xml
dart run flutter_launcher_icons || true
flutter build apk --debug
mkdir -p out
cp build/app/outputs/flutter-apk/app-debug.apk out/XEROTV.apk
echo "Built out/XEROTV.apk successfully!"
`,
        { name: 'build-apk.sh' },
      );

      archive.append(
        `name: Build XEROTV Android APK
on:
  workflow_dispatch:
  push:
    branches: [ main, master ]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: 'zulu'
          java-version: '17'
      - uses: subosito/flutter-action@v2
        with:
          channel: 'stable'
      - run: flutter pub get
      - run: flutter create . --platforms=android --org com.xianinproduction --project-name xerotv_mobile
      - run: cp android-template/AndroidManifest.xml android/app/src/main/AndroidManifest.xml
      - run: dart run flutter_launcher_icons || true
      - run: flutter build apk --debug
      - run: mkdir -p dist-apk && cp build/app/outputs/flutter-apk/app-debug.apk dist-apk/XEROTV.apk
      - uses: actions/upload-artifact@v4
        with:
          name: XEROTV-Android-APK
          path: dist-apk/XEROTV.apk
`,
        { name: '.github/workflows/build-apk.yml' },
      );

      archive.append(
        `# XEROTV Mobile App (Android APK)

Target Server URL: ${hostUrl}
Developed by: XIAN IN PRODUCTION

## Option A — Cloud Build (No Android Studio / SDK Needed)
1. Create a new GitHub repository and upload all files from this ZIP.
2. Open the **Actions** tab -> select **Build XEROTV Android APK** -> click **Run workflow**.
3. Download the **XEROTV-Android-APK** artifact containing \`XEROTV.apk\` and install on your Android device.

## Option B — Local Build (If Flutter is installed)
\`\`\`bash
bash build-apk.sh
\`\`\`
Output APK: \`out/XEROTV.apk\`
`,
        { name: 'README.md' },
      );

      await archive.finalize();
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Failed to package mobile bundle.',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Probe whether a public target URL (Shared Cloud Run / Vercel) is live
  // ---------------------------------------------------------------------------
  app.get('/api/apps/check-public-url', async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const cleanUrl = resolvePublicAppOrigin(rawUrl, DEFAULT_SHARED_APP_URL);
    try {
      const probe = await fetch(`${cleanUrl}/api/health`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(4500),
      });
      const ct = (probe.headers.get('content-type') || '').toLowerCase();
      const reachable = probe.ok && ct.includes('application/json');
      return res.json({ url: cleanUrl, reachable, status: probe.status });
    } catch {
      return res.json({ url: cleanUrl, reachable: false, status: 0 });
    }
  });

  // ---------------------------------------------------------------------------
  // Direct Real Android APK Binary (/api/apps/android.apk) — Standalone & Signed
  // ---------------------------------------------------------------------------
  app.get('/api/apps/android.apk', async (req: Request, res: Response) => {
    if (process.env.VERCEL) {
      return res.redirect(302, '/apps/XEROTV.apk');
    }
    const hostUrl = resolvePublicOrigin(req);
    const rootDir = process.cwd();
    const builderScript = path.join(rootDir, 'android-builder', 'build_apk.sh');
    const prebuiltApk = path.join(rootDir, 'public', 'apps', 'XEROTV.apk');
    const sdkSigner = '/opt/android-sdk/build-tools/34.0.0/apksigner';

    try {
      let apkToServe = prebuiltApk;

      const versionTags = [
        path.join(rootDir, 'android-builder', 'LocalXeroServer.java'),
        path.join(rootDir, 'android-builder', 'MainActivity.java'),
        path.join(rootDir, 'dist', 'index.html'),
      ]
        .map((p) => (fs.existsSync(p) ? String(Math.floor(fs.statSync(p).mtimeMs)) : '0'))
        .join(':');

      if (fs.existsSync(sdkSigner) && fs.existsSync(builderScript)) {
        const cacheKey = crypto.createHash('sha1').update(`${hostUrl}|${versionTags}`).digest('hex').slice(0, 16);
        const cacheDir = '/tmp/xerotv-apk-cache';
        fs.mkdirSync(cacheDir, { recursive: true });
        const cachedApk = path.join(cacheDir, `xerotv-${cacheKey}.apk`);

        if (!fs.existsSync(cachedApk)) {
          await execFileAsync('bash', [builderScript, hostUrl, cachedApk], {
            timeout: 60_000,
          });
        }
        if (fs.existsSync(cachedApk)) {
          apkToServe = cachedApk;
        }
      }

      if (!fs.existsSync(apkToServe)) {
        return res.status(503).json({ error: 'Android APK artifact is not ready yet.' });
      }

      const stat = fs.statSync(apkToServe);
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="XEROTV.apk"');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store');
      return fs.createReadStream(apkToServe).pipe(res);
    } catch (error) {
      if (fs.existsSync(prebuiltApk)) {
        const stat = fs.statSync(prebuiltApk);
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', 'attachment; filename="XEROTV.apk"');
        res.setHeader('Content-Length', String(stat.size));
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-store');
        return fs.createReadStream(prebuiltApk).pipe(res);
      }
      return res.status(500).json({
        error: 'Failed to build XEROTV Android APK.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Direct Real iPhone / iPad Standalone App Profile (/api/apps/ios.mobileconfig)
  // ---------------------------------------------------------------------------
  app.get('/api/apps/ios.mobileconfig', (req: Request, res: Response) => {
    const hostUrl = resolvePublicOrigin(req);
    const rootDir = process.cwd();
    const iosIconPath = path.join(rootDir, 'public', 'apple-touch-icon.png');
    const fallbackIconPath = path.join(rootDir, 'public', 'pwa-192x192.png');

    let iconBase64 = '';
    try {
      const iconFile = fs.existsSync(iosIconPath) ? iosIconPath : fallbackIconPath;
      if (fs.existsSync(iconFile)) {
        iconBase64 = fs.readFileSync(iconFile).toString('base64');
      }
    } catch {
      iconBase64 = '';
    }

    const escapeXml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const uuidHash = crypto.createHash('sha256').update(`xerotv-ios:${hostUrl}`).digest('hex');
    const fmtUuid = (offset: number) =>
      `${uuidHash.slice(offset, offset + 8)}-${uuidHash.slice(offset + 8, offset + 12)}-4${uuidHash.slice(offset + 13, offset + 16)}-a${uuidHash.slice(offset + 17, offset + 20)}-${uuidHash.slice(offset + 20, offset + 32)}`.toUpperCase();

    const mobileConfigXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key>
      <true/>
      <key>Icon</key>
      <data>${iconBase64}</data>
      <key>IgnoreManifestScope</key>
      <false/>
      <key>IsRemovable</key>
      <true/>
      <key>Label</key>
      <string>XEROTV</string>
      <key>PayloadDescription</key>
      <string>Installs standalone full-screen XEROTV App on iPhone and iPad Home Screen</string>
      <key>PayloadDisplayName</key>
      <string>XEROTV</string>
      <key>PayloadIdentifier</key>
      <string>com.xianinproduction.xerotv.webclip</string>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key>
      <string>${fmtUuid(0)}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>Precomposed</key>
      <true/>
      <key>URL</key>
      <string>${escapeXml(hostUrl)}</string>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Official XEROTV Mobile App for iPhone and iPad — Developed by XIAN IN PRODUCTION</string>
  <key>PayloadDisplayName</key>
  <string>XEROTV</string>
  <key>PayloadIdentifier</key>
  <string>com.xianinproduction.xerotv.profile</string>
  <key>PayloadOrganization</key>
  <string>XIAN IN PRODUCTION</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${fmtUuid(16)}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;

    res.setHeader('Content-Type', 'application/x-apple-aspen-config');
    res.setHeader('Content-Disposition', 'attachment; filename="XEROTV-iPhone.mobileconfig"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(mobileConfigXml);
  });

  // ---------------------------------------------------------------------------
  // XeroHots AdultColony-API Integration (XEROSTAR VIP ₱150)
  // ---------------------------------------------------------------------------
  interface XeroHotsVideo {
    id: string;
    title: string;
    duration: string;
    views: string;
    rating: string;
    thumbnail: string;
    embedUrl: string;
    sourceUrl: string;
    provider: 'eporner' | 'xvideos' | 'pornhub';
    uploader: string;
  }

  const xeroHotsCache = new Map<string, { items: XeroHotsVideo[]; expiresAt: number }>();

  const HOTS_BROWSER_HEADERS = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  async function fetchEpornerAdultColony(q: string, page: number): Promise<XeroHotsVideo[]> {
    const query = (q || 'trending').trim() || 'trending';
    const url = `https://www.eporner.com/api/v2/video/search/?query=${encodeURIComponent(
      query,
    )}&per_page=18&page=${page}&thumbsize=big&order=top-weekly&format=json`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...HOTS_BROWSER_HEADERS },
      signal: AbortSignal.timeout(4800),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      videos?: Array<{
        id?: string;
        title?: string;
        length_min?: string;
        views?: number;
        rate?: string;
        default_thumb?: { src?: string };
        embed?: string;
        url?: string;
      }>;
    };
    return (data.videos || [])
      .filter((v) => v.id && v.title && v.default_thumb?.src)
      .map((v) => ({
        id: String(v.id),
        title: String(v.title),
        duration: v.length_min || 'HD',
        views: typeof v.views === 'number' ? v.views.toLocaleString() : '—',
        rating: v.rate && Number(v.rate) > 0 ? `${v.rate}/5` : 'HD',
        thumbnail: String(v.default_thumb?.src || ''),
        embedUrl: `https://www.eporner.com/embed/${encodeURIComponent(String(v.id))}/`,
        sourceUrl: String(v.url || `https://www.eporner.com/video-${v.id}/`),
        provider: 'eporner' as const,
        uploader: 'Eporner HD',
      }));
  }

  async function fetchXvideosAdultColony(q: string, page: number): Promise<XeroHotsVideo[]> {
    const term = (q || '').trim();
    const url = term
      ? `https://www.xvideos.com/?k=${encodeURIComponent(term)}&p=${Math.max(0, page - 1)}`
      : page > 1
        ? `https://www.xvideos.com/new/${page}`
        : 'https://www.xvideos.com/?k=trending';
    const res = await fetch(url, {
      headers: HOTS_BROWSER_HEADERS,
      signal: AbortSignal.timeout(4800),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: XeroHotsVideo[] = [];
    $('div.mozaique div.thumb-block').each((_, el) => {
      if (items.length >= 18) return false;
      const id = $(el).attr('data-id') || '';
      const a = $(el).find('.thumb-under p.title a');
      const img = $(el).find('.thumb img');
      const title = (a.attr('title') || a.text() || '').trim();
      const href = a.attr('href') || '';
      const dur = $(el).find('.thumb-under p.title span.duration').text().trim();
      const thumb = img.attr('data-src') || img.attr('src') || '';
      if (!id || !title || !thumb) return;
      items.push({
        id,
        title,
        duration: dur || 'HD',
        views: 'Verified',
        rating: 'XVideos',
        thumbnail: thumb.startsWith('//') ? `https:${thumb}` : thumb,
        embedUrl: `https://www.xvideos.com/embedframe/${encodeURIComponent(id)}`,
        sourceUrl: href.startsWith('http') ? href : `https://www.xvideos.com${href}`,
        provider: 'xvideos',
        uploader: $(el).find('.metadata .name').text().trim() || 'XVideos Channel',
      });
      return undefined;
    });
    return items;
  }

  async function fetchPornhubAdultColony(q: string, page: number): Promise<XeroHotsVideo[]> {
    const term = (q || '').trim();
    const url = term
      ? `https://www.pornhub.com/video/search?search=${encodeURIComponent(term)}&page=${page}`
      : `https://www.pornhub.com/video?o=tr&page=${page}`;
    const res = await fetch(url, {
      headers: { ...HOTS_BROWSER_HEADERS, Cookie: 'accessAgeDisclaimerPH=1' },
      signal: AbortSignal.timeout(4800),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: XeroHotsVideo[] = [];
    $('li.pcVideoListItem, ul.videos li.videoblock').each((_, el) => {
      if (items.length >= 18) return false;
      const vk = $(el).attr('data-video-vkey') || '';
      const a = $(el).find('span.title a').first();
      const title = (a.attr('title') || a.text() || $(el).find('a').attr('title') || '').trim();
      const img = $(el).find('img').first();
      const thumb =
        img.attr('data-src') || img.attr('data-thumb_url') || img.attr('src') || '';
      const dur = $(el).find('.duration').first().text().trim();
      const views = $(el).find('.views var').first().text().trim();
      if (!vk || !title || !thumb || thumb.startsWith('data:')) return;
      items.push({
        id: vk,
        title,
        duration: dur || 'HD',
        views: views || 'Hot',
        rating: 'Pornhub',
        thumbnail: thumb.startsWith('//') ? `https:${thumb}` : thumb,
        embedUrl: `https://www.pornhub.com/embed/${encodeURIComponent(vk)}`,
        sourceUrl: `https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(vk)}`,
        provider: 'pornhub',
        uploader: $(el).find('.usernameWrap a').first().text().trim() || 'Pornhub Creator',
      });
      return undefined;
    });
    return items;
  }

  async function queryAdultColony(provider: string, query: string, page: number) {
    const cleanProv = ['eporner', 'xvideos', 'pornhub', 'all'].includes(provider)
      ? provider
      : 'all';
    const cleanQuery = query.slice(0, 80).trim();
    const cacheKey = `${cleanProv}:${cleanQuery}:${page}`;
    const hit = xeroHotsCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.items;
    }

    let items: XeroHotsVideo[] = [];
    if (cleanProv === 'eporner') {
      items = await fetchEpornerAdultColony(cleanQuery, page).catch(() => []);
    } else if (cleanProv === 'xvideos') {
      items = await fetchXvideosAdultColony(cleanQuery, page).catch(() => []);
    } else if (cleanProv === 'pornhub') {
      items = await fetchPornhubAdultColony(cleanQuery, page).catch(() => []);
    } else {
      const [epRes, xvRes, phRes] = await Promise.allSettled([
        fetchEpornerAdultColony(cleanQuery, page),
        fetchXvideosAdultColony(cleanQuery, page),
        fetchPornhubAdultColony(cleanQuery, page),
      ]);
      const ep = epRes.status === 'fulfilled' ? epRes.value : [];
      const xv = xvRes.status === 'fulfilled' ? xvRes.value : [];
      const ph = phRes.status === 'fulfilled' ? phRes.value : [];
      const maxLen = Math.max(ep.length, xv.length, ph.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < ep.length) items.push(ep[i]);
        if (i < xv.length) items.push(xv[i]);
        if (i < ph.length) items.push(ph[i]);
      }
    }

    if (xeroHotsCache.size > 150) {
      const firstKey = xeroHotsCache.keys().next().value;
      if (firstKey) xeroHotsCache.delete(firstKey);
    }
    xeroHotsCache.set(cacheKey, { items, expiresAt: Date.now() + 90_000 });
    return items;
  }

  app.get('/api/xerohots/feed', async (req: Request, res: Response) => {
    const provider = String(req.query.provider || 'all').toLowerCase();
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));
    try {
      const items = await queryAdultColony(provider, '', page);
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      res.json({ ok: true, provider, page, items });
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: 'Unable to load XeroHots stream feed.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/xerohots/search', async (req: Request, res: Response) => {
    const q = String(req.query.q || req.query.query || '').trim();
    const provider = String(req.query.provider || 'all').toLowerCase();
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));
    try {
      const items = await queryAdultColony(provider, q, page);
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      res.json({ ok: true, provider, query: q, page, items });
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: 'XeroHots search failed.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Clean JSON 404 for unknown /api/* paths
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Global Express error handler so uncaught async/sync errors return structured JSON instead of crashing Vercel runtime
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled XEROTV API error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal API error',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return app;
}

let vercelAppInstance: ReturnType<typeof createApiApp> | null = null;

function normalizeVercelServerlessUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const xeroPath = parsed.searchParams.get('__xero_path');
    if (xeroPath !== null) {
      parsed.searchParams.delete('__xero_path');
      const cleaned = xeroPath.replace(/^\/+/, '').replace(/^api\/+/, '');
      const qs = parsed.searchParams.toString();
      return `/api/${cleaned || 'health'}${qs ? `?${qs}` : ''}`;
    }
    if (
      parsed.pathname === '/' ||
      parsed.pathname === '/api' ||
      parsed.pathname === '/api/index' ||
      parsed.pathname === '/api/index.ts'
    ) {
      const qs = parsed.searchParams.toString();
      return `/api/health${qs ? `?${qs}` : ''}`;
    }
    if (!parsed.pathname.startsWith('/api/')) {
      const qs = parsed.searchParams.toString();
      return `/api${parsed.pathname.startsWith('/') ? '' : '/'}${parsed.pathname}${qs ? `?${qs}` : ''}`;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

export default function handler(req: Request, res: Response) {
  try {
    req.url = normalizeVercelServerlessUrl(req.url || '/');
    if (!vercelAppInstance) {
      vercelAppInstance = createApiApp();
    }
    return vercelAppInstance(req, res);
  } catch (error) {
    console.error('Fatal XEROTV handler error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Serverless API handler error',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
