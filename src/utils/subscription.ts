export type DownloadTier = 'free' | 'trial_2d' | 'download_2m' | 'lifetime_bundle';
export type StorageTier = 'none' | 'bonus_2gb' | 'permanent_1tb';

export interface UserSubscriptionState {
  uid: string;
  shortUserId: string;
  downloadTier: DownloadTier;
  downloadExpiresAtMs: number;
  storageTier: StorageTier;
  storageQuotaBytes: number;
  storageUsedBytes: number;
  redeemedCodes: string[];
  kidsPinHash?: string;
  adultPinHash?: string;
  grantedBy?: string;
}

export const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
export const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const TWO_GB_BYTES = 2 * 1024 * 1024 * 1024;
export const FIVE_GB_BYTES = 5 * 1024 * 1024 * 1024;
export const ONE_GB_BYTES = 1024 * 1024 * 1024;
export const ONE_TB_BYTES = 1024 * 1024 * 1024 * 1024;

export interface CustomPromoDefinition {
  code: string;
  daysGranted: number;
  storageBonusBytes: number;
  active: boolean;
}

export const BUILT_IN_PROMO_CODES: Record<string, { daysGranted: number; storageBonusBytes: number }> = {
  NEWUSER2026: { daysGranted: 2, storageBonusBytes: TWO_GB_BYTES },
  'VER-1-0XEROTV': { daysGranted: 20, storageBonusBytes: FIVE_GB_BYTES },
};

export const SUBSCRIPTION_PLANS = {
  DOWNLOAD_2M: {
    id: 'download_2m',
    name: 'Offline Download Access',
    pricePesos: 500,
    durationLabel: '2 Months (60 Days)',
    description: 'Unlock real offline movie downloads for web shortcut and mobile app.',
  },
  STORAGE_1TB: {
    id: 'storage_1tb',
    name: '1TB Permanent Vault Storage',
    pricePesos: 1090,
    durationLabel: 'Permanent Storage',
    description: 'Upgrade your offline vault capacity to 1TB permanently.',
  },
} as const;

