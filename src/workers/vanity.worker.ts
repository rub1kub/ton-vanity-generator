/// <reference lib="webworker" />

import { Buffer } from 'buffer';
import { mnemonicToSeedWebcrypto } from '@scure/bip39';
import {
  generateEnglishMnemonic12,
  generateEnglishMnemonic12Batch,
} from '../lib/fast-mnemonic';
import {
  deriveTonMnemonicBasicSeed,
  deriveTonMnemonicDefaultSeed,
  generateTonMnemonic24,
  generateTonMnemonic24Batch,
  tonMnemonicEntropy,
} from '../lib/ton-mnemonic';
import { matchesVanitySuffix, validateSearchOptions } from '../lib/search';
import type {
  FoundCandidate, FoundWallet, SearchOptions, SearchProgress,
  WorkerRequest, WorkerResponse,
} from '../types';

const PROGRESS_INTERVAL_MS = 500;
// Browser profiling on the target RTX 5060 showed 512 to be the fastest safe
// end-to-end dispatch size: large enough to saturate the GPU without pushing
// one batch into an excessive watchdog/interaction stall.
const GPU_BATCH_SIZE = 512;
const TON_MNEMONIC_GPU_BATCH_SIZE = 16_384;

const workerScope = self as DedicatedWorkerGlobalScope;

// Vite targets browsers and therefore does not inject Node's Buffer global.
// TON's audited packages use it internally, so initialize the polyfill before
// loading the cryptographic module in this worker.
(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
// @ton/crypto-primitives' browser entry addresses Web Crypto as `window.crypto`.
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });

const tonRuntime = import('../lib/ton');
const cpuEd25519Runtime = import('../lib/cpu-ed25519')
  .then(({ createCpuEd25519Accelerator }) => createCpuEd25519Accelerator());

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

interface PendingCpuCandidate {
  mnemonic: string[];
  rootSeed: Promise<Uint8Array>;
}

function createPendingCpuCandidate(): PendingCpuCandidate {
  const mnemonicText = generateEnglishMnemonic12();
  return {
    mnemonic: mnemonicText.split(' '),
    rootSeed: mnemonicToSeedWebcrypto(mnemonicText),
  };
}

