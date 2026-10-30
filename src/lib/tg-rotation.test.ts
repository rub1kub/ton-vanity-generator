/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Address, beginCell, Cell, loadMessage } from '@ton/ton';
import { ed25519 } from '@noble/curves/ed25519.js';
import { encryptPreviousSeed, hex, parseMainnetAddress, rotationBody, rotationEnvelope, rotationProof, telegramIdentity, telegramSigningSeed } from './tg-rotation';
import vectors from './fixtures/wallet-tg.json';
import reference from './fixtures/wallet-tg-rotation.json';

// Public BIP39 test vectors ONLY. Never fund these addresses.
export const ANCHOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const NEXT = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const THIRD = 'notice tortoise soup strong gun divide offer process salon siren general carry';
const ADDRESS = vectors[0].nonBounceable;
const VALID_UNTIL = 2_000_000_000;

describe('Telegram rotation identity and serialization', () => {
  it('imports initial, duplicated and rotated halves with the same canonical address', async () => {
    const initial = await telegramIdentity(ANCHOR, ADDRESS);
    const duplicate = await telegramIdentity(`${ANCHOR} ${ANCHOR}`, ADDRESS);
    const rotated = await telegramIdentity(`${ANCHOR} ${NEXT}`, ADDRESS);
    expect(hex(initial.publicKey)).toBe(vectors[0].publicKey);
    expect(hex(duplicate.publicKey)).toBe(hex(initial.publicKey));
    expect(hex(rotated.publicKey)).toBe(reference.newPublicKey);
    expect(rotated.address.equals(initial.address)).toBe(true);
  });

  it('rejects invalid halves, missing anchors, another address and testnet', async () => {
    await expect(telegramIdentity(`${ANCHOR} ${NEXT.replace('wrong', 'zoo')}`, ADDRESS)).rejects.toMatchObject({ code: 'phrase' });
    await expect(telegramIdentity(ANCHOR.replace('about', 'abandon'), ADDRESS)).rejects.toMatchObject({ code: 'phrase' });
    await expect(telegramIdentity(NEXT, ADDRESS)).rejects.toMatchObject({ code: 'mismatch' });
    await expect(telegramIdentity(ANCHOR, vectors[1].nonBounceable)).rejects.toMatchObject({ code: 'mismatch' });
    const testnet = Address.parse(ADDRESS).toString({ testOnly: true });
    expect(() => parseMainnetAddress(testnet)).toThrow('address');
    expect(() => parseMainnetAddress(`-1:${'0'.repeat(64)}`)).toThrow('address');
  });

  it('matches the official Rust engine byte-for-byte, including both signatures and old-key encryption', async () => {
    const identity = await telegramIdentity(ANCHOR, ADDRESS);
    const nextSeed = await telegramSigningSeed(NEXT.split(' '));
    const body = rotationBody({ address: identity.address, oldSeed: identity.seed, newSeed: nextSeed, seqno: 0, validUntil: VALID_UNTIL, sign: true });
    expect(rotationProof(identity.address).hash().toString('hex')).toBe(reference.proofHash);
    expect(hex(encryptPreviousSeed(identity.seed, nextSeed))).toBe(reference.encryptedOldSeed);
    expect(body.hash().toString('hex')).toBe(reference.bodyHash);
    expect(body.equals(Cell.fromBoc(Buffer.from(reference.bodyBocHex, 'hex'))[0])).toBe(true);
    // Independently recover the old signing seed using Node crypto.
    const mask = createHash('sha256').update(nextSeed).update('keyChangeSaltV1').digest();
    expect(Buffer.from(reference.encryptedOldSeed, 'hex').map((b, i) => b ^ mask[i])).toEqual(Buffer.from(identity.seed));
  });

  it('never includes valid signatures or encrypted key material in a fee estimate', async () => {
    const identity = await telegramIdentity(ANCHOR, ADDRESS);
    const nextSeed = await telegramSigningSeed(NEXT.split(' '));
    const body = rotationBody({ address: identity.address, oldSeed: identity.seed, newSeed: nextSeed, seqno: 0, validUntil: VALID_UNTIL, sign: false });
    const data = body.beginParse();
    const signature = data.loadBuffer(64);
    expect(signature.every((byte) => byte === 0)).toBe(true);
    expect(ed25519.verify(signature, data.asCell().hash(), identity.publicKey)).toBe(false);
    expect(data.loadRef().beginParse().loadBuffer(64).every((byte) => byte === 0)).toBe(true);
    expect(data.loadRef().beginParse().loadBuffer(32).every((byte) => byte === 0)).toBe(true);
  });

  it('wraps active and deploying requests correctly and emits deterministic emulator fixtures', async () => {
    const identity = await telegramIdentity(ANCHOR, ADDRESS);
    const nextSeed = await telegramSigningSeed(NEXT.split(' '));
    const thirdSeed = await telegramSigningSeed(THIRD.split(' '));
    const body = rotationBody({ address: identity.address, oldSeed: identity.seed, newSeed: nextSeed, seqno: 0, validUntil: VALID_UNTIL, sign: true });
    const active = rotationEnvelope(identity, body, false);
    const deploying = rotationEnvelope(identity, body, true);
    expect(loadMessage(active.beginParse()).init).toBeNull();
    const deployment = loadMessage(deploying.beginParse());
    expect(deployment.init?.code?.equals(identity.init.code!)).toBe(true);
    expect(deployment.init?.data?.equals(identity.init.data!)).toBe(true);
    expect(deployment.body.equals(body)).toBe(true);
    const second = rotationBody({ address: identity.address, oldSeed: nextSeed, newSeed: thirdSeed, seqno: 1, validUntil: VALID_UNTIL, sign: true });
    const stale = rotationBody({ address: identity.address, oldSeed: identity.seed, newSeed: thirdSeed, seqno: 1, validUntil: VALID_UNTIL, sign: true });
    const wrongAddress = rotationBody({ address: Address.parse(vectors[1].nonBounceable), oldSeed: identity.seed, newSeed: nextSeed, seqno: 0, validUntil: VALID_UNTIL, sign: true });
    if (process.env.ROTATION_FIXTURE_DIR) {
      const directory = process.env.ROTATION_FIXTURE_DIR;
      mkdirSync(directory, { recursive: true });
      const fixtures: Record<string, Cell> = {
        first: active, deploy: deploying, second: rotationEnvelope(identity, second, false),
        stale: rotationEnvelope(identity, stale, false), wrongProof: rotationEnvelope(identity, wrongAddress, false),
        code: identity.init.code!, data: identity.init.data!,
        address: beginCell().storeAddress(identity.address).endCell(),
        nextKey: beginCell().storeBuffer(Buffer.from(ed25519.getPublicKey(nextSeed))).endCell(),
        thirdKey: beginCell().storeBuffer(Buffer.from(ed25519.getPublicKey(thirdSeed))).endCell(),
      };
      for (const [name, cell] of Object.entries(fixtures)) writeFileSync(join(directory, `${name}.boc`), cell.toBoc());
    }
  });
});
