/**
 * Multi-tier TMDB client cache + in-flight deduplication + token-bucket rate limiter
 * following cd-Crypton/mstream's recommended caching & rate-limiting architecture.
 */

export const TMDB_CACHE_TTL = {
  SHORT: 5 * 60 * 1000,
  MEDIUM: 20 * 60 * 1000,
  LONG: 60 * 60 * 1000,
} as const;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const SESSION_PREFIX = 'xerotv_tmdb_cache_';
const memoryCache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

class TokenBucketLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number;

  constructor(maxRequestsPerSecond: number = 12) {
    this.maxTokens = maxRequestsPerSecond;
    this.tokens = maxRequestsPerSecond;
    this.lastRefill = Date.now();
    this.refillRatePerMs = maxRequestsPerSecond / 1000;
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      const elapsed = now - this.lastRefill;
      this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
      this.lastRefill = now;

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      const waitMs = Math.ceil((1 - this.tokens) / this.refillRatePerMs);
      await new Promise((resolve) => setTimeout(resolve, Math.max(10, waitMs)));
    }
  }
}

const limiter = new TokenBucketLimiter(12);

export function getCachedValue<T>(key: string): T | null {
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem) {
    if (mem.expiresAt > now) {
      return mem.data as T;
    }
    memoryCache.delete(key);
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(SESSION_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw) as CacheEntry<T>;
        if (parsed.expiresAt > now) {
          memoryCache.set(key, parsed);
          return parsed.data;
        }
        sessionStorage.removeItem(SESSION_PREFIX + key);
      }
    } catch {
      // ignore storage errors
    }
  }
  return null;
}

export function setCachedValue<T>(key: string, data: T, ttlMs: number): void {
  const entry: CacheEntry<T> = {
    data,
    expiresAt: Date.now() + ttlMs,
  };
  memoryCache.set(key, entry);

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify(entry));
    } catch {
      // ignore quota exceeded
    }
  }
}

export async function cachedTmdbFetch<T>(
  url: string,
  ttlMs: number = TMDB_CACHE_TTL.MEDIUM,
): Promise<T> {
  const cached = getCachedValue<T>(url);
  if (cached !== null) {
    return cached;
  }

  const existing = inFlight.get(url);
  if (existing) {
    return existing as Promise<T>;
  }

  const requestPromise = (async () => {
    let attempt = 0;
    while (attempt < 3) {
      await limiter.acquire();
      const res = await fetch(url);
      if (res.status === 429 && attempt < 2) {
        attempt += 1;
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as T;
      setCachedValue(url, json, ttlMs);
      return json;
    }
    throw new Error('TMDB rate limit exceeded');
  })();

  inFlight.set(url, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlight.delete(url);
  }
}
