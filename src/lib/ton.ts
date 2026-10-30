import { generateMnemonic, mnemonicToSeedWebcrypto, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  keyPairFromSeed, mnemonicNew, mnemonicToPrivateKey, mnemonicValidate,
} from '@ton/crypto';
import {
  beginCell, Cell, contractAddress, WalletContractV4, WalletContractV5R1,
} from '@ton/ton';
import { Buffer } from 'buffer';

import type { AddressFormat, MnemonicScheme, WalletVersion } from '../types';

const BIP39_STRENGTH_BITS = 128;
const TON_DERIVATION_PATH = [44, 607, 0];
const HARDENED_OFFSET = 0x80000000;
const ED25519_CURVE = new TextEncoder().encode('ed25519 seed');
const MAINNET_GLOBAL_ID = -239;
const BASECHAIN_WORKCHAIN = 0;
const V4_DEFAULT_WALLET_ID = 698_983_191;
// Default W5R1 client context: mainnet (-239), workchain 0, version 0,
// subwallet 0. This is the canonical serialized value from @ton/ton.
const W5_DEFAULT_WALLET_ID = 2_147_483_409;
// WalletTg rev00, mainnet, workchain 0. This is NOT the W5 wallet ID.
const TG_DEFAULT_WALLET_ID = 0x7fff7f11;
// Immutable on-account trampoline from ton-blockchain/tg-wallet-contract
// commit 1a29ae5d90e03c3d585d3e42e6ecef691d727a3c. The shared implementation
// in config -123 must never be substituted for this address-defining code.
const TG_TRAMPOLINE_BOC = 'b5ee9c7241010101001a000030ff00209821d7498308b9f240df8085f833d0ed1e20ed53d969427e39';

function getTelegramWalletCode(): Cell {
  const [code] = Cell.fromBoc(Buffer.from(TG_TRAMPOLINE_BOC, 'hex'));
  if (code?.hash().toString('hex') !== '9149ae51c1e4689710cebf7830297b16acfbadb363a920a537893e7ffeeca768') {
    throw new Error('The WalletTg trampoline failed canonical verification.');
  }
  return code;
}

function getCanonicalWalletCode(version: Exclude<WalletVersion, 'tg'>): Cell {
  const placeholderPublicKey = Buffer.alloc(32);
  const wallet = version === 'v4r2'
    ? WalletContractV4.create({
        workchain: BASECHAIN_WORKCHAIN,
        publicKey: placeholderPublicKey,
      })
    : WalletContractV5R1.create({
        publicKey: placeholderPublicKey,
        walletId: {
          networkGlobalId: MAINNET_GLOBAL_ID,
          context: {
            walletVersion: 'v5r1',
            workchain: BASECHAIN_WORKCHAIN,
            subwalletNumber: 0,
          },
        },
      });
  placeholderPublicKey.fill(0);
  const code = wallet.init?.code;
  if (!code) throw new Error(`Missing canonical ${version} wallet code.`);
  return code;
}

// Contract code is immutable. Parsing its large BOC for every vanity attempt
// dominated the address tail, so do it exactly once when this worker loads.
const WALLET_CODE: Record<WalletVersion, Cell> = {
  v4r2: getCanonicalWalletCode('v4r2'),
  w5: getCanonicalWalletCode('w5'),
  tg: getTelegramWalletCode(),
};

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
export function walletAddressFromRootSeed(
  rootSeed: Uint8Array,
  version: WalletVersion,
  addressFormat: AddressFormat,
): string {
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

    return walletAddressFromPublicKey(publicKey, version, addressFormat);
  } finally {
    rootSeedBuffer?.fill(0);
    derivedSeedBytes?.fill(0);
    derivedSeed?.fill(0);
    publicKey?.fill(0);
  }
}

/**
 * Finishes a wallet address from the final 32-byte TON Ed25519 path seed.
 * This is the CPU tail used by the fused WebGPU PBKDF2 + SLIP-0010 path.
 * The caller retains ownership of tonSeed and must wipe it.
 */
export function walletAddressFromTonSeed(
  tonSeed: Uint8Array,
  version: WalletVersion,
  addressFormat: AddressFormat,
): string {
  if (tonSeed.byteLength !== 32) {
    throw new Error('A TON Ed25519 path seed must be exactly 32 bytes.');
  }

  let publicKey: TonPublicKey | undefined;
  try {
    publicKey = publicKeyFromSeed(tonSeed);
    return walletAddressFromPublicKey(publicKey, version, addressFormat);
  } finally {
    publicKey?.fill(0);
  }
}

