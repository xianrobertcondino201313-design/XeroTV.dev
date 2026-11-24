import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_SETTINGS,
  TIMEZONE_OPTIONS,
  formatClockDisplay,
  isValidTimeZone,
} from './settings';

test('default server uses popup-free VidZen mstream primary and auto timezone', () => {
  assert.equal(DEFAULT_APP_SETTINGS.defaultServerId, 'vidzen');
  assert.equal(DEFAULT_APP_SETTINGS.timeZone, 'auto');
  assert.equal(DEFAULT_APP_SETTINGS.timeFormat, '12h');
  assert.ok(TIMEZONE_OPTIONS.some((tz) => tz.value === 'Asia/Manila'));
  assert.ok(TIMEZONE_OPTIONS.some((tz) => tz.value === 'UTC'));
});

test('isValidTimeZone validates IANA zones and rejects invalid strings', () => {
  assert.equal(isValidTimeZone('auto'), true);
  assert.equal(isValidTimeZone('Asia/Manila'), true);
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
});

test('formatClockDisplay formats exact UTC and Asia/Manila times in 12h and 24h', () => {
  const sample = new Date('2026-11-23T08:05:09Z');

  const utc24 = formatClockDisplay(sample, '24h', 'UTC');
  assert.match(utc24.timeText, /08:05:09/);
  assert.match(utc24.dateText, /Nov/);
  assert.match(utc24.dateText, /23/);
  assert.match(utc24.dateText, /2026/);
  assert.equal(utc24.zoneLabel, 'UTC');

  // Asia/Manila is UTC+8 -> 08:05:09Z = 16:05:09 (04:05:09 PM)
  const mnl24 = formatClockDisplay(sample, '24h', 'Asia/Manila');
  assert.match(mnl24.timeText, /16:05:09/);

  const mnl12 = formatClockDisplay(sample, '12h', 'Asia/Manila');
  assert.match(mnl12.timeText, /04:05:09/);
  assert.match(mnl12.shortDateText, /Nov\s+23/);
});
