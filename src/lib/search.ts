import type { SearchOptions } from '../types';

export const FRIENDLY_ADDRESS_LENGTH = 48;

const BASE64_URL_SUFFIX_PATTERN = /^[A-Za-z0-9_-]+$/;

export type SuffixValidationError =
  | 'empty'
  | 'invalid-characters'
  | 'too-long';

export type SuffixValidationResult =
  | { valid: true; suffix: string }
  | { valid: false; error: SuffixValidationError };

export type SuffixesValidationResult =
  | { valid: true; suffixes: string[] }
  | { valid: false; error: SuffixValidationError };

export function normalizeVanitySuffix(value: string): string {
  return value.trim();
}

export function normalizeVanitySuffixes(value: string): string[] {
  return [...new Set(value.split(',').map(normalizeVanitySuffix).filter(Boolean))];
}

export function validateVanitySuffix(value: string): SuffixValidationResult {
  const suffix = normalizeVanitySuffix(value);

  if (suffix.length === 0) {
    return { valid: false, error: 'empty' };
  }

  if (suffix.length > FRIENDLY_ADDRESS_LENGTH) {
    return { valid: false, error: 'too-long' };
  }

  if (!BASE64_URL_SUFFIX_PATTERN.test(suffix)) {
    return { valid: false, error: 'invalid-characters' };
  }

  return { valid: true, suffix };
}

export function validateVanitySuffixes(
  value: string,
  maximumLength = FRIENDLY_ADDRESS_LENGTH,
): SuffixesValidationResult {
  const suffixes = normalizeVanitySuffixes(value);
  if (!suffixes.length) return { valid: false, error: 'empty' };

  for (const suffix of suffixes) {
    const validation = validateVanitySuffix(suffix);
    if (!validation.valid) return validation;
    if (suffix.length > maximumLength) return { valid: false, error: 'too-long' };
  }

  return { valid: true, suffixes };
}

export function matchesVanitySuffix(
  address: string,
  suffix: string,
  caseSensitive: boolean,
): boolean {
  if (caseSensitive) {
    return address.endsWith(suffix);
  }

  return address.toLowerCase().endsWith(suffix.toLowerCase());
}

export function createVanitySuffixMatcher(
  suffixes: readonly string[],
  caseSensitive: boolean,
): (address: string) => string | undefined {
  // Prepare once per search, outside the CPU/GPU candidate loops. Prefer the
  // longest match so the result highlights the full requested ending.
  const targets = suffixes.filter(Boolean).map((suffix) => ({
    suffix,
    normalized: caseSensitive ? suffix : suffix.toLowerCase(),
  })).sort((a, b) => b.suffix.length - a.suffix.length);

  return (address) => {
    const normalizedAddress = caseSensitive ? address : address.toLowerCase();
    return targets.find(({ normalized }) => normalizedAddress.endsWith(normalized))?.suffix;
  };
}

export function expectedVanityAttempts(
  suffixes: readonly string[],
  caseSensitive: boolean,
): number {
  const targets = [...new Set(suffixes.filter(Boolean).map((suffix) => (
    caseSensitive ? suffix : suffix.toLowerCase()
  )))];
  // Suffix events overlap only when one ending contains another at its end.
  // Count that shorter ending once, rather than promising a faster search.
  const independent = targets.filter((suffix) => !targets.some((other) => (
    other.length < suffix.length && suffix.endsWith(other)
  )));
  const probability = independent.reduce((sum, suffix) => {
    const letters = caseSensitive ? 0 : [...suffix].filter((character) => /[a-z]/i.test(character)).length;
    return sum + 2 ** letters / 64 ** suffix.length;
  }, 0);
  return probability > 0 ? 1 / probability : 0;
}

export function validateSearchOptions(
  options: SearchOptions,
): SuffixValidationResult {
  if (options.version !== 'v4r2' && options.version !== 'w5' && options.version !== 'tg') {
    return { valid: false, error: 'invalid-characters' };
  }

  if (
    options.addressFormat !== 'bounceable' &&
    options.addressFormat !== 'non-bounceable'
  ) {
    return { valid: false, error: 'invalid-characters' };
  }

  if (options.engine !== 'cpu' && options.engine !== 'gpu') {
    return { valid: false, error: 'invalid-characters' };
  }

  if (options.locale !== 'ru' && options.locale !== 'en') {
    return { valid: false, error: 'invalid-characters' };
  }

  if (
    options.mnemonicScheme !== 'multichain-12' &&
    options.mnemonicScheme !== 'ton-24'
  ) {
    return { valid: false, error: 'invalid-characters' };
  }

  // Telegram imports the initial 12-word rotation mnemonic. A classic TON
  // 24-word seed would derive an address the Telegram client cannot restore.
  if (options.version === 'tg' && options.mnemonicScheme !== 'multichain-12') {
    return { valid: false, error: 'invalid-characters' };
  }

  const validation = validateVanitySuffixes(options.suffix);
  return validation.valid
    ? { valid: true, suffix: validation.suffixes.join(', ') }
    : validation;
}
