import { describe, expect, it } from 'vitest';
import { clearPendingRotation, loadPendingRotation, parsePendingRotation, savePendingRotation } from './tg-rotation-journal';
import type { PendingRotation } from './tg-rotation-types';
import vectors from './fixtures/wallet-tg.json';

const pending: PendingRotation = { version: 1, network: 'mainnet', address: vectors[0].nonBounceable,
  anchorPublicKey: vectors[0].publicKey, oldPublicKey: vectors[0].publicKey, newPublicKey: vectors[1].publicKey,
  seqno: 0, validUntil: 2_000_000_000, messageHash: 'a'.repeat(64) };
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); }, clear: () => map.clear(), key: (index) => [...map.keys()][index], get length() { return map.size; } };
}
describe('public pending journal', () => {
  it('survives reload with only allowlisted public fields and can only clear the matching operation', () => {
    const storage = memoryStorage();
    savePendingRotation(pending, storage);
    expect(loadPendingRotation(storage)).toEqual(pending);
    expect(() => clearPendingRotation({ ...pending, messageHash: 'b'.repeat(64) }, storage)).toThrow('busy');
    clearPendingRotation(pending, storage);
    expect(loadPendingRotation(storage)).toBeNull();
  });
  it('rejects secrets, corrupt state, invalid networks, and replacing an unresolved operation', () => {
    expect(() => parsePendingRotation(JSON.stringify({ ...pending, mnemonic: ['secret'] }))).toThrow('storage');
    expect(() => parsePendingRotation('{')).toThrow('storage');
    expect(() => parsePendingRotation(JSON.stringify({ ...pending, network: 'testnet' }))).toThrow('storage');
    const storage = memoryStorage();
    savePendingRotation(pending, storage);
    expect(() => savePendingRotation({ ...pending, messageHash: 'b'.repeat(64) }, storage)).toThrow('busy');
  });
  it('stops before broadcast when storage cannot be written or silently drops writes', () => {
    const storage = memoryStorage();
    storage.setItem = () => {};
    expect(() => savePendingRotation(pending, storage)).toThrow('storage');
    storage.setItem = () => { throw new Error('Quota'); };
    expect(() => savePendingRotation(pending, storage)).toThrow('storage');
  });
});
