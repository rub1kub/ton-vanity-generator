import { describe, expect, it } from 'vitest';

import {
  BIP39_SEED_BYTES,
  TON_PATH_SEED_BYTES,
  WebGpuPbkdf2Error,
  bytesEqual,
  canonicalizeBip39Mnemonic,
  deriveBip39SeedCpuReference,
  encodeBip39Mnemonic,
  hexToBytes,
  packMnemonicBatch,
  packTonMnemonicEntropyBatch,
} from './webgpu-pbkdf2';
import { deriveTonPathSeed } from './ton';
import { tonMnemonicEntropy } from './ton-mnemonic';

const VECTOR_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const VECTOR_SEED_HEX =
  '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1' +
  '9a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';
const TON_VECTOR_MNEMONIC =
  'panic job where tourist large stand genius lunch normal enough helmet honey ' +
  'torch fragile flock symbol slender bicycle off park way phrase axis paddle';

describe('BIP39 mnemonic helpers', () => {
  it('normalizes whitespace and Unicode with NFKD', () => {
    expect(canonicalizeBip39Mnemonic('  abandon\tability\n able  ')).toBe(
      'abandon ability able',
    );
    expect(canonicalizeBip39Mnemonic('\u00e9')).toBe('e\u0301');
  });

  it('accepts exactly twelve words and rejects other lengths', () => {
    expect(new TextDecoder().decode(encodeBip39Mnemonic(VECTOR_MNEMONIC))).toBe(
      VECTOR_MNEMONIC,
    );

    try {
      encodeBip39Mnemonic('abandon abandon');
      throw new Error('Expected encodeBip39Mnemonic to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(WebGpuPbkdf2Error);
      expect((error as WebGpuPbkdf2Error).code).toBe('invalid-input');
    }
  });

  it('packs each mnemonic into its own zero-padded SHA-512 key block', () => {
    const second = VECTOR_MNEMONIC.replace(/about$/u, 'zoo');
    const packed = packMnemonicBatch([VECTOR_MNEMONIC, second]);
    const bytes = new Uint8Array(packed.words.buffer);
    const firstEncoded = new TextEncoder().encode(VECTOR_MNEMONIC);
    const secondEncoded = new TextEncoder().encode(second);

    expect(packed.count).toBe(2);
    expect(packed.strideBytes).toBe(128);
    expect(bytes.slice(0, firstEncoded.length)).toEqual(firstEncoded);
    expect(bytes.slice(firstEncoded.length, 128)).toEqual(
      new Uint8Array(128 - firstEncoded.length),
    );
    expect(bytes.slice(128, 128 + secondEncoded.length)).toEqual(secondEncoded);
    expect(bytes.slice(128 + secondEncoded.length, 256)).toEqual(
      new Uint8Array(128 - secondEncoded.length),
    );

    packed.words.fill(0);
  });

  it('packs canonical TON entropy and zero-pads the rest of each key block', () => {
    const packed = packTonMnemonicEntropyBatch([TON_VECTOR_MNEMONIC]);
    const bytes = new Uint8Array(packed.words.buffer);
    const expected = tonMnemonicEntropy(TON_VECTOR_MNEMONIC);
    try {
      expect(packed.count).toBe(1);
      expect(bytes.slice(0, 64)).toEqual(expected);
      expect(bytes.slice(64)).toEqual(new Uint8Array(64));
    } finally {
      expected.fill(0);
      packed.words.fill(0);
    }
  });
});

describe('byte helpers', () => {
  it('decodes hexadecimal and compares bytes without an early exit', () => {
    expect(hexToBytes('00aBff')).toEqual(new Uint8Array([0, 0xab, 0xff]));
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(
      true,
    );
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(
      false,
    );
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(
      false,
    );
    expect(() => hexToBytes('abc')).toThrow(/even-length hexadecimal/u);
  });
});

describe('PBKDF2 CPU reference', () => {
  it('matches the standard BIP39 empty-passphrase vector', async () => {
    const seed = await deriveBip39SeedCpuReference(VECTOR_MNEMONIC);
    const expected = hexToBytes(VECTOR_SEED_HEX);

    expect(seed).toHaveLength(BIP39_SEED_BYTES);
    expect(seed).toEqual(expected);

    seed.fill(0);
    expected.fill(0);
  });

  it('feeds the exact TON m/44\'/607\'/0\' SLIP-0010 KAT', async () => {
    const rootSeed = await deriveBip39SeedCpuReference(VECTOR_MNEMONIC);
    const tonSeed = deriveTonPathSeed(rootSeed);

    expect(tonSeed).toHaveLength(TON_PATH_SEED_BYTES);
    expect(Array.from(tonSeed, (byte) =>
      byte.toString(16).padStart(2, '0')).join('')).toBe(
      'b477ef5ed17fb8a2b8faddd7a9835a227243a82c70b190c7af4896155aa7df9f',
    );

    rootSeed.fill(0);
    tonSeed.fill(0);
  });
});