export function walletCandidateFromTonSeed(
  tonSeed: Uint8Array,
  mnemonic: readonly string[],
  version: WalletVersion,
  addressFormat: AddressFormat,
): WalletCandidate {
  return {
    address: walletAddressFromTonSeed(tonSeed, version, addressFormat),
    mnemonic: [...mnemonic],
  };
}

/**
 * Candidate wrapper used only when recovery words must stay attached to the
 * result. Bulk GPU losers call walletAddressFromRootSeed directly and avoid a
 * twelve-string array copy for every attempted address.
 */
export function walletCandidateFromRootSeed(
  rootSeed: Uint8Array,
  mnemonic: readonly string[],
  version: WalletVersion,
  addressFormat: AddressFormat,
): WalletCandidate {
  return {
    address: walletAddressFromRootSeed(rootSeed, version, addressFormat),
    mnemonic: [...mnemonic],
  };
}

/** CPU reference path used both by normal search and to verify GPU winners. */
export async function walletCandidateFromMnemonic(
  mnemonic: readonly string[],
  version: WalletVersion,
  addressFormat: AddressFormat,
  mnemonicScheme: MnemonicScheme = mnemonic.length === 24 ? 'ton-24' : 'multichain-12',
): Promise<WalletCandidate> {
  if (version === 'tg' && mnemonicScheme !== 'multichain-12') {
    throw new Error('New WalletTg wallets require a 12-word BIP39 rotation mnemonic.');
  }
  if (mnemonicScheme === 'ton-24') {
    const normalizedMnemonic = mnemonic.map((word) => word.toLowerCase().trim());
    if (normalizedMnemonic.length !== 24 || !(await mnemonicValidate(normalizedMnemonic))) {
      normalizedMnemonic.fill('');
      throw new Error('The TON 24-word mnemonic failed canonical validation.');
    }

    const keyPair = await mnemonicToPrivateKey(normalizedMnemonic);
    try {
      return {
        address: walletAddressFromPublicKey(keyPair.publicKey, version, addressFormat),
        mnemonic: [...mnemonic],
      };
    } finally {
      normalizedMnemonic.fill('');
      keyPair.publicKey.fill(0);
      keyPair.secretKey.fill(0);
    }
  }

  if (mnemonic.length !== 12) {
    throw new Error('The multichain mnemonic must contain exactly 12 words.');
  }
  const mnemonicText = mnemonic.join(' ');
  if (!validateMnemonic(mnemonicText, wordlist)) {
    throw new Error('The 12-word mnemonic failed BIP39 validation.');
  }
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
 * standard mainnet v5r1 client context (workchain 0, subwallet 0). WalletTg
 * uses its immutable trampoline and rev00 data with the initial anchor key.
 */
export function walletAddressFromPublicKey(
  publicKey: TonPublicKey,
  version: WalletVersion,
  addressFormat: AddressFormat,
): string {
  if (publicKey.length !== 32) {
    throw new Error('A TON Ed25519 public key must be exactly 32 bytes.');
  }

  const data = version === 'tg'
    ? beginCell()
        .storeUint(0, 8) // initial revision
        .storeUint(0, 32) // seqno
        .storeUint(TG_DEFAULT_WALLET_ID, 32)
        .storeBuffer(publicKey, 32)
        .endCell()
    : version === 'v4r2'
    ? beginCell()
        .storeUint(0, 32)
        .storeUint(V4_DEFAULT_WALLET_ID, 32)
        .storeBuffer(publicKey)
        .storeBit(0)
        .endCell()
    : beginCell()
        .storeUint(1, 1)
        .storeUint(0, 32)
        .storeInt(W5_DEFAULT_WALLET_ID, 32)
        .storeBuffer(publicKey, 32)
        .storeBit(0)
        .endCell();
  const address = contractAddress(BASECHAIN_WORKCHAIN, {
    code: WALLET_CODE[version],
    data,
  });

  return address.toString({
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
  mnemonicScheme: MnemonicScheme = 'multichain-12',
): Promise<WalletCandidate> {
  if (version === 'tg' && mnemonicScheme !== 'multichain-12') {
    throw new Error('New WalletTg wallets require a 12-word BIP39 rotation mnemonic.');
  }
  if (mnemonicScheme === 'ton-24') {
    const mnemonic = await mnemonicNew(24);
    return walletCandidateFromMnemonic(mnemonic, version, addressFormat, mnemonicScheme);
  }
  const mnemonicText = generateMnemonic(wordlist, BIP39_STRENGTH_BITS);
  const mnemonic = mnemonicText.split(' ');
  return walletCandidateFromMnemonic(mnemonic, version, addressFormat, mnemonicScheme);
}
