import { RotationError } from './tg-rotation-types';
import type { PendingRotation } from './tg-rotation-types';

export const ROTATION_JOURNAL_KEY = 'tonsuite:tg-rotation:pending:v1';
const fields = ['version', 'network', 'address', 'anchorPublicKey', 'oldPublicKey', 'newPublicKey', 'seqno', 'validUntil', 'messageHash'];

// Public recovery metadata ONLY. Never persist words, seeds or a signed BOC.
export function parsePendingRotation(text: string): PendingRotation {
  try {
    if (text.length > 2000) throw new Error();
    const p = JSON.parse(text) as PendingRotation;
    if (!p || typeof p !== 'object' || Object.keys(p).length !== fields.length
      || Object.keys(p).some((key) => !fields.includes(key))
      || p.version !== 1 || p.network !== 'mainnet'
      || typeof p.address !== 'string' || !/^UQ[A-Za-z0-9_-]{46}$/.test(p.address)
      || ![p.anchorPublicKey, p.oldPublicKey, p.newPublicKey, p.messageHash]
        .every((key) => typeof key === 'string' && /^[0-9a-f]{64}$/.test(key))
      || p.oldPublicKey === p.newPublicKey
      || ![p.seqno, p.validUntil].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff)) throw new Error();
    return p;
  } catch { throw new RotationError('storage'); }
}

export function loadPendingRotation(storage: Pick<Storage, 'getItem'> = localStorage): PendingRotation | null {
  try {
    const text = storage.getItem(ROTATION_JOURNAL_KEY);
    return text ? parsePendingRotation(text) : null;
  } catch { throw new RotationError('storage'); }
}

export function savePendingRotation(pending: PendingRotation, storage: Storage = localStorage) {
  const previous = loadPendingRotation(storage);
  if (previous && previous.messageHash !== pending.messageHash) throw new RotationError('busy');
  const text = JSON.stringify(parsePendingRotation(JSON.stringify(pending)));
  try {
    storage.setItem(ROTATION_JOURNAL_KEY, text);
    if (storage.getItem(ROTATION_JOURNAL_KEY) !== text) throw new Error();
  } catch { throw new RotationError('storage'); }
}

export function clearPendingRotation(pending: PendingRotation, storage: Storage = localStorage) {
  const previous = loadPendingRotation(storage);
  if (!previous) return; // Another tab may already have acknowledged the result.
  if (previous.messageHash !== pending.messageHash) throw new RotationError('busy');
  try { storage.removeItem(ROTATION_JOURNAL_KEY); } catch { throw new RotationError('storage'); }
}
