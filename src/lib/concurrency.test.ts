import { describe, expect, it } from 'vitest';

import {
  BROWSER_WORKER_STABILITY_CAP,
  createSearchWorkerPlan,
  createConcurrencyPolicy,
  formatWorkerCount,
  getBrowserConcurrencyPolicy,
  normalizeHardwareConcurrency,
  resolveWorkerCount,
} from './concurrency';

describe('createSearchWorkerPlan', () => {
  it('uses exactly the selected number of CPU workers in CPU mode', () => {
    expect(createSearchWorkerPlan('cpu', 7)).toEqual([
      'cpu', 'cpu', 'cpu', 'cpu', 'cpu', 'cpu', 'cpu',
    ]);
  });

  it('uses the selected number of independent WebGPU lanes in GPU mode', () => {
    expect(createSearchWorkerPlan('gpu', 3)).toEqual(['gpu', 'gpu', 'gpu']);
  });

  it('keeps at least one WebGPU lane', () => {
    expect(createSearchWorkerPlan('gpu', 0)).toEqual(['gpu']);
  });
});

describe('normalizeHardwareConcurrency', () => {
  it.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'uses a safe fallback for %s',
    (value) => {
      expect(normalizeHardwareConcurrency(value)).toBe(4);
    },
  );

  it('rounds a reported fractional value down to a usable core count', () => {
    expect(normalizeHardwareConcurrency(8.9)).toBe(8);
  });
});

describe('createConcurrencyPolicy', () => {
  it('leaves one core free in Auto and lets Maximum use all reported cores', () => {
    const policy = createConcurrencyPolicy(8);

    expect(policy).toMatchObject({
      reportedCoreCount: 8,
      autoWorkerCount: 7,
      maximumWorkerCount: 8,
      isCapped: false,
    });
    expect(policy.choices).toEqual([
      {
        mode: 'auto',
        label: 'Авто',
        description: 'Оставляет одно ядро свободным · 7 потоков',
        workerCount: 7,
      },
      {
        mode: 'maximum',
        label: 'Максимум',
        description: 'Использует все доступные ядра · 8 потоков',
        workerCount: 8,
      },
    ]);
  });

  it('still permits one worker on a single-core device', () => {
    const policy = createConcurrencyPolicy(1);

    expect(policy.autoWorkerCount).toBe(1);
    expect(policy.maximumWorkerCount).toBe(1);
  });

  it('caps high-core systems while keeping Auto below Maximum', () => {
    const policy = createConcurrencyPolicy(64);

    expect(policy.maximumWorkerCount).toBe(BROWSER_WORKER_STABILITY_CAP);
    expect(policy.autoWorkerCount).toBe(BROWSER_WORKER_STABILITY_CAP - 1);
    expect(policy.isCapped).toBe(true);
    expect(policy.choices[1].description).toContain('Лимит для стабильности браузера');
  });

  it('allows a lower injected cap for deterministic embedding and tests', () => {
    const policy = createConcurrencyPolicy(12, 6);

    expect(policy.maximumWorkerCount).toBe(6);
    expect(policy.autoWorkerCount).toBe(5);
    expect(policy.stabilityCap).toBe(6);
  });
});

describe('getBrowserConcurrencyPolicy', () => {
  it('reads hardwareConcurrency from an injected Navigator-like source', () => {
    expect(
      getBrowserConcurrencyPolicy({ hardwareConcurrency: 12 }),
    ).toMatchObject({
      reportedCoreCount: 12,
      autoWorkerCount: 11,
      maximumWorkerCount: 12,
    });
  });
});

describe('resolveWorkerCount', () => {
  const policy = createConcurrencyPolicy(8);

  it('resolves the two UI modes', () => {
    expect(resolveWorkerCount('auto', policy)).toBe(7);
    expect(resolveWorkerCount('maximum', policy)).toBe(8);
  });

  it('clamps a manual value into the safe policy range', () => {
    expect(resolveWorkerCount(0, policy)).toBe(1);
    expect(resolveWorkerCount(3.9, policy)).toBe(3);
    expect(resolveWorkerCount(100, policy)).toBe(8);
    expect(resolveWorkerCount(Number.NaN, policy)).toBe(7);
  });
});

describe('formatWorkerCount', () => {
  it.each([
    [1, '1 поток'],
    [2, '2 потока'],
    [5, '5 потоков'],
    [11, '11 потоков'],
    [21, '21 поток'],
    [24, '24 потока'],
  ])('formats %i for the UI', (count, expected) => {
    expect(formatWorkerCount(count)).toBe(expected);
  });
});
