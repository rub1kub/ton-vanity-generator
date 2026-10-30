import { describe, expect, it } from 'vitest';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { deriveEd25519Path, keyPairFromSeed, mnemonicValidate } from '@ton/crypto';
import { WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import { Buffer } from 'buffer';

import {
  deriveTonPathSeed,
  generateWalletCandidate,
  publicKeyFromSeed,
  walletAddressFromPublicKey,
  walletAddressFromRootSeed,
  walletAddressFromTonSeed,
  walletCandidateFromMnemonic,
} from './ton';
import telegramVectors from './fixtures/wallet-tg.json';

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
  it('matches an exact m/44\'/607\'/0\' SLIP-0010 known-answer vector', () => {
    const rootSeed = Uint8Array.from({ length: 64 }, (_, index) => index);
    const actual = deriveTonPathSeed(rootSeed);

    expect(Buffer.from(actual).toString('hex')).toBe(
      '26d9edd7b7452b14a75ac4b3ca5d7785739913439916656b8eb5a9d8f5d8d224',
    );
    actual.fill(0);
    rootSeed.fill(0);
  });

  it('matches @ton/crypto for randomized root seeds', async () => {
    for (let sample = 0; sample < 64; sample += 1) {
      const rootSeed = crypto.getRandomValues(new Uint8Array(64));
      const expected = await deriveEd25519Path(
        Buffer.from(rootSeed),
        [44, 607, 0],
      );
      const actual = deriveTonPathSeed(rootSeed);

      expect(Buffer.from(actual).toString('hex')).toBe(expected.toString('hex'));
      actual.fill(0);
      expected.fill(0);
      rootSeed.fill(0);
    }
  });
});

describe('walletAddressFromTonSeed', () => {
  it('is identical to the root-seed path for all wallet contracts', () => {
    for (let sample = 0; sample < 24; sample += 1) {
      const rootSeed = crypto.getRandomValues(new Uint8Array(64));
      const tonSeed = deriveTonPathSeed(rootSeed);
      for (const version of ['v4r2', 'w5', 'tg'] as const) {
        expect(walletAddressFromTonSeed(
          tonSeed,
          version,
          'non-bounceable',
        )).toBe(walletAddressFromRootSeed(
          rootSeed,
          version,
          'non-bounceable',
        ));
      }
      rootSeed.fill(0);
      tonSeed.fill(0);
    }
  });

  it('rejects malformed path seeds', () => {
    expect(() => walletAddressFromTonSeed(
      new Uint8Array(31),
      'w5',
      'non-bounceable',
    )).toThrow('exactly 32 bytes');
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
  // Produced independently by i582/wallet-engine at
  // e59e0d89d7ee90c388bf36e3334c5b276f396697 via TonWallet::new(Wallet).
  // Pins trampoline code, rev00 layout, mainnet subwallet ID, and CRC16 flags.
  it.each(telegramVectors)('matches Telegram Rust address for $publicKey', (vector) => {
    const publicKey = Buffer.from(vector.publicKey, 'hex');
    expect(walletAddressFromPublicKey(publicKey, 'tg', 'non-bounceable'))
      .toBe(vector.nonBounceable);
    expect(walletAddressFromPublicKey(publicKey, 'tg', 'bounceable'))
      .toBe(vector.bounceable);
  });

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

  it('stays byte-for-byte equal to the canonical TON constructors', () => {
    for (let sample = 0; sample < 24; sample += 1) {
      const publicKey = Buffer.alloc(32);
      for (let index = 0; index < publicKey.length; index += 1) {
        publicKey[index] = (sample * 73 + index * 29 + 11) & 0xff;
      }

      const canonicalV4 = WalletContractV4.create({
        workchain: 0,
        publicKey,
      }).address;
      const canonicalW5 = WalletContractV5R1.create({
        publicKey,
        walletId: {
          networkGlobalId: -239,
          context: {
            walletVersion: 'v5r1',
            workchain: 0,
            subwalletNumber: 0,
          },
        },
      }).address;

      for (const addressFormat of ['non-bounceable', 'bounceable'] as const) {
        const format = {
          bounceable: addressFormat === 'bounceable',
          testOnly: false,
          urlSafe: true,
        };
        expect(walletAddressFromPublicKey(publicKey, 'v4r2', addressFormat))
          .toBe(canonicalV4.toString(format));
        expect(walletAddressFromPublicKey(publicKey, 'w5', addressFormat))
          .toBe(canonicalW5.toString(format));
      }
      publicKey.fill(0);
    }
  });
});

describe('WalletTg Telegram import', () => {
  // Public BIP39 test vectors, never use these phrases for a funded wallet.
  const phrases = [
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    'notice tortoise soup strong gun divide offer process salon siren general carry',
  ];

  it.each([0, 1])('restores the same address as Telegram wallet-engine (vector %i)', async (index) => {
    const candidate = await walletCandidateFromMnemonic(
      phrases[index]!.split(' '), 'tg', 'non-bounceable',
    );
    expect(candidate.address).toBe(telegramVectors[index]!.nonBounceable);
    expect(candidate.mnemonic).toHaveLength(12);
  });

  it('rejects the incompatible classic TON mnemonic mode before generation', async () => {
    await expect(generateWalletCandidate('tg', 'non-bounceable', 'ton-24'))
      .rejects.toThrow('12-word BIP39 rotation mnemonic');
    await expect(walletCandidateFromMnemonic(
      Array(24).fill('abandon'), 'tg', 'non-bounceable', 'ton-24',
    )).rejects.toThrow('12-word BIP39 rotation mnemonic');
  });

  it('rejects a twelve-word phrase with an invalid BIP39 checksum', async () => {
    await expect(walletCandidateFromMnemonic(
      Array(12).fill('abandon'), 'tg', 'non-bounceable',
    )).rejects.toThrow('BIP39 validation');
  });
});

describe('generateWalletCandidate', () => {
  it('creates a Telegram-compatible twelve-word WalletTg candidate', async () => {
    const candidate = await generateWalletCandidate('tg', 'non-bounceable');
    expect(candidate.mnemonic).toHaveLength(12);
    expect(validateMnemonic(candidate.mnemonic.join(' '), wordlist)).toBe(true);
    expect(candidate.address).toMatch(/^UQ[A-Za-z0-9_-]{46}$/);
  });

  it('creates an importable 12-word TEP-3 BIP39 candidate', async () => {
    const candidate = await generateWalletCandidate('w5', 'non-bounceable');

    expect(candidate.mnemonic).toHaveLength(12);
    expect(validateMnemonic(candidate.mnemonic.join(' '), wordlist)).toBe(true);
    expect(candidate.address).toMatch(/^UQ[A-Za-z0-9_-]{46}$/);
  });

  it('creates an importable classic 24-word TON candidate', async () => {
    const candidate = await generateWalletCandidate(
      'w5',
      'non-bounceable',
      'ton-24',
    );

    expect(candidate.mnemonic).toHaveLength(24);
    expect(await mnemonicValidate(candidate.mnemonic)).toBe(true);
    expect(candidate.address).toMatch(/^UQ[A-Za-z0-9_-]{46}$/);
  });
});
