import { generateMnemonic, mnemonicToSeedWebcrypto, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Address, beginCell, contractAddress, external, storeMessage } from '@ton/ton';
import type { Cell, StateInit } from '@ton/ton';
import { Buffer } from 'buffer';
import { deriveTonPathSeed } from './ton';
import { telegramWalletCode, telegramWalletData, TG_WALLET_ID } from './wallet-tg-code';
import { RotationError } from './tg-rotation-types';

export interface TelegramIdentity {
  address: Address;
  init: StateInit;
  anchorWords: string[];
  anchorPublicKey: Uint8Array;
  seed: Uint8Array;
  publicKey: Uint8Array;
}

export const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

export function parseMainnetAddress(text: string): Address {
  try {
    const value = text.trim();
    const address = Address.isRaw(value) ? Address.parseRaw(value) : (() => {
      const result = Address.parseFriendly(value);
      if (result.isTestOnly) throw new Error();
      return result.address;
    })();
    if (address.workChain !== 0) throw new Error();
    return address;
  } catch { throw new RotationError('address'); }
}

export async function telegramSigningSeed(words: readonly string[]): Promise<Uint8Array> {
  const root = await mnemonicToSeedWebcrypto(words.join(' '));
  try { return deriveTonPathSeed(root); } finally { root.fill(0); }
}

// Telegram's 24 words are TWO independently checksummed 12-word BIP39 halves.
// The first half fixes the original StateInit forever; only the second signs.
export async function telegramIdentity(phrase: string, expectedAddress: string): Promise<TelegramIdentity> {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  let anchorSeed: Uint8Array | undefined;
  let seed: Uint8Array | undefined;
  try {
    if ((words.length !== 12 && words.length !== 24)
      || !validateMnemonic(words.slice(0, 12).join(' '), wordlist)
      || (words.length === 24 && !validateMnemonic(words.slice(12).join(' '), wordlist))) {
      throw new RotationError('phrase');
    }
    const expected = parseMainnetAddress(expectedAddress);
    anchorSeed = await telegramSigningSeed(words.slice(0, 12));
    const anchorPublicKey = ed25519.getPublicKey(anchorSeed);
    const init = { code: telegramWalletCode(), data: telegramWalletData(anchorPublicKey) };
    const address = contractAddress(0, init);
    if (!address.equals(expected)) throw new RotationError('mismatch');
    seed = words.length === 12 ? anchorSeed.slice() : await telegramSigningSeed(words.slice(12));
    return { address, init, anchorWords: words.slice(0, 12), anchorPublicKey, seed, publicKey: ed25519.getPublicKey(seed) };
  } catch (error) {
    seed?.fill(0);
    throw error;
  } finally {
    anchorSeed?.fill(0);
    words.fill('');
  }
}

export async function newTelegramSigner(identity: TelegramIdentity) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const words = generateMnemonic(wordlist, 128).split(' ');
    const seed = await telegramSigningSeed(words);
    const publicKey = ed25519.getPublicKey(seed);
    if (hex(publicKey) !== hex(identity.publicKey) && hex(publicKey) !== hex(identity.anchorPublicKey)) {
      return { words, seed, publicKey };
    }
    seed.fill(0); words.fill('');
  }
  throw new RotationError('internal');
}

export function rotationProof(address: Address): Cell {
  return beginCell().storeUint(0x4b45595f524f544154494f4en, 96)
    .storeInt(address.workChain, 8).storeBuffer(address.hash, 32).endCell();
}

export function encryptPreviousSeed(oldSeed: Uint8Array, newSeed: Uint8Array): Uint8Array {
  if (oldSeed.length !== 32 || newSeed.length !== 32) throw new RotationError('internal');
  const input = new Uint8Array(47); // new seed + ASCII keyChangeSaltV1
  input.set(newSeed); input.set(new TextEncoder().encode('keyChangeSaltV1'), 32);
  const mask = sha256(input);
  try { return Uint8Array.from(oldSeed, (value, i) => value ^ mask[i]); }
  finally { input.fill(0); mask.fill(0); }
}

export function rotationBody(args: {
  address: Address; oldSeed: Uint8Array; newSeed: Uint8Array;
  seqno: number; validUntil: number; sign: boolean;
}): Cell {
  if (![args.seqno, args.validUntil].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff)) {
    throw new RotationError('internal');
  }
  const newKey = ed25519.getPublicKey(args.newSeed);
  if (hex(newKey) === hex(ed25519.getPublicKey(args.oldSeed))) throw new RotationError('staleKey');
  // Fee estimation deliberately has NO valid signatures and NO encrypted seed.
  // The RPC cannot broadcast an estimate as a valid change-key request.
  const proof = args.sign ? ed25519.sign(rotationProof(args.address).hash(), args.newSeed) : new Uint8Array(64);
  const encrypted = args.sign ? encryptPreviousSeed(args.oldSeed, args.newSeed) : new Uint8Array(32);
  const request = beginCell().storeUint(0xfbba99c8, 32).storeUint(TG_WALLET_ID, 32)
    .storeUint(args.validUntil, 32).storeUint(args.seqno, 32).storeBuffer(Buffer.from(newKey))
    .storeRef(beginCell().storeBuffer(Buffer.from(proof)).endCell())
    .storeRef(beginCell().storeBuffer(Buffer.from(encrypted)).endCell()).endCell();
  try {
    const signature = args.sign ? ed25519.sign(request.hash(), args.oldSeed) : new Uint8Array(64);
    return beginCell().storeBuffer(Buffer.from(signature)).storeSlice(request.beginParse()).endCell();
  } finally { encrypted.fill(0); }
}

export function rotationEnvelope(identity: TelegramIdentity, body: Cell, deploy: boolean): Cell {
  return beginCell().store(storeMessage(external({
    to: identity.address, body, init: deploy ? identity.init : undefined,
  }), { forceRef: true })).endCell();
}

export function clearIdentity(identity: TelegramIdentity | undefined) {
  identity?.seed.fill(0);
  identity?.anchorWords.fill('');
}
