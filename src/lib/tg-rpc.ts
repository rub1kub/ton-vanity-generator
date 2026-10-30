import { Cell, contractAddress } from '@ton/ton';
import type { Address } from '@ton/ton';
import { Buffer } from 'buffer';
import { RotationError } from './tg-rotation-types';
import type { PendingRotation, RotationStatus } from './tg-rotation-types';
import { hex, parseMainnetAddress } from './tg-rotation';
import type { TelegramIdentity } from './tg-rotation';
import { telegramWalletCode, telegramWalletData, TG_CODE_HASH, TG_IMPLEMENTATION_HASH, TG_WALLET_ID } from './wallet-tg-code';

type RpcMethod = 'getAddressInformation' | 'getConfigParam' | 'estimateFee' | 'sendBoc';
export interface RotationRpc { call(method: RpcMethod, params: Record<string, unknown>): Promise<unknown> }

// The server adds the API key. Never put credentials in a VITE_* variable.
export class TonCenterRpc implements RotationRpc {
  private tail: Promise<unknown> = Promise.resolve();
  private nextCall = 0;
  call(method: RpcMethod, params: Record<string, unknown>): Promise<unknown> {
    const task = this.tail.then(async () => {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, this.nextCall - Date.now())));
      this.nextCall = Date.now() + 1100;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch(`/generator/rpc/${method}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params), signal: controller.signal,
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        });
        if (response.status === 429) throw new RotationError('rateLimit');
        if (!response.ok) throw new RotationError('network');
        const data = object(await response.json());
        if (data.ok !== true) throw new RotationError(method === 'estimateFee' ? 'estimate' : 'network');
        return data.result;
      } catch (error) {
        if (error instanceof RotationError) throw error;
        throw new RotationError('network'); // Never reflect remote errors or signed bodies into UI/logs.
      } finally { clearTimeout(timeout); }
    });
    this.tail = task.catch(() => {});
    return task;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RotationError('network');
  return value as Record<string, unknown>;
}

function number(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new RotationError('network');
  return value as number;
}

function coins(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    throw new RotationError('network');
  }
  return BigInt(value);
}

function cell(value: unknown): Cell {
  try {
    if (typeof value !== 'string' || value.length > 100_000) throw new Error();
    const cells = Cell.fromBoc(Buffer.from(value, 'base64'));
    if (cells.length !== 1 || cells[0].isExotic) throw new Error();
    return cells[0];
  } catch { throw new RotationError('wallet'); }
}

export interface WalletSnapshot {
  deploy: boolean;
  publicKey: string;
  seqno: number;
  balance: bigint;
  time: number;
}

export async function readTelegramWallet(rpc: RotationRpc, address: Address, anchorPublicKey: Uint8Array): Promise<WalletSnapshot> {
  const raw = object(await rpc.call('getAddressInformation', { address: address.toRawString() }));
  const time = number(raw.sync_utime);
  const age = Date.now() / 1000 - time;
  if (age > 90 || age < -30) throw new RotationError('clock');
  const block = object(raw.block_id);
  if (block.workchain !== -1) throw new RotationError('network');
  const config = object(await rpc.call('getConfigParam', { param: -123, seqno: number(block.seqno) }));
  if (cell(object(config.config).bytes).hash().toString('hex') !== TG_IMPLEMENTATION_HASH) {
    throw new RotationError('configuration');
  }
  const balance = coins(raw.balance);
  if (raw.state === 'uninitialized') {
    if (raw.code || raw.data || raw.frozen_hash) throw new RotationError('wallet');
    return { deploy: true, seqno: 0, publicKey: hex(anchorPublicKey), balance, time };
  }
  if (raw.state !== 'active' || cell(raw.code).hash().toString('hex') !== TG_CODE_HASH) throw new RotationError('wallet');
  try {
    const storage = cell(raw.data).beginParse();
    if (storage.loadUint(8) !== 0) throw new RotationError('configuration');
    const seqno = storage.loadUint(32);
    if (storage.loadUint(32) !== TG_WALLET_ID) throw new RotationError('wallet');
    const publicKey = storage.loadBuffer(32).toString('hex');
    storage.endParse();
    return { deploy: false, seqno, publicKey, balance, time };
  } catch (error) {
    if (error instanceof RotationError) throw error;
    throw new RotationError('wallet');
  }
}

export async function estimateRotationFee(rpc: RotationRpc, identity: TelegramIdentity, body: Cell, deploy: boolean): Promise<bigint> {
  const response = object(await rpc.call('estimateFee', {
    address: identity.address.toRawString(), body: body.toBoc().toString('base64'),
    init_code: deploy ? identity.init.code!.toBoc().toString('base64') : '',
    init_data: deploy ? identity.init.data!.toBoc().toString('base64') : '',
    ignore_chksig: true,
  }));
  const fees = object(response.source_fees);
  const total = ['in_fwd_fee', 'storage_fee', 'gas_fee', 'fwd_fee']
    .reduce((sum, key) => sum + coins(fees[key]), 0n);
  if (total <= 0n || total > 1_000_000_000n) throw new RotationError('estimate');
  return total;
}

export function rotationStatus(snapshot: WalletSnapshot, pending: PendingRotation): RotationStatus {
  if (!snapshot.deploy && snapshot.publicKey === pending.newPublicKey && snapshot.seqno > pending.seqno) return 'confirmed';
  if (snapshot.publicKey !== pending.oldPublicKey) return 'conflict';
  if (snapshot.seqno > pending.seqno) return 'superseded';
  if (snapshot.seqno !== pending.seqno) throw new RotationError('network');
  // The chain's time, not the browser's clock, must pass the validity window.
  return snapshot.time > pending.validUntil + 30 ? 'expired' : 'pending';
}

export async function checkRotation(rpc: RotationRpc, pending: PendingRotation): Promise<RotationStatus> {
  const address = parseMainnetAddress(pending.address);
  const anchor = Buffer.from(pending.anchorPublicKey, 'hex');
  if (anchor.length !== 32 || !contractAddress(0, { code: telegramWalletCode(), data: telegramWalletData(anchor) }).equals(address)) {
    throw new RotationError('mismatch');
  }
  return rotationStatus(await readTelegramWallet(rpc, address, anchor), pending);
}
