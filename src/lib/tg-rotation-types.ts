export type RotationErrorCode = 'phrase' | 'address' | 'mismatch' | 'staleKey' | 'wallet' | 'configuration'
  | 'network' | 'rateLimit' | 'clock' | 'balance' | 'estimate' | 'stateChanged' | 'feeChanged'
  | 'storage' | 'busy' | 'internal';

export class RotationError extends Error {
  constructor(public readonly code: RotationErrorCode) { super(code); }
}

export interface PendingRotation {
  version: 1;
  network: 'mainnet';
  address: string;
  anchorPublicKey: string;
  oldPublicKey: string;
  newPublicKey: string;
  seqno: number;
  validUntil: number;
  messageHash: string;
}

export interface RotationPreview {
  address: string;
  words: string[];
  fee: string; // nanotons, estimate only
  balance: string;
  deploy: boolean;
  quiz: number[]; // zero-based positions in the NEW signing half
}

export type RotationStatus = 'pending' | 'confirmed' | 'expired' | 'superseded' | 'conflict';
export type RotationCommand =
  | { action: 'prepare'; phrase: string; address: string }
  | { action: 'sign'; answers: string[]; fee: string }
  | { action: 'send'; messageHash: string }
  | { action: 'status'; pending: PendingRotation };

export type RotationResult = RotationPreview | PendingRotation | RotationStatus | null;
export type RotationRequest = RotationCommand & { id: number };
export type RotationResponse = { id: number } & (
  { ok: true; result: RotationResult } | { ok: false; code: RotationErrorCode }
);
