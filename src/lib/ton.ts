import { generateMnemonic, mnemonicToSeedWebcrypto } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { keyPairFromSeed } from '@ton/crypto';
import { WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import { Buffer } from 'buffer';

import type { AddressFormat, WalletVersion } from '../types';

const BIP39_STRENGTH_BITS = 128;
const TON_DERIVATION_PATH = [44, 607, 0];
const HARDENED_OFFSET = 0x80000000;
const ED25519_CURVE = new TextEncoder().encode('ed25519 seed');
const MAINNET_GLOBAL_ID = -239;
const BASECHAIN_WORKCHAIN = 0;

type TonKeyPair = ReturnType<typeof keyPairFromSeed>;
export type TonPublicKey = TonKeyPair['publicKey'];

export interface WalletCandidate {
  address: string;
  mnemonic: string[];
}

/**
 * Synchronous SLIP-0010 Ed25519 derivation for TON's m/44'/607'/0' path.
 *
 * The previous implementation imported a Web Crypto HMAC key four times for
 * every candidate. That fixed per-call overhead dominated the already-fast
 * WebGPU PBKDF2 stage. Noble's audited SHA-512 implementation keeps these
 * short HMAC operations in-process and is byte-for-byte checked against
 * @ton/crypto in the test suite.
 */
export function deriveTonPathSeed(rootSeed: Uint8Array): Uint8Array {
  let digest = hmac(sha512, ED25519_CURVE, rootSeed);
  let key = digest.slice(0, 32);
  let chainCode = digest.slice(32);
  digest.fill(0);

  try {
    for (const index of TON_DERIVATION_PATH) {
      const data = new Uint8Array(1 + key.length + 4);
      data.set(key, 1);
      new DataView(data.buffer).setUint32(
        1 + key.length,
        index + HARDENED_OFFSET,
        false,
      );

      try {
        digest = hmac(sha512, chainCode, data);
      } finally {
        data.fill(0);
      }

      const nextKey = digest.slice(0, 32);
      const nextChainCode = digest.slice(32);
      digest.fill(0);
      key.fill(0);
      chainCode.fill(0);
      key = nextKey;
      chainCode = nextChainCode;
    }

    chainCode.fill(0);
    return key;
  } catch (error) {
    digest.fill(0);
    key.fill(0);
    chainCode.fill(0);
    throw error;
  }
}

/** Fast, audited, cross-browser Ed25519 public-key expansion. */
export function publicKeyFromSeed(seed: Uint8Array): TonPublicKey {
  if (seed.byteLength !== 32) {
    throw new Error('An Ed25519 seed must be exactly 32 bytes.');
  }

  try {
    return Buffer.from(ed25519.getPublicKey(seed));
  } catch {
    // Keep the existing TON implementation as a correctness-compatible
    // fallback for an unexpected runtime incompatibility.
    const keyPair = keyPairFromSeed(Buffer.from(seed));
    try {
      return Buffer.from(keyPair.publicKey);
    } finally {
      keyPair.secretKey.fill(0);
    }
  }
}

/**
 * Finishes TON wallet derivation from an already-derived 64-byte BIP39 root
 * seed. The caller retains ownership of rootSeed and must wipe it.
 */
export function walletCandidateFromRootSeed(
  rootSeed: Uint8Array,
  mnemonic: readonly string[],
  version: WalletVersion,
  addressFormat: AddressFormat,
): WalletCandidate {
  if (rootSeed.byteLength !== 64) {
    throw new Error('A BIP39 root seed must be exactly 64 bytes.');
  }

  let rootSeedBuffer: Buffer | undefined;
  let derivedSeedBytes: Uint8Array | undefined;
  let derivedSeed: Buffer | undefined;
  let publicKey: TonPublicKey | undefined;

  try {
    rootSeedBuffer = Buffer.from(rootSeed);
    derivedSeedBytes = deriveTonPathSeed(rootSeedBuffer);
    derivedSeed = Buffer.from(derivedSeedBytes);
    publicKey = publicKeyFromSeed(derivedSeed);

    return {
      address: walletAddressFromPublicKey(publicKey, version, addressFormat),
      mnemonic: [...mnemonic],
    };
  } finally {
    rootSeedBuffer?.fill(0);
    derivedSeedBytes?.fill(0);
    derivedSeed?.fill(0);
    publicKey?.fill(0);
  }
}

/** CPU reference path used both by normal search and to verify GPU winners. */
export async function walletCandidateFromMnemonic(
  mnemonic: readonly string[],
  version: WalletVersion,
  addressFormat: AddressFormat,
): Promise<WalletCandidate> {
  const mnemonicText = mnemonic.join(' ');
  let rootSeed: Uint8Array | undefined;

  try {
    rootSeed = await mnemonicToSeedWebcrypto(mnemonicText);
    return await walletCandidateFromRootSeed(
      rootSeed,
      mnemonic,
      version,
      addressFormat,
    );
  } finally {
    rootSeed?.fill(0);
  }
}

/**
 * Produces the canonical mainnet address for the selected wallet contract.
 *
 * v4 uses the Wallet V4R2 contract's standard wallet id. W5 uses the
 * standard mainnet v5r1 client context (workchain 0, subwallet 0).
 */
export function walletAddressFromPublicKey(
  publicKey: TonPublicKey,
  version: WalletVersion,
  addressFormat: AddressFormat,
): string {
  if (publicKey.length !== 32) {
    throw new Error('A TON Ed25519 public key must be exactly 32 bytes.');
  }

  const wallet =
    version === 'v4r2'
      ? WalletContractV4.create({
          workchain: BASECHAIN_WORKCHAIN,
          publicKey,
        })
      : WalletContractV5R1.create({
          publicKey,
          walletId: {
            networkGlobalId: MAINNET_GLOBAL_ID,
            context: {
              walletVersion: 'v5r1',
              workchain: BASECHAIN_WORKCHAIN,
              subwalletNumber: 0,
            },
          },
        });

  return wallet.address.toString({
    bounceable: addressFormat === 'bounceable',
    testOnly: false,
    urlSafe: true,
  });
}

/**
 * Generates the 12-word TEP-3 multichain mnemonic used by current TON wallets,
 * derives m/44'/607'/0' with SLIP-0010 Ed25519 and creates the requested
 * default contract address. Secret byte buffers are zeroed on a best-effort
 * basis after derivation; immutable JavaScript strings remain subject to GC.
 */
export async function generateWalletCandidate(
  version: WalletVersion,
  addressFormat: AddressFormat,
): Promise<WalletCandidate> {
  const mnemonicText = generateMnemonic(wordlist, BIP39_STRENGTH_BITS);
  const mnemonic = mnemonicText.split(' ');
  return walletCandidateFromMnemonic(mnemonic, version, addressFormat);
}
