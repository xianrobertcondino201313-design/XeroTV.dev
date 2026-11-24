import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLocalAuthError } from './authError.ts';
import {
  isValidAuthEmail,
  normalizeAuthEmail,
  normalizeAuthUsername,
  validateLoginInput,
  validateRegistrationInput,
} from './authHelpers.ts';

test('normalizeAuthEmail and isValidAuthEmail normalize cleanly and reject invalid addresses', () => {
  assert.equal(normalizeAuthEmail('  User.Name@Example.COM \n'), 'user.name@example.com');
  assert.equal(isValidAuthEmail('xian@xerotv.app'), true);
  assert.equal(isValidAuthEmail('not-an-email'), false);
  assert.equal(isValidAuthEmail('bad@domain'), false);
});

test('normalizeAuthUsername strips unsafe symbols and keeps handle concise', () => {
  assert.equal(normalizeAuthUsername('Xian <Production> 2026!'), 'xianproduction2026');
  assert.equal(normalizeAuthUsername('xero_tv.1'), 'xero_tv.1');
});

test('validateRegistrationInput validates fields, password strength, and confirmation match', () => {
  const mismatch = validateRegistrationInput({
    displayName: 'Xian',
    email: 'xian@xerotv.app',
    password: 'secret123',
    confirmPassword: 'different',
  });
  assert.equal(mismatch.ok, false);

  const shortPass = validateRegistrationInput({
    displayName: 'Xian',
    email: 'xian@xerotv.app',
    password: '123',
    confirmPassword: '123',
  });
  assert.equal(shortPass.ok, false);

  const valid = validateRegistrationInput({
    displayName: 'Xian Dev',
    email: 'XIAN@XeroTV.app',
    password: 'password123',
    confirmPassword: 'password123',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.email, 'xian@xerotv.app');
    assert.equal(valid.username, 'xiandev');
    assert.equal(valid.displayName, 'Xian Dev');
  }
});

test('validateLoginInput accepts email or username and rejects empty password', () => {
  assert.equal(validateLoginInput({ identifier: '', password: '123' }).ok, false);
  assert.equal(validateLoginInput({ identifier: 'xian@xerotv.app', password: '' }).ok, false);

  const valid = validateLoginInput({ identifier: '  Xian@XeroTV.app ', password: 'password123' });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.identifier, 'xian@xerotv.app');
  }
});

test('formatLocalAuthError classifies credential, duplicate email, rate limit, and network errors cleanly', () => {
  const dup = formatLocalAuthError(
    Object.assign(new Error('Account already exists.'), { code: 'auth/email-in-use' }),
  );
  assert.equal(dup.code, 'auth/email-in-use');

  const rate = formatLocalAuthError(
    Object.assign(new Error('Too many attempts'), { code: 'auth/too-many-requests' }),
  );
  assert.equal(rate.code, 'auth/too-many-requests');

  const net = formatLocalAuthError(new Error('Failed to fetch'));
  assert.equal(net.code, 'auth/network-error');
});
