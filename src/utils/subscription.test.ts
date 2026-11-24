import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAdminGrantUpdate,
  calculateGrantAmountPesos,
  calculateRedemptionUpdate,
  canDownloadMovie,
  FIVE_GB_BYTES,
  formatBytes,
  generateShortUserId,
  isDownloadAccessActive,
  isXeroStarActive,
  ONE_GB_BYTES,
  ONE_TB_BYTES,
  SUBSCRIPTION_PLANS,
  THIRTY_DAYS_MS,
  TWO_GB_BYTES,
  type UserSubscriptionState,
} from './subscription';

const baseUser: UserSubscriptionState = {
  uid: 'firebaseUid123',
  shortUserId: 'XTV-FIR12345',
  downloadTier: 'free',
  downloadExpiresAtMs: 0,
  storageTier: 'none',
  storageQuotaBytes: 0,
  storageUsedBytes: 0,
  redeemedCodes: [],
};

test('generateShortUserId produces deterministic XTV-prefixed ID', () => {
  const id1 = generateShortUserId('abc123xyz');
  const id2 = generateShortUserId('abc123xyz');
  assert.equal(id1, id2);
  assert.match(id1, /^XTV-[A-Z0-9]+$/);
});

test('NEWUSER2026 grants 2 days download access and +2GB storage once only', () => {
  const now = 1_700_000_000_000;
  const first = calculateRedemptionUpdate(baseUser, 'newuser2026', now);
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.daysGranted, 2);
    assert.equal(first.storageBonusBytes, TWO_GB_BYTES);
    assert.equal(first.patch.storageQuotaBytes, TWO_GB_BYTES);
    assert.equal(first.patch.downloadExpiresAtMs, now + 2 * 24 * 60 * 60 * 1000);
    assert.deepEqual(first.patch.redeemedCodes, ['NEWUSER2026']);

    const updatedUser: UserSubscriptionState = { ...baseUser, ...first.patch };
    assert.equal(isDownloadAccessActive(updatedUser, now + 1000), true);
    assert.equal(canDownloadMovie(updatedUser, 100_000_000, now + 1000).allowed, true);

    const second = calculateRedemptionUpdate(updatedUser, 'NEWUSER2026', now + 5000);
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.error, 'This code is already redeemed.');
    }
  }
});

test('VER-1-0XEROTV grants 20 days download access and +5GB storage once only', () => {
  const now = 1_700_000_000_000;
  const first = calculateRedemptionUpdate(baseUser, 'ver-1-0xerotv', now);
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.code, 'VER-1-0XEROTV');
    assert.equal(first.daysGranted, 20);
    assert.equal(first.storageBonusBytes, FIVE_GB_BYTES);
    assert.equal(first.patch.storageQuotaBytes, FIVE_GB_BYTES);
    assert.equal(first.patch.downloadExpiresAtMs, now + 20 * 24 * 60 * 60 * 1000);
    assert.deepEqual(first.patch.redeemedCodes, ['VER-1-0XEROTV']);

    const updated: UserSubscriptionState = { ...baseUser, ...first.patch };
    const duplicate = calculateRedemptionUpdate(updated, 'VER-1-0XEROTV', now + 5000);
    assert.equal(duplicate.ok, false);
  }
});

test('Admin-generated active custom promo code redeems properly and rejects inactive codes', () => {
  const now = 1_700_000_000_000;
  const activePromo = {
    code: 'XERO-VIP-30',
    daysGranted: 30,
    storageBonusBytes: 10 * ONE_GB_BYTES,
    active: true,
  };
  const res = calculateRedemptionUpdate(baseUser, 'xero-vip-30', now, activePromo);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.daysGranted, 30);
    assert.equal(res.storageBonusBytes, 10 * ONE_GB_BYTES);
  }

  const inactive = calculateRedemptionUpdate(baseUser, 'xero-vip-30', now, {
    ...activePromo,
    active: false,
  });
  assert.equal(inactive.ok, false);
});

test('Admin grant 2 months download, 1TB permanent storage, and honest Peso billing totals', () => {
  const now = 1_700_000_000_000;
  const grant2m = calculateAdminGrantUpdate(baseUser, 'download_2m', 60, now);
  assert.equal(grant2m.downloadTier, 'download_2m');
  assert.equal(grant2m.downloadExpiresAtMs, now + 60 * 24 * 60 * 60 * 1000);

  const grant1tb = calculateAdminGrantUpdate({ ...baseUser, ...grant2m }, 'storage_1tb', 0, now);
  assert.equal(grant1tb.storageTier, 'permanent_1tb');
  assert.equal(grant1tb.storageQuotaBytes, ONE_TB_BYTES);

  assert.equal(calculateGrantAmountPesos('download_2m'), 500);
  assert.equal(calculateGrantAmountPesos('storage_1tb'), 1090);
  assert.equal(calculateGrantAmountPesos('bundle_2m_1tb'), 1590);
  assert.equal(calculateGrantAmountPesos('xerostar'), 150);
  assert.equal(calculateGrantAmountPesos('revoke'), 0);
  assert.equal(SUBSCRIPTION_PLANS.XEROSTAR.pricePesos, 150);

  assert.equal(isXeroStarActive(baseUser, now), false);
  const grantXeroStar = calculateAdminGrantUpdate(baseUser, 'xerostar', 30, now);
  assert.equal(grantXeroStar.xerostarActive, true);
  assert.equal(grantXeroStar.xerostarExpiresAtMs, now + THIRTY_DAYS_MS);
  assert.equal(isXeroStarActive({ ...baseUser, ...grantXeroStar }, now + 1000), true);
  assert.equal(isXeroStarActive({ ...baseUser, ...grantXeroStar }, now + THIRTY_DAYS_MS + 1000), false);
});

test('canDownloadMovie blocks free user and insufficient storage', () => {
  const freeCheck = canDownloadMovie(baseUser, 50_000_000);
  assert.equal(freeCheck.allowed, false);

  const fullUser: UserSubscriptionState = {
    ...baseUser,
    downloadTier: 'trial_2d',
    downloadExpiresAtMs: Date.now() + 86400_000,
    storageTier: 'bonus_2gb',
    storageQuotaBytes: TWO_GB_BYTES,
    storageUsedBytes: TWO_GB_BYTES - 100,
  };
  const spaceCheck = canDownloadMovie(fullUser, 5000);
  assert.equal(spaceCheck.allowed, false);
  assert.equal(formatBytes(ONE_TB_BYTES), '1.00 TB');
});

