import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHARED_APP_URL,
  isPrivateDevOrigin,
  resolvePublicAppOrigin,
} from './appLinks';

test('converts private ais-dev origin into public ais-pre shared URL', () => {
  const input = 'https://ais-dev-kjqsaa2zuutrws532d2e33-328965355805.asia-east1.run.app';
  const expected = 'https://ais-pre-kjqsaa2zuutrws532d2e33-328965355805.asia-east1.run.app';
  assert.equal(resolvePublicAppOrigin(input), expected);
  assert.equal(isPrivateDevOrigin(input), true);
  assert.equal(isPrivateDevOrigin(expected), false);
});

test('falls back from container localhost to default public shared URL', () => {
  assert.equal(resolvePublicAppOrigin('http://localhost:3000'), DEFAULT_SHARED_APP_URL);
  assert.equal(resolvePublicAppOrigin('http://127.0.0.1:3000'), DEFAULT_SHARED_APP_URL);
  assert.equal(resolvePublicAppOrigin(''), DEFAULT_SHARED_APP_URL);
});

test('preserves custom public deployment domains cleanly', () => {
  assert.equal(resolvePublicAppOrigin('https://xerotv.vercel.app/'), 'https://xerotv.vercel.app');
  assert.equal(resolvePublicAppOrigin('xerotv.web.app'), 'https://xerotv.web.app');
});