function discardPendingCpuCandidate(candidate: PendingCpuCandidate): void {
  clearMnemonic(candidate.mnemonic);
  void candidate.rootSeed.then(
    (rootSeed) => { rootSeed.fill(0); },
    () => undefined,
  );
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
    mnemonicScheme: options.mnemonicScheme,
    attempts: state.attempts,
    elapsedMs,
  };
  pendingWorkerId = workerId;
  const publicCandidate: FoundCandidate = {
    address: pendingWallet.address,
    version: pendingWallet.version,
    addressFormat: pendingWallet.addressFormat,
    mnemonicScheme: pendingWallet.mnemonicScheme,
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
  const [ton, cpuEd25519] = await Promise.all([tonRuntime, cpuEd25519Runtime]);
  postResponse({ type: 'engine', workerId, engine: 'cpu' });

  let pending: PendingCpuCandidate | null = createPendingCpuCandidate();
  try {
    while (runId === activeRunId) {
      const current = pending;
      pending = null;
      let rootSeed: Uint8Array | undefined;
      let tonSeed: Uint8Array | undefined;
      let publicKey: Uint8Array | undefined;
      let address = '';

      try {
        rootSeed = await current.rootSeed;
        if (runId !== activeRunId) {
          clearMnemonic(current.mnemonic);
          return;
        }

        // Start the expensive native PBKDF2 for the next phrase before the
        // synchronous SLIP-0010, Ed25519, and TON StateInit tail. Chromium can
        // now overlap those two independent stages instead of leaving its
        // crypto thread idle during every address build.
        pending = createPendingCpuCandidate();
        tonSeed = ton.deriveTonPathSeed(rootSeed);
        publicKey = cpuEd25519.publicKeyFromSeed(tonSeed);
        const publicKeyBuffer = Buffer.from(
          publicKey.buffer as ArrayBuffer,
          publicKey.byteOffset,
          publicKey.byteLength,
        );
        address = ton.walletAddressFromPublicKey(
          publicKeyBuffer,
          options.version,
          options.addressFormat,
        );
      } catch (error) {
        clearMnemonic(current.mnemonic);
        throw error;
      } finally {
        rootSeed?.fill(0);
        tonSeed?.fill(0);
        publicKey?.fill(0);
      }

      if (runId !== activeRunId) {
        clearMnemonic(current.mnemonic);
        return;
      }

      state.attempts += 1;
      state.sampleAddress = address;
      if (matchesVanitySuffix(address, suffix, options.caseSensitive)) {
        // libsodium is self-tested at startup, and a rare winning phrase is
        // additionally re-derived through the canonical noble/TON path before
        // anything is exposed to the user.
        let verified: Awaited<ReturnType<typeof ton.walletCandidateFromMnemonic>>;
        try {
          verified = await ton.walletCandidateFromMnemonic(
            current.mnemonic,
            options.version,
            options.addressFormat,
            options.mnemonicScheme,
          );
        } catch (error) {
          clearMnemonic(current.mnemonic);
          throw error;
        }
        if (runId !== activeRunId) {
          clearMnemonic(current.mnemonic);
          clearMnemonic(verified.mnemonic);
          return;
        }
        if (verified.address !== address) {
          clearMnemonic(current.mnemonic);
          clearMnemonic(verified.mnemonic);
          throw new Error('CPU winner failed independent canonical verification.');
        }

        clearMnemonic(current.mnemonic);
        publishCandidate(runId, workerId, options, verified, state);
        return;
      }

      clearMnemonic(current.mnemonic);
      reportProgress(workerId, state);
    }
  } finally {
    if (pending) discardPendingCpuCandidate(pending);
  }
}

