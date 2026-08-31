import type { ComputeEngine } from '../types';

export const DEFAULT_HARDWARE_CONCURRENCY = 4;
/**
 * Browsers can report very large logical-processor counts on workstations.
 * Spawning one worker per reported processor remains useful up to a point,
 * after which memory pressure and scheduling overhead tend to dominate.
 */
export const BROWSER_WORKER_STABILITY_CAP = 32;
/** Phones default low, but Maximum can use a typical full 8-thread mobile SoC. */
export const MOBILE_WORKER_STABILITY_CAP = 8;
export const MOBILE_DEFAULT_WORKER_CAP = 2;
/** Chromium's native PBKDF2 queue peaks around two independent workers. */
export const DESKTOP_DEFAULT_WORKER_CAP = 2;

export type ConcurrencyMode = 'auto' | 'maximum';
export type ConcurrencySelection = ConcurrencyMode | number;

export interface HardwareConcurrencySource {
  readonly hardwareConcurrency?: number;
  readonly userAgent?: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
  readonly userAgentData?: {
    readonly mobile?: boolean;
  };
}

export interface ConcurrencyPolicyOptions {
  readonly isMobile?: boolean;
  readonly stabilityCap?: number;
}

export interface ConcurrencyChoice {
  mode: ConcurrencyMode;
  label: string;
  description: string;
  workerCount: number;
}

export interface ConcurrencyPolicy {
  deviceClass: 'mobile' | 'desktop';
  isMobile: boolean;
  /** Whether the UI should expose its experimental GPU engine. */
  gpuAllowed: boolean;
  reportedCoreCount: number;
  stabilityCap: number;
  maximumWorkerCount: number;
  autoWorkerCount: number;
  defaultWorkerCount: number;
  isCapped: boolean;
  /** Every safe exact value the UI may expose in a manual selector. */
  workerCountOptions: readonly number[];
  /** A compact subset suitable for quick power presets. */
  recommendedWorkerCounts: readonly number[];
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

/**
 * userAgentData.mobile is authoritative when available. The UA fallback keeps
 * Firefox/Safari useful, including iPadOS versions that identify as a Mac.
 */
export function detectMobileDevice(
  source: HardwareConcurrencySource | undefined,
): boolean {
  if (typeof source?.userAgentData?.mobile === 'boolean') {
    return source.userAgentData.mobile;
  }

  const userAgent = source?.userAgent ?? '';
  if (/Android|webOS|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(userAgent)) {
    return true;
  }

  return source?.platform === 'MacIntel' && (source.maxTouchPoints ?? 0) > 1;
}

function recommendedWorkerCounts(
  maximumWorkerCount: number,
  autoWorkerCount: number,
  isMobile: boolean,
): number[] {
  const candidates = isMobile
    ? [1, autoWorkerCount, maximumWorkerCount]
    : [1, Math.min(4, maximumWorkerCount), Math.ceil(maximumWorkerCount / 2), autoWorkerCount, maximumWorkerCount];

  return [...new Set(candidates)]
    .filter((count) => count >= 1 && count <= maximumWorkerCount)
    .sort((left, right) => left - right);
}

export function createConcurrencyPolicy(
  reportedCoreCount: number | null | undefined,
  stabilityCapOrOptions: number | ConcurrencyPolicyOptions = BROWSER_WORKER_STABILITY_CAP,
): ConcurrencyPolicy {
  const normalizedCoreCount = normalizeHardwareConcurrency(reportedCoreCount);
  const options = typeof stabilityCapOrOptions === 'number'
    ? { stabilityCap: stabilityCapOrOptions }
    : stabilityCapOrOptions;
  const isMobile = options.isMobile ?? false;
  const requestedCap = normalizePositiveInteger(
    options.stabilityCap,
    BROWSER_WORKER_STABILITY_CAP,
  );
  const normalizedCap = isMobile
    ? Math.min(requestedCap, MOBILE_WORKER_STABILITY_CAP)
    : requestedCap;
  const maximumWorkerCount = Math.min(normalizedCoreCount, normalizedCap);
  // WebCrypto owns the expensive PBKDF2 stage and schedules it through a
  // browser-native queue. Real Chromium profiling peaks around two workers;
  // matching hardwareConcurrency oversubscribes that queue and can be slower.
  // Mobile also stays conservative because big.LITTLE cores are not equal.
  const autoWorkerCount = isMobile
    ? Math.min(maximumWorkerCount, MOBILE_DEFAULT_WORKER_CAP)
    : Math.min(maximumWorkerCount, DESKTOP_DEFAULT_WORKER_CAP);
  const isCapped = normalizedCoreCount > maximumWorkerCount;

  return {
    deviceClass: isMobile ? 'mobile' : 'desktop',
    isMobile,
    gpuAllowed: !isMobile,
    reportedCoreCount: normalizedCoreCount,
    stabilityCap: normalizedCap,
    maximumWorkerCount,
    autoWorkerCount,
    defaultWorkerCount: autoWorkerCount,
    isCapped,
    workerCountOptions: Array.from(
      { length: maximumWorkerCount },
      (_, index) => index + 1,
    ),
    recommendedWorkerCounts: recommendedWorkerCounts(
      maximumWorkerCount,
      autoWorkerCount,
      isMobile,
    ),
    choices: [
      {
        mode: 'auto',
        label: 'Авто',
        description: isMobile
          ? `Щадящий режим для телефона · ${formatWorkerCount(autoWorkerCount)}`
          : `Быстрый режим WebCrypto · ${formatWorkerCount(autoWorkerCount)}`,
        workerCount: autoWorkerCount,
      },
      {
        mode: 'maximum',
        label: 'Максимум',
        description: isMobile
          ? `Пиковая скорость телефона · ${formatWorkerCount(maximumWorkerCount)}`
          : isCapped
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
  return createConcurrencyPolicy(source?.hardwareConcurrency, {
    isMobile: detectMobileDevice(source),
  });
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
