/// <reference lib="webworker" />

import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { Buffer } from 'buffer';
import { matchesVanitySuffix, validateSearchOptions } from '../lib/search';
import type {
  FoundCandidate, FoundWallet, SearchOptions, SearchProgress,
  WorkerRequest, WorkerResponse,
} from '../types';

const PROGRESS_INTERVAL_MS = 500;
const GPU_BATCH_SIZE = 64;
const BIP39_STRENGTH_BITS = 128;

const workerScope = self as DedicatedWorkerGlobalScope;

// Vite targets browsers and therefore does not inject Node's Buffer global.
// TON's audited packages use it internally, so initialize the polyfill before
// loading the cryptographic module in this worker.
(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
// @ton/crypto-primitives' browser entry addresses Web Crypto as `window.crypto`.
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });

const tonRuntime = import('../lib/ton');

let activeRunId = 0;
let pendingWallet: FoundWallet | null = null;
let pendingWorkerId = -1;
let activeLocale: SearchOptions['locale'] = 'ru';
let activeAccelerator: { destroy(): void } | null = null;

interface RunState {
  startedAt: number;
  lastProgressAt: number;
  attempts: number;
  sampleAddress: string;
}

const copy = {
  ru: {
    generation: 'Не удалось сгенерировать кошелёк. Перезапустите поиск.',
    invalid: 'Параметры поиска некорректны.',
    missing: 'Найденный кошелёк уже недоступен. Запустите поиск заново.',
  },
  en: {
    generation: 'The wallet could not be generated. Restart the search.',
    invalid: 'The search settings are invalid.',
    missing: 'The found wallet is no longer available. Start a new search.',
  },
} as const;

function postResponse(response: WorkerResponse): void {
  workerScope.postMessage(response);
}

function clearMnemonic(mnemonic: string[]): void {
  mnemonic.fill('');
}

function clearPendingWallet(): void {
  if (pendingWallet) clearMnemonic(pendingWallet.mnemonic);
  pendingWallet = null;
  pendingWorkerId = -1;
}

function destroyAccelerator(): void {
  activeAccelerator?.destroy();
  activeAccelerator = null;
}

function reportProgress(workerId: number, state: RunState, force = false): void {
  const now = performance.now();
  if (!force && now - state.lastProgressAt < PROGRESS_INTERVAL_MS) return;
  const elapsedMs = now - state.startedAt;
  const progress: SearchProgress = {
    attempts: state.attempts,
    elapsedMs,
    attemptsPerSecond: elapsedMs > 0 ? (state.attempts * 1_000) / elapsedMs : 0,
    sampleAddress: state.sampleAddress,
  };
  postResponse({ type: 'progress', workerId, progress });
  state.lastProgressAt = now;
}

function publishCandidate(
  runId: number,
  workerId: number,
  options: SearchOptions,
  wallet: { address: string; mnemonic: string[] },
  state: RunState,
): void {
  const elapsedMs = performance.now() - state.startedAt;
  pendingWallet = {
    address: wallet.address,
    mnemonic: wallet.mnemonic,
    version: options.version,
    addressFormat: options.addressFormat,
    attempts: state.attempts,
    elapsedMs,
  };
  pendingWorkerId = workerId;
  const publicCandidate: FoundCandidate = {
    address: pendingWallet.address,
    version: pendingWallet.version,
    addressFormat: pendingWallet.addressFormat,
    attempts: pendingWallet.attempts,
    elapsedMs: pendingWallet.elapsedMs,
  };
  postResponse({ type: 'candidate', workerId, candidate: publicCandidate });
  if (activeRunId === runId) activeRunId += 1;
}

async function runCpuSearch(
  runId: number,
  workerId: number,
  options: SearchOptions,
  suffix: string,
  state: RunState,
): Promise<void> {
  const { generateWalletCandidate } = await tonRuntime;
  postResponse({ type: 'engine', workerId, engine: 'cpu' });

  while (runId === activeRunId) {
    const candidate = await generateWalletCandidate(options.version, options.addressFormat);
    if (runId !== activeRunId) {
      clearMnemonic(candidate.mnemonic);
      return;
    }

    state.attempts += 1;
    state.sampleAddress = candidate.address;
    if (matchesVanitySuffix(candidate.address, suffix, options.caseSensitive)) {
      publishCandidate(runId, workerId, options, candidate, state);
      return;
    }

    clearMnemonic(candidate.mnemonic);
    reportProgress(workerId, state);
  }
}