async function runTonMnemonicCpuSearch(
  runId: number,
  workerId: number,
  options: SearchOptions,
  suffix: string,
  state: RunState,
): Promise<void> {
  const [ton, cpuEd25519] = await Promise.all([tonRuntime, cpuEd25519Runtime]);
  postResponse({ type: 'engine', workerId, engine: 'cpu' });

  while (runId === activeRunId) {
    const mnemonicText = generateTonMnemonic24();
    const mnemonic = mnemonicText.split(' ');
    let entropy: Uint8Array | undefined;
    let basicSeed: Uint8Array | undefined;
    let tonSeed: Uint8Array | undefined;
    let publicKey: Uint8Array | undefined;
    let address = '';

    try {
      entropy = tonMnemonicEntropy(mnemonic);
      basicSeed = await deriveTonMnemonicBasicSeed(entropy);
      if (runId !== activeRunId) {
        clearMnemonic(mnemonic);
        return;
      }
      if (basicSeed[0] !== 0) {
        clearMnemonic(mnemonic);
        continue;
      }

      tonSeed = await deriveTonMnemonicDefaultSeed(entropy);
      if (runId !== activeRunId) {
        clearMnemonic(mnemonic);
        return;
      }
      publicKey = cpuEd25519.publicKeyFromSeed(tonSeed);
      const publicKeyBuffer = Buffer.from(
        publicKey.buffer as ArrayBuffer,
        publicKey.byteOffset,
        publicKey.byteLength,
      );
      address = ton.walletAddressFromPublicKey(
        publicKeyBuffer,
        options.version,
        options.addressFormat,
      );
    } catch (error) {
      clearMnemonic(mnemonic);
      throw error;
    } finally {
      entropy?.fill(0);
      basicSeed?.fill(0);
      tonSeed?.fill(0);
      publicKey?.fill(0);
    }

    if (runId !== activeRunId) {
      clearMnemonic(mnemonic);
      return;
    }

    state.attempts += 1;
    state.sampleAddress = address;
    if (matchesVanitySuffix(address, suffix, options.caseSensitive)) {
      const verified = await ton.walletCandidateFromMnemonic(
        mnemonic,
        options.version,
        options.addressFormat,
        options.mnemonicScheme,
      );
      if (runId !== activeRunId) {
        clearMnemonic(mnemonic);
        clearMnemonic(verified.mnemonic);
        return;
      }
      if (verified.address !== address) {
        clearMnemonic(mnemonic);
        clearMnemonic(verified.mnemonic);
        throw new Error('TON mnemonic CPU winner failed canonical verification.');
      }
      clearMnemonic(mnemonic);
      publishCandidate(runId, workerId, options, verified, state);
      return;
    }

    clearMnemonic(mnemonic);
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
  const [{ WebGpuPbkdf2Accelerator }, ton, cpuEd25519] = await Promise.all([
    import('../lib/webgpu-pbkdf2'),
    tonRuntime,
    cpuEd25519Runtime,
  ]);
  const accelerator = await WebGpuPbkdf2Accelerator.create({
    maxBatchSize: options.mnemonicScheme === 'ton-24'
      ? TON_MNEMONIC_GPU_BATCH_SIZE
      : GPU_BATCH_SIZE,
    powerPreference: 'high-performance',
    selfTest: true,
  });
  activeAccelerator = accelerator;

  if (options.mnemonicScheme === 'ton-24' && workerId === 0) {
    await accelerator.runTonMnemonicSelfTest();
  }

  if (runId !== activeRunId) {
    destroyAccelerator();
    return;
  }
  postResponse({ type: 'engine', workerId, engine: 'gpu' });

  if (options.mnemonicScheme === 'ton-24') {
    while (runId === activeRunId) {
      const mnemonicTexts = generateTonMnemonic24Batch(TON_MNEMONIC_GPU_BATCH_SIZE);
      let seeds: Array<Uint8Array | null> = [];

      try {
        seeds = await accelerator.deriveTonMnemonicSeeds(mnemonicTexts);
        if (runId !== activeRunId) return;

        if (seeds.length !== mnemonicTexts.length) {
          throw new Error('WebGPU returned an incomplete TON mnemonic seed batch.');
        }
        const derivedBatch: Array<
          | { ok: true; mnemonic: string[]; address: string }
          | { ok: false; mnemonic: string[]; error: unknown }
        > = [];
        mnemonicTexts.forEach((mnemonicText, index) => {
          const seed = seeds[index];
          if (!seed) return;
          const mnemonic = mnemonicText.split(' ');
          try {
            const publicKey = cpuEd25519.publicKeyFromSeed(seed);
            let address: string;
            try {
              const publicKeyBuffer = Buffer.from(
                publicKey.buffer as ArrayBuffer,
                publicKey.byteOffset,
                publicKey.byteLength,
              );
              address = ton.walletAddressFromPublicKey(
                publicKeyBuffer,
                options.version,
                options.addressFormat,
              );
            } finally {
              publicKey.fill(0);
            }
            derivedBatch.push({ ok: true, mnemonic, address });
          } catch (error) {
            derivedBatch.push({ ok: false, mnemonic, error });
          } finally {
            seed.fill(0);
          }
        });

        try {
          const failure = derivedBatch.find((item) => !item.ok);
          if (failure && !failure.ok) throw failure.error;
          if (runId !== activeRunId) return;

          let winner: Extract<(typeof derivedBatch)[number], { ok: true }> | undefined;
          for (const item of derivedBatch) {
            if (!item.ok) continue;
            state.attempts += 1;
            state.sampleAddress = item.address;
            if (!winner && matchesVanitySuffix(
              item.address,
              suffix,
              options.caseSensitive,
            )) winner = item;
          }

          if (winner) {
            const verified = await ton.walletCandidateFromMnemonic(
              winner.mnemonic,
              options.version,
              options.addressFormat,
              options.mnemonicScheme,
            );
            if (runId !== activeRunId) {
              clearMnemonic(verified.mnemonic);
              return;
            }
            if (verified.address !== winner.address) {
              clearMnemonic(verified.mnemonic);
              throw new Error('TON mnemonic GPU winner failed independent CPU verification.');
            }
            publishCandidate(runId, workerId, options, verified, state);
            destroyAccelerator();
            return;
          }

          reportProgress(workerId, state);
        } finally {
          for (const item of derivedBatch) clearMnemonic(item.mnemonic);
        }
      } finally {
        for (const seed of seeds) seed?.fill(0);
        mnemonicTexts.fill('');
      }
    }
    return;
  }

  while (runId === activeRunId) {
    const mnemonicTexts = generateEnglishMnemonic12Batch(GPU_BATCH_SIZE);
    let seeds: Uint8Array[] = [];

    try {
      seeds = await accelerator.deriveTonSeeds(mnemonicTexts);
      if (runId !== activeRunId) return;

      // Finish the whole GPU batch into canonical TON addresses before
      // scanning it. Parallel workers provide lane-level concurrency, while
      // keeping each batch together amortizes GPU buffer and mapping overhead.
      const derivedBatch = mnemonicTexts.map((mnemonicText, index) => {
        const mnemonic = mnemonicText.split(' ');
        const seed = seeds[index];
        try {
          if (!seed) throw new Error('WebGPU returned an incomplete seed batch.');
          const publicKey = cpuEd25519.publicKeyFromSeed(seed);
          let address: string;
          try {
            const publicKeyBuffer = Buffer.from(
              publicKey.buffer as ArrayBuffer,
              publicKey.byteOffset,
              publicKey.byteLength,
            );
            address = ton.walletAddressFromPublicKey(
              publicKeyBuffer,
              options.version,
              options.addressFormat,
            );
          } finally {
            publicKey.fill(0);
          }
          return { ok: true as const, mnemonic, address };
        } catch (error) {
          return { ok: false as const, mnemonic, error };
        } finally {
          seed?.fill(0);
        }
      });

      const clearDerivedBatch = () => {
        for (const item of derivedBatch) {
          clearMnemonic(item.mnemonic);
        }
      };
      try {
        const failure = derivedBatch.find((item) => !item.ok);
        if (failure && !failure.ok) throw failure.error;

        if (runId !== activeRunId) return;

        let winner: Extract<(typeof derivedBatch)[number], { ok: true }> | undefined;
        for (const item of derivedBatch) {
          if (!item.ok) continue;
          state.attempts += 1;
          state.sampleAddress = item.address;
          if (!winner && matchesVanitySuffix(
            item.address,
            suffix,
            options.caseSensitive,
          )) winner = item;
        }

        if (winner) {
          // A winning GPU result is independently re-derived from its mnemonic
          // on the CPU before the address or recovery phrase is accepted.
          const verified = await ton.walletCandidateFromMnemonic(
            winner.mnemonic,
            options.version,
            options.addressFormat,
            options.mnemonicScheme,
          );
          if (runId !== activeRunId) {
            clearMnemonic(verified.mnemonic);
            return;
          }
          if (verified.address !== winner.address) {
            clearMnemonic(verified.mnemonic);
            throw new Error('GPU winner failed independent CPU verification.');
          }

          publishCandidate(runId, workerId, options, verified, state);
          destroyAccelerator();
          return;
        }

        reportProgress(workerId, state);
      } finally {
        // This also covers rejected CPU winner verification, stale runs, and
        // mismatches, so all 512 split mnemonic arrays are cleared promptly.
        clearDerivedBatch();
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
      if (runId !== activeRunId) return;
      destroyAccelerator();
      postResponse({
        type: 'engine',
        workerId,
        engine: 'cpu',
        fallbackReason: error instanceof Error ? error.message : 'WebGPU failure',
      });
    }
  }

  if (options.mnemonicScheme === 'ton-24') {
    await runTonMnemonicCpuSearch(runId, workerId, options, suffix, state);
  } else {
    await runCpuSearch(runId, workerId, options, suffix, state);
  }
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
    if (runId !== activeRunId) return;
    destroyAccelerator();
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
