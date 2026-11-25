import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyStardustCategory,
  convertSrtToVtt,
  getShortDramaCategories,
  hashShortDramaToVaultId,
  isAllowedShortDramaUrl,
  rewriteHlsManifestUrls,
  slugifyDramaTitle,
  stripHtmlTags,
} from './shortDrama.ts';

test('isAllowedShortDramaUrl allows verified CDN hosts and blocks SSRF targets', () => {
  assert.equal(
    isAllowedShortDramaUrl(
      'https://v-mps.crazymaplestudios.com/vod-112094/abc/playlist.m3u8',
    ),
    true,
  );
  assert.equal(
    isAllowedShortDramaUrl(
      'https://tcdn-v.stardust-tv.com/prod/30112/1/test.m3u8',
    ),
    true,
  );
  assert.equal(
    isAllowedShortDramaUrl('http://127.0.0.1:8080/secret.m3u8'),
    false,
  );
  assert.equal(
    isAllowedShortDramaUrl('http://169.254.169.254/latest/meta-data/'),
    false,
  );
  assert.equal(
    isAllowedShortDramaUrl('https://evil-attacker.example.com/payload.m3u8'),
    false,
  );
  assert.equal(isAllowedShortDramaUrl('javascript:alert(1)'), false);
});

test('slugifyDramaTitle & stripHtmlTags clean titles and synopses accurately', () => {
  assert.equal(slugifyDramaTitle("The Mermaid's Tear!"), 'the-mermaid-s-tear');
  assert.equal(
    stripHtmlTags('<h4>Synopsis:</h4><p>Hello&nbsp;<b>World</b> &amp; Co.<br/>Line 2</p>'),
    'Synopsis: Hello World & Co. Line 2',
  );
});

test('convertSrtToVtt converts timestamps and prepends WEBVTT header cleanly', () => {
  const sampleSrt = `1\r\n00:00:01,500 --> 00:00:04,250\r\nHello hero!\r\n\r\n2\r\n00:00:05,000 --> 00:00:07,000\r\nSecond line`;
  const vtt = convertSrtToVtt(sampleSrt);
  assert.ok(vtt.startsWith('WEBVTT'));
  assert.ok(vtt.includes('00:00:01.500 --> 00:00:04.250 line:82%'));
  assert.ok(vtt.includes('00:00:05.000 --> 00:00:07.000 line:82%'));
  assert.ok(!vtt.includes('00:00:01,500'));
});

test('rewriteHlsManifestUrls proxies segments & nested playlists while blocking unsafe URLs', () => {
  const manifest = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://tcdn-v.stardust-tv.com/prod/key.bin"',
    '#EXTINF:4.0,',
    'segment-0.ts',
    '#EXTINF:4.0,',
    'http://127.0.0.1/ssrf.ts',
  ].join('\n');

  const rewritten = rewriteHlsManifestUrls(
    manifest,
    'https://tcdn-v.stardust-tv.com/prod/30112/1/master.m3u8',
    'https://www.stardusttv.net/',
  );

  assert.ok(rewritten.includes('/api/drama/hls-segment?url=https%3A%2F%2Ftcdn-v.stardust-tv.com%2Fprod%2Fkey.bin'));
  assert.ok(rewritten.includes('/api/drama/hls-segment?url=https%3A%2F%2Ftcdn-v.stardust-tv.com%2Fprod%2F30112%2F1%2Fsegment-0.ts'));
  assert.ok(!rewritten.includes('/api/drama/hls-segment?url=http%3A%2F%2F127.0.0.1'));
});

test('hashShortDramaToVaultId & getShortDramaCategories produce deterministic IDs and categories', () => {
  const id1 = hashShortDramaToVaultId('reelshort', '6ae05732c3f25f52170eb58b', 1);
  const id2 = hashShortDramaToVaultId('reelshort', '6ae05732c3f25f52170eb58b', 2);
  assert.notEqual(id1, id2);
  assert.ok(id1 > 0);
  assert.ok(getShortDramaCategories('reelshort').length >= 5);
  assert.equal(classifyStardustCategory('Kicked Out, Then I Won the Lottery'), 'CEO & Billionaire');
});
