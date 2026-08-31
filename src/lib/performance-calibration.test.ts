import { describe, expect, it } from 'vitest';

import type {
  DeviceProfile,
  DeviceSettingsRecommendation,
} from './device-profile';
import {
  createPerformanceCalibrationPlan,
  DEFAULT_CPU_CALIBRATION_DURATION_MS,
  DEFAULT_GPU_CALIBRATION_DURATION_MS,
  selectFastestCalibrationResult,
  type PerformanceCalibrationResult,
} from './performance-calibration';

function profile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    localOnly: true,
    hardwareConcurrency: 8,
    mobile: false,
    hardwareDetailsSource: 'unavailable',
    webgpu: { apiAvailable: true, adapterAvailable: true },
    ...overrides,
  };
}

function recommendation(
  overrides: Partial<DeviceSettingsRecommendation> = {},
): DeviceSettingsRecommendation {
  return {
    recommendedEngine: 'gpu',
    cpu: {
      balancedWorkerCount: 2,
      peakWorkerCount: 8,
      workerCountOptions: [1, 2, 3, 4, 5, 6, 7, 8],
    },
    gpu: {
      allowed: true,
      balancedLaneCount: 4,
      peakLaneCount: 16,
      laneCountOptions: Array.from({ length: 16 }, (_, index) => index + 1),
    },
    ...overrides,
  };
}

describe('createPerformanceCalibrationPlan', () => {
  it('benchmarks a geometric sweep through CPU and GPU peak configurations', () => {
    expect(createPerformanceCalibrationPlan({
      profile: profile(),
      recommendation: recommendation(),
      maxCpuWorkers: 8,
    })).toEqual([
      { engine: 'cpu', count: 1, durationMs: DEFAULT_CPU_CALIBRATION_DURATION_MS },
      { engine: 'cpu', count: 2, durationMs: DEFAULT_CPU_CALIBRATION_DURATION_MS },
      { engine: 'cpu', count: 4, durationMs: DEFAULT_CPU_CALIBRATION_DURATION_MS },
      { engine: 'cpu', count: 8, durationMs: DEFAULT_CPU_CALIBRATION_DURATION_MS },
      { engine: 'gpu', count: 1, durationMs: DEFAULT_GPU_CALIBRATION_DURATION_MS },
      { engine: 'gpu', count: 2, durationMs: DEFAULT_GPU_CALIBRATION_DURATION_MS },
      { engine: 'gpu', count: 4, durationMs: DEFAULT_GPU_CALIBRATION_DURATION_MS },
      { engine: 'gpu', count: 8, durationMs: DEFAULT_GPU_CALIBRATION_DURATION_MS },
      { engine: 'gpu', count: 16, durationMs: DEFAULT_GPU_CALIBRATION_DURATION_MS },
    ]);
  });

  it('deduplicates tiny plans and still sweeps to the GPU ceiling', () => {
    const settings = recommendation({
      cpu: {
        balancedWorkerCount: 1,
        peakWorkerCount: 2,
        workerCountOptions: [1, 2],
      },
      gpu: {
        allowed: true,
        balancedLaneCount: 8,
        peakLaneCount: 8,
        laneCountOptions: [8],
      },
    });

    expect(createPerformanceCalibrationPlan({
      profile: profile(),
      recommendation: settings,
      maxCpuWorkers: 2,
    })).toEqual([
      { engine: 'cpu', count: 1, durationMs: 1_800 },
      { engine: 'cpu', count: 2, durationMs: 1_800 },
      { engine: 'gpu', count: 1, durationMs: 2_400 },
      { engine: 'gpu', count: 2, durationMs: 2_400 },
      { engine: 'gpu', count: 4, durationMs: 2_400 },
      { engine: 'gpu', count: 8, durationMs: 2_400 },
    ]);
  });

  it('uses the same CPU candidates but never includes GPU on mobile', () => {
    expect(createPerformanceCalibrationPlan({
      profile: profile({ mobile: true }),
      recommendation: recommendation(),
      maxCpuWorkers: 8,
    })).toEqual([
      { engine: 'cpu', count: 1, durationMs: 1_800 },
      { engine: 'cpu', count: 2, durationMs: 1_800 },
      { engine: 'cpu', count: 4, durationMs: 1_800 },
      { engine: 'cpu', count: 8, durationMs: 1_800 },
    ]);
  });

  it('requires a real adapter and an allowed GPU recommendation', () => {
    const noAdapter = createPerformanceCalibrationPlan({
      profile: profile({
        webgpu: { apiAvailable: true, adapterAvailable: false },
      }),
      recommendation: recommendation(),
      maxCpuWorkers: 4,
    });
    const disallowed = createPerformanceCalibrationPlan({
      profile: profile(),
      recommendation: recommendation({
        recommendedEngine: 'cpu',
        gpu: {
          allowed: false,
          balancedLaneCount: 0,
          peakLaneCount: 0,
          laneCountOptions: [],
        },
      }),
      maxCpuWorkers: 4,
    });

    expect(noAdapter.every((step) => step.engine === 'cpu')).toBe(true);
    expect(disallowed.every((step) => step.engine === 'cpu')).toBe(true);
  });

  it('caps the recommended CPU peak at the session maximum', () => {
    const plan = createPerformanceCalibrationPlan({
      profile: profile(),
      recommendation: recommendation({
        cpu: {
          balancedWorkerCount: 2,
          peakWorkerCount: 32,
          workerCountOptions: Array.from({ length: 32 }, (_, index) => index + 1),
        },
      }),
      maxCpuWorkers: 6,
    });

    expect(plan.filter((step) => step.engine === 'cpu').map((step) => step.count))
      .toEqual([1, 2, 4, 6]);
  });

  it('supports custom sample durations and safely normalizes invalid inputs', () => {
    const plan = createPerformanceCalibrationPlan({
      profile: profile(),
      recommendation: recommendation({
        cpu: {
          balancedWorkerCount: 1,
          peakWorkerCount: Number.NaN,
          workerCountOptions: [],
        },
      }),
      maxCpuWorkers: Number.NaN,
      cpuDurationMs: 750.9,
      gpuDurationMs: 0,
    });

    expect(plan).toEqual([
      { engine: 'cpu', count: 1, durationMs: 750 },
      { engine: 'gpu', count: 1, durationMs: 2_400 },
      { engine: 'gpu', count: 2, durationMs: 2_400 },
      { engine: 'gpu', count: 4, durationMs: 2_400 },
      { engine: 'gpu', count: 8, durationMs: 2_400 },
      { engine: 'gpu', count: 16, durationMs: 2_400 },
    ]);
  });
});

