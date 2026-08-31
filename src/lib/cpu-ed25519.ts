import { ed25519 } from '@noble/curves/ed25519.js';

const ED25519_SEED_BYTES = 32;
const SELF_TEST_SEED = hexToBytes(
  '9d61b19deffd5a60ba844af492ec2cc4' +
  '4449c5697b326919703bac031cae7f60',
);
const SELF_TEST_PUBLIC_KEY = hexToBytes(
  'd75a980182b10ab7d54bfed3c964073a' +
  '0ee172f3daa62325af021a68f707511a',
);

interface SodiumKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface SodiumEd25519Api {
  readonly ready: Promise<unknown>;
  crypto_sign_seed_keypair(seed: Uint8Array): SodiumKeyPair;
}

export interface CpuEd25519Accelerator {
  readonly backend: 'libsodium-wasm' | 'noble-js';
  /** The returned public key is owned by the caller and should be wiped. */
  publicKeyFromSeed(seed: Uint8Array): Uint8Array;
}

export interface CpuEd25519Options {
  /** Test seam; production callers should leave this unset. */
  loadSodium?: () => Promise<SodiumEd25519Api>;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function assertSeed(seed: Uint8Array): void {
  if (!(seed instanceof Uint8Array) || seed.byteLength !== ED25519_SEED_BYTES) {
    throw new Error('An Ed25519 seed must be exactly 32 bytes.');
  }
}

function noblePublicKey(seed: Uint8Array): Uint8Array {
  assertSeed(seed);
  return ed25519.getPublicKey(seed);
}

function nobleAccelerator(): CpuEd25519Accelerator {
  return {
    backend: 'noble-js',
    publicKeyFromSeed: noblePublicKey,
  };
}

async function loadOfficialSodium(): Promise<SodiumEd25519Api> {
  const module = await import('libsodium-wrappers');
  return module.default as SodiumEd25519Api;
}

function sodiumPublicKey(
  sodium: SodiumEd25519Api,
  seed: Uint8Array,
): Uint8Array {
  assertSeed(seed);
  let pair: SodiumKeyPair | undefined;
  try {
    pair = sodium.crypto_sign_seed_keypair(seed);
    if (
      !(pair.publicKey instanceof Uint8Array) ||
      pair.publicKey.byteLength !== ED25519_SEED_BYTES ||
      !(pair.privateKey instanceof Uint8Array)
    ) {
      throw new Error('libsodium returned a malformed Ed25519 key pair.');
    }

    // libsodium-wrappers copies WASM output into an owned Uint8Array. Return
    // that array directly so the hot path avoids a second allocation/copy.
    const publicKey = pair.publicKey;
    pair.publicKey = new Uint8Array(0);
    return publicKey;
  } finally {
    pair?.publicKey.fill(0);
    pair?.privateKey.fill(0);
  }
}

/**
 * Loads libsodium's official WASM build and verifies it against RFC 8032.
 * Any loading, self-test, or per-call failure falls back to audited noble JS,
 * keeping CPU search functional in browsers that block WebAssembly.
 */
export async function createCpuEd25519Accelerator(
  options: CpuEd25519Options = {},
): Promise<CpuEd25519Accelerator> {
  let sodium: SodiumEd25519Api;
  let selfTestSeed: Uint8Array | undefined;
  try {
    sodium = await (options.loadSodium ?? loadOfficialSodium)();
    await sodium.ready;

    selfTestSeed = SELF_TEST_SEED.slice();
    const actual = sodiumPublicKey(sodium, selfTestSeed);
    try {
      if (!bytesEqual(actual, SELF_TEST_PUBLIC_KEY)) {
        throw new Error('libsodium Ed25519 self-test failed.');
      }
    } finally {
      actual.fill(0);
    }
  } catch {
    return nobleAccelerator();
  } finally {
    selfTestSeed?.fill(0);
  }

  return {
    backend: 'libsodium-wasm',
    publicKeyFromSeed(seed: Uint8Array): Uint8Array {
      try {
        return sodiumPublicKey(sodium, seed);
      } catch (error) {
        // Invalid caller input must remain an error; only runtime/provider
        // failures should take the compatibility fallback.
        assertSeed(seed);
        try {
          return noblePublicKey(seed);
        } catch {
          throw error;
        }
      }
    },
  };
}
