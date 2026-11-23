export function sanitizePlainText(input: string, maxLength: number = 500): string {
  return String(input || '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function sanitizePromoCode(input: string): string {
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
}

export function formatCountdownClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

export function isBotVerifiedThisSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem('xtv_bot_verified');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { token?: string; expiresAtMs?: number };
    return Boolean(parsed.token && parsed.expiresAtMs && parsed.expiresAtMs > Date.now());
  } catch {
    return false;
  }
}

export function saveBotVerifiedSession(token: string, ttlMs: number = 30 * 60 * 1000) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      'xtv_bot_verified',
      JSON.stringify({ token, expiresAtMs: Date.now() + ttlMs }),
    );
  } catch {
    // ignore storage failures
  }
}
