export const DEFAULT_SHARED_APP_URL =
  'https://ais-pre-kjqsaa2zuutrws532d2e33-328965355805.asia-east1.run.app';

/**
 * Ensures any origin baked into an APK, iOS profile, or shared link is publicly
 * reachable outside the private Google AI Studio developer proxy (`ais-dev-*`).
 *
 * - Converts `https://ais-dev-...` -> `https://ais-pre-...`
 * - Rejects `localhost`, `127.0.0.1`, `0.0.0.0`, or non-HTTP(S) schemes by falling
 *   back to `fallbackPublicUrl` (since a mobile device cannot open container localhost).
 */
export function resolvePublicAppOrigin(
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

export function isPrivateDevOrigin(rawOrigin?: string | null): boolean {
  if (!rawOrigin) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(rawOrigin) ? rawOrigin : `https://${rawOrigin}`);
    const host = u.hostname.toLowerCase();
    return host.startsWith('ais-dev-') || host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}
