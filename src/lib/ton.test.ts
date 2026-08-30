import { describe, expect, it } from 'vitest';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { deriveEd25519Path, keyPairFromSeed } from '@ton/crypto';
import { Buffer } from 'buffer';

import {
  deriveTonPathSeed,
  generateWalletCandidate,
  publicKeyFromSeed,
  walletAddressFromPublicKey,
} from './ton';

type TestPublicKey = Parameters<typeof walletAddressFromPublicKey>[0];

const NodeBuffer = (
  globalThis as typeof globalThis & {
    Buffer: {
      from(value: string, encoding: 'hex'): TestPublicKey;
    };
  }
).Buffer;

const TEST_PUBLIC_KEY = NodeBuffer.from(
  'ba54488588d41dc6ec249d49f89f7dc76a56ee2be5d63b31b487b1d039b8238d',
  'hex',
);

describe('deriveTonPathSeed', () => {
  it('matches the canonical @ton/crypto SLIP-0010 implementation', async () => {
    const rootSeed = Uint8Array.from({ length: 64 }, (_, index) => index);
    const expected = await deriveEd25519Path(Buffer.from(rootSeed), [44, 607, 0]);
    const actual = deriveTonPathSeed(rootSeed);

    expect(Buffer.from(actual).toString('hex')).toBe(expected.toString('hex'));
    actual.fill(0);
    expected.fill(0);
    rootSeed.fill(0);
  });
});

describe('publicKeyFromSeed', () => {
  it('matches the audited @ton/crypto Ed25519 implementation', async () => {
    const seed = Buffer.from(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
      'hex',
    );
    const expected = keyPairFromSeed(seed);
    const actual = await publicKeyFromSeed(seed);

    expect(actual.toString('hex')).toBe(expected.publicKey.toString('hex'));
    actual.fill(0);
    expected.secretKey.fill(0);
    seed.fill(0);
  });
});

describe('walletAddressFromPublicKey', () => {
  it('derives the standard Wallet V4R2 mainnet address', () => {
    expect(
      walletAddressFromPublicKey(
        TEST_PUBLIC_KEY,
        'v4r2',
        'non-bounceable',
      ),
    ).toBe('UQAnK_NOuLYcdGhZs6KtJ_mjW4bh50ruzOIF6KxLZcVu_jIv');
  });

  it('derives the standard Wallet V5R1 mainnet address', () => {
    expect(
      walletAddressFromPublicKey(TEST_PUBLIC_KEY, 'w5', 'non-bounceable'),
    ).toBe('UQCfc6SAdj2vEfb0DYJPSyVLSjOuL2J4hcxWel0t1tok4CqY');
  });

  it('uses the requested friendly-address bounce flag', () => {
    expect(
      walletAddressFromPublicKey(TEST_PUBLIC_KEY, 'v4r2', 'bounceable'),
    ).toBe('EQAnK_NOuLYcdGhZs6KtJ_mjW4bh50ruzOIF6KxLZcVu_m_q');
  });

  it('rejects malformed Ed25519 public keys', () => {
    const shortPublicKey = NodeBuffer.from('00', 'hex');

    expect(() =>
      walletAddressFromPublicKey(
        shortPublicKey,
        'v4r2',
        'non-bounceable',
      ),
    ).toThrow('exactly 32 bytes');
  });
});

describe('generateWalletCandidate', () => {
  it('creates an importable 12-word TEP-3 BIP39 candidate', async () => {
    const candidate = await generateWalletCandidate('w5', 'non-bounceable');

    expect(candidate.mnemonic).toHaveLength(12);
    expect(validateMnemonic(candidate.mnemonic.join(' '), wordlist)).toBe(true);
    expect(candidate.address).toMatch(/^UQ[A-Za-z0-9_-]{46}$/);
  });
});
