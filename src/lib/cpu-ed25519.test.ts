import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';

import {
  createCpuEd25519Accelerator,
  type SodiumEd25519Api,
} from './cpu-ed25519';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function fakeSodium(
  expand: (seed: Uint8Array) => Uint8Array = (seed) => ed25519.getPublicKey(seed),
): SodiumEd25519Api {
  return {
    ready: Promise.resolve(),
    crypto_sign_seed_keypair(seed) {
      const publicKey = expand(seed);
      const privateKey = new Uint8Array(64);
      privateKey.set(seed, 0);
      privateKey.set(publicKey, 32);
      return { publicKey, privateKey };
    },
  };
}

describe('createCpuEd25519Accelerator', () => {
  it('passes the RFC 8032 known-answer test with real libsodium WASM', async () => {
    const accelerator = await createCpuEd25519Accelerator();
    const seed = hexToBytes(
      '9d61b19deffd5a60ba844af492ec2cc4' +
      '4449c5697b326919703bac031cae7f60',
    );
    const publicKey = accelerator.publicKeyFromSeed(seed);

    expect(accelerator.backend).toBe('libsodium-wasm');
    expect(bytesToHex(publicKey)).toBe(
      'd75a980182b10ab7d54bfed3c964073a' +
      '0ee172f3daa62325af021a68f707511a',
    );
    publicKey.fill(0);
    seed.fill(0);
  });

  it('is byte-equal to noble across deterministic seeds', async () => {
    const accelerator = await createCpuEd25519Accelerator();

    for (let sample = 0; sample < 64; sample += 1) {
      const seed = Uint8Array.from(
        { length: 32 },
        (_, index) => (sample * 73 + index * 29 + 11) & 0xff,
      );
      const expected = ed25519.getPublicKey(seed);
      const actual = accelerator.publicKeyFromSeed(seed);
      expect(actual).toEqual(expected);
      actual.fill(0);
      expected.fill(0);
      seed.fill(0);
    }
  });

  it('falls back when WASM loading fails', async () => {
    const accelerator = await createCpuEd25519Accelerator({
      loadSodium: () => Promise.reject(new Error('WASM blocked')),
    });
    const seed = new Uint8Array(32).fill(7);
    const expected = ed25519.getPublicKey(seed);
    const actual = accelerator.publicKeyFromSeed(seed);

    expect(accelerator.backend).toBe('noble-js');
    expect(actual).toEqual(expected);
    actual.fill(0);
    expected.fill(0);
    seed.fill(0);
  });

  it('falls back when the startup known-answer test fails', async () => {
    const accelerator = await createCpuEd25519Accelerator({
      loadSodium: async () => fakeSodium(() => new Uint8Array(32)),
    });

    expect(accelerator.backend).toBe('noble-js');
  });

  it('uses noble for an isolated runtime provider failure', async () => {
    let calls = 0;
    const sodium = fakeSodium((seed) => {
      calls += 1;
      if (calls > 1) throw new Error('provider failed after self-test');
      return ed25519.getPublicKey(seed);
    });
    const accelerator = await createCpuEd25519Accelerator({
      loadSodium: async () => sodium,
    });
    const seed = new Uint8Array(32).fill(13);
    const expected = ed25519.getPublicKey(seed);
    const actual = accelerator.publicKeyFromSeed(seed);

    expect(accelerator.backend).toBe('libsodium-wasm');
    expect(actual).toEqual(expected);
    actual.fill(0);
    expected.fill(0);
    seed.fill(0);
  });

  it('rejects malformed seeds without mutating them', async () => {
    const accelerator = await createCpuEd25519Accelerator({
      loadSodium: async () => fakeSodium(),
    });
    const seed = new Uint8Array([1, 2, 3]);

    expect(() => accelerator.publicKeyFromSeed(seed)).toThrow('exactly 32 bytes');
    expect([...seed]).toEqual([1, 2, 3]);
  });
});
