export type WalletVersion = 'v4r2' | 'w5';
export type AddressFormat = 'non-bounceable' | 'bounceable';

export interface SearchOptions {
  suffix: string;
  version: WalletVersion;
  addressFormat: AddressFormat;
  caseSensitive: boolean;
}

export interface SearchProgress {
  attempts: number;
  elapsedMs: number;
  attemptsPerSecond: number;
  sampleAddress: string;
}

export interface FoundCandidate {
  address: string;
  version: WalletVersion;
  addressFormat: AddressFormat;
  attempts: number;
  elapsedMs: number;
}

export interface FoundWallet extends FoundCandidate {
  mnemonic: string[];
}

export type WorkerRequest =
  | { type: 'start'; options: SearchOptions; workerId: number }
  | { type: 'stop' }
  | { type: 'reveal' };

export type WorkerResponse =
  | { type: 'ready'; workerId: number }
  | { type: 'progress'; workerId: number; progress: SearchProgress }
  | { type: 'candidate'; workerId: number; candidate: FoundCandidate }
  | { type: 'revealed'; workerId: number; wallet: FoundWallet }
  | { type: 'error'; workerId: number; message: string };
