import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findCategoryById,
  getCategoriesForProvider,
  hashProviderKeyToNumericId,
  isAllowedXeroHotsUrl,
} from './xerohots.ts';

test('getCategoriesForProvider returns tailored categories for every source', () => {
  const providers = ['all', 'eporner', 'pornhub', 'xhamster', 'hentaicity', 'xvideos', 'xnxx'] as const;
  for (const prov of providers) {
    const cats = getCategoriesForProvider(prov);
    assert.ok(cats.length >= 6, `expected categories for ${prov}`);
    assert.equal(cats[0].id, 'all');
  }

  const epCats = getCategoriesForProvider('eporner');
  assert.ok(epCats.some((c) => c.epornerSlug === '4k-uhd'));

  const hcCats = getCategoriesForProvider('hentaicity');
  assert.ok(hcCats.some((c) => c.id === 'hc-uncensored'));
});

test('findCategoryById resolves category or returns null for all', () => {
  assert.equal(findCategoryById('eporner', 'all'), null);
  const asian = findCategoryById('pornhub', 'asian');
  assert.ok(asian);
  assert.equal(asian.pornhubCatId, '1');
});

test('isAllowedXeroHotsUrl validates adult provider hosts and blocks SSRF loopback/private hosts', () => {
  assert.equal(isAllowedXeroHotsUrl('https://www.eporner.com/dload/abc/360/video.mp4'), true);
  assert.equal(isAllowedXeroHotsUrl('https://video-nss-b.xhcdn.com/stream.mp4'), true);
  assert.equal(isAllowedXeroHotsUrl('https://ev-h.phncdn.com/videos/test.mp4'), true);
  assert.equal(isAllowedXeroHotsUrl('http://127.0.0.1:3000/api/admin/users'), false);
  assert.equal(isAllowedXeroHotsUrl('http://169.254.169.254/latest/meta-data/'), false);
  assert.equal(isAllowedXeroHotsUrl('http://localhost:8080/secret'), false);
  assert.equal(isAllowedXeroHotsUrl('https://evil.example.com/payload.mp4'), false);
});

test('hashProviderKeyToNumericId produces deterministic positive vault IDs', () => {
  const idA = hashProviderKeyToNumericId('eporner', '3TU49cnFjQb');
  const idB = hashProviderKeyToNumericId('eporner', 'OtherVideo99');
  assert.ok(idA >= 900_000_000);
  assert.notEqual(idA, idB);
  assert.equal(idA, hashProviderKeyToNumericId('eporner', '3TU49cnFjQb'));
});
