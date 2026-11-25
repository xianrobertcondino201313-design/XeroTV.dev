import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAllowedCinemaArchiveUrl,
  selectOrderedOpenStreams,
  VERIFIED_OPEN_CINEMA_CATALOG,
} from './cinemaStreams.ts';

test('different movies resolve to distinct primary offline stream URLs instead of repeating Big Buck Bunny', () => {
  const sampleTitles = [
    { tmdbId: 550, mediaType: 'movie', title: 'Fight Club' },
    { tmdbId: 278, mediaType: 'movie', title: 'The Shawshank Redemption' },
    { tmdbId: 1396, mediaType: 'tv', title: 'Breaking Bad' },
    { tmdbId: 27205, mediaType: 'movie', title: 'Inception' },
    { tmdbId: 109445, mediaType: 'movie', title: 'Frozen' },
    { tmdbId: 872585, mediaType: 'movie', title: 'Oppenheimer' },
  ];

  const chosenUrls = sampleTitles.map(
    (item) => selectOrderedOpenStreams({ ...item, quality: 'hd' })[0].url,
  );
  const uniqueCount = new Set(chosenUrls).size;
  assert.ok(uniqueCount >= 4, `expected diverse streams across distinct titles, got ${uniqueCount}`);

  const bunnyUrl =
    VERIFIED_OPEN_CINEMA_CATALOG.find((e) => e.id === 'big-buck-bunny')?.url || '';
  const bunnyCount = chosenUrls.filter((u) => u === bunnyUrl).length;
  assert.ok(bunnyCount <= 1, 'Big Buck Bunny should not repeat across different movies');
});

test('isAllowedCinemaArchiveUrl permits verified archive hosts and rejects arbitrary hosts', () => {
  assert.equal(
    isAllowedCinemaArchiveUrl('https://archive.org/download/Sintel/sintel-2048-stereo_512kb.mp4'),
    true,
  );
  assert.equal(isAllowedCinemaArchiveUrl('http://127.0.0.1/secret.mp4'), false);
  assert.equal(isAllowedCinemaArchiveUrl('https://evil.example.com/x.mp4'), false);
});
