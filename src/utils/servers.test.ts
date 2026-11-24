import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STREAMING_SERVERS,
  buildEmbedUrl,
  getNextServerId,
} from './servers';
import { formatLocalAuthError } from './authError';

test('streaming servers integrate 10 live mstream servers with VidZen popup-free default', () => {
  assert.equal(STREAMING_SERVERS.length, 11);
  assert.equal(STREAMING_SERVERS[0]?.id, 'vidzen');
  assert.equal(STREAMING_SERVERS[0]?.strictNoPopups, true);
  assert.equal(STREAMING_SERVERS[1]?.id, 'vidlink');
  assert.equal(STREAMING_SERVERS[2]?.id, 'twoembed');
  for (const srv of STREAMING_SERVERS) {
    assert.ok(srv.sandboxFlags.includes('allow-scripts'));
    assert.ok(srv.sandboxFlags.includes('allow-same-origin'));
    assert.ok(srv.sandboxFlags.includes('allow-presentation'));
    if (srv.id !== 'trailer') {
      assert.equal(srv.sandboxFlags.includes('allow-popups'), false);
    }
  }
});

test('getNextServerId cycles cleanly through all mstream servers', () => {
  assert.equal(getNextServerId('vidzen'), 'vidlink');
  assert.equal(getNextServerId('trailer'), 'vidzen');
  assert.equal(getNextServerId('nonexistent'), 'vidzen');
});

test('buildEmbedUrl constructs clean single-slash movie, TV, and trailer URLs', () => {
  assert.equal(buildEmbedUrl('vidzen', 'movie', 550), 'https://web.nxsha.app/embed/movie/550');
  assert.equal(buildEmbedUrl('vidzen', 'tv', 1396, 2, 3), 'https://web.nxsha.app/embed/tv/1396/2/3');
  assert.equal(buildEmbedUrl('vidlink', 'tv', 1399, 1, 2), 'https://vidlink.pro/tv/1399/1/2');
  assert.equal(buildEmbedUrl('twoembed', 'movie', 550), 'https://www.2embed.cc/embed/550');
  assert.equal(buildEmbedUrl('vidzee', 'tv', 1396, 1, 5), 'https://player.vidzee.wtf/embed/tv/1396/1/5');
  assert.equal(buildEmbedUrl('vidspark', 'tv', 1399, 1, 2), 'https://moviesapi.to/tv/1399-1-2');
  assert.equal(buildEmbedUrl('zoryva', 'tv', 1396, 1, 5), 'https://zoryva.me/embed/tv/1396/1/5');
  assert.match(buildEmbedUrl('trailer', 'movie', 550, 1, 1, 'dQw4w9WgXcQ'), /youtube\.com\/embed\/dQw4w9WgXcQ/);

  for (const srv of STREAMING_SERVERS.filter((s) => s.id !== 'trailer')) {
    const url = buildEmbedUrl(srv.id, 'tv', 1396, 1, 2);
    const pathPart = url.replace(/^https?:\/\//, '');
    assert.equal(pathPart.includes('//'), false, `${srv.id} TV URL had double slash: ${url}`);
  }
});

test('formatLocalAuthError classifies credential, duplicate email, and rate-limit errors clearly', () => {
  const invalid = formatLocalAuthError(new Error('Incorrect email/username or password.'), 'auth/invalid-credentials');
  assert.equal(invalid.code, 'auth/invalid-credentials');
  assert.match(invalid.message, /incorrect/i);

  const dup = formatLocalAuthError(new Error('Email already exists'), 'auth/email-in-use');
  assert.equal(dup.code, 'auth/email-in-use');

  const rate = formatLocalAuthError(new Error('Locked for 60s'), 'auth/too-many-requests');
  assert.equal(rate.code, 'auth/too-many-requests');
});
