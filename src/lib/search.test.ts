import { describe, expect, it } from 'vitest';

import {
  FRIENDLY_ADDRESS_LENGTH,
  createVanitySuffixMatcher,
  expectedVanityAttempts,
  matchesVanitySuffix,
  normalizeVanitySuffix,
  normalizeVanitySuffixes,
  validateSearchOptions,
  validateVanitySuffix,
  validateVanitySuffixes,
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

describe('comma-separated endings', () => {
  it('trims entries, removes duplicates and ignores empty separators without changing case', () => {
    expect(normalizeVanitySuffixes(' PUMP, GRAM,\n DiMa, PUMP, , ')).toEqual(['PUMP', 'GRAM', 'DiMa']);
    expect(validateVanitySuffixes(' PUMP, GRAM, DIMA ', 8)).toEqual({
      valid: true, suffixes: ['PUMP', 'GRAM', 'DIMA'],
    });
  });

  it.each([
    [', , \n', 'empty'],
    ['PUMP, ТОН, DIMA', 'invalid-characters'],
    ['PUMP, TO N', 'invalid-characters'],
    ['PUMP, GRAM!', 'invalid-characters'],
    ['PUMP, 123456789', 'too-long'],
  ])('rejects %j without silently dropping invalid endings', (value, error) => {
    expect(validateVanitySuffixes(value, 8)).toEqual({ valid: false, error });
  });

  it('limits each ending individually, not the total input length', () => {
    expect(validateVanitySuffixes('ABCDEFGH, 12345678, _-_-_-_-', 8).valid).toBe(true);
  });

  it.each([true, false])('matches any ending in the list (case sensitive: %s)', (caseSensitive) => {
    const match = createVanitySuffixMatcher(['PUMP', 'GRAM', 'DIMA'], caseSensitive);
    expect(match('UQexamplePUMP')).toBe('PUMP');
    expect(match('UQexampleGRAM')).toBe('GRAM');
    expect(match('UQexampleDIMA')).toBe('DIMA');
    expect(match('UQexampleTON')).toBeUndefined();
    expect(match('UQPUMPexample')).toBeUndefined();
  });

  it('preserves the case requested for each entry in exact mode', () => {
    const match = createVanitySuffixMatcher(['PuMp', 'GRAM', 'dima'], true);
    expect(match('UQexamplePuMp')).toBe('PuMp');
    expect(match('UQexamplePUMP')).toBeUndefined();
    expect(match('UQexamplegram')).toBeUndefined();
    expect(match('UQexampledima')).toBe('dima');
  });

  it('ignores case for every entry and prefers the longest match for highlighting', () => {
    const match = createVanitySuffixMatcher(['AM', 'GrAm', 'DIMA'], false);
    expect(match('UQexamplegRaM')).toBe('GrAm');
    expect(match('UQexampledima')).toBe('DIMA');
  });

  it('never lets an empty entry match every address', () => {
    expect(createVanitySuffixMatcher(['', 'GRAM'], false)('UQexampleTON')).toBeUndefined();
    expect(createVanitySuffixMatcher([], false)('UQexampleGRAM')).toBeUndefined();
  });
});

describe('expectedVanityAttempts', () => {
  it('adds the probabilities of distinct endings', () => {
    expect(expectedVanityAttempts(['PUMP', 'GRAM', 'DIMA'], true)).toBeCloseTo(64 ** 4 / 3);
    expect(expectedVanityAttempts(['PUMP', 'GRAM', 'DIMA'], false)).toBeCloseTo(32 ** 4 / 3);
  });

  it('does not count duplicate or overlapping endings twice', () => {
    expect(expectedVanityAttempts(['AM', 'GRAM', 'AM'], true)).toBe(64 ** 2);
    expect(expectedVanityAttempts(['AM', 'am', 'GrAm'], false)).toBe(32 ** 2);
    expect(expectedVanityAttempts(['AM', 'am'], true)).toBe(64 ** 2 / 2);
  });

  it('handles differing lengths and mixed base64 characters', () => {
    expect(expectedVanityAttempts(['A', '99'], false)).toBeCloseTo(1 / (1 / 32 + 1 / 64 ** 2));
    expect(expectedVanityAttempts(['A0_-'], false)).toBe(64 ** 4 / 2);
    expect(expectedVanityAttempts([], false)).toBe(0);
  });
});

describe('validateSearchOptions', () => {
  it.each(['cpu', 'gpu'] as const)('allows WalletTg on %s only with twelve words', (engine) => {
    const options = {
      suffix: 'GRAM', version: 'tg' as const,
      addressFormat: 'non-bounceable' as const, caseSensitive: false,
      engine, locale: 'ru' as const, mnemonicScheme: 'multichain-12' as const,
    };
    expect(validateSearchOptions(options)).toEqual({ valid: true, suffix: 'GRAM' });
    expect(validateSearchOptions({ ...options, mnemonicScheme: 'ton-24' }).valid).toBe(false);
  });

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

  it.each(['cpu', 'gpu'] as const)('accepts the same comma-separated list for %s', (engine) => {
    expect(validateSearchOptions({
      suffix: ' PUMP, GRAM, DiMa, PUMP, ', version: 'tg',
      addressFormat: 'non-bounceable', caseSensitive: true,
      engine, locale: 'ru', mnemonicScheme: 'multichain-12',
    })).toEqual({ valid: true, suffix: 'PUMP, GRAM, DiMa' });
  });
});
