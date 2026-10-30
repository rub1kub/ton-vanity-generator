/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginCell, Cell } from '@ton/ton';
import { RotationSession } from './tg-rotation-session';
import { telegramWalletCode, TG_WALLET_ID } from './wallet-tg-code';
import { checkRotation, rotationStatus } from './tg-rpc';
import type { RotationRpc, WalletSnapshot } from './tg-rpc';
import { RotationError } from './tg-rotation-types';
import type { PendingRotation } from './tg-rotation-types';
import vectors from './fixtures/wallet-tg.json';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const implementation = readFileSync(new URL('../../tests/rotation-contract/contracts/WalletTg-rev00.boc', import.meta.url)).toString('base64');
const account = () => ({
  state: 'active', balance: '1000000000', sync_utime: Math.floor(Date.now() / 1000), block_id: { workchain: -1, seqno: 123 },
  code: telegramWalletCode().toBoc().toString('base64'),
  data: beginCell().storeUint(0, 8).storeUint(0, 32).storeUint(TG_WALLET_ID, 32)
    .storeBuffer(Buffer.from(vectors[0].publicKey, 'hex')).endCell().toBoc().toString('base64'),
});
let state: ReturnType<typeof account>;
let fee: number;
let sendFails: boolean;
let calls: { method: string; params: Record<string, unknown> }[];
const rpc: RotationRpc = { async call(method, params) {
  calls.push({ method, params });
  if (method === 'getAddressInformation') return state;
  if (method === 'getConfigParam') return { config: { bytes: implementation } };
  if (method === 'estimateFee') return { source_fees: { in_fwd_fee: 100, storage_fee: 20, gas_fee: fee, fwd_fee: 200 } };
  if (sendFails) throw new RotationError('network');
  return { '@type': 'ok' };
} };
beforeEach(() => { state = account(); fee = 1_000_000; calls = []; sendFails = false; });

