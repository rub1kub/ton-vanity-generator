import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';

export const TON_MNEMONIC_WORD_COUNT = 24;
export const TON_MNEMONIC_BASIC_ITERATIONS = 390;
export const TON_MNEMONIC_DEFAULT_ITERATIONS = 100_000;
export const TON_MNEMONIC_ENTROPY_BYTES = 64;
export const TON_MNEMONIC_SEED_BYTES = 32;

const TON_BASIC_SEED_SALT = 'TON seed version';
const TON_DEFAULT_SEED_SALT = 'TON default seed';
const MAX_GET_RANDOM_VALUES_BYTES = 65_536;
const MAX_BATCH_SIZE = 1_000_000;
const WORD_INDEX_MASK = 0x07ff;
const textEncoder = new TextEncoder();
const emptyMessage = new Uint8Array(0);

if (!Array.isArray(englishWordlist) || englishWordlist.length !== 2_048) {
  throw new TypeError('The bundled TON mnemonic wordlist is invalid.');
}

const WORDS = Object.freeze([...englishWordlist]);
const WORD_SET = new Set(WORDS);

function secureRandom(): Crypto {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== 'function') {
    throw new Error('A cryptographically secure random-number generator is unavailable.');
  }
  return crypto;
}

function assertEntropy(entropy: Uint8Array): void {
  if (!(entropy instanceof Uint8Array) || entropy.byteLength !== TON_MNEMONIC_ENTROPY_BYTES) {
    throw new RangeError('TON mnemonic entropy must be exactly 64 bytes.');
  }
}

export function canonicalizeTonMnemonic(mnemonic: string | readonly string[]): string[] {
  const words = (typeof mnemonic === 'string' ? mnemonic.split(/\s+/u) : [...mnemonic])
    .map((word) => word.normalize('NFKD').trim().toLowerCase())
    .filter(Boolean);

  if (words.length !== TON_MNEMONIC_WORD_COUNT || words.some((word) => !WORD_SET.has(word))) {
    throw new TypeError(`Expected exactly ${TON_MNEMONIC_WORD_COUNT} English TON mnemonic words.`);
  }
  return words;
}

/** HMAC-SHA512(words, empty password), matching @ton/crypto mnemonicToEntropy. */
export function tonMnemonicEntropy(mnemonic: string | readonly string[]): Uint8Array {
  const words = canonicalizeTonMnemonic(mnemonic);
  const encoded = textEncoder.encode(words.join(' '));
  try {
    return hmac(sha512, encoded, emptyMessage);
  } finally {
    encoded.fill(0);
    words.fill('');
  }
}

async function pbkdf2Sha512(
  entropy: Uint8Array,
  saltText: string,
  iterations: number,
): Promise<Uint8Array> {
  assertEntropy(entropy);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto is unavailable.');

  const password = entropy.slice();
  const salt = textEncoder.encode(saltText);
  try {
    const key = await subtle.importKey(
      'raw',
      password.buffer as ArrayBuffer,
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await subtle.deriveBits({
      name: 'PBKDF2',
      hash: 'SHA-512',
      salt,
      iterations,
    }, key, 512);
    return new Uint8Array(bits);
  } finally {
    password.fill(0);
    salt.fill(0);
  }
}

export function deriveTonMnemonicBasicSeed(entropy: Uint8Array): Promise<Uint8Array> {
  return pbkdf2Sha512(entropy, TON_BASIC_SEED_SALT, TON_MNEMONIC_BASIC_ITERATIONS);
}

export async function deriveTonMnemonicDefaultSeed(entropy: Uint8Array): Promise<Uint8Array> {
  const fullSeed = await pbkdf2Sha512(
    entropy,
    TON_DEFAULT_SEED_SALT,
    TON_MNEMONIC_DEFAULT_ITERATIONS,
  );
  try {
    return fullSeed.slice(0, TON_MNEMONIC_SEED_BYTES);
  } finally {
    fullSeed.fill(0);
  }
}

/** Returns null when the 24 random words do not satisfy TON's basic-seed check. */
export async function deriveTonMnemonicSeed(
  mnemonic: string | readonly string[],
): Promise<Uint8Array | null> {
  const entropy = tonMnemonicEntropy(mnemonic);
  let basicSeed: Uint8Array | undefined;
  try {
    basicSeed = await deriveTonMnemonicBasicSeed(entropy);
    if (basicSeed[0] !== 0) return null;
    return await deriveTonMnemonicDefaultSeed(entropy);
  } finally {
    basicSeed?.fill(0);
    entropy.fill(0);
  }
}

export function generateTonMnemonic24(): string {
  return generateTonMnemonic24Batch(1)[0]!;
}

/** Generates random 24-word TON candidates; roughly one in 256 is valid. */
export function generateTonMnemonic24Batch(count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_BATCH_SIZE) {
    throw new RangeError(`Mnemonic batch size must be an integer from 0 to ${MAX_BATCH_SIZE}.`);
  }
  if (count === 0) return [];

  const crypto = secureRandom();
  const phrases = new Array<string>(count);
  const maxPhrasesPerCall = Math.floor(
    MAX_GET_RANDOM_VALUES_BYTES /
    (TON_MNEMONIC_WORD_COUNT * Uint16Array.BYTES_PER_ELEMENT),
  );
  const randomWords = new Uint16Array(
    Math.min(count, maxPhrasesPerCall) * TON_MNEMONIC_WORD_COUNT,
  );

  let written = 0;
  try {
    while (written < count) {
      const chunkCount = Math.min(count - written, maxPhrasesPerCall);
      const chunk = randomWords.subarray(0, chunkCount * TON_MNEMONIC_WORD_COUNT);
      crypto.getRandomValues(chunk);
      try {
        for (let phraseIndex = 0; phraseIndex < chunkCount; phraseIndex += 1) {
          const words = new Array<string>(TON_MNEMONIC_WORD_COUNT);
          const offset = phraseIndex * TON_MNEMONIC_WORD_COUNT;
          for (let wordIndex = 0; wordIndex < TON_MNEMONIC_WORD_COUNT; wordIndex += 1) {
            words[wordIndex] = WORDS[chunk[offset + wordIndex]! & WORD_INDEX_MASK]!;
          }
          phrases[written + phraseIndex] = words.join(' ');
          words.fill('');
        }
      } finally {
        chunk.fill(0);
      }
      written += chunkCount;
    }
    return phrases;
  } catch (error) {
    phrases.fill('');
    throw error;
  } finally {
    randomWords.fill(0);
  }
}
