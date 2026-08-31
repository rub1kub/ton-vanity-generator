import { sha256 } from '@noble/hashes/sha2.js';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';

export const BIP39_ENTROPY_BYTES_12_WORDS = 16;
export const MAX_GET_RANDOM_VALUES_BYTES = 65_536;

const MAX_ENTROPIES_PER_RANDOM_CALL =
  MAX_GET_RANDOM_VALUES_BYTES / BIP39_ENTROPY_BYTES_12_WORDS;
const MAX_BATCH_SIZE = 1_000_000;

/**
 * @scure/bip39 validates every one of the 2,048 word-list entries every time
 * entropyToMnemonic is called. The bundled canonical English list is trusted,
 * but validate and copy it once so later batches cannot be affected by a
 * mutated import.
 */
function validatedEnglishWordlist(): readonly string[] {
  if (!Array.isArray(englishWordlist) || englishWordlist.length !== 2_048) {
    throw new TypeError('The bundled BIP39 English wordlist is invalid.');
  }

  for (const word of englishWordlist) {
    if (typeof word !== 'string' || word.length === 0) {
      throw new TypeError('The bundled BIP39 English wordlist is invalid.');
    }
  }

  return Object.freeze([...englishWordlist]);
}

const WORDS = validatedEnglishWordlist();

function secureRandom(): Crypto {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== 'function') {
    throw new Error('A cryptographically secure random-number generator is unavailable.');
  }
  return crypto;
}

/**
 * Encodes exactly 128 bits of entropy as the canonical 12-word English BIP39
 * phrase. The twelve 11-bit indexes below are the 128 entropy bits followed by
 * the high four bits of SHA-256(entropy), as specified by BIP39.
 */
export function entropy128ToEnglishMnemonic(entropy: Uint8Array): string {
  if (!(entropy instanceof Uint8Array) || entropy.byteLength !== BIP39_ENTROPY_BYTES_12_WORDS) {
    throw new RangeError('A 12-word BIP39 mnemonic requires exactly 16 bytes of entropy.');
  }

  const checksum = sha256(entropy);
  try {
    const b = entropy;
    return [
      WORDS[(b[0]! << 3) | (b[1]! >>> 5)],
      WORDS[((b[1]! & 0x1f) << 6) | (b[2]! >>> 2)],
      WORDS[((b[2]! & 0x03) << 9) | (b[3]! << 1) | (b[4]! >>> 7)],
      WORDS[((b[4]! & 0x7f) << 4) | (b[5]! >>> 4)],
      WORDS[((b[5]! & 0x0f) << 7) | (b[6]! >>> 1)],
      WORDS[((b[6]! & 0x01) << 10) | (b[7]! << 2) | (b[8]! >>> 6)],
      WORDS[((b[8]! & 0x3f) << 5) | (b[9]! >>> 3)],
      WORDS[((b[9]! & 0x07) << 8) | b[10]!],
      WORDS[(b[11]! << 3) | (b[12]! >>> 5)],
      WORDS[((b[12]! & 0x1f) << 6) | (b[13]! >>> 2)],
      WORDS[((b[13]! & 0x03) << 9) | (b[14]! << 1) | (b[15]! >>> 7)],
      WORDS[((b[15]! & 0x7f) << 4) | (checksum[0]! >>> 4)],
    ].join(' ');
  } finally {
    checksum.fill(0);
  }
}

/** Generates one 12-word English BIP39 phrase from browser CSPRNG entropy. */
export function generateEnglishMnemonic12(): string {
  const entropy = new Uint8Array(BIP39_ENTROPY_BYTES_12_WORDS);
  try {
    secureRandom().getRandomValues(entropy);
    return entropy128ToEnglishMnemonic(entropy);
  } finally {
    entropy.fill(0);
  }
}

/**
 * Generates a batch while keeping every getRandomValues call at or below the
 * Web Crypto mandated 65,536-byte quota. Entropy buffers are wiped as soon as
 * their chunk has been encoded; returned JavaScript strings remain GC-managed.
 */
export function generateEnglishMnemonic12Batch(count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_BATCH_SIZE) {
    throw new RangeError(`Mnemonic batch size must be an integer from 0 to ${MAX_BATCH_SIZE}.`);
  }
  if (count === 0) return [];

  const crypto = secureRandom();
  const phrases = new Array<string>(count);
  const entropyPool = new Uint8Array(
    Math.min(count, MAX_ENTROPIES_PER_RANDOM_CALL) * BIP39_ENTROPY_BYTES_12_WORDS,
  );

  let written = 0;
  try {
    while (written < count) {
      const chunkCount = Math.min(count - written, MAX_ENTROPIES_PER_RANDOM_CALL);
      const chunk = entropyPool.subarray(
        0,
        chunkCount * BIP39_ENTROPY_BYTES_12_WORDS,
      );
      crypto.getRandomValues(chunk);

      try {
        for (let index = 0; index < chunkCount; index += 1) {
          const offset = index * BIP39_ENTROPY_BYTES_12_WORDS;
          phrases[written + index] = entropy128ToEnglishMnemonic(
            chunk.subarray(offset, offset + BIP39_ENTROPY_BYTES_12_WORDS),
          );
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
    entropyPool.fill(0);
  }
}
