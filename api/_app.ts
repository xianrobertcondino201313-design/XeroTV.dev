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
import {
  isAllowedCinemaArchiveUrl,
  selectOrderedOpenStreams,
} from '../src/utils/cinemaStreams';
import {
  findCategoryById,
  getCategoriesForProvider,
  isAllowedXeroHotsUrl,
  normalizeExternalThumbUrl,
  XEROHOTS_SORT_OPTIONS,
  type XeroHotsProviderId,
  type XeroHotsSortId,
  type XeroHotsVideo,
} from '../src/utils/xerohots';
import {
  classifyStardustCategory,
  convertSrtToVtt,
  getShortDramaCategories,
  isAllowedShortDramaUrl,
  rewriteHlsManifestUrls,
  SHORT_DRAMA_PROVIDERS,
  slugifyDramaTitle,
  stripHtmlTags,
  type ShortDramaDetail,
  type ShortDramaEpisode,
  type ShortDramaProviderId,
  type ShortDramaSeries,
} from '../src/utils/shortDrama';

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

// Deterministic deployment-scoped signing seed so Vercel lambdas share identical HMAC verification
const STABLE_DEPLOY_SEED =
  process.env.SESSION_SECRET ||
  process.env.ADMIN_SESSION_SECRET ||
  process.env.ADMIN_ACCESS_CODE ||
  `${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_PROJECT_ID || process.env.HOSTNAME || 'xerotv.vercel.app'}:xianinproduction-v1-key`;

const ADMIN_SECRET_SIGNING_KEY = crypto
  .createHash('sha256')
  .update(STABLE_DEPLOY_SEED)
  .digest();

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

const STREAM_BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function probeSingleStreamMirror(
  url: string,
  mirrorIndex: number,
  timeoutMs: number,
  label: string = 'XEROTV Stream',
): Promise<{ url: string; mirrorIndex: number; totalBytes: number; contentType: string; label: string }> {
  const probe = await fetch(url, {
    redirect: 'follow',
    headers: { ...STREAM_BROWSER_HEADERS, Range: 'bytes=0-0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const contentType = (probe.headers.get('content-type') || 'video/mp4').toLowerCase();
  if (
    (!probe.ok && probe.status !== 206) ||
    contentType.includes('text/html') ||
    contentType.includes('application/json') ||
    contentType.includes('mpegurl')
  ) {
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
  return {
    url,
    mirrorIndex,
    totalBytes,
    contentType: contentType.includes('webm') ? 'video/webm' : 'video/mp4',
    label,
  };
}

function getLocalImprovingMp4Path(): string | null {
  const videoPath = path.resolve(process.cwd(), 'public', 'media', 'improving-v1.mp4');
  return fs.existsSync(videoPath) ? videoPath : null;
}

interface CachedStreamMeta {
  value: { url: string; mirrorIndex: number; totalBytes: number; contentType: string; label: string };
  expiresAt: number;
}
const streamMetaCache = new Map<string, CachedStreamMeta>();

async function searchTitleMatchArchiveMp4(
  title: string,
  quality: string,
): Promise<{ url: string; label: string } | null> {
  const cleanWords = title
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 3);
  if (cleanWords.length === 0) return null;

  try {
    const query = `mediatype:movies AND format:MPEG4 AND -collection:adult AND -subject:nsfw AND title:(${cleanWords.join(' ')})`;
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
      query,
    )}&fl[]=identifier,title&sort[]=downloads+desc&rows=4&page=1&output=json`;
    const r = await fetch(searchUrl, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      response?: { docs?: Array<{ identifier?: string; title?: string }> };
    };
    const topDoc = (j.response?.docs || [])[0];
    if (!topDoc?.identifier) return null;

    const metaRes = await fetch(
      `https://archive.org/metadata/${encodeURIComponent(topDoc.identifier)}/files`,
      { signal: AbortSignal.timeout(1500) },
    );
    if (!metaRes.ok) return null;
    const metaJson = (await metaRes.json()) as {
      result?: Array<{ name?: string; size?: string | number }>;
    };
    const maxBytes = quality === 'standard' ? 45_000_000 : 95_000_000;
    const mp4s = (metaJson.result || []).filter(
      (f) =>
        f.name &&
        f.name.endsWith('.mp4') &&
        Number(f.size) > 1_500_000 &&
        Number(f.size) <= maxBytes,
    );
    if (mp4s.length === 0) return null;
    mp4s.sort((a, b) => Number(a.size) - Number(b.size));
    const url = `https://archive.org/download/${encodeURIComponent(topDoc.identifier)}/${encodeURI(mp4s[0].name!)}`;
    if (!isAllowedCinemaArchiveUrl(url)) return null;
    return { url, label: String(topDoc.title || cleanWords.join(' ')) };
  } catch {
    return null;
  }
}

