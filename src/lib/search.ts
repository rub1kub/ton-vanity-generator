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

export function normalizeVanitySuffix(value: string): string {
  return value.trim();
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

export function validateSearchOptions(
  options: SearchOptions,
): SuffixValidationResult {
  if (options.version !== 'v4r2' && options.version !== 'w5') {
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

  return validateVanitySuffix(options.suffix);
}