describe('rotation session', () => {
  it('requires backup verification; estimates are unsigned; broadcasts only the explicitly confirmed operation', async () => {
    const session = new RotationSession(rpc);
    const preview = await session.prepare(PHRASE, vectors[0].nonBounceable);
    expect(preview.words.slice(0, 12).join(' ')).toBe(PHRASE);
    expect(preview.words).toHaveLength(24);
    expect(new Set(preview.quiz).size).toBe(3);
    expect(preview.quiz.every((position) => position >= 12)).toBe(true);
    expect(calls.some(({ method }) => method === 'sendBoc')).toBe(false);
    const estimate = calls.find(({ method }) => method === 'estimateFee')!;
    expect(estimate.params.ignore_chksig).toBe(true);
    expect(Cell.fromBase64(estimate.params.body as string).beginParse().loadBuffer(64).every((b) => b === 0)).toBe(true);
    await expect(session.sign(['wrong', 'wrong', 'wrong'], preview.fee)).rejects.toMatchObject({ code: 'phrase' });
    const pending = await session.sign(preview.quiz.map((position) => preview.words[position]), preview.fee);
    expect(calls.some(({ method }) => method === 'sendBoc')).toBe(false);
    await session.send(pending.messageHash);
    await expect(session.send(pending.messageHash)).rejects.toMatchObject({ code: 'busy' });
    expect(calls.filter(({ method }) => method === 'sendBoc')).toHaveLength(1);
    session.dispose();
  });

  it('keeps the same public pending operation after an ambiguous send error and forbids another candidate', async () => {
    const session = new RotationSession(rpc);
    const preview = await session.prepare(PHRASE, vectors[0].nonBounceable);
    const pending = await session.sign(preview.quiz.map((position) => preview.words[position]), preview.fee);
    sendFails = true;
    await expect(session.send(pending.messageHash)).rejects.toMatchObject({ code: 'network' });
    await expect(session.prepare(PHRASE, vectors[0].nonBounceable)).rejects.toMatchObject({ code: 'busy' });
    expect(await checkRotation(rpc, pending)).toBe('pending');
    state.data = beginCell().storeUint(0, 8).storeUint(1, 32).storeUint(TG_WALLET_ID, 32)
      .storeBuffer(Buffer.from(pending.newPublicKey, 'hex')).endCell().toBoc().toString('base64');
    expect(await checkRotation(rpc, pending)).toBe('confirmed');
    session.dispose();
  });

  it('rechecks the current key and fee before signing', async () => {
    const session = new RotationSession(rpc);
    const preview = await session.prepare(PHRASE, vectors[0].nonBounceable);
    fee = 50_000_000;
    await expect(session.sign(preview.quiz.map((p) => preview.words[p]), preview.fee)).rejects.toMatchObject({ code: 'feeChanged' });
    state.data = beginCell().storeUint(0, 8).storeUint(1, 32).storeUint(TG_WALLET_ID, 32)
      .storeBuffer(Buffer.from(vectors[1].publicKey, 'hex')).endCell().toBoc().toString('base64');
    await expect(session.sign(preview.quiz.map((p) => preview.words[p]), preview.fee)).rejects.toMatchObject({ code: 'staleKey' });
    expect(calls.some(({ method }) => method === 'sendBoc')).toBe(false);
    session.dispose();
  });

  it('rejects unfunded, wrong-contract, stale-node and unsupported-revision accounts', async () => {
    const session = new RotationSession(rpc);
    state.balance = '0';
    await expect(session.prepare(PHRASE, vectors[0].nonBounceable)).rejects.toMatchObject({ code: 'balance' });
    state = account(); state.code = beginCell().endCell().toBoc().toString('base64');
    await expect(session.prepare(PHRASE, vectors[0].nonBounceable)).rejects.toMatchObject({ code: 'wallet' });
    state = account(); state.sync_utime -= 1000;
    await expect(session.prepare(PHRASE, vectors[0].nonBounceable)).rejects.toMatchObject({ code: 'clock' });
    state = account(); state.data = beginCell().storeUint(1, 8).endCell().toBoc().toString('base64');
    await expect(session.prepare(PHRASE, vectors[0].nonBounceable)).rejects.toMatchObject({ code: 'configuration' });
    session.dispose();
  });

  it('includes original StateInit only when the prefunded account is uninitialized', async () => {
    state.state = 'uninitialized'; state.code = ''; state.data = '';
    const session = new RotationSession(rpc);
    const preview = await session.prepare(PHRASE, vectors[0].nonBounceable);
    expect(preview.deploy).toBe(true);
    const estimate = calls.find(({ method }) => method === 'estimateFee')!;
    expect(estimate.params.init_code).toBe(telegramWalletCode().toBoc().toString('base64'));
    session.dispose();
  });

  it('fails closed on an unknown shared implementation', async () => {
    const unknown: RotationRpc = { call: vi.fn(async (method, params) => method === 'getConfigParam'
      ? { config: { bytes: beginCell().endCell().toBoc().toString('base64') } } : rpc.call(method, params)) };
    await expect(new RotationSession(unknown).prepare(PHRASE, vectors[0].nonBounceable)).rejects.toMatchObject({ code: 'configuration' });
  });
});

describe('on-chain confirmation', () => {
  const pending = { oldPublicKey: 'a', newPublicKey: 'b', seqno: 5, validUntil: 1000 } as PendingRotation;
  const snapshot = { deploy: false, publicKey: 'a', seqno: 5, balance: 1n, time: 1000 } satisfies WalletSnapshot;
  it('does not interpret HTTP success, local expiry or a seqno bump as a new key', () => {
    expect(rotationStatus(snapshot, pending)).toBe('pending');
    expect(rotationStatus({ ...snapshot, publicKey: 'b', seqno: 6 }, pending)).toBe('confirmed');
    expect(rotationStatus({ ...snapshot, seqno: 6 }, pending)).toBe('superseded');
    expect(rotationStatus({ ...snapshot, time: 1031 }, pending)).toBe('expired');
    expect(rotationStatus({ ...snapshot, publicKey: 'c', seqno: 6 }, pending)).toBe('conflict');
    expect(() => rotationStatus({ ...snapshot, seqno: 4 }, pending)).toThrow('network');
  });
});
