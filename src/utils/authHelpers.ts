export interface AuthUser {
  uid: string;
  provider: 'xerotv';
  username: string;
  displayName: string;
  email: string;
  photoURL: string | null;
}

export function normalizeAuthEmail(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .toLowerCase();
}

export function isValidAuthEmail(email: string): boolean {
  const clean = normalizeAuthEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean) && clean.length <= 160;
}

export function normalizeAuthUsername(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '')
    .slice(0, 32);
}

export function sanitizeDisplayName(raw: string): string {
  return String(raw || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 50);
}

export function validateRegistrationInput(input: {
  displayName: string;
  email: string;
  password: string;
  confirmPassword?: string;
}):
  | {
      ok: true;
      displayName: string;
      username: string;
      email: string;
      password: string;
    }
  | { ok: false; error: string } {
  const displayName = sanitizeDisplayName(input.displayName);
  if (displayName.length < 2) {
    return { ok: false, error: 'Display name must be at least 2 characters.' };
  }

  const email = normalizeAuthEmail(input.email);
  if (!isValidAuthEmail(email)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }

  const password = String(input.password || '');
  if (password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' };
  }
  if (password.length > 128) {
    return { ok: false, error: 'Password must be 128 characters or fewer.' };
  }

  if (input.confirmPassword !== undefined && password !== String(input.confirmPassword)) {
    return { ok: false, error: 'Passwords do not match.' };
  }

  const emailLocal = email.split('@')[0] || 'member';
  const username = normalizeAuthUsername(displayName) || normalizeAuthUsername(emailLocal) || 'member';

  return {
    ok: true,
    displayName,
    username,
    email,
    password,
  };
}

export function validateLoginInput(input: {
  identifier: string;
  password: string;
}): { ok: true; identifier: string; password: string } | { ok: false; error: string } {
  const identifier = String(input.identifier || '').trim().toLowerCase();
  if (identifier.length < 2 || identifier.length > 160) {
    return { ok: false, error: 'Please enter your email address or username.' };
  }
  const password = String(input.password || '');
  if (!password) {
    return { ok: false, error: 'Please enter your password.' };
  }
  return { ok: true, identifier, password };
}