export function generateShortUserId(uid: string): string {
  let hash = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    hash ^= uid.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36).toUpperCase().padStart(6, '0');
  const tail = uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
  return `XTV-${tail}${suffix}`.slice(0, 14);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 100 || exp === 0 ? val.toFixed(0) : val.toFixed(2)} ${units[exp]}`;
}

export function isDownloadAccessActive(
  account: Pick<UserSubscriptionState, 'downloadTier' | 'downloadExpiresAtMs'> | null,
  nowMs: number = Date.now(),
): boolean {
  if (!account) return false;
  if (account.downloadTier === 'lifetime_bundle') return true;
  if (account.downloadTier === 'free') return false;
  return account.downloadExpiresAtMs > nowMs;
}

export function getRemainingStorageBytes(
  account: Pick<UserSubscriptionState, 'storageQuotaBytes' | 'storageUsedBytes'> | null,
): number {
  if (!account) return 0;
  return Math.max(0, account.storageQuotaBytes - account.storageUsedBytes);
}

export function canDownloadMovie(
  account: UserSubscriptionState | null,
  estimatedFileBytes: number,
  nowMs: number = Date.now(),
): { allowed: boolean; reason?: string } {
  if (!account) {
    return { allowed: false, reason: 'Please sign in with Google to download movies offline.' };
  }
  if (!isDownloadAccessActive(account, nowMs)) {
    return {
      allowed: false,
      reason: 'Download Access subscription required (₱500 / 2 Months or redeem VER-1-0XEROTV).',
    };
  }
  if (account.storageQuotaBytes <= 0) {
    return {
      allowed: false,
      reason: 'No offline storage quota available. Redeem VER-1-0XEROTV (+5GB) or upgrade to 1TB.',
    };
  }
  if (account.storageUsedBytes + estimatedFileBytes > account.storageQuotaBytes) {
    return {
      allowed: false,
      reason: `Insufficient vault storage (${formatBytes(getRemainingStorageBytes(account))} remaining). Delete watched movies or upgrade to 1TB.`,
    };
  }
  return { allowed: true };
}

export function calculateRedemptionUpdate(
  account: UserSubscriptionState,
  rawCode: string,
  nowMs: number = Date.now(),
  customPromo?: CustomPromoDefinition | null,
): {
  ok: true;
  code: string;
  daysGranted: number;
  storageBonusBytes: number;
  patch: Pick<
    UserSubscriptionState,
    'downloadTier' | 'downloadExpiresAtMs' | 'storageTier' | 'storageQuotaBytes' | 'redeemedCodes' | 'grantedBy'
  >;
} | {
  ok: false;
  error: string;
} {
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    return { ok: false, error: 'Please enter a redeem code.' };
  }
  if (account.redeemedCodes.includes(code)) {
    return { ok: false, error: 'This code is already redeemed.' };
  }

  let reward: { daysGranted: number; storageBonusBytes: number } | null = null;
  if (BUILT_IN_PROMO_CODES[code]) {
    reward = BUILT_IN_PROMO_CODES[code];
  } else if (customPromo && customPromo.code.toUpperCase() === code && customPromo.active) {
    reward = {
      daysGranted: Math.max(0, Math.min(3650, Math.floor(customPromo.daysGranted || 0))),
      storageBonusBytes: Math.max(0, Math.min(ONE_TB_BYTES, Math.floor(customPromo.storageBonusBytes || 0))),
    };
  }

  if (!reward) {
    return { ok: false, error: 'Invalid or expired promo code.' };
  }

  const baseExpiry = Math.max(account.downloadExpiresAtMs || 0, nowMs);
  const nextExpiry = baseExpiry + reward.daysGranted * ONE_DAY_MS;
  const nextQuota = (account.storageQuotaBytes || 0) + reward.storageBonusBytes;
  const nextDownloadTier: DownloadTier =
    account.downloadTier === 'free' && reward.daysGranted > 0 ? 'trial_2d' : account.downloadTier;
  const nextStorageTier: StorageTier =
    account.storageTier === 'none' && reward.storageBonusBytes > 0 ? 'bonus_2gb' : account.storageTier;

  return {
    ok: true,
    code,
    daysGranted: reward.daysGranted,
    storageBonusBytes: reward.storageBonusBytes,
    patch: {
      downloadTier: nextDownloadTier,
      downloadExpiresAtMs: nextExpiry,
      storageTier: nextStorageTier,
      storageQuotaBytes: nextQuota,
      redeemedCodes: [...account.redeemedCodes, code],
      grantedBy: `code:${code}`,
    },
  };
}

export type AdminGrantType = 'download_2m' | 'storage_1tb' | 'bundle_2m_1tb' | 'custom_days' | 'revoke';

export function calculateGrantAmountPesos(grantType: AdminGrantType): number {
  switch (grantType) {
    case 'download_2m':
      return SUBSCRIPTION_PLANS.DOWNLOAD_2M.pricePesos;
    case 'storage_1tb':
      return SUBSCRIPTION_PLANS.STORAGE_1TB.pricePesos;
    case 'bundle_2m_1tb':
      return SUBSCRIPTION_PLANS.DOWNLOAD_2M.pricePesos + SUBSCRIPTION_PLANS.STORAGE_1TB.pricePesos;
    default:
      return 0;
  }
}

export function calculateAdminGrantUpdate(
  account: UserSubscriptionState,
  grantType: AdminGrantType,
  customDays: number = 30,
  nowMs: number = Date.now(),
): Pick<
  UserSubscriptionState,
  'downloadTier' | 'downloadExpiresAtMs' | 'storageTier' | 'storageQuotaBytes' | 'grantedBy'
> {
  if (grantType === 'revoke') {
    return {
      downloadTier: 'free',
      downloadExpiresAtMs: 0,
      storageTier: 'none',
      storageQuotaBytes: 0,
      grantedBy: 'admin:revoked',
    };
  }

  if (grantType === 'download_2m') {
    const baseExpiry = Math.max(account.downloadExpiresAtMs || 0, nowMs);
    return {
      downloadTier: 'download_2m',
      downloadExpiresAtMs: baseExpiry + SIXTY_DAYS_MS,
      storageTier: account.storageTier === 'none' ? 'bonus_2gb' : account.storageTier,
      storageQuotaBytes: Math.max(account.storageQuotaBytes || 0, 10 * 1024 * 1024 * 1024),
      grantedBy: 'admin:download_2m',
    };
  }

  if (grantType === 'storage_1tb') {
    return {
      downloadTier: account.downloadTier,
      downloadExpiresAtMs: account.downloadExpiresAtMs,
      storageTier: 'permanent_1tb',
      storageQuotaBytes: Math.max(account.storageQuotaBytes || 0, ONE_TB_BYTES),
      grantedBy: 'admin:storage_1tb',
    };
  }

  if (grantType === 'bundle_2m_1tb') {
    const baseExpiry = Math.max(account.downloadExpiresAtMs || 0, nowMs);
    return {
      downloadTier: 'download_2m',
      downloadExpiresAtMs: baseExpiry + SIXTY_DAYS_MS,
      storageTier: 'permanent_1tb',
      storageQuotaBytes: Math.max(account.storageQuotaBytes || 0, ONE_TB_BYTES),
      grantedBy: 'admin:bundle_2m_1tb',
    };
  }

  const safeDays = Math.max(1, Math.min(3650, Math.floor(customDays || 30)));
  const baseExpiry = Math.max(account.downloadExpiresAtMs || 0, nowMs);
  return {
    downloadTier: 'download_2m',
    downloadExpiresAtMs: baseExpiry + safeDays * ONE_DAY_MS,
    storageTier: account.storageTier === 'none' ? 'bonus_2gb' : account.storageTier,
    storageQuotaBytes: Math.max(account.storageQuotaBytes || 0, TWO_GB_BYTES),
    grantedBy: `admin:custom_${safeDays}d`,
  };
}

