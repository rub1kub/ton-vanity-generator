export type WalletVersion = 'v4r2' | 'w5' | 'tg';
export type AddressFormat = 'non-bounceable' | 'bounceable';
export type ComputeEngine = 'cpu' | 'gpu';
export type SearchLocale = 'ru' | 'en';
export type MnemonicScheme = 'multichain-12' | 'ton-24';

export interface SearchOptions {
  suffix: string;
  version: WalletVersion;
  addressFormat: AddressFormat;
  caseSensitive: boolean;
  engine: ComputeEngine;
  locale: SearchLocale;
  mnemonicScheme: MnemonicScheme;
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
  mnemonicScheme: MnemonicScheme;
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
  | {
      type: 'engine';
      workerId: number;
      engine: ComputeEngine;
      fallbackReason?: string;
    }
  | { type: 'progress'; workerId: number; progress: SearchProgress }
  | { type: 'candidate'; workerId: number; candidate: FoundCandidate }
  | { type: 'revealed'; workerId: number; wallet: FoundWallet }
  | { type: 'error'; workerId: number; message: string };