async function runGpuSearch(
  runId: number,
  workerId: number,
  options: SearchOptions,
  suffix: string,
  state: RunState,
): Promise<void> {
  const [{ WebGpuPbkdf2Accelerator }, ton] = await Promise.all([
    import('../lib/webgpu-pbkdf2'),
    tonRuntime,
  ]);
  const accelerator = await WebGpuPbkdf2Accelerator.create({
    maxBatchSize: GPU_BATCH_SIZE,
    powerPreference: 'high-performance',
    selfTest: true,
  });
  activeAccelerator = accelerator;

  if (runId !== activeRunId) {
    destroyAccelerator();
    return;
  }
  postResponse({ type: 'engine', workerId, engine: 'gpu' });

  while (runId === activeRunId) {
    const mnemonicTexts = Array.from(
      { length: GPU_BATCH_SIZE },
      () => generateMnemonic(wordlist, BIP39_STRENGTH_BITS),
    );
    let seeds: Uint8Array[] = [];

    try {
      seeds = await accelerator.deriveSeeds(mnemonicTexts);
      if (runId !== activeRunId) return;

      for (let index = 0; index < mnemonicTexts.length; index += 1) {
        if (runId !== activeRunId) return;
        const mnemonic = mnemonicTexts[index].split(' ');
        const seed = seeds[index];
        const candidate = await ton.walletCandidateFromRootSeed(
          seed,
          mnemonic,
          options.version,
          options.addressFormat,
        );
        seed.fill(0);
        state.attempts += 1;
        state.sampleAddress = candidate.address;

        if (matchesVanitySuffix(candidate.address, suffix, options.caseSensitive)) {
          // A winning GPU result is independently re-derived through Web Crypto
          // before the public address or recovery phrase is accepted.
          const verified = await ton.walletCandidateFromMnemonic(
            mnemonic,
            options.version,
            options.addressFormat,
          );
          if (verified.address !== candidate.address) {
            clearMnemonic(verified.mnemonic);
            clearMnemonic(candidate.mnemonic);
            clearMnemonic(mnemonic);
            throw new Error('GPU winner failed independent CPU verification.');
          }

          clearMnemonic(candidate.mnemonic);
          clearMnemonic(mnemonic);
          publishCandidate(runId, workerId, options, verified, state);
          destroyAccelerator();
          return;
        }

        clearMnemonic(candidate.mnemonic);
        clearMnemonic(mnemonic);
        mnemonicTexts[index] = '';
        reportProgress(workerId, state);
      }
    } finally {
      for (const seed of seeds) seed.fill(0);
      mnemonicTexts.fill('');
    }
  }
}

async function runSearch(
  runId: number,
  workerId: number,
  options: SearchOptions,
  suffix: string,
): Promise<void> {
  const now = performance.now();
  const state: RunState = {
    startedAt: now,
    lastProgressAt: now,
    attempts: 0,
    sampleAddress: '',
  };

  if (options.engine === 'gpu') {
    try {
      await runGpuSearch(runId, workerId, options, suffix, state);
      return;
    } catch (error) {
      destroyAccelerator();
      if (runId !== activeRunId) return;
      postResponse({
        type: 'engine',
        workerId,
        engine: 'cpu',
        fallbackReason: error instanceof Error ? error.message : 'WebGPU failure',
      });
    }
  }

  await runCpuSearch(runId, workerId, options, suffix, state);
}

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === 'stop') {
    activeRunId += 1;
    destroyAccelerator();
    clearPendingWallet();
    return;
  }

  if (request.type === 'reveal') {
    if (!pendingWallet) {
      postResponse({ type: 'error', workerId: pendingWorkerId, message: copy[activeLocale].missing });
      return;
    }

    const wallet = pendingWallet;
    const workerId = pendingWorkerId;
    pendingWallet = null;
    pendingWorkerId = -1;
    postResponse({ type: 'revealed', workerId, wallet });
    clearMnemonic(wallet.mnemonic);
    return;
  }

  clearPendingWallet();
  destroyAccelerator();
  activeLocale = request.options.locale;
  const runId = activeRunId + 1;
  activeRunId = runId;

  const validation = validateSearchOptions(request.options);
  if (!validation.valid) {
    postResponse({ type: 'error', workerId: request.workerId, message: copy[activeLocale].invalid });
    return;
  }

  postResponse({ type: 'ready', workerId: request.workerId });
  void runSearch(runId, request.workerId, request.options, validation.suffix).catch((error: unknown) => {
    destroyAccelerator();
    if (runId !== activeRunId) return;
    activeRunId += 1;
    postResponse({
      type: 'error',
      workerId: request.workerId,
      message: import.meta.env.DEV && error instanceof Error
        ? `${copy[activeLocale].generation} (${error.message})`
        : copy[activeLocale].generation,
    });
  });
});

export {};