async function resolveWorkingStreamMeta(params: {
  tmdbId: number;
  mediaType: string;
  title: string;
  quality: string;
  reqOrigin?: string;
  preferredMirror?: number;
  directUrl?: string;
}): Promise<{
  url: string;
  mirrorIndex: number;
  totalBytes: number;
  contentType: string;
  label: string;
} | null> {
  if (params.directUrl && isAllowedXeroHotsUrl(params.directUrl)) {
    try {
      return await probeSingleStreamMirror(params.directUrl, 888, 3500, params.title || 'XeroHots MP4');
    } catch {
      // fall through cleanly if upstream direct url temporarily rejects probe
    }
  }

  const ordered = selectOrderedOpenStreams({
    tmdbId: params.tmdbId,
    mediaType: params.mediaType,
    title: params.title,
    quality: params.quality,
    preferredMirror: params.preferredMirror,
  });

  const primaryIdx = ordered[0].mirrorIndex;
  const cacheKey = `${params.mediaType}:${params.tmdbId}:${params.quality}:${primaryIdx}`;
  const cached = streamMetaCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // First try lightweight title-specific public-domain cinema match cleanly (only if quick)
  if (params.mediaType !== 'xerohots' && params.title && params.preferredMirror === undefined) {
    const archiveHit = await searchTitleMatchArchiveMp4(params.title, params.quality);
    if (archiveHit) {
      try {
        const found = await probeSingleStreamMirror(
          archiveHit.url,
          primaryIdx,
          2000,
          archiveHit.label,
        );
        streamMetaCache.set(cacheKey, { value: found, expiresAt: Date.now() + 180_000 });
        return found;
      } catch {
        // continue deterministically to curated distinct catalog
      }
    }
  }

  // Deterministically probe the title's own assigned unique slot FIRST (never Promise.any racing back to Big Buck Bunny!)
  for (let attempt = 0; attempt < Math.min(4, ordered.length); attempt++) {
    const candidate = ordered[attempt];
    try {
      const found = await probeSingleStreamMirror(
        candidate.url,
        candidate.mirrorIndex,
        2400,
        candidate.label,
      );
      if (streamMetaCache.size > 300) {
        const oldest = streamMetaCache.keys().next().value;
        if (oldest) streamMetaCache.delete(oldest);
      }
      streamMetaCache.set(cacheKey, { value: found, expiresAt: Date.now() + 180_000 });
      return found;
    } catch {
      // advance deterministically to next distinct movie slot
    }
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
        label: 'XEROTV Local Stream',
      };
    }
  }

  if (params.reqOrigin && /^https?:\/\//i.test(params.reqOrigin)) {
    try {
      return await probeSingleStreamMirror(
        `${params.reqOrigin.replace(/\/+$/, '')}/media/improving-v1.mp4`,
        LOCAL_FALLBACK_MIRROR_INDEX,
        3000,
        'XEROTV Stream',
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
  timeoutMs: number = 6000,
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
      signal: AbortSignal.timeout(timeoutMs),
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
// Server-Side Persistent Store + Cross-Lambda Signed Cookie Credential Vault
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
    // non-fatal on read-only paths; in-memory state + signed vault cookies remain active
  }
}

interface CompactVaultEntry {
  u: AuthUser;
  a: UserSubscriptionState;
  p?: string;
  t: number;
}

interface AccountVaultCookiePayload {
  kind: 'acct_vault';
  records: CompactVaultEntry[];
  exp: number;
}

function hydrateStoreFromCookies(req: Request): PersistentStoreData {
  const store = readStore();
  const cookies = parseCookies(req);
  const vaultToken = cookies.xtv_acct_vault;
  const vault = verifyHmacPayload<AccountVaultCookiePayload>(vaultToken);
  if (vault?.kind === 'acct_vault' && Array.isArray(vault.records)) {
    let changed = false;
    for (const rec of vault.records) {
      if (!rec?.u?.uid || !rec?.a) continue;
      const uid = rec.u.uid;
      const existing = store.users[uid];
      const incomingTime = Number(rec.t || 0);
      if (!existing || incomingTime >= (existing.updatedAtMs || 0)) {
        const shortUserId = rec.a.shortUserId || generateShortUserId(uid);
        store.users[uid] = {
          user: rec.u,
          account: { ...rec.a, shortUserId },
          passwordHash: rec.p || existing?.passwordHash,
          emailNormalized: normalizeAuthEmail(rec.u.email),
          usernameNormalized: normalizeAuthUsername(rec.u.username || rec.u.displayName),
          createdAtMs: existing?.createdAtMs || incomingTime || Date.now(),
          updatedAtMs: incomingTime || Date.now(),
        };
        store.shortIdToUid[shortUserId] = uid;
        changed = true;
      }
    }
    if (changed) {
      writeStore(store);
    }
  }
  return store;
}

function buildCookieString(name: string, value: string, maxAgeSec: number, isHttps: boolean): string {
  const encoded = value ? encodeURIComponent(value) : '';
  if (isHttps) {
    return `${name}=${encoded}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${maxAgeSec}`;
  }
  // Plain http://localhost:3000 browsers can reject Secure/SameSite=None cookies on non-HTTPS origins
  return `${name}=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function isRequestHttps(req: Request): boolean {
  const fwdProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  if (fwdProto === 'https') return true;
  if (req.secure) return true;
  const host = String(req.get('host') || '').toLowerCase();
  return !host.startsWith('localhost') && !host.startsWith('127.0.0.1') && !host.startsWith('0.0.0.0');
}

function buildAuthCookieHeader(token: string, maxAgeSec: number, req?: Request): string {
  return buildCookieString('xtv_auth_session', token, maxAgeSec, req ? isRequestHttps(req) : true);
}

function buildAccountVaultCookieHeader(
  store: PersistentStoreData,
  priorityUid?: string,
  req?: Request,
): string | null {
  const all = Object.values(store.users)
    .filter((r) => Boolean(r.user?.uid))
    .sort((a, b) => {
      if (priorityUid && a.user.uid === priorityUid) return -1;
      if (priorityUid && b.user.uid === priorityUid) return 1;
      return (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
    });

  // Pack up to 4 newest accounts safely under 3400 bytes total header size
  for (let limit = Math.min(4, all.length); limit >= 1; limit--) {
    const records: CompactVaultEntry[] = all.slice(0, limit).map((r) => ({
      u: r.user,
      a: r.account,
      p: r.passwordHash,
      t: r.updatedAtMs || Date.now(),
    }));
    const token = signHmacPayload({
      kind: 'acct_vault',
      records,
      exp: Date.now() + 90 * 24 * 60 * 60 * 1000,
    });
    if (token.length < 3400 || limit === 1) {
      return buildCookieString(
        'xtv_acct_vault',
        token,
        90 * 24 * 60 * 60,
        req ? isRequestHttps(req) : true,
      );
    }
  }
  return null;
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
  const store = hydrateStoreFromCookies(req);
  const token = getUserTokenFromReq(req);
  const parsed = verifyHmacPayload<SignedUserSessionPayload>(token);
  if (!parsed || parsed.kind !== 'user_auth' || !parsed.user?.uid) {
    return null;
  }

  const uid = parsed.user.uid;
  const existing = store.users[uid];
  if (existing) {
    return { user: existing.user, account: existing.account };
  }

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
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(password, salt, 32).toString('base64url');
  return `s:${salt}:${derived}`;
}

function verifyUserPassword(password: string, storedHash: string | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  try {
    if (storedHash.startsWith('s:')) {
      const parts = storedHash.split(':');
      if (parts.length !== 3) return false;
      const [, salt, b64] = parts;
      if (!salt || !b64) return false;
      const expected = Buffer.from(b64, 'base64url');
      const actual = crypto.scryptSync(password, salt, 32);
      return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    }
    const [salt, hex] = storedHash.split(':');
    if (!salt || !hex) return false;
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

function isSafeBrowserMutation(req: Request): boolean {
  if (req.headers.authorization?.startsWith('Bearer ')) return true;
  if (String(req.get('x-requested-with') || '') === 'XEROTV') return true;
  const origin = String(req.get('origin') || req.get('referer') || '').trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function normalizeVercelServerlessUrl(rawUrl: string): string {
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
      parsed.pathname === '/api/index.mjs' ||
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

export function createApiApp() {
  const app = express();
  const jsonParser = express.json({ limit: '1mb' });

  // Prevent body-parser hangs if @vercel/node already pre-populated req.body
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.url.includes('__xero_path=')) {
      req.url = normalizeVercelServerlessUrl(req.url);
    }
    if (req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }
    return jsonParser(req, res, next);
  });

  // Anti-Exploit Security Headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Sliding-window API rate limiter (excludes video chunk streaming)
  const apiRateMap = new Map<string, { count: number; resetAt: number }>();
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (
      req.path === '/download/stream' ||
      req.path === '/xerohots/stream' ||
      req.path === '/xerohots/download' ||
      req.path === '/drama/hls' ||
      req.path === '/drama/hls-segment' ||
      req.path === '/drama/subtitle' ||
      req.path === '/health'
    ) {
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
    if (record.count > 300) {
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
  // Built-In XEROTV Authentication (Stateless Cross-Lambda Vault + Zero External APIs)
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

    const store = hydrateStoreFromCookies(req);
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
    const cookiesToSet = [buildAuthCookieHeader(token, 30 * 24 * 60 * 60, req)];
    const vaultCookie = buildAccountVaultCookieHeader(store, uid, req);
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    res.setHeader('Set-Cookie', cookiesToSet);

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

    const store = hydrateStoreFromCookies(req);
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
    const cookiesToSet = [buildAuthCookieHeader(token, 30 * 24 * 60 * 60, req)];
    const vaultCookie = buildAccountVaultCookieHeader(store, record.user.uid, req);
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    res.setHeader('Set-Cookie', cookiesToSet);

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
    res.setHeader('Set-Cookie', buildAuthCookieHeader('', 0, req));
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

    const store = hydrateStoreFromCookies(req);
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
    const cookiesToSet = [buildAuthCookieHeader(token, 30 * 24 * 60 * 60, req)];
    const vaultCookie = buildAccountVaultCookieHeader(store, record.user.uid, req);
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    res.setHeader('Set-Cookie', cookiesToSet);

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

    const store = hydrateStoreFromCookies(req);
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
    const cookiesToSet = [buildAuthCookieHeader(token, 30 * 24 * 60 * 60, req)];
    const vaultCookie = buildAccountVaultCookieHeader(store, record.user.uid, req);
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    res.setHeader('Set-Cookie', cookiesToSet);

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
    const store = hydrateStoreFromCookies(req);
    const record = store.users[session.user.uid];
    if (!record) {
      return res.status(404).json({ ok: false, error: 'Account not found.' });
    }

    record.account.storageUsedBytes = bytes;
    record.updatedAtMs = Date.now();
    writeStore(store);

    const token = signUserAuthToken(record.user, record.account);
    const cookiesToSet = [buildAuthCookieHeader(token, 30 * 24 * 60 * 60, req)];
    const vaultCookie = buildAccountVaultCookieHeader(store, record.user.uid, req);
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    res.setHeader('Set-Cookie', cookiesToSet);

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

  app.get('/api/platform/pulse', (req: Request, res: Response) => {
    const store = hydrateStoreFromCookies(req);
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
  app.use('/api/tmdb', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'public, max-age=180, s-maxage=300, stale-while-revalidate=600');
    next();
  });

  app.get('/api/tmdb/feed', async (req: Request, res: Response) => {
    const mode = String(req.query.mode || 'main');
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));

    const readSettledResults = (
      settled: PromiseSettledResult<{ results: Record<string, unknown>[] }>,
    ): Record<string, unknown>[] => (settled.status === 'fulfilled' ? settled.value.results || [] : []);

    try {
      if (mode === 'kids') {
        const kidsBlocked = new Set([27, 53, 80, 10752, 10768, 9648]);
        const settled = await Promise.allSettled([
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
        if (settled.every((s) => s.status === 'rejected')) {
          throw new Error('All TMDB kids catalog queries failed.');
        }

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
            { id: 'featured', title: 'Kids PG Cinema', items: tag(readSettledResults(settled[0]), 'movie') },
            { id: 'animated', title: 'Animated Adventures', items: tag(readSettledResults(settled[1]), 'movie') },
            { id: 'series', title: 'Family & Kids Series', items: tag(readSettledResults(settled[2]), 'tv') },
          ],
        });
      }

      if (mode === 'adult') {
        const settled = await Promise.allSettled([
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
        if (settled.every((s) => s.status === 'rejected')) {
          throw new Error('All TMDB mature catalog queries failed.');
        }

        const tag = (list: Record<string, unknown>[], media_type: 'movie' | 'tv') =>
          (list || []).map((item) => ({ ...item, media_type }));

        return res.json({
          mode,
          sections: [
            { id: 'featured', title: '18+ Mature & Romance', items: tag(readSettledResults(settled[0]), 'movie') },
            { id: 'thriller', title: 'R-Rated Thrillers & Noir', items: tag(readSettledResults(settled[1]), 'movie') },
            { id: 'series', title: 'Uncut Mature Series', items: tag(readSettledResults(settled[2]), 'tv') },
          ],
        });
      }

      if (mode === 'christmas') {
        const settled = await Promise.allSettled([
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
        if (settled.every((s) => s.status === 'rejected')) {
          throw new Error('All TMDB holiday catalog queries failed.');
        }

        const tag = (list: Record<string, unknown>[], media_type: 'movie' | 'tv') =>
          (list || []).map((item) => ({ ...item, media_type }));

        return res.json({
          mode,
          sections: [
            { id: 'featured', title: 'Christmas Spotlight', items: tag(readSettledResults(settled[0]), 'movie') },
            { id: 'santa', title: 'Santa & Holiday Classics', items: tag(readSettledResults(settled[1]), 'movie') },
            { id: 'series', title: 'Winter Holiday Specials', items: tag(readSettledResults(settled[2]), 'tv') },
          ],
        });
      }

      const settled = await Promise.allSettled([
        tmdbFetch<{ results: Record<string, unknown>[] }>('/trending/all/week', { page, include_adult: false }),
        tmdbFetch<{ results: Record<string, unknown>[] }>('/movie/popular', { page, include_adult: false }),
        tmdbFetch<{ results: Record<string, unknown>[] }>('/movie/now_playing', { page, include_adult: false }),
        tmdbFetch<{ results: Record<string, unknown>[] }>('/tv/top_rated', { page, include_adult: false }),
      ]);
      if (settled.every((s) => s.status === 'rejected')) {
        throw new Error('All TMDB main catalog queries failed.');
      }

      const tag = (list: Record<string, unknown>[], defaultType?: 'movie' | 'tv') =>
        (list || [])
          .filter((item) => item.media_type !== 'person' && !item.adult)
          .map((item) => ({ ...item, media_type: item.media_type || defaultType || 'movie' }));

      return res.json({
        mode: 'main',
        sections: [
          { id: 'featured', title: 'Trending Worldwide', items: tag(readSettledResults(settled[0])) },
          { id: 'popular', title: 'Popular Cinema', items: tag(readSettledResults(settled[1]), 'movie') },
          { id: 'now_playing', title: 'Now Playing in Theaters', items: tag(readSettledResults(settled[2]), 'movie') },
          { id: 'series', title: 'Acclaimed Series', items: tag(readSettledResults(settled[3]), 'tv') },
        ].filter((sec) => sec.items.length > 0),
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
    const typeFilter = String(req.query.type || 'all').toLowerCase();
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
      const settled = await Promise.allSettled([
        tmdbFetch<{ results: Record<string, unknown>[] }>('/movie/now_playing', { page: 1, include_adult: false }),
        tmdbFetch<{ results: Record<string, unknown>[] }>('/tv/airing_today', { page: 1, include_adult: false }),
      ]);
      if (settled.every((s) => s.status === 'rejected')) {
        throw new Error('Failed to reach TMDB releases.');
      }
      const movies = settled[0].status === 'fulfilled' ? settled[0].value.results || [] : [];
      const tvShows = settled[1].status === 'fulfilled' ? settled[1].value.results || [] : [];
      const items = [
        ...movies.slice(0, 4).map((m) => ({ ...m, media_type: 'movie' })),
        ...tvShows.slice(0, 3).map((t) => ({ ...t, media_type: 'tv' })),
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
  // Real Playable Offline Movie & XeroHots Stream Proxy (Unique Stream Per Title)
  // ---------------------------------------------------------------------------
  app.get('/api/download/info', async (req: Request, res: Response) => {
    try {
      const tmdbId = Math.abs(Number(req.query.tmdbId || 1) || 1);
      const mediaType = String(req.query.mediaType || 'movie');
      const quality = String(req.query.quality || 'standard');
      const rawTitle = String(req.query.title || 'xerotv-movie');
      const safeTitle = rawTitle.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'xerotv-movie';

      let verifiedDirectUrl: string | undefined;
      const directToken = typeof req.query.directToken === 'string' ? req.query.directToken.trim() : '';
      if (directToken) {
        const parsed = verifyHmacPayload<{ kind?: string; url?: string }>(directToken);
        if (parsed?.kind === 'hots_media' && parsed.url && isAllowedXeroHotsUrl(parsed.url)) {
          verifiedDirectUrl = parsed.url;
        }
      }

      const origin = `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
      const meta = await resolveWorkingStreamMeta({
        tmdbId,
        mediaType,
        title: rawTitle,
        quality,
        reqOrigin: origin,
        directUrl: verifiedDirectUrl,
      });

      if (!meta) {
        return res.status(502).json({
          error: 'No upstream video mirror is currently reachable. Please try again in a moment.',
        });
      }

      const isExternalRemote =
        /^https?:\/\//i.test(meta.url) &&
        (isAllowedCinemaArchiveUrl(meta.url) || isAllowedXeroHotsUrl(meta.url));

      const streamToken = isExternalRemote
        ? signHmacPayload({
            kind: 'download_stream',
            url: meta.url,
            exp: Date.now() + 6 * 60 * 60 * 1000,
          })
        : '';

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        mirrorIndex: meta.mirrorIndex,
        streamToken,
        sourceLabel: meta.label,
        totalBytes: meta.totalBytes,
        contentType: meta.contentType,
        chunkBytes: MAX_CHUNK_BYTES,
        filename: `${safeTitle}-${tmdbId}.mp4`,
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
    const mediaType = String(req.query.mediaType || 'movie');
    const quality = String(req.query.quality || 'standard');
    const rawTitle = String(req.query.title || 'xerotv-movie');
    const mirrorIndexParam =
      req.query.mirrorIndex !== undefined ? Number(req.query.mirrorIndex) : undefined;
    const title = rawTitle.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'xerotv-movie';

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

    let pinnedUrl: string | null = null;
    const streamToken = typeof req.query.streamToken === 'string' ? req.query.streamToken.trim() : '';
    if (streamToken) {
      const verified = verifyHmacPayload<{ kind?: string; url?: string }>(streamToken);
      if (
        verified?.kind === 'download_stream' &&
        verified.url &&
        (isAllowedCinemaArchiveUrl(verified.url) || isAllowedXeroHotsUrl(verified.url))
      ) {
        pinnedUrl = verified.url;
      }
    }

    const ordered = selectOrderedOpenStreams({
      tmdbId,
      mediaType,
      title: rawTitle,
      quality,
      preferredMirror: mirrorIndexParam,
    });

    const candidateUrls = pinnedUrl
      ? [pinnedUrl, ...ordered.slice(0, 2).map((o) => o.url)]
      : ordered.map((o) => o.url);

    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
    });

    try {
      let upstream: globalThis.Response | null = null;
      const maxAttempts = pinnedUrl ? 2 : Math.min(4, candidateUrls.length);

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (clientDisconnected) return;
        const candidateUrl = candidateUrls[attempt];
        const attemptRes = await fetch(candidateUrl, {
          redirect: 'follow',
          headers: {
            ...STREAM_BROWSER_HEADERS,
            ...(rangeHeader ? { Range: rangeHeader } : {}),
          },
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
  // Admin Verification & Management Endpoints
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
      buildCookieString('xtv_admin_session', token, 43200, isRequestHttps(req)),
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
      buildCookieString('xtv_admin_session', '', 0, isRequestHttps(req)),
    );
    return res.json({ ok: true });
  });

  app.get('/api/admin/users', (req: Request, res: Response) => {
    if (!verifyAdminToken(getAdminTokenFromReq(req))) {
      return res.status(403).json({ error: 'Admin verification required.' });
    }
    const store = hydrateStoreFromCookies(req);
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

    const store = hydrateStoreFromCookies(req);
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

    const vaultCookie = buildAccountVaultCookieHeader(store, targetUid, req);
    const currentSession = hydrateSessionRecord(req);
    const cookiesToSet: string[] = [];
    if (vaultCookie) cookiesToSet.push(vaultCookie);
    if (currentSession?.user.uid === targetUid) {
      const freshToken = signUserAuthToken(record.user, record.account);
      cookiesToSet.push(buildAuthCookieHeader(freshToken, 30 * 24 * 60 * 60, req));
    }
    if (cookiesToSet.length > 0) {
      res.setHeader('Set-Cookie', cookiesToSet);
    }

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
          `2. Run \`npm install && npm run build\` (bundles Vite SPA + \`api/index.mjs\`).\n` +
          `3. Push cleanly to GitHub or run \`npx vercel --prod\`.\n`,
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
  // Native Mobile App & Public URL Probe
  // ---------------------------------------------------------------------------
  app.get('/api/apps/mobile-bundle', async (req: Request, res: Response) => {
    try {
      const hostUrl = resolvePublicOrigin(req);
      const archive = await createZipArchiver();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="XEROTV-Mobile-Native-App.zip"');
      archive.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) res.status(500).json({ error: msg });
        else if (!res.writableEnded) res.end();
      });
      archive.pipe(res);

      const rootDir = process.cwd();
      const iconPath = path.join(rootDir, 'public', 'pwa-512x512.png');
      if (fs.existsSync(iconPath)) {
        archive.file(iconPath, { name: 'assets/icon.png' });
      }
      archive.append(
        `# XEROTV Mobile App (Android APK)\nTarget URL: ${hostUrl}\n`,
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
          await execFileAsync('bash', [builderScript, hostUrl, cachedApk], { timeout: 60_000 });
        }
        if (fs.existsSync(cachedApk)) apkToServe = cachedApk;
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
  // XeroHots — Full Snowball-01/AdultColony-API Multi-Provider System (XEROSTAR VIP ₱150)
  // ---------------------------------------------------------------------------
  const xeroHotsCache = new Map<string, { items: XeroHotsVideo[]; expiresAt: number }>();

  const HOTS_BROWSER_HEADERS = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  function makeSignedXeroHotsMediaUrls(mediaUrl: string, title: string): {
    proxiedStreamUrl: string;
    proxiedDownloadUrl: string;
    directStreamToken: string;
  } {
    const cleanTitle = (title || 'xerohots-video')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 48);
    const tok = signHmacPayload({
      kind: 'hots_media',
      url: mediaUrl,
      title: cleanTitle,
      exp: Date.now() + 6 * 60 * 60 * 1000,
    });
    const enc = encodeURIComponent(tok);
    return {
      proxiedStreamUrl: `/api/xerohots/stream?token=${enc}`,
      proxiedDownloadUrl: `/api/xerohots/download?token=${enc}`,
      directStreamToken: tok,
    };
  }

  async function fetchEpornerAdultColony(
    q: string,
    page: number,
    sort: XeroHotsSortId,
    catId: string,
  ): Promise<XeroHotsVideo[]> {
    const cat = findCategoryById('eporner', catId);
    const query = (q || cat?.query || 'all').trim() || 'all';
    const orderMap: Record<XeroHotsSortId, string> = {
      trending: 'top-weekly',
      popular: 'most-popular',
      'top-rated': 'top-rated',
      newest: 'latest',
      longest: 'longest',
    };
    const order = orderMap[sort] || 'top-weekly';
    const url = `https://www.eporner.com/api/v2/video/search/?query=${encodeURIComponent(
      query,
    )}&per_page=20&page=${page}&thumbsize=big&order=${encodeURIComponent(order)}&format=json`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...HOTS_BROWSER_HEADERS },
      signal: AbortSignal.timeout(4500),
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
        thumbnail: normalizeExternalThumbUrl(v.default_thumb?.src),
        embedUrl: `https://www.eporner.com/embed/${encodeURIComponent(String(v.id))}/`,
        sourceUrl: String(v.url || `https://www.eporner.com/video-${v.id}/`),
        provider: 'eporner' as const,
        uploader: 'Eporner HD',
        category: cat?.label || 'Featured',
        directDownloadable: true,
      }));
  }

  async function fetchPornhubAdultColony(
    q: string,
    page: number,
    sort: XeroHotsSortId,
    catId: string,
  ): Promise<XeroHotsVideo[]> {
    const cat = findCategoryById('pornhub', catId);
    const term = (q || (!cat?.pornhubCatId ? cat?.query || '' : '')).trim();
    const phSortMap: Record<XeroHotsSortId, string> = {
      trending: 'tr',
      popular: 'mv',
      'top-rated': 'tr',
      newest: 'cm',
      longest: 'lg',
    };
    const o = phSortMap[sort] || 'tr';
    let url = `https://www.pornhub.com/video?o=${o}&page=${page}`;
    if (term) {
      url = `https://www.pornhub.com/video/search?search=${encodeURIComponent(term)}&o=${o}&page=${page}`;
    } else if (cat?.pornhubCatId) {
      url = `https://www.pornhub.com/video?c=${encodeURIComponent(cat.pornhubCatId)}&o=${o}&page=${page}`;
    }

    const res = await fetch(url, {
      headers: { ...HOTS_BROWSER_HEADERS, Cookie: 'accessAgeDisclaimerPH=1' },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: XeroHotsVideo[] = [];
    $('li.pcVideoListItem, ul.videos li.videoblock').each((_, el) => {
      if (items.length >= 20) return false;
      const vk = $(el).attr('data-video-vkey') || '';
      const a = $(el).find('span.title a').first();
      const title = (a.attr('title') || a.text() || $(el).find('a').attr('title') || '').trim();
      const img = $(el).find('img').first();
      const thumb = normalizeExternalThumbUrl(
        img.attr('data-src') || img.attr('data-thumb_url') || img.attr('src'),
      );
      const dur = $(el).find('.duration').first().text().trim();
      const views = $(el).find('.views var').first().text().trim();
      if (!vk || !title || !thumb) return;
      items.push({
        id: vk,
        title,
        duration: dur || 'HD',
        views: views || 'Hot',
        rating: 'Pornhub',
        thumbnail: thumb,
        embedUrl: `https://www.pornhub.com/embed/${encodeURIComponent(vk)}`,
        sourceUrl: `https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(vk)}`,
        provider: 'pornhub',
        uploader: $(el).find('.usernameWrap a').first().text().trim() || 'Pornhub Creator',
        category: cat?.label || 'Trending',
        directDownloadable: true,
      });
      return undefined;
    });
    return items;
  }

  async function fetchXhamsterAdultColony(
    q: string,
    page: number,
    sort: XeroHotsSortId,
    catId: string,
  ): Promise<XeroHotsVideo[]> {
    const cat = findCategoryById('xhamster', catId);
    const term = (q || (!cat?.xhamsterSlug ? cat?.query || '' : '')).trim();
    const sortPathMap: Record<XeroHotsSortId, string> = {
      trending: '',
      popular: 'most-viewed/weekly',
      'top-rated': 'best/weekly',
      newest: 'newest',
      longest: 'most-viewed/monthly',
    };
    let url = `https://xhamster.com/${sortPathMap[sort] || ''}${page > 1 ? `/${page}` : ''}`.replace(
      /([^:])\/\//g,
      '$1/',
    );
    if (term) {
      url = `https://xhamster.com/search/${encodeURIComponent(term)}?page=${page}`;
    } else if (cat?.xhamsterSlug) {
      url = `https://xhamster.com/categories/${encodeURIComponent(cat.xhamsterSlug)}${page > 1 ? `/${page}` : ''}`;
    }

    const res = await fetch(url, {
      headers: HOTS_BROWSER_HEADERS,
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: XeroHotsVideo[] = [];

    $('a.video-thumb__image-container').each((_, el) => {
      if (items.length >= 20) return false;
      const href = $(el).attr('href') || '';
      const img = $(el).find('img').first();
      const title = (img.attr('alt') || $(el).closest('[data-role="video-item"], .video-thumb').find('.video-thumb-info__name').text() || '').trim();
      const thumb = normalizeExternalThumbUrl(img.attr('src') || img.attr('data-src'));
      const dur = $(el).find('[data-role="video-duration"]').text().trim();
      const views = $(el).parent().parent().find('.video-thumb-views').text().trim();
      if (!href || !title || !thumb) return;
      const embedSuffix = href.split('-').pop() || '';
      const id = embedSuffix || Buffer.from(href).toString('base64url').slice(0, 16);
      items.push({
        id,
        title,
        duration: dur || 'HD',
        views: views || 'HD',
        rating: 'xHamster',
        thumbnail: thumb,
        embedUrl: `https://xheve2.com/embed/${encodeURIComponent(embedSuffix)}`,
        sourceUrl: href.startsWith('http') ? href : `https://xhamster.com${href}`,
        provider: 'xhamster',
        uploader: 'xHamster Channel',
        category: cat?.label || 'Featured',
        directDownloadable: true,
      });
      return undefined;
    });
    return items;
  }

  async function fetchHentaiCityAdultColony(
    q: string,
    page: number,
    _sort: XeroHotsSortId,
    catId: string,
  ): Promise<XeroHotsVideo[]> {
    const cat = findCategoryById('hentaicity', catId);
    const term = (q || (!cat?.hentaicitySlug ? cat?.query || '' : '')).trim();
    let url = page > 1 ? `https://www.hentaicity.com/videos/recent/${page}/` : 'https://www.hentaicity.com/videos/';
    if (term) {
      url = `https://www.hentaicity.com/search/${encodeURIComponent(term)}/${page > 1 ? `${page}/` : ''}`;
    } else if (cat?.hentaicitySlug) {
      url = `https://www.hentaicity.com/search/${encodeURIComponent(cat.hentaicitySlug)}/${page > 1 ? `${page}/` : ''}`;
    }

    const res = await fetch(url, {
      headers: HOTS_BROWSER_HEADERS,
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: XeroHotsVideo[] = [];

    $('div.thumb-list div.outer-item').each((_, el) => {
      if (items.length >= 20) return false;
      const anchor = $(el).find('a').first();
      const href = anchor.attr('href') || '';
      const title = ($(el).find('p a').attr('title') || $(el).find('p a').text() || anchor.attr('title') || '').trim();
      const img = $(el).find('img').first();
      const thumb = normalizeExternalThumbUrl(img.attr('src') || img.attr('data-src'));
      const dur = $(el).find('span.time').text().trim();
      const views = $(el).find('div.info span').last().text().trim();
      const rating = $(el).find('div.info span').first().text().trim();
      if (!href || !title || !thumb) return;
      const tail = href.split('-').at(-1)?.replace('.html', '') || '';
      const fullSource = href.startsWith('http') ? href : `https://www.hentaicity.com${href}`;
      items.push({
        id: tail || Buffer.from(fullSource).toString('base64url').slice(0, 16),
        title,
        duration: dur || 'Anime',
        views: views || 'Verified',
        rating: rating || 'HentaiCity',
        thumbnail: thumb,
        embedUrl: `https://www.hentaicity.com/embed/${encodeURIComponent(tail)}`,
        sourceUrl: fullSource,
        provider: 'hentaicity',
        uploader: 'HentaiCity',
        category: cat?.label || 'Hentai / Anime',
        directDownloadable: true,
      });
      return undefined;
    });
    return items;
  }

  async function fetchXvideosAdultColony(
    q: string,
    page: number,
    _sort: XeroHotsSortId,
    catId: string,
  ): Promise<XeroHotsVideo[]> {
    const cat = findCategoryById('xvideos', catId);
    const term = (q || cat?.query || '').trim();
    const url = term
      ? `https://www.xvideos.com/?k=${encodeURIComponent(term)}&p=${Math.max(0, page - 1)}`
      : page > 1
        ? `https://www.xvideos.com/new/${page}`
        : 'https://www.xvideos.com/?k=trending';
    const res = await fetch(url, {
      headers: HOTS_BROWSER_HEADERS,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: XeroHotsVideo[] = [];
    $('div.mozaique div.thumb-block').each((_, el) => {
      if (items.length >= 20) return false;
      const id = $(el).attr('data-id') || '';
      const a = $(el).find('.thumb-under p.title a');
      const img = $(el).find('.thumb img');
      const title = (a.attr('title') || a.text() || '').trim();
      const href = a.attr('href') || '';
      const dur = $(el).find('.thumb-under p.title span.duration').text().trim();
      const thumb = normalizeExternalThumbUrl(img.attr('data-src') || img.attr('src'));
      if (!id || !title || !thumb) return;
      items.push({
        id,
        title,
        duration: dur || 'HD',
        views: 'Verified',
        rating: 'XVideos',
        thumbnail: thumb,
        embedUrl: `https://www.xvideos.com/embedframe/${encodeURIComponent(id)}`,
        sourceUrl: href.startsWith('http') ? href : `https://www.xvideos.com${href}`,
        provider: 'xvideos',
        uploader: $(el).find('.metadata .name').text().trim() || 'XVideos Channel',
        category: cat?.label || 'Featured',
        directDownloadable: true,
      });
      return undefined;
    });
    return items;
  }

  async function fetchXnxxAdultColony(
    q: string,
    page: number,
    _sort: XeroHotsSortId,
    catId: string,
  ): Promise<XeroHotsVideo[]> {
    const cat = findCategoryById('xnxx', catId);
    const term = (q || cat?.query || '').trim();
    const url = term
      ? `https://www.xnxx.com/search/${encodeURIComponent(term)}/${Math.max(0, page - 1)}`
      : page > 1
        ? `https://www.xnxx.com/hits/${Math.max(0, page - 1)}`
        : 'https://www.xnxx.com/hits';
    const res = await fetch(url, {
      headers: HOTS_BROWSER_HEADERS,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: XeroHotsVideo[] = [];
    $('div.mozaique div.thumb-block').each((_, el) => {
      if (items.length >= 20) return false;
      const a = $(el).find('div.thumb-under p a').first();
      const href = a.attr('href') || '';
      const id = $(el).attr('data-id') || href.split('/')[1] || '';
      const img = $(el).find('.thumb img').first();
      const title = (a.attr('title') || a.text() || '').trim();
      const thumb = normalizeExternalThumbUrl(img.attr('data-src') || img.attr('src'));
      if (!id || !title || !thumb) return;
      items.push({
        id,
        title,
        duration: 'HD',
        views: 'Hits',
        rating: 'XNXX',
        thumbnail: thumb,
        embedUrl: `https://www.xnxx.com/embedframe/${encodeURIComponent(id)}`,
        sourceUrl: href.startsWith('http') ? href : `https://www.xnxx.com${href}`,
        provider: 'xnxx',
        uploader: 'XNXX Channel',
        category: cat?.label || 'Hits',
        directDownloadable: true,
      });
      return undefined;
    });
    return items;
  }

  async function queryAdultColony(
    provider: XeroHotsProviderId,
    query: string,
    page: number,
    sort: XeroHotsSortId,
    categoryId: string,
  ): Promise<XeroHotsVideo[]> {
    const cleanQuery = query.slice(0, 80).trim();
    const cleanCat = (categoryId || 'all').slice(0, 40).toLowerCase();
    const cacheKey = `${provider}:${cleanCat}:${sort}:${cleanQuery}:${page}`;
    const hit = xeroHotsCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.items;
    }

    let items: XeroHotsVideo[] = [];
    if (provider === 'eporner') {
      items = await fetchEpornerAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else if (provider === 'pornhub') {
      items = await fetchPornhubAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else if (provider === 'xhamster') {
      items = await fetchXhamsterAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else if (provider === 'hentaicity') {
      items = await fetchHentaiCityAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else if (provider === 'xvideos') {
      items = await fetchXvideosAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else if (provider === 'xnxx') {
      items = await fetchXnxxAdultColony(cleanQuery, page, sort, cleanCat).catch(() => []);
    } else {
      const [epRes, phRes, xhRes, hcRes] = await Promise.allSettled([
        fetchEpornerAdultColony(cleanQuery, page, sort, cleanCat),
        fetchPornhubAdultColony(cleanQuery, page, sort, cleanCat),
        fetchXhamsterAdultColony(cleanQuery, page, sort, cleanCat),
        fetchHentaiCityAdultColony(cleanQuery, page, sort, cleanCat),
      ]);
      const buckets = [
        epRes.status === 'fulfilled' ? epRes.value : [],
        phRes.status === 'fulfilled' ? phRes.value : [],
        xhRes.status === 'fulfilled' ? xhRes.value : [],
        hcRes.status === 'fulfilled' ? hcRes.value : [],
      ];
      const maxLen = Math.max(...buckets.map((b) => b.length), 0);
      for (let i = 0; i < maxLen; i++) {
        for (const list of buckets) {
          if (i < list.length) items.push(list[i]);
        }
      }
    }

    if (xeroHotsCache.size > 150) {
      const firstKey = xeroHotsCache.keys().next().value;
      if (firstKey) xeroHotsCache.delete(firstKey);
    }
    if (items.length > 0) {
      xeroHotsCache.set(cacheKey, { items, expiresAt: Date.now() + 90_000 });
    }
    return items;
  }

  app.get('/api/xerohots/categories', (req: Request, res: Response) => {
    const provider = (String(req.query.provider || 'all').toLowerCase() || 'all') as XeroHotsProviderId;
    const categories = getCategoriesForProvider(provider);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ ok: true, provider, categories, sortOptions: XEROHOTS_SORT_OPTIONS });
  });

  app.get('/api/xerohots/feed', async (req: Request, res: Response) => {
    const provider = (String(req.query.provider || 'all').toLowerCase() || 'all') as XeroHotsProviderId;
    const category = String(req.query.category || 'all').toLowerCase();
    const sort = (String(req.query.sort || 'trending').toLowerCase() || 'trending') as XeroHotsSortId;
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));
    try {
      const items = await queryAdultColony(provider, '', page, sort, category);
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      res.json({ ok: true, provider, category, sort, page, items });
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
    const provider = (String(req.query.provider || 'all').toLowerCase() || 'all') as XeroHotsProviderId;
    const category = String(req.query.category || 'all').toLowerCase();
    const sort = (String(req.query.sort || 'trending').toLowerCase() || 'trending') as XeroHotsSortId;
    const page = Math.max(1, Math.min(20, Number(req.query.page || 1) || 1));
    try {
      const items = await queryAdultColony(provider, q, page, sort, category);
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      res.json({ ok: true, provider, category, sort, query: q, page, items });
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: 'XeroHots search failed.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/xerohots/random', async (req: Request, res: Response) => {
    const provider = (String(req.query.provider || 'all').toLowerCase() || 'all') as XeroHotsProviderId;
    const randomPage = 1 + crypto.randomInt(5);
    try {
      const items = await queryAdultColony(provider, '', randomPage, 'popular', 'all');
      if (items.length === 0) {
        return res.status(404).json({ ok: false, error: 'No random video available right now.' });
      }
      const picked = items[crypto.randomInt(items.length)];
      return res.json({ ok: true, item: picked });
    } catch {
      return res.status(502).json({ ok: false, error: 'Random video pickup failed.' });
    }
  });

  // AdultColony-API Full Video Scraper & Direct Stream Extractor
  app.get('/api/xerohots/video', async (req: Request, res: Response) => {
    const provider = String(req.query.provider || 'eporner').toLowerCase() as Exclude<XeroHotsProviderId, 'all'>;
    const id = String(req.query.id || '').trim();
    const rawSourceUrl = String(req.query.sourceUrl || '').trim();
    const fallbackTitle = String(req.query.title || 'XeroHots Video').trim();
    const fallbackThumb = String(req.query.thumbnail || '').trim();
    const fallbackDuration = String(req.query.duration || 'HD').trim();
    const fallbackUploader = String(req.query.uploader || provider).trim();

    if (!id && !rawSourceUrl) {
      return res.status(400).json({ ok: false, error: 'Missing video identifier.' });
    }

    let targetUrl = rawSourceUrl;
    if (!targetUrl) {
      if (provider === 'eporner') targetUrl = `https://www.eporner.com/video-${encodeURIComponent(id)}/`;
      else if (provider === 'pornhub') targetUrl = `https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(id)}`;
      else if (provider === 'xvideos') targetUrl = `https://www.xvideos.com/video.${encodeURIComponent(id)}/video`;
      else if (provider === 'hentaicity') targetUrl = `https://www.hentaicity.com/video/${encodeURIComponent(id)}.html`;
    }

    if (targetUrl && !isAllowedXeroHotsUrl(targetUrl)) {
      return res.status(403).json({ ok: false, error: 'Disallowed provider domain.' });
    }

    let title = fallbackTitle;
    let duration = fallbackDuration;
    let views = 'Verified';
    let rating = 'HD';
    let upvoted = '—';
    let downvoted = '—';
    let uploaded = '';
    let thumbnail = normalizeExternalThumbUrl(fallbackThumb);
    let embedUrl = '';
    let uploader = fallbackUploader;
    let tags: string[] = [];
    let models: string[] = [];
    const directCandidates: Array<{ label: string; url: string }> = [];
    let hlsUrl: string | null = null;
    const relatedVideos: XeroHotsVideo[] = [];

    try {
      if (targetUrl) {
        const pageRes = await fetch(targetUrl, {
          headers: { ...HOTS_BROWSER_HEADERS, Cookie: 'accessAgeDisclaimerPH=1' },
          redirect: 'follow',
          signal: AbortSignal.timeout(5500),
        });
        const html = pageRes.ok ? await pageRes.text() : '';
        if (html) {
          const $ = cheerio.load(html);

          if (provider === 'eporner') {
            title =
              $('#video-info h1').clone().children('span').remove().end().text().trim() ||
              $("meta[property='og:title']").attr('content') ||
              title;
            thumbnail = normalizeExternalThumbUrl($('#EPvideo').attr('poster') || $("meta[property='og:image']").attr('content')) || thumbnail;
            views = $('#cinemaviews1').text().trim() || views;
            duration = $('span.vid-length').text().trim() || duration;
            upvoted = $('div.likeup i').text().trim() || upvoted;
            downvoted = $('div.likedown i').text().trim() || downvoted;
            embedUrl = `https://www.eporner.com/embed/${encodeURIComponent(id)}/`;

            $('div.dloaddivcol span.download-h264 a, a[href*="/dload/"]').each((_, el) => {
              const href = $(el).attr('href') || '';
              if (!href.includes('.mp4')) return;
              const full = href.startsWith('http') ? href : `https://www.eporner.com${href}`;
              if (!isAllowedXeroHotsUrl(full)) return;
              const label = $(el).text().trim() || (href.includes('720') ? '720p MP4' : href.includes('480') ? '480p MP4' : '360p MP4');
              if (!directCandidates.some((c) => c.url === full)) {
                directCandidates.push({ label, url: full });
              }
            });
            // Prefer universal H.264 480p/360p/720p ahead of AV1 for cross-device compatibility
            directCandidates.sort((a, b) => {
              const aAv1 = a.url.includes('-av1') ? 1 : 0;
              const bAv1 = b.url.includes('-av1') ? 1 : 0;
              return aAv1 - bAv1;
            });

            tags = $('#video-info-tags a, a[href*="/tag/"]')
              .map((_, el) => $(el).text().trim())
              .get()
              .filter(Boolean)
              .slice(0, 12);
            uploader = $('#video-info .vit-uploader a').first().text().trim() || 'Eporner HD';

            $('#relateddiv div.mb').each((_, el) => {
              if (relatedVideos.length >= 8) return false;
              const rHref = $(el).find('a').first().attr('href') || '';
              const rTitle = $(el).find('p.mbtit a').text().trim();
              const rImg = normalizeExternalThumbUrl($(el).find('img').attr('data-src') || $(el).find('img').attr('src'));
              const rDur = $(el).find('span.mbtim').text().trim();
              const rId = rHref.match(/video-([a-zA-Z0-9]+)/)?.[1] || '';
              if (rId && rTitle && rImg) {
                relatedVideos.push({
                  id: rId,
                  title: rTitle,
                  duration: rDur || 'HD',
                  views: $(el).find('span.mbvie').text().trim() || 'HD',
                  rating: 'Eporner',
                  thumbnail: rImg,
                  embedUrl: `https://www.eporner.com/embed/${rId}/`,
                  sourceUrl: rHref.startsWith('http') ? rHref : `https://www.eporner.com${rHref}`,
                  provider: 'eporner',
                  uploader: 'Eporner HD',
                  directDownloadable: true,
                });
              }
              return undefined;
            });
          } else if (provider === 'pornhub') {
            title = $("meta[property='og:title']").attr('content')?.trim() || title;
            thumbnail = normalizeExternalThumbUrl($("meta[property='og:image']").attr('content')) || thumbnail;
            views = $('div.views > span.count').text().trim() || views;
            rating = $('div.ratingPercent > span.percent').text().trim() || rating;
            upvoted = $('span.votesUp').attr('data-rating') || upvoted;
            downvoted = $('span.votesDown').attr('data-rating') || downvoted;
            uploaded = $('div.videoInfo').text().trim() || uploaded;
            embedUrl = `https://www.pornhub.com/embed/${encodeURIComponent(id)}`;
            tags = $('div.video-info-row a')
              .map((_, el) => $(el).text().trim())
              .get()
              .filter((t) => t && t !== 'Suggest')
              .slice(0, 12);
            models = $('div.pornstarsWrapper a')
              .map((_, el) => $(el).attr('data-mxptext') || $(el).text().trim())
              .get()
              .filter(Boolean)
              .slice(0, 8);

            // Extract direct video/HLS URLs from mediaDefinitions if present
            const mediaMatches = [...html.matchAll(/"videoUrl"\s*:\s*"([^"]+)"/g)];
            for (const m of mediaMatches) {
              const rawUrl = m[1].replace(/\\\//g, '/');
              if (!isAllowedXeroHotsUrl(rawUrl)) continue;
              if (rawUrl.includes('.mp4') && !rawUrl.includes('.m3u8')) {
                directCandidates.push({ label: 'MP4 Stream', url: rawUrl });
              } else if (rawUrl.includes('.m3u8') && !hlsUrl) {
                hlsUrl = rawUrl;
              }
            }
          } else if (provider === 'xhamster') {
            title = $("meta[property='og:title']").attr('content')?.trim() || title;
            thumbnail = normalizeExternalThumbUrl($("meta[property='og:image']").attr('content')) || thumbnail;
            embedUrl = `https://xheve2.com/embed/${encodeURIComponent(id)}`;
            const mp4Matches = [...html.matchAll(/"(?:mp4File|file)"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/g)];
            for (const m of mp4Matches) {
              const rawUrl = m[1].replace(/\\\//g, '/');
              if (isAllowedXeroHotsUrl(rawUrl)) {
                directCandidates.push({ label: 'xHamster MP4', url: rawUrl });
              }
            }
            const hlsMatch = html.match(/"hls"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/);
            if (hlsMatch) {
              hlsUrl = hlsMatch[1].replace(/\\\//g, '/');
            }
          } else if (provider === 'hentaicity') {
            title = $('section.content h1').first().text().trim() || $("meta[property='og:title']").attr('content')?.trim() || title;
            embedUrl = `https://www.hentaicity.com/embed/${encodeURIComponent(id)}`;
            const srcUrl = $('#video-id source').attr('src') || $('video source').attr('src') || '';
            if (srcUrl && isAllowedXeroHotsUrl(srcUrl)) {
              if (srcUrl.includes('.mp4') && !srcUrl.includes('.m3u8')) {
                directCandidates.push({ label: 'Direct MP4', url: srcUrl });
              } else {
                hlsUrl = srcUrl;
              }
            }
            const regexMp4s = html.match(/https?:\/\/[^"'\s<>]+\.mp4(?:\?[^"'\s<>]*)?/gi) || [];
            for (const rawMp4 of regexMp4s) {
              if (!isAllowedXeroHotsUrl(rawMp4) || rawMp4.includes('.urlset')) continue;
              const lbl = rawMp4.includes('720') ? '720p MP4' : rawMp4.includes('480') ? '480p MP4' : 'MP4 Stream';
              if (!directCandidates.some((c) => c.url === rawMp4)) {
                directCandidates.push({ label: lbl, url: rawMp4 });
              }
            }
            const hcHls = html.match(/https?:\/\/[^"'\s<>]+\.m3u8(?:\?[^"'\s<>]*)?/i)?.[0];
            if (hcHls && !hlsUrl) hlsUrl = hcHls;
          } else if (provider === 'xvideos' || provider === 'xnxx') {
            title = $("meta[property='og:title']").attr('content')?.trim() || title;
            thumbnail = normalizeExternalThumbUrl($("meta[property='og:image']").attr('content')) || thumbnail;
            embedUrl =
              provider === 'xnxx'
                ? `https://www.xnxx.com/embedframe/${encodeURIComponent(id)}`
                : `https://www.xvideos.com/embedframe/${encodeURIComponent(id)}`;
            const highMatch = html.match(/html5player\.setVideoUrlHigh\(['"]([^'"]+)['"]\)/);
            const lowMatch = html.match(/html5player\.setVideoUrlLow\(['"]([^'"]+)['"]\)/);
            if (highMatch?.[1] && isAllowedXeroHotsUrl(highMatch[1])) {
              directCandidates.push({ label: 'High HD MP4', url: highMatch[1] });
            }
            if (lowMatch?.[1] && isAllowedXeroHotsUrl(lowMatch[1])) {
              directCandidates.push({ label: 'Compact MP4', url: lowMatch[1] });
            }
            tags = $('a.is-keyword, div.video-tags a')
              .map((_, el) => $(el).text().trim())
              .get()
              .filter(Boolean)
              .slice(0, 12);
          }
        }
      }
    } catch {
      // keep clean embed & fallback info even if remote detail page stalls
    }

    if (!embedUrl) {
      if (provider === 'eporner') embedUrl = `https://www.eporner.com/embed/${encodeURIComponent(id)}/`;
      else if (provider === 'pornhub') embedUrl = `https://www.pornhub.com/embed/${encodeURIComponent(id)}`;
      else if (provider === 'xhamster') embedUrl = `https://xheve2.com/embed/${encodeURIComponent(id)}`;
      else if (provider === 'hentaicity') embedUrl = `https://www.hentaicity.com/embed/${encodeURIComponent(id)}`;
      else if (provider === 'xnxx') embedUrl = `https://www.xnxx.com/embedframe/${encodeURIComponent(id)}`;
      else embedUrl = `https://www.xvideos.com/embedframe/${encodeURIComponent(id)}`;
    }

    const primaryDirectUrl = directCandidates[0]?.url || null;
    const primaryLinks = primaryDirectUrl
      ? makeSignedXeroHotsMediaUrls(primaryDirectUrl, title)
      : null;

    const qualities = directCandidates.slice(0, 4).map((q) => {
      const signed = makeSignedXeroHotsMediaUrls(q.url, title);
      return {
        label: q.label,
        proxiedStreamUrl: signed.proxiedStreamUrl,
        proxiedDownloadUrl: signed.proxiedDownloadUrl,
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      provider,
      id,
      title,
      duration,
      views,
      rating,
      upvoted,
      downvoted,
      uploaded,
      thumbnail,
      embedUrl,
      sourceUrl: targetUrl,
      uploader,
      tags,
      models,
      directVideoUrl: primaryDirectUrl,
      proxiedStreamUrl: primaryLinks?.proxiedStreamUrl || null,
      proxiedDownloadUrl: primaryLinks?.proxiedDownloadUrl || null,
      directStreamToken: primaryLinks?.directStreamToken || null,
      hlsUrl,
      qualities,
      relatedVideos,
    });
  });

  async function handleXeroHotsMediaProxy(req: Request, res: Response, forceAttachment: boolean) {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const parsed = verifyHmacPayload<{ kind?: string; url?: string; title?: string }>(token);
    if (!parsed || parsed.kind !== 'hots_media' || !parsed.url || !isAllowedXeroHotsUrl(parsed.url)) {
      return res.status(403).json({ error: 'Invalid or expired media token.' });
    }

    const safeTitle = (parsed.title || 'xerohots-video').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48);
    const rangeHeader = req.headers.range ? String(req.headers.range) : undefined;

    try {
      const upstream = await fetch(parsed.url, {
        redirect: 'follow',
        headers: {
          ...HOTS_BROWSER_HEADERS,
          Cookie: 'accessAgeDisclaimerPH=1',
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!upstream.ok && upstream.status !== 206) {
        return res.status(502).json({ error: `Provider video stream returned ${upstream.status}` });
      }
      if (!upstream.body) {
        return res.status(502).json({ error: 'Empty video stream body' });
      }

      const ct = upstream.headers.get('content-type') || 'video/mp4';
      const contentType = ct.includes('octet-stream') ? 'video/mp4' : ct;
      const cl = upstream.headers.get('content-length');
      const cr = upstream.headers.get('content-range');

      res.status(upstream.status);
      res.setHeader('Content-Type', contentType);
      if (cl) res.setHeader('Content-Length', cl);
      if (cr) res.setHeader('Content-Range', cr);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader(
        'Content-Disposition',
        `${forceAttachment ? 'attachment' : 'inline'}; filename="${safeTitle}.mp4"`,
      );
      res.setHeader('Cache-Control', 'no-store');

      let closed = false;
      const reader = upstream.body.getReader();
      req.on('close', () => {
        closed = true;
        reader.cancel().catch(() => {});
      });

      while (true) {
        if (closed || res.writableEnded || res.destroyed) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (value && !res.writableEnded && !res.destroyed) {
          const ok = res.write(Buffer.from(value));
          if (!ok) {
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
          error: 'Failed to proxy XeroHots video stream.',
          details: error instanceof Error ? error.message : String(error),
        });
      } else if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    }
  }

  app.get('/api/xerohots/stream', (req: Request, res: Response) => handleXeroHotsMediaProxy(req, res, false));
  app.get('/api/xerohots/download', (req: Request, res: Response) => handleXeroHotsMediaProxy(req, res, true));

  // ---------------------------------------------------------------------------
  // Short Drama Vertical Cinema Engine (ReelShort + StardustTV + Mini-Series)
  // Inspired by Sansekai/SekaiDrama open-source architecture
  // ---------------------------------------------------------------------------
  const dramaFeedCache = new Map<string, { items: ShortDramaSeries[]; expiresAt: number }>();
  const dramaDetailCache = new Map<string, { detail: ShortDramaDetail; expiresAt: number }>();

  interface ReelShortBookRaw {
    book_id?: string;
    book_title?: string;
    title?: string;
    book_pic?: string;
    pic?: string;
    special_desc?: string;
    chapter_count?: number;
    total?: number;
    read_count?: number;
    collect_count?: number;
    paid_start?: number;
    tag?: string[];
    jump_param?: { book_id?: string };
  }

  function mapReelShortBook(raw: ReelShortBookRaw, categoryLabel: string): ShortDramaSeries | null {
    const id = String(raw.book_id || raw.jump_param?.book_id || '').trim();
    const title = String(raw.book_title || raw.title || '')
      .replace(/^高清/, '')
      .trim();
    const poster = normalizeExternalThumbUrl(raw.book_pic || raw.pic || '');
    if (!id || !title) return null;
    const epCount = Number(raw.chapter_count || raw.total || 45) || 45;
    const readNum = Number(raw.read_count || 0);
    return {
      id,
      provider: 'reelshort',
      title,
      slug: slugifyDramaTitle(title),
      poster,
      overview: stripHtmlTags(raw.special_desc || '') || `Vertical HD drama series on ReelShort (${epCount} episodes).`,
      episodeCount: epCount,
      freeEpisodesCount: typeof raw.paid_start === 'number' && raw.paid_start > 1 ? raw.paid_start - 1 : undefined,
      category: categoryLabel,
      tags: Array.isArray(raw.tag) ? raw.tag.filter(Boolean).slice(0, 4) : [],
      scoreLabel: readNum > 1000 ? `${Math.round(readNum / 1000)}K Views` : 'HD Vertical',
      sourceUrl: `https://www.reelshort.com/movie/${slugifyDramaTitle(title)}-${encodeURIComponent(id)}`,
    };
  }

  const KIDS_BLOCKED_DRAMA_RE =
    /\b(affair|mistress|divorce|revenge|mafia|murder|killer|blood|betray|seduc|lust|desire|pregnant|cheating|billionaire|virgin|omega|alpha|werewolf)\b/i;

  function filterDramaItemsForMode(items: ShortDramaSeries[], mode: string): ShortDramaSeries[] {
    if (mode !== 'kids') return items;
    return items.filter((item) => {
      const text = `${item.title} ${item.category} ${(item.tags || []).join(' ')} ${item.overview}`;
      return !KIDS_BLOCKED_DRAMA_RE.test(text);
    });
  }

  async function fetchReelShortFeed(category: string, query: string, page: number): Promise<ShortDramaSeries[]> {
    if (query.trim()) {
      const searchUrl = `https://www.reelshort.com/search?keywords=${encodeURIComponent(query.trim())}&page=${page}`;
      const res = await fetch(searchUrl, {
        headers: { ...STREAM_BROWSER_HEADERS },
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) return [];
      const html = await res.text();
      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!match) return [];
      let parsed: { props?: { pageProps?: { books?: ReelShortBookRaw[] } } };
      try {
        parsed = JSON.parse(match[1]) as { props?: { pageProps?: { books?: ReelShortBookRaw[] } } };
      } catch {
        return [];
      }
      const out: ShortDramaSeries[] = [];
      for (const b of parsed.props?.pageProps?.books || []) {
        const mapped = mapReelShortBook(b, 'Search Result');
        if (mapped) out.push(mapped);
      }
      return out;
    }

    const res = await fetch('https://www.reelshort.com/', {
      headers: { ...STREAM_BROWSER_HEADERS },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return [];

    let parsed: {
      props?: {
        pageProps?: {
          fallback?: Record<
            string,
            {
              banners?: ReelShortBookRaw[];
              bookShelfList?: Array<{ bookshelf_name?: string; books?: ReelShortBookRaw[] }>;
            }
          >;
        };
      };
    };
    try {
      parsed = JSON.parse(match[1]) as typeof parsed;
    } catch {
      return [];
    }

    const hall = parsed.props?.pageProps?.fallback?.['/api/ms/hall/webInfo'];
    if (!hall) return [];

    const seen = new Set<string>();
    const results: ShortDramaSeries[] = [];
    const wantedCat = (category || 'all').toLowerCase().trim();

    if (wantedCat === 'all' || wantedCat === 'new release') {
      for (const b of hall.banners || []) {
        const mapped = mapReelShortBook(b, 'Spotlight');
        if (mapped && !seen.has(mapped.id)) {
          seen.add(mapped.id);
          results.push(mapped);
        }
      }
    }

    for (const shelf of hall.bookShelfList || []) {
      const shelfName = String(shelf.bookshelf_name || '').trim();
      if (!shelfName || shelfName === 'undefined') continue;
      if (wantedCat !== 'all') {
        const shelfClean = shelfName.replace(/[^\p{L}\p{N}\s]/gu, '').toLowerCase().trim();
        if (!shelfClean.includes(wantedCat) && !wantedCat.includes(shelfClean)) {
          continue;
        }
      }
      for (const b of shelf.books || []) {
        const mapped = mapReelShortBook(b, shelfName.replace(/[^\p{L}\p{N}\s&]/gu, '').trim() || 'Featured');
        if (mapped && !seen.has(mapped.id)) {
          seen.add(mapped.id);
          results.push(mapped);
        }
      }
    }

    return results.slice(0, 40);
  }

  async function fetchStardustFeed(category: string, query: string): Promise<ShortDramaSeries[]> {
    const res = await fetch('https://www.stardusttv.net/', {
      headers: { ...STREAM_BROWSER_HEADERS },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const items: ShortDramaSeries[] = [];

    $('a.video_item[href*="/episodes/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const idMatch = href.match(/-(\d+)$/);
      const seriesId = idMatch?.[1] || '';
      if (!seriesId || seen.has(seriesId)) return;

      const title =
        $(el).attr('title')?.trim() ||
        $(el).find('h3, h4, .title, p').first().text().trim() ||
        '';
      const posterRaw =
        $(el).find('img.poster').attr('src') ||
        $(el).find('img[src^="https://assets.stardusttv.cc"]').attr('src') ||
        '';
      const poster = normalizeExternalThumbUrl(posterRaw);
      if (!title || !poster) return;

      const derivedCat = classifyStardustCategory(title);
      if (category && category !== 'all' && derivedCat.toLowerCase() !== category.toLowerCase()) {
        return;
      }
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        if (!title.toLowerCase().includes(q) && !derivedCat.toLowerCase().includes(q)) {
          return;
        }
      }

      seen.add(seriesId);
      const slugMatch = href.match(/\/episodes\/([^/?#]+)/);
      items.push({
        id: seriesId,
        provider: 'stardusttv',
        title,
        slug: slugMatch?.[1] || `01-${slugifyDramaTitle(title)}-${seriesId}`,
        poster,
        overview: `${derivedCat} vertical micro-drama series with dual-CDN HLS playback & English subtitles.`,
        episodeCount: 15,
        category: derivedCat,
        tags: [derivedCat, 'English Sub'],
        scoreLabel: 'Subtitled HD',
        sourceUrl: `https://www.stardusttv.net${href}`,
      });
    });

    return items.slice(0, 36);
  }

  async function fetchMiniSeriesFeed(
    category: string,
    query: string,
    mode: string = 'main',
  ): Promise<ShortDramaSeries[]> {
    try {
      interface TmdbShow {
        id: number;
        name?: string;
        title?: string;
        overview?: string;
        poster_path?: string | null;
        vote_average?: number;
        first_air_date?: string;
      }
      let results: TmdbShow[] = [];
      if (query.trim()) {
        const searchData = await tmdbFetch<{ results?: TmdbShow[] }>('/search/tv', {
          query: query.trim(),
          include_adult: false,
          page: 1,
        });
        results = searchData.results || [];
      } else {
        const discoverParams: Record<string, string | number | boolean> = {
          sort_by: 'popularity.desc',
          'vote_count.gte': 30,
          with_genres: mode === 'kids' ? '16|10751|10762' : '18,10749',
          ...(mode === 'kids' ? { without_genres: '27,53,80,10752,10768,9648' } : {}),
          page: 1,
        };
        if (category === 'kdrama') discoverParams.with_origin_country = 'KR';
        else if (category === 'cdrama') discoverParams.with_origin_country = 'CN';
        else if (category === 'romance' && mode !== 'kids') discoverParams.with_genres = '10749';
        else discoverParams.with_origin_country = 'KR|CN|JP';

        const data = await tmdbFetch<{ results?: TmdbShow[] }>('/discover/tv', discoverParams);
        results = data.results || [];
      }

      const items: ShortDramaSeries[] = [];
      for (const show of results) {
        if (!show.poster_path || !(show.name || show.title)) continue;
        const t = String(show.name || show.title);
        items.push({
          id: String(show.id),
          provider: 'miniseries',
          title: t,
          slug: slugifyDramaTitle(t),
          poster: `https://image.tmdb.org/t/p/w500${show.poster_path}`,
          overview: show.overview || 'Asian drama series synchronized live via XEROTV mstream servers.',
          episodeCount: 16,
          category:
            mode === 'kids'
              ? 'Family Mini-Series'
              : category === 'kdrama'
                ? 'K-Drama'
                : category === 'cdrama'
                  ? 'C-Drama'
                  : 'Asian Drama',
          tags: [
            show.first_air_date ? show.first_air_date.slice(0, 4) : 'Series',
            typeof show.vote_average === 'number' && show.vote_average > 0 ? `${show.vote_average.toFixed(1)} ★` : 'HD',
          ],
          scoreLabel: typeof show.vote_average === 'number' && show.vote_average > 0 ? `${show.vote_average.toFixed(1)} ★` : 'Series',
          tmdbId: show.id,
        });
      }
      return items.slice(0, 20);
    } catch {
      return [];
    }
  }

  async function resolveShortDramaDetail(
    provider: Exclude<ShortDramaProviderId, 'all'>,
    id: string,
    slug: string,
  ): Promise<ShortDramaDetail | null> {
    const cacheKey = `${provider}:${id}:${slug}`;
    const hit = dramaDetailCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.detail;
    }

    if (provider === 'reelshort') {
      const safeSlug = slug || 'drama';
      const targetUrl = `https://www.reelshort.com/movie/${encodeURIComponent(safeSlug)}-${encodeURIComponent(id)}`;
      const res = await fetch(targetUrl, {
        headers: { ...STREAM_BROWSER_HEADERS },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const html = await res.text();
      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!match) return null;

      let parsed: {
        props?: {
          pageProps?: {
            data?: {
              book_id?: string;
              book_title?: string;
              book_pic?: string;
              special_desc?: string;
              paid_start?: number;
              tag?: string[];
              online_base?: Array<{
                chapter_id?: string;
                serial_number?: number;
                video_pic?: string;
                like_count?: number;
              }>;
            };
          };
        };
      };
      try {
        parsed = JSON.parse(match[1]) as typeof parsed;
      } catch {
        return null;
      }
      const book = parsed.props?.pageProps?.data;
      if (!book?.book_id) return null;
      const paidStart = typeof book.paid_start === 'number' && book.paid_start > 0 ? book.paid_start : 16;
      const title = String(book.book_title || 'ReelShort Series').trim();
      const seriesSlug = slugifyDramaTitle(title);

      const episodes: ShortDramaEpisode[] = (book.online_base || [])
        .filter((e) => Boolean(e.chapter_id))
        .map((e, idx) => {
          const epNum = Number(e.serial_number || idx + 1);
          return {
            episodeNum: epNum,
            chapterId: String(e.chapter_id),
            title: `Episode ${epNum}`,
            thumbnail: normalizeExternalThumbUrl(e.video_pic || book.book_pic || ''),
            isFree: epNum < paidStart,
          };
        });

      const detail: ShortDramaDetail = {
        series: {
          id: book.book_id,
          provider: 'reelshort',
          title,
          slug: seriesSlug,
          poster: normalizeExternalThumbUrl(book.book_pic || ''),
          overview: stripHtmlTags(book.special_desc || '') || 'Vertical short drama on ReelShort.',
          episodeCount: episodes.length || 1,
          freeEpisodesCount: Math.max(0, paidStart - 1),
          category: book.tag?.[0] || 'Vertical Drama',
          tags: Array.isArray(book.tag) ? book.tag.slice(0, 5) : [],
          sourceUrl: targetUrl,
        },
        episodes,
      };
      dramaDetailCache.set(cacheKey, { detail, expiresAt: Date.now() + 180_000 });
      return detail;
    }

    if (provider === 'stardusttv') {
      const epPath = slug && slug.includes(id) ? slug : `01-drama-${id}`;
      const targetUrl = `https://www.stardusttv.net/episodes/${encodeURIComponent(epPath)}`;
      const res = await fetch(targetUrl, {
        headers: { ...STREAM_BROWSER_HEADERS },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const html = await res.text();
      const $ = cheerio.load(html);
      const slugHumanTitle = epPath
        .replace(/^01-/, '')
        .replace(/-\d+$/, '')
        .split('-')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      const rawTitle =
        $('h1').first().text().trim() ||
        html.match(/"videoName"\s*:\s*"([^"]{2,140})"/)?.[1]?.trim() ||
        $("meta[property='og:title']")
          .attr('content')
          ?.replace(/\s*(?:Episode|Full|Online|Free|—|\||- StardustTV).*$/i, '')
          .trim() ||
        $('title')
          .text()
          .replace(/\s*(?:Episode|Full|Online|Free|—|\||- StardustTV).*$/i, '')
          .trim() ||
        slugHumanTitle ||
        `StardustTV Series #${id}`;
      const overview =
        stripHtmlTags($("meta[name='description']").attr('content') || '') ||
        'Vertical micro-drama series with dual-CDN HLS video and English captions.';
      const poster = normalizeExternalThumbUrl(
        $("meta[property='og:image']").attr('content') ||
          html.match(/https:\/\/assets\.stardusttv\.cc\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/i)?.[0] ||
          '',
      );

      const escapedId = id.replace(/[^a-zA-Z0-9_-]/g, '');
      const m3u8Pattern = new RegExp(
        `https://(?:tcdn-v|agilecdn-v)\\.stardust-tv\\.com/prod/${escapedId}/(\\d+)/[a-f0-9]+\\.m3u8`,
        'gi',
      );
      const srtPattern = new RegExp(
        `https://subtitle\\.stardust-tv\\.com/final_cut/${escapedId}/[^"'\\s<>\\\\]+_(\\d+)\\.srt`,
        'gi',
      );
      const thumbPattern = new RegExp(
        `https://stardust-video\\.oss-cn-beijing\\.aliyuncs\\.com/snapshot_url/${escapedId}/\\d+\\.png`,
        'gi',
      );

      const epMap = new Map<number, { hlsUrl?: string; backupHlsUrl?: string; subtitleUrl?: string }>();
      for (const m of html.matchAll(m3u8Pattern)) {
        const epNum = Number(m[1]);
        const url = m[0];
        if (!Number.isFinite(epNum) || epNum <= 0 || !isAllowedShortDramaUrl(url)) continue;
        const entry = epMap.get(epNum) || {};
        if (!entry.hlsUrl) entry.hlsUrl = url;
        else if (!entry.backupHlsUrl && entry.hlsUrl !== url) entry.backupHlsUrl = url;
        epMap.set(epNum, entry);
      }

      for (const sm of html.matchAll(srtPattern)) {
        const epNum = Number(sm[1]);
        const url = sm[0];
        if (!Number.isFinite(epNum) || epNum <= 0 || !isAllowedShortDramaUrl(url)) continue;
        const entry = epMap.get(epNum) || {};
        if (!entry.subtitleUrl) entry.subtitleUrl = url;
        epMap.set(epNum, entry);
      }

      const thumbs = [...new Set(html.match(thumbPattern) || [])];
      const sortedEps = Array.from(epMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([epNum, entry], idx): ShortDramaEpisode => ({
          episodeNum: epNum,
          chapterId: `${escapedId}-${epNum}`,
          title: `Episode ${epNum}`,
          thumbnail: thumbs[idx] || poster,
          isFree: true,
          hlsUrl: entry.hlsUrl,
          backupHlsUrl: entry.backupHlsUrl,
          subtitleUrl: entry.subtitleUrl,
        }));

      const detail: ShortDramaDetail = {
        series: {
          id: escapedId,
          provider: 'stardusttv',
          title: rawTitle,
          slug: epPath,
          poster,
          overview,
          episodeCount: sortedEps.length || 1,
          freeEpisodesCount: sortedEps.length,
          category: classifyStardustCategory(rawTitle),
          tags: [classifyStardustCategory(rawTitle), 'English Sub'],
          sourceUrl: targetUrl,
        },
        episodes: sortedEps,
      };
      dramaDetailCache.set(cacheKey, { detail, expiresAt: Date.now() + 180_000 });
      return detail;
    }

    if (provider === 'miniseries') {
      const tmdbId = Number(id);
      if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
      interface TmdbShowDetail {
        id: number;
        name?: string;
        overview?: string;
        poster_path?: string | null;
        number_of_episodes?: number;
        genres?: Array<{ name?: string }>;
        seasons?: Array<{ season_number: number; episode_count: number }>;
      }
      const tv = await tmdbFetch<TmdbShowDetail>(`/tv/${tmdbId}`);
      const firstSeason = (tv.seasons || []).find((s) => s.season_number >= 1) || {
        season_number: 1,
        episode_count: 16,
      };
      const seasonData = await tmdbFetch<{
        episodes?: Array<{ episode_number: number; name?: string; runtime?: number; still_path?: string | null }>;
      }>(`/tv/${tmdbId}/season/${firstSeason.season_number}`).catch(() => ({ episodes: [] }));

      const rawEpisodes: Array<{
        episode_number: number;
        name?: string;
        runtime?: number;
        still_path?: string | null;
      }> =
        seasonData.episodes && seasonData.episodes.length > 0
          ? seasonData.episodes
          : Array.from({ length: Math.min(20, firstSeason.episode_count || 12) }, (_, i) => ({
              episode_number: i + 1,
              name: `Episode ${i + 1}`,
            }));
      const episodes: ShortDramaEpisode[] = rawEpisodes.map((ep) => ({
        episodeNum: ep.episode_number,
        chapterId: String(ep.episode_number),
        title: ep.name || `Episode ${ep.episode_number}`,
        durationSec: ep.runtime ? ep.runtime * 60 : undefined,
        thumbnail: ep.still_path
          ? `https://image.tmdb.org/t/p/w500${ep.still_path}`
          : tv.poster_path
            ? `https://image.tmdb.org/t/p/w500${tv.poster_path}`
            : undefined,
        isFree: true,
      }));

      const detail: ShortDramaDetail = {
        series: {
          id: String(tmdbId),
          provider: 'miniseries',
          title: tv.name || `Series #${tmdbId}`,
          slug: slugifyDramaTitle(tv.name || String(tmdbId)),
          poster: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : '',
          overview: tv.overview || 'Asian mini-series via XEROTV TMDB sync.',
          episodeCount: episodes.length,
          freeEpisodesCount: episodes.length,
          category: tv.genres?.[0]?.name || 'Asian Drama',
          tags: (tv.genres || []).map((g) => String(g.name || '')).filter(Boolean).slice(0, 4),
          tmdbId,
        },
        episodes,
      };
      dramaDetailCache.set(cacheKey, { detail, expiresAt: Date.now() + 180_000 });
      return detail;
    }

    return null;
  }

  app.get('/api/drama/providers', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ ok: true, providers: SHORT_DRAMA_PROVIDERS });
  });

  app.get('/api/drama/feed', async (req: Request, res: Response) => {
    const provider = (String(req.query.provider || 'all').toLowerCase() || 'all') as ShortDramaProviderId;
    const category = String(req.query.category || 'all').trim();
    const mode = String(req.query.mode || 'main').toLowerCase();
    const cacheKey = `${mode}:${provider}:${category}`;
    const hit = dramaFeedCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=240');
      return res.json({
        ok: true,
        provider,
        category,
        categories: getShortDramaCategories(provider),
        items: hit.items,
      });
    }

    try {
      let items: ShortDramaSeries[] = [];
      if (provider === 'reelshort') {
        items = await fetchReelShortFeed(category, '', 1).catch(() => []);
      } else if (provider === 'stardusttv') {
        items = await fetchStardustFeed(category, '').catch(() => []);
      } else if (provider === 'miniseries') {
        items = await fetchMiniSeriesFeed(category, '', mode).catch(() => []);
      } else {
        const [rsRes, sdRes, msRes] = await Promise.allSettled([
          fetchReelShortFeed(category === 'Revenge & Secrets' ? 'all' : category, '', 1),
          fetchStardustFeed(category === 'Hidden Identity' || category === 'New Release' ? 'all' : category, ''),
          fetchMiniSeriesFeed('all', '', mode),
        ]);
        const rs = rsRes.status === 'fulfilled' ? rsRes.value : [];
        const sd = sdRes.status === 'fulfilled' ? sdRes.value : [];
        const ms = msRes.status === 'fulfilled' ? msRes.value : [];
        const maxLen = Math.max(rs.length, sd.length, ms.length, 0);
        for (let i = 0; i < maxLen; i++) {
          if (i < rs.length) items.push(rs[i]);
          if (i < sd.length) items.push(sd[i]);
          if (i < ms.length && items.length < 48) items.push(ms[i]);
        }
      }

      items = filterDramaItemsForMode(items, mode);

      if (items.length > 0) {
        if (dramaFeedCache.size > 100) {
          const oldest = dramaFeedCache.keys().next().value;
          if (oldest) dramaFeedCache.delete(oldest);
        }
        dramaFeedCache.set(cacheKey, { items, expiresAt: Date.now() + 180_000 });
      }
      res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=240');
      return res.json({
        ok: true,
        provider,
        category,
        categories: getShortDramaCategories(provider),
        items,
      });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: 'Unable to load Short Drama catalog right now.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/drama/search', async (req: Request, res: Response) => {
    const q = String(req.query.q || req.query.query || '').trim().slice(0, 80);
    const provider = (String(req.query.provider || 'all').toLowerCase() || 'all') as ShortDramaProviderId;
    const mode = String(req.query.mode || 'main').toLowerCase();
    const page = Math.max(1, Math.min(10, Number(req.query.page || 1) || 1));

    if (!q) {
      return res.json({ ok: true, provider, query: '', items: [] });
    }

    try {
      let items: ShortDramaSeries[] = [];
      if (provider === 'reelshort') {
        items = await fetchReelShortFeed('all', q, page).catch(() => []);
      } else if (provider === 'stardusttv') {
        items = await fetchStardustFeed('all', q).catch(() => []);
      } else if (provider === 'miniseries') {
        items = await fetchMiniSeriesFeed('all', q, mode).catch(() => []);
      } else {
        const [rsRes, sdRes, msRes] = await Promise.allSettled([
          fetchReelShortFeed('all', q, page),
          fetchStardustFeed('all', q),
          fetchMiniSeriesFeed('all', q, mode),
        ]);
        const rs = rsRes.status === 'fulfilled' ? rsRes.value : [];
        const sd = sdRes.status === 'fulfilled' ? sdRes.value : [];
        const ms = msRes.status === 'fulfilled' ? msRes.value : [];
        items = [...rs, ...sd, ...ms].slice(0, 48);
      }

      items = filterDramaItemsForMode(items, mode);

      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.json({ ok: true, provider, query: q, page, items });
    } catch {
      return res.status(502).json({ ok: false, error: 'Short Drama search failed.' });
    }
  });

  app.get('/api/drama/detail', async (req: Request, res: Response) => {
    const provider = String(req.query.provider || 'reelshort').toLowerCase() as Exclude<ShortDramaProviderId, 'all'>;
    const id = String(req.query.id || '').trim();
    const slug = String(req.query.slug || '').trim();
    if (!id) {
      return res.status(400).json({ ok: false, error: 'Missing drama series id.' });
    }
    try {
      const detail = await resolveShortDramaDetail(provider, id, slug);
      if (!detail) {
        return res.status(404).json({ ok: false, error: 'Drama detail not found on provider.' });
      }
      res.setHeader('Cache-Control', 'public, max-age=120');
      return res.json({ ok: true, ...detail });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: 'Failed to load drama detail.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/drama/watch', async (req: Request, res: Response) => {
    const provider = String(req.query.provider || 'reelshort').toLowerCase() as Exclude<ShortDramaProviderId, 'all'>;
    const seriesId = String(req.query.id || '').trim();
    const chapterId = String(req.query.chapterId || '').trim();
    const episodeNum = Math.max(1, Number(req.query.episodeNum || 1) || 1);
    const slug = slugifyDramaTitle(String(req.query.slug || 'drama'));

    if (!seriesId) {
      return res.status(400).json({ ok: false, error: 'Missing drama id.' });
    }

    try {
      if (provider === 'reelshort') {
        const epPath = `episode-${episodeNum}-${slug}-${encodeURIComponent(seriesId)}-${encodeURIComponent(chapterId)}`;
        const url = `https://www.reelshort.com/episodes/${epPath}`;
        const pageRes = await fetch(url, {
          headers: { ...STREAM_BROWSER_HEADERS },
          signal: AbortSignal.timeout(8000),
        });
        if (!pageRes.ok) {
          return res.status(502).json({ ok: false, error: `ReelShort returned ${pageRes.status}` });
        }
        const html = await pageRes.text();
        const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        const data = match
          ? (
              JSON.parse(match[1]) as {
                props?: {
                  pageProps?: {
                    data?: { video_url?: string; duration?: number; video_pic?: string; serial_number?: number };
                  };
                };
              }
            )?.props?.pageProps?.data
          : null;

        const videoUrl = data?.video_url && isAllowedShortDramaUrl(data.video_url) ? data.video_url : null;
        if (!videoUrl) {
          return res.json({
            ok: true,
            provider,
            seriesId,
            chapterId,
            episodeNum,
            title: `Episode ${episodeNum}`,
            isFree: false,
            streamType: 'hls',
            proxiedStreamUrl: null,
            proxiedSubtitleUrl: null,
          });
        }
        const proxiedStreamUrl = `/api/drama/hls?url=${encodeURIComponent(videoUrl)}&referer=${encodeURIComponent('https://www.reelshort.com/')}`;
        return res.json({
          ok: true,
          provider,
          seriesId,
          chapterId,
          episodeNum,
          title: `Episode ${episodeNum}`,
          isFree: true,
          streamType: 'hls',
          proxiedStreamUrl,
          proxiedSubtitleUrl: null,
          durationSec: data?.duration,
          poster: data?.video_pic,
        });
      }

      if (provider === 'stardusttv') {
        const detail = await resolveShortDramaDetail('stardusttv', seriesId, String(req.query.slug || ''));
        const ep =
          detail?.episodes.find((e) => e.episodeNum === episodeNum) ||
          detail?.episodes[0];
        if (!ep?.hlsUrl) {
          return res.json({
            ok: true,
            provider,
            seriesId,
            chapterId,
            episodeNum,
            title: `Episode ${episodeNum}`,
            isFree: false,
            streamType: 'hls',
            proxiedStreamUrl: null,
            proxiedSubtitleUrl: null,
          });
        }
        const proxiedStreamUrl = `/api/drama/hls?url=${encodeURIComponent(ep.hlsUrl)}&referer=${encodeURIComponent('https://www.stardusttv.net/')}`;
        const proxiedSubtitleUrl =
          ep.subtitleUrl && isAllowedShortDramaUrl(ep.subtitleUrl)
            ? `/api/drama/subtitle?url=${encodeURIComponent(ep.subtitleUrl)}&referer=${encodeURIComponent('https://www.stardusttv.net/')}`
            : null;
        return res.json({
          ok: true,
          provider,
          seriesId,
          chapterId: ep.chapterId,
          episodeNum: ep.episodeNum,
          title: ep.title,
          isFree: true,
          streamType: 'hls',
          proxiedStreamUrl,
          proxiedSubtitleUrl,
          poster: ep.thumbnail,
        });
      }

      if (provider === 'miniseries') {
        return res.json({
          ok: true,
          provider,
          seriesId,
          chapterId: String(episodeNum),
          episodeNum,
          title: `Episode ${episodeNum}`,
          isFree: true,
          streamType: 'tmdb',
          proxiedStreamUrl: null,
          proxiedSubtitleUrl: null,
          tmdbId: Number(seriesId) || 0,
        });
      }

      return res.status(400).json({ ok: false, error: 'Unsupported drama provider.' });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: 'Unable to resolve drama episode stream.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/drama/hls', async (req: Request, res: Response) => {
    const rawUrl = String(req.query.url || '').trim();
    const rawReferer = String(req.query.referer || '').trim();
    if (!rawUrl || !isAllowedShortDramaUrl(rawUrl)) {
      return res.status(403).send('Disallowed HLS manifest URL');
    }
    const safeReferer =
      rawReferer && isAllowedShortDramaUrl(rawReferer) ? rawReferer : new URL(rawUrl).origin + '/';
    try {
      const upstream = await fetch(rawUrl, {
        headers: { ...STREAM_BROWSER_HEADERS, Referer: safeReferer },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      if (!upstream.ok) {
        return res.status(502).send(`Upstream manifest error (${upstream.status})`);
      }
      const text = await upstream.text();
      const rewritten = rewriteHlsManifestUrls(text, upstream.url || rawUrl, safeReferer);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(rewritten);
    } catch {
      return res.status(502).send('Failed to load HLS manifest');
    }
  });

  app.get('/api/drama/hls-segment', async (req: Request, res: Response) => {
    const rawUrl = String(req.query.url || '').trim();
    const rawReferer = String(req.query.referer || '').trim();
    if (!rawUrl || !isAllowedShortDramaUrl(rawUrl)) {
      return res.status(403).send('Disallowed HLS segment URL');
    }
    const safeReferer =
      rawReferer && isAllowedShortDramaUrl(rawReferer) ? rawReferer : new URL(rawUrl).origin + '/';
    const rangeHeader = req.headers.range ? String(req.headers.range) : undefined;
    try {
      const upstream = await fetch(rawUrl, {
        headers: {
          ...STREAM_BROWSER_HEADERS,
          Referer: safeReferer,
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      if (!upstream.ok && upstream.status !== 206) {
        return res.status(502).send(`Segment fetch failed (${upstream.status})`);
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      const ct = upstream.headers.get('content-type') || 'video/mp2t';
      res.status(upstream.status);
      res.setHeader('Content-Type', ct);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', String(buf.length));
      const cr = upstream.headers.get('content-range');
      if (cr) res.setHeader('Content-Range', cr);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(buf);
    } catch {
      return res.status(502).send('Failed to fetch video segment');
    }
  });

  app.get('/api/drama/subtitle', async (req: Request, res: Response) => {
    const rawUrl = String(req.query.url || '').trim();
    const rawReferer = String(req.query.referer || '').trim();
    if (!rawUrl || !isAllowedShortDramaUrl(rawUrl)) {
      return res.status(403).send('Disallowed subtitle URL');
    }
    const safeReferer =
      rawReferer && isAllowedShortDramaUrl(rawReferer) ? rawReferer : 'https://www.stardusttv.net/';
    try {
      const upstream = await fetch(rawUrl, {
        headers: { ...STREAM_BROWSER_HEADERS, Referer: safeReferer },
        signal: AbortSignal.timeout(7000),
      });
      if (!upstream.ok) {
        return res.status(502).send('Subtitle fetch failed');
      }
      const rawText = await upstream.text();
      const vtt = convertSrtToVtt(rawText);
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(vtt);
    } catch {
      return res.status(502).send('Unable to convert subtitle');
    }
  });

  // Clean JSON 404 for unknown /api/* paths
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

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
