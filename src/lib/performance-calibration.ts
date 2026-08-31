import type {
  DeviceProfile,
  DeviceSettingsRecommendation,
} from './device-profile';

export type CalibrationEngine = 'cpu' | 'gpu';

/** Measurement time after every CPU configuration has warmed up. */
export const DEFAULT_CPU_CALIBRATION_DURATION_MS = 1_800;
/** Measurement time after every WebGPU configuration has warmed up. */
export const DEFAULT_GPU_CALIBRATION_DURATION_MS = 2_400;

export interface PerformanceCalibrationStep {
  engine: CalibrationEngine;
  /** Number of CPU workers or independent GPU lanes to run. */
  count: number;
  durationMs: number;
}

export interface PerformanceCalibrationPlanInput {
  profile: DeviceProfile;
  recommendation: DeviceSettingsRecommendation;
  /** The CPU limit exposed by the current browser/session. */
  maxCpuWorkers: number;
  cpuDurationMs?: number;
  gpuDurationMs?: number;
}

export interface PerformanceCalibrationResult {
  engine: CalibrationEngine;
  count: number;
  attemptsPerSecond: number;
  /** False for an interrupted or failed measurement. */
  valid: boolean;
  /** True when a requested GPU run silently continued on CPU. */
  fallback?: boolean;
  /** Explicit failure marker for adapters that report errors separately. */
  failed?: boolean;
}

function positiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.max(1, Math.floor(value));
}

function uniquePositiveCounts(
  values: readonly number[],
  maximum?: number,
): number[] {
  const result: number[] = [];
  const seen = new Set<number>();

  for (const rawValue of values) {
    if (!Number.isFinite(rawValue)) continue;
    const value = Math.floor(rawValue);
    if (value < 1 || (maximum !== undefined && value > maximum) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

function geometricCounts(maximum: number): number[] {
  const normalizedMaximum = positiveInteger(maximum, 1);
  const counts: number[] = [];
  for (let count = 1; count < normalizedMaximum; count *= 2) counts.push(count);
  counts.push(normalizedMaximum);
  return uniquePositiveCounts(counts, normalizedMaximum);
}

/**
 * Builds a geometric sweep (1/2/4/8/...) through the whole safe CPU and GPU
 * range. This catches common mid-range sweet spots without turning the local
 * calibration into an exhaustive, minutes-long test of every exact value.
 */
export function createPerformanceCalibrationPlan({
  profile,
  recommendation,
  maxCpuWorkers,
  cpuDurationMs = DEFAULT_CPU_CALIBRATION_DURATION_MS,
  gpuDurationMs = DEFAULT_GPU_CALIBRATION_DURATION_MS,
}: PerformanceCalibrationPlanInput): PerformanceCalibrationStep[] {
  const cpuMaximum = positiveInteger(maxCpuWorkers, 1);
  const cpuPeak = Math.min(
    cpuMaximum,
    positiveInteger(recommendation.cpu.peakWorkerCount, cpuMaximum),
  );
  const normalizedCpuDuration = positiveInteger(
    cpuDurationMs,
    DEFAULT_CPU_CALIBRATION_DURATION_MS,
  );
  const normalizedGpuDuration = positiveInteger(
    gpuDurationMs,
    DEFAULT_GPU_CALIBRATION_DURATION_MS,
  );

  const plan: PerformanceCalibrationStep[] = geometricCounts(cpuPeak).map((count) => ({
    engine: 'cpu',
    count,
    durationMs: normalizedCpuDuration,
  }));

  const gpuAllowed = !profile.mobile
    && profile.webgpu.adapterAvailable
    && recommendation.gpu.allowed;

  if (gpuAllowed) {
    const gpuPeak = positiveInteger(recommendation.gpu.peakLaneCount, 1);
    for (const count of geometricCounts(gpuPeak)) {
      plan.push({
        engine: 'gpu',
        count,
        durationMs: normalizedGpuDuration,
      });
    }
  }

  return plan;
}

function isUsableResult(
  result: PerformanceCalibrationResult,
): boolean {
  return result.valid
    && result.failed !== true
    && result.fallback !== true
    && Number.isFinite(result.attemptsPerSecond)
    && result.attemptsPerSecond > 0
    && Number.isInteger(result.count)
    && result.count > 0;
}

/**
 * Chooses the highest measured throughput without mutating the input. Equal
 * speeds prefer fewer workers/lanes; an otherwise exact tie prefers CPU so the
 * result is deterministic regardless of input order.
 */
export function selectFastestCalibrationResult(
  results: readonly PerformanceCalibrationResult[],
): PerformanceCalibrationResult | null {
  let fastest: PerformanceCalibrationResult | null = null;

  for (const result of results) {
    if (!isUsableResult(result)) continue;

    if (
      fastest === null
      || result.attemptsPerSecond > fastest.attemptsPerSecond
      || (
        result.attemptsPerSecond === fastest.attemptsPerSecond
        && result.count < fastest.count
      )
      || (
        result.attemptsPerSecond === fastest.attemptsPerSecond
        && result.count === fastest.count
        && result.engine === 'cpu'
        && fastest.engine === 'gpu'
      )
    ) {
      fastest = result;
    }
  }

  return fastest;
}
