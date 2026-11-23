import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterMediaForMode,
  getChristmasUnlockInfo,
  isChristmasModeUnlocked,
  verifyPinFormat,
} from './modes';
import { buildEmbedUrl, STREAMING_SERVERS } from './servers';
import { getCachedValue, setCachedValue } from './tmdbCache';

test('filterMediaForMode enforces Kids Mode PG/Animation safety', () => {
  const items = [
    { id: 1, title: 'Toy Story', adult: false, genre_ids: [16, 10751] },
    { id: 2, title: 'Horror Slasher', adult: false, genre_ids: [27, 53] },
    { id: 3, title: 'Adult Film', adult: true, genre_ids: [10749] },
  ];
  const kids = filterMediaForMode(items, 'kids');
  assert.equal(kids.length, 1);
  assert.equal(kids[0].id, 1);

  const main = filterMediaForMode(items, 'main');
  assert.equal(main.length, 2);
});

test('verifyPinFormat accepts 4-6 digit numeric PINs only', () => {
  assert.equal(verifyPinFormat('1234'), true);
  assert.equal(verifyPinFormat('123456'), true);
  assert.equal(verifyPinFormat('12'), false);
  assert.equal(verifyPinFormat('abcd'), false);
});

test('Christmas Mode stays locked until December 25 12:00 AM and unlocks on Dec 25', () => {
  const nov21 = new Date(2026, 10, 21, 12, 0, 0).getTime();
  assert.equal(isChristmasModeUnlocked(nov21), false);
  const infoLocked = getChristmasUnlockInfo(nov21);
  assert.equal(infoLocked.unlocked, false);
  assert.ok(infoLocked.daysRemaining >= 33);

  const dec24Late = new Date(2026, 11, 24, 23, 59, 59).getTime();
  assert.equal(isChristmasModeUnlocked(dec24Late), false);

  const dec25Midnight = new Date(2026, 11, 25, 0, 0, 0).getTime();
  assert.equal(isChristmasModeUnlocked(dec25Midnight), true);
  const infoOpen = getChristmasUnlockInfo(dec25Midnight);
  assert.equal(infoOpen.unlocked, true);
  assert.equal(infoOpen.daysRemaining, 0);
});

test('STREAMING_SERVERS includes mstream VidZen, NxSha, and Zoryva with sandbox support', () => {
  const vidzen = STREAMING_SERVERS.find((s) => s.id === 'vidzen');
  const nxsha = STREAMING_SERVERS.find((s) => s.id === 'nxsha');
  const zoryva = STREAMING_SERVERS.find((s) => s.id === 'zoryva');
  assert.ok(vidzen);
  assert.ok(nxsha);
  assert.ok(zoryva);
  assert.equal(vidzen.recommendedByXero, true);
  assert.equal(nxsha.recommendedByXero, true);
  assert.equal(vidzen.sandboxSupported, true);
  assert.equal(nxsha.sandboxSupported, true);
  assert.match(buildEmbedUrl('vidzen', 'movie', 550), /player\.vidzee\.wtf\/embed\/movie\/550/);
  assert.match(buildEmbedUrl('vidzen', 'tv', 1399, 1, 2), /player\.vidzee\.wtf\/embed\/tv\/1399\/1\/2/);
  assert.match(buildEmbedUrl('nxsha', 'movie', 550), /web\.nxsha\.app\/embed\/movie\/550/);
  assert.match(buildEmbedUrl('nxsha', 'tv', 1399, 1, 2), /web\.nxsha\.app\/embed\/tv\/1399\/1\/2/);
  assert.match(buildEmbedUrl('zoryva', 'tv', 1399, 1, 2), /zoryva\.me\/embed\/tv\/1399\/1\/2/);
  assert.match(buildEmbedUrl('primesrc', 'movie', 550), /primesrc\.me\/embed\/movie\?tmdb=550/);
  assert.match(buildEmbedUrl('twoembed', 'movie', 550), /2embed\.cc\/embed\/550/);
  assert.match(buildEmbedUrl('trailer', 'movie', 550, 1, 1, 'SUXWAEX2jlg'), /youtube\.com\/embed\/SUXWAEX2jlg.*enablejsapi=1/);
});

test('tmdbCache stores and expires entries cleanly', () => {
  setCachedValue('unit-test-key', { ok: true }, 60_000);
  assert.deepEqual(getCachedValue('unit-test-key'), { ok: true });
  setCachedValue('expired-test-key', { ok: false }, -1000);
  assert.equal(getCachedValue('expired-test-key'), null);
});

