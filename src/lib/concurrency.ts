import type { ComputeEngine } from '../types';

export const DEFAULT_HARDWARE_CONCURRENCY = 4;
export const BROWSER_WORKER_STABILITY_CAP = 16;

export type ConcurrencyMode = 'auto' | 'maximum';
export type ConcurrencySelection = ConcurrencyMode | number;

export interface HardwareConcurrencySource {
  readonly hardwareConcurrency?: number;
}

export interface ConcurrencyChoice {
  mode: ConcurrencyMode;
  label: string;
  description: string;
  workerCount: number;
}

export interface ConcurrencyPolicy {
  reportedCoreCount: number;
  stabilityCap: number;
  maximumWorkerCount: number;
  autoWorkerCount: number;
  isCapped: boolean;
  choices: readonly [ConcurrencyChoice, ConcurrencyChoice];
}

function normalizePositiveInteger(value: number | null | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value === null || value < 1) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

export function normalizeHardwareConcurrency(
  reportedCoreCount: number | null | undefined,
): number {
  return normalizePositiveInteger(
    reportedCoreCount,
    DEFAULT_HARDWARE_CONCURRENCY,
  );
}

export function formatWorkerCount(workerCount: number): string {
  const count = Math.max(1, Math.floor(workerCount));
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return `${count} потоков`;
  }
  if (lastDigit === 1) return `${count} поток`;
  if (lastDigit >= 2 && lastDigit <= 4) return `${count} потока`;
  return `${count} потоков`;
}

export function createConcurrencyPolicy(
  reportedCoreCount: number | null | undefined,
  stabilityCap = BROWSER_WORKER_STABILITY_CAP,
): ConcurrencyPolicy {
  const normalizedCoreCount = normalizeHardwareConcurrency(reportedCoreCount);
  const normalizedCap = normalizePositiveInteger(
    stabilityCap,
    BROWSER_WORKER_STABILITY_CAP,
  );
  const maximumWorkerCount = Math.min(normalizedCoreCount, normalizedCap);
  // Auto deliberately leaves one of the usable cores free for the browser UI.
  // A single-core device cannot reserve a core and still run the search.
  const autoWorkerCount = Math.max(1, maximumWorkerCount - 1);
  const isCapped = normalizedCoreCount > maximumWorkerCount;

  return {
    reportedCoreCount: normalizedCoreCount,
    stabilityCap: normalizedCap,
    maximumWorkerCount,
    autoWorkerCount,
    isCapped,
    choices: [
      {
        mode: 'auto',
        label: 'Авто',
        description: `Оставляет одно ядро свободным · ${formatWorkerCount(autoWorkerCount)}`,
        workerCount: autoWorkerCount,
      },
      {
        mode: 'maximum',
        label: 'Максимум',
        description: isCapped
          ? `Лимит для стабильности браузера · ${formatWorkerCount(maximumWorkerCount)}`
          : `Использует все доступные ядра · ${formatWorkerCount(maximumWorkerCount)}`,
        workerCount: maximumWorkerCount,
      },
    ],
  };
}

export function getBrowserConcurrencyPolicy(
  source: HardwareConcurrencySource | undefined =
    typeof navigator === 'undefined' ? undefined : navigator,
): ConcurrencyPolicy {
  return createConcurrencyPolicy(source?.hardwareConcurrency);
}

export function resolveWorkerCount(
  selection: ConcurrencySelection,
  policy: ConcurrencyPolicy,
): number {
  if (selection === 'auto') return policy.autoWorkerCount;
  if (selection === 'maximum') return policy.maximumWorkerCount;

  if (!Number.isFinite(selection)) return policy.autoWorkerCount;
  return Math.min(
    policy.maximumWorkerCount,
    Math.max(1, Math.floor(selection)),
  );
}

/**
 * Each GPU lane owns a WebGPU batch queue and its own address post-processing
 * worker. Multiple lanes keep the graphics queue busy while spreading the
 * unavoidable SLIP-0010, Ed25519, and StateInit tail across browser workers.
 */
export function createSearchWorkerPlan(
  engine: ComputeEngine,
  cpuWorkerCount: number,
): ComputeEngine[] {
  const normalizedCpuCount = Math.max(1, Math.floor(cpuWorkerCount));
  if (engine === 'cpu') return Array.from({ length: normalizedCpuCount }, () => 'cpu');
  return Array.from({ length: normalizedCpuCount }, () => 'gpu');
}
