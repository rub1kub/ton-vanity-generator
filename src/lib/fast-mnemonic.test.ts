import { entropyToMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { describe, expect, it, vi } from 'vitest';

import {
  entropy128ToEnglishMnemonic,
  generateEnglishMnemonic12,
  generateEnglishMnemonic12Batch,
  MAX_GET_RANDOM_VALUES_BYTES,
} from './fast-mnemonic';

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

describe('fast 12-word BIP39 mnemonic generation', () => {
  it.each([
    [
      '00000000000000000000000000000000',
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    ],
    [
      '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
    ],
    [
      '80808080808080808080808080808080',
      'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
    ],
    [
      'ffffffffffffffffffffffffffffffff',
      'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    ],
  ])('matches the official BIP39 vector for %s', (hex, expected) => {
    expect(entropy128ToEnglishMnemonic(fromHex(hex))).toBe(expected);
  });

  it('matches @scure/bip39 across many deterministic entropy values', () => {
    for (let vector = 0; vector < 512; vector += 1) {
      const entropy = Uint8Array.from(
        { length: 16 },
        (_, index) => (vector * 73 + index * 151 + (vector >>> (index % 8))) & 0xff,
      );
      expect(entropy128ToEnglishMnemonic(entropy)).toBe(
        entropyToMnemonic(entropy, wordlist),
      );
    }
  });

  it('does not mutate caller-owned entropy', () => {
    const entropy = Uint8Array.from({ length: 16 }, (_, index) => index * 11);
    const snapshot = entropy.slice();
    entropy128ToEnglishMnemonic(entropy);
    expect(entropy).toEqual(snapshot);
  });

  it('rejects entropy lengths other than 128 bits', () => {
    expect(() => entropy128ToEnglishMnemonic(new Uint8Array(15))).toThrow(RangeError);
    expect(() => entropy128ToEnglishMnemonic(new Uint8Array(17))).toThrow(RangeError);
  });

  it('generates valid phrases with the browser CSPRNG', () => {
    const mnemonic = generateEnglishMnemonic12();
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(validateMnemonic(mnemonic, wordlist)).toBe(true);
  });

  it('chunks large batches below the getRandomValues quota', () => {
    const originalGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    const callSizes: number[] = [];
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
      callSizes.push(array.byteLength);
      return originalGetRandomValues(array);
    });

    try {
      const mnemonics = generateEnglishMnemonic12Batch(4_097);
      expect(mnemonics).toHaveLength(4_097);
      expect(callSizes).toEqual([MAX_GET_RANDOM_VALUES_BYTES, 16]);
      expect(callSizes.every((size) => size <= MAX_GET_RANDOM_VALUES_BYTES)).toBe(true);
      expect(validateMnemonic(mnemonics[0]!, wordlist)).toBe(true);
      expect(validateMnemonic(mnemonics.at(-1)!, wordlist)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('supports an empty batch and rejects unsafe batch sizes', () => {
    expect(generateEnglishMnemonic12Batch(0)).toEqual([]);
    expect(() => generateEnglishMnemonic12Batch(-1)).toThrow(RangeError);
    expect(() => generateEnglishMnemonic12Batch(1.5)).toThrow(RangeError);
    expect(() => generateEnglishMnemonic12Batch(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
});
