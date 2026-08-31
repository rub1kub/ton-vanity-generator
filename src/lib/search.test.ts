import { describe, expect, it } from 'vitest';

import {
  FRIENDLY_ADDRESS_LENGTH,
  matchesVanitySuffix,
  normalizeVanitySuffix,
  validateSearchOptions,
  validateVanitySuffix,
} from './search';

describe('normalizeVanitySuffix', () => {
  it('trims only surrounding whitespace', () => {
    expect(normalizeVanitySuffix('  MoNeY  ')).toBe('MoNeY');
  });
});

describe('validateVanitySuffix', () => {
  it('accepts every character in the URL-safe base64 alphabet', () => {
    expect(validateVanitySuffix('Az09_-')).toEqual({
      valid: true,
      suffix: 'Az09_-',
    });
    expect(validateVanitySuffix('DICK')).toEqual({ valid: true, suffix: 'DICK' });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['TON!', 'invalid-characters'],
    ['TON TON', 'invalid-characters'],
    ['A'.repeat(FRIENDLY_ADDRESS_LENGTH + 1), 'too-long'],
  ])('rejects %j as %s', (suffix, error) => {
    expect(validateVanitySuffix(suffix)).toEqual({ valid: false, error });
  });
});

describe('matchesVanitySuffix', () => {
  const address = 'UQAnK_NOuLYcdGhZs6KtJ_mjW4bh50ruzOIF6KxLZcVu_jIv';

  it('matches exact case when case sensitivity is enabled', () => {
    expect(matchesVanitySuffix(address, '_jIv', true)).toBe(true);
    expect(matchesVanitySuffix(address, '_JIV', true)).toBe(false);
  });

  it('folds ASCII letter case when case sensitivity is disabled', () => {
    expect(matchesVanitySuffix(address, '_JIV', false)).toBe(true);
  });

  it('never matches a non-suffix fragment', () => {
    expect(matchesVanitySuffix(address, 'MONEY', false)).toBe(false);
  });
});

describe('validateSearchOptions', () => {
  it('returns the normalized suffix for valid options', () => {
    expect(
      validateSearchOptions({
        suffix: '  GRAM ',
        version: 'w5',
        addressFormat: 'non-bounceable',
        caseSensitive: true,
        engine: 'cpu',
        locale: 'en',
        mnemonicScheme: 'multichain-12',
      }),
    ).toEqual({ valid: true, suffix: 'GRAM' });
  });
});
