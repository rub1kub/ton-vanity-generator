import { hmac_sha512, mnemonicToSeed, mnemonicValidate } from '@ton/crypto';
import { describe, expect, it } from 'vitest';

import {
  canonicalizeTonMnemonic,
  deriveTonMnemonicSeed,
  generateTonMnemonic24,
  generateTonMnemonic24Batch,
  tonMnemonicEntropy,
} from './ton-mnemonic';

const VALID_TON_MNEMONIC = (
  'panic job where tourist large stand genius lunch normal enough helmet honey ' +
  'torch fragile flock symbol slender bicycle off park way phrase axis paddle'
).split(' ');
const EXPECTED_SEED_HEX =
  'e9c96cef04c0826acbedd3f885d48ffb682d955dec654240f2593ef1c410499b';

describe('TON 24-word mnemonic', () => {
  it('matches the canonical @ton/crypto seed derivation', async () => {
    expect(await mnemonicValidate(VALID_TON_MNEMONIC)).toBe(true);
    const expected = await mnemonicToSeed(VALID_TON_MNEMONIC, 'TON default seed');
    const actual = await deriveTonMnemonicSeed(VALID_TON_MNEMONIC);
    try {
      expect(actual).not.toBeNull();
      expect(Array.from(actual!, (byte) => byte.toString(16).padStart(2, '0')).join(''))
        .toBe(EXPECTED_SEED_HEX);
      expect(actual).toEqual(Uint8Array.from(expected.subarray(0, 32)));
    } finally {
      actual?.fill(0);
      expected.fill(0);
    }
  });

  it('matches @ton/crypto entropy for the known phrase', async () => {
    const expected = await hmac_sha512(VALID_TON_MNEMONIC.join(' '), '');
    const actual = tonMnemonicEntropy(VALID_TON_MNEMONIC);
    try {
      expect(actual).toEqual(Uint8Array.from(expected));
    } finally {
      actual.fill(0);
      expected.fill(0);
    }
  });

  it('generates independent 24-word candidates from the canonical wordlist', () => {
    const phrases = generateTonMnemonic24Batch(16);
    expect(phrases).toHaveLength(16);
    expect(new Set(phrases).size).toBe(16);
    for (const phrase of phrases) {
      expect(canonicalizeTonMnemonic(phrase)).toHaveLength(24);
    }
    expect(generateTonMnemonic24().split(' ')).toHaveLength(24);
  });

  it('rejects malformed phrases and invalid batch sizes', async () => {
    expect(() => canonicalizeTonMnemonic('abandon '.repeat(23))).toThrow();
    expect(() => generateTonMnemonic24Batch(-1)).toThrow();
    expect(() => generateTonMnemonic24Batch(1_000_001)).toThrow();
  });
});