function result(
  overrides: Partial<PerformanceCalibrationResult> = {},
): PerformanceCalibrationResult {
  return {
    engine: 'cpu',
    count: 2,
    attemptsPerSecond: 1_000,
    valid: true,
    ...overrides,
  };
}

describe('selectFastestCalibrationResult', () => {
  it('selects the highest valid measured throughput', () => {
    const fastest = result({ engine: 'gpu', count: 8, attemptsPerSecond: 12_500 });

    expect(selectFastestCalibrationResult([
      result({ count: 1, attemptsPerSecond: 900 }),
      fastest,
      result({ count: 8, attemptsPerSecond: 4_200 }),
    ])).toBe(fastest);
  });

  it('ignores invalid, failed, fallback, zero, negative, and non-finite samples', () => {
    const usable = result({ count: 2, attemptsPerSecond: 850 });
    const invalidSamples = [
      result({ attemptsPerSecond: 99_999, valid: false }),
      result({ attemptsPerSecond: 99_999, failed: true }),
      result({ engine: 'gpu', attemptsPerSecond: 99_999, fallback: true }),
      result({ attemptsPerSecond: 0 }),
      result({ attemptsPerSecond: -1 }),
      result({ attemptsPerSecond: Number.NaN }),
      result({ attemptsPerSecond: Number.POSITIVE_INFINITY }),
      result({ count: 0, attemptsPerSecond: 99_999 }),
      result({ count: 1.5, attemptsPerSecond: 99_999 }),
    ];

    expect(selectFastestCalibrationResult([...invalidSamples, usable])).toBe(usable);
    expect(selectFastestCalibrationResult(invalidSamples)).toBeNull();
  });

  it('breaks equal-speed ties in favour of fewer tasks', () => {
    const fewer = result({ engine: 'cpu', count: 2, attemptsPerSecond: 4_000 });

    expect(selectFastestCalibrationResult([
      result({ engine: 'gpu', count: 8, attemptsPerSecond: 4_000 }),
      fewer,
      result({ engine: 'cpu', count: 4, attemptsPerSecond: 3_999 }),
    ])).toBe(fewer);
  });

  it('uses CPU as a stable final tie-break regardless of input order', () => {
    const cpu = result({ engine: 'cpu', count: 4, attemptsPerSecond: 2_000 });
    const gpu = result({ engine: 'gpu', count: 4, attemptsPerSecond: 2_000 });

    expect(selectFastestCalibrationResult([gpu, cpu])).toBe(cpu);
    expect(selectFastestCalibrationResult([cpu, gpu])).toBe(cpu);
  });

  it('does not mutate the provided measurements', () => {
    const measurements = Object.freeze([
      Object.freeze(result({ count: 8, attemptsPerSecond: 5_000 })),
      Object.freeze(result({ count: 2, attemptsPerSecond: 5_000 })),
    ]);

    expect(() => selectFastestCalibrationResult(measurements)).not.toThrow();
    expect(measurements.map((item) => item.count)).toEqual([8, 2]);
  });
});
