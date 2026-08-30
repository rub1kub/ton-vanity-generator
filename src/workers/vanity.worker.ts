/// <reference lib="webworker" />

import { Buffer } from 'buffer';
import {
  matchesVanitySuffix,
  validateSearchOptions,
} from '../lib/search';

import type {
  FoundCandidate,
  FoundWallet,
  SearchOptions,
  SearchProgress,
  WorkerRequest,
  WorkerResponse,
} from '../types';

const PROGRESS_INTERVAL_MS = 500;
const GENERATION_ERROR_MESSAGE =
  'Не удалось сгенерировать кошелёк. Перезапустите поиск.';
const INVALID_OPTIONS_ERROR_MESSAGE = 'Параметры поиска некорректны.';

const workerScope = self as DedicatedWorkerGlobalScope;

// Vite targets browsers and therefore does not inject Node's Buffer global.
// TON's audited packages use it internally, so initialize the polyfill before
// loading the cryptographic module in this worker.
(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
// @ton/crypto-primitives' browser entry addresses Web Crypto as
// `window.crypto`, although dedicated workers expose it on `self`. Provide the
// equivalent alias inside this isolated worker only.
Object.defineProperty(globalThis, 'window', {
  value: globalThis,
  configurable: true,
});
const tonRuntime = import('../lib/ton');

let activeRunId = 0;
let pendingWallet: FoundWallet | null = null;
let pendingWorkerId = -1;

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

async function runSearch(
  runId: number,
  workerId: number,
  options: SearchOptions,
  suffix: string,
): Promise<void> {
  const { generateWalletCandidate } = await tonRuntime;
  const startedAt = performance.now();
  let lastProgressAt = startedAt;
  let attempts = 0;

  while (runId === activeRunId) {
    const candidate = await generateWalletCandidate(
      options.version,
      options.addressFormat,
    );

    if (runId !== activeRunId) {
      clearMnemonic(candidate.mnemonic);
      return;
    }

    attempts += 1;
    const now = performance.now();
    const elapsedMs = now - startedAt;

    if (
      matchesVanitySuffix(
        candidate.address,
        suffix,
        options.caseSensitive,
      )
    ) {
      const wallet: FoundWallet = {
        address: candidate.address,
        mnemonic: candidate.mnemonic,
        version: options.version,
        addressFormat: options.addressFormat,
        attempts,
        elapsedMs,
      };

      pendingWallet = wallet;
      pendingWorkerId = workerId;
      const publicCandidate: FoundCandidate = {
        address: wallet.address,
        version: wallet.version,
        addressFormat: wallet.addressFormat,
        attempts: wallet.attempts,
        elapsedMs: wallet.elapsedMs,
      };

      // Keep the mnemonic inside this worker until the user explicitly asks
      // to reveal it. The UI receives only the public address at this stage.
      postResponse({ type: 'candidate', workerId, candidate: publicCandidate });
      activeRunId += 1;
      return;
    }

    clearMnemonic(candidate.mnemonic);

    if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      const progress: SearchProgress = {
        attempts,
        elapsedMs,
        attemptsPerSecond:
          elapsedMs > 0 ? (attempts * 1_000) / elapsedMs : 0,
        sampleAddress: candidate.address,
      };

      postResponse({ type: 'progress', workerId, progress });
      lastProgressAt = now;
    }
  }
}

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === 'stop') {
    activeRunId += 1;
    clearPendingWallet();
    return;
  }

  if (request.type === 'reveal') {
    if (!pendingWallet) {
      postResponse({
        type: 'error',
        workerId: pendingWorkerId,
        message: 'Найденный кошелёк уже недоступен. Запустите поиск заново.',
      });
      return;
    }

    const wallet = pendingWallet;
    const workerId = pendingWorkerId;
    pendingWallet = null;
    pendingWorkerId = -1;
    // postMessage clones synchronously; clear the worker-owned copy right
    // after it has been handed to the consented reveal screen.
    postResponse({ type: 'revealed', workerId, wallet });
    clearMnemonic(wallet.mnemonic);
    return;
  }

  // A new start request always replaces any in-flight search in this worker.
  clearPendingWallet();
  const runId = activeRunId + 1;
  activeRunId = runId;

  const validation = validateSearchOptions(request.options);
  if (!validation.valid) {
    postResponse({
      type: 'error',
      workerId: request.workerId,
      message: INVALID_OPTIONS_ERROR_MESSAGE,
    });
    return;
  }

  postResponse({ type: 'ready', workerId: request.workerId });

  void runSearch(
    runId,
    request.workerId,
    request.options,
    validation.suffix,
  ).catch((error: unknown) => {
    if (runId !== activeRunId) {
      return;
    }

    activeRunId += 1;
    postResponse({
      type: 'error',
      workerId: request.workerId,
      message:
        import.meta.env.DEV && error instanceof Error
          ? `${GENERATION_ERROR_MESSAGE} (${error.message})`
          : GENERATION_ERROR_MESSAGE,
    });
  });
});

export {};
