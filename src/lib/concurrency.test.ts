import { describe, expect, it } from 'vitest';

import {
  BROWSER_WORKER_STABILITY_CAP,
  MOBILE_WORKER_STABILITY_CAP,
  createSearchWorkerPlan,
  createConcurrencyPolicy,
  detectMobileDevice,
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
  it('uses the profiled WebCrypto sweet spot in Auto and exposes all cores', () => {
    const policy = createConcurrencyPolicy(8);

    expect(policy).toMatchObject({
      deviceClass: 'desktop',
      isMobile: false,
      gpuAllowed: true,
      reportedCoreCount: 8,
      autoWorkerCount: 2,
      defaultWorkerCount: 2,
      maximumWorkerCount: 8,
      isCapped: false,
    });
    expect(policy.workerCountOptions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(policy.recommendedWorkerCounts).toEqual([1, 2, 4, 8]);
    expect(policy.choices).toEqual([
      {
        mode: 'auto',
        label: 'Авто',
        description: 'Быстрый режим WebCrypto · 2 потока',
        workerCount: 2,
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

  it('caps high-core systems while keeping profiled Auto below Maximum', () => {
    const policy = createConcurrencyPolicy(64);

    expect(policy.maximumWorkerCount).toBe(BROWSER_WORKER_STABILITY_CAP);
    expect(policy.autoWorkerCount).toBe(2);
    expect(policy.isCapped).toBe(true);
    expect(policy.choices[1].description).toContain('Лимит для стабильности браузера');
  });

  it('supports all 16 logical processors on a 16-thread desktop', () => {
    const policy = createConcurrencyPolicy(16);

    expect(policy.maximumWorkerCount).toBe(16);
    expect(policy.autoWorkerCount).toBe(2);
    expect(policy.workerCountOptions).toHaveLength(16);
    expect(policy.workerCountOptions.at(-1)).toBe(16);
    expect(policy.recommendedWorkerCounts).toEqual([1, 2, 4, 8, 16]);
  });

  it('uses a heat-conscious default and ceiling on mobile', () => {
    const policy = createConcurrencyPolicy(16, { isMobile: true });

    expect(policy).toMatchObject({
      deviceClass: 'mobile',
      isMobile: true,
      gpuAllowed: false,
      reportedCoreCount: 16,
      stabilityCap: MOBILE_WORKER_STABILITY_CAP,
      maximumWorkerCount: 8,
      autoWorkerCount: 2,
      defaultWorkerCount: 2,
      isCapped: true,
    });
    expect(policy.workerCountOptions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(policy.recommendedWorkerCounts).toEqual([1, 2, 8]);
    expect(policy.choices[0].description).toContain('Щадящий режим для телефона');
  });

  it('allows a lower injected cap for deterministic embedding and tests', () => {
    const policy = createConcurrencyPolicy(12, 6);

    expect(policy.maximumWorkerCount).toBe(6);
    expect(policy.autoWorkerCount).toBe(2);
    expect(policy.stabilityCap).toBe(6);
  });
});

describe('getBrowserConcurrencyPolicy', () => {
  it('reads hardwareConcurrency from an injected Navigator-like source', () => {
    expect(
      getBrowserConcurrencyPolicy({ hardwareConcurrency: 12 }),
    ).toMatchObject({
      reportedCoreCount: 12,
      autoWorkerCount: 2,
      maximumWorkerCount: 12,
    });
  });

  it('uses Client Hints to hide GPU and limit load on mobile', () => {
    expect(
      getBrowserConcurrencyPolicy({
        hardwareConcurrency: 12,
        userAgentData: { mobile: true },
      }),
    ).toMatchObject({
      isMobile: true,
      gpuAllowed: false,
      autoWorkerCount: 2,
      maximumWorkerCount: 8,
    });
  });
});

describe('detectMobileDevice', () => {
  it('prefers an explicit userAgentData.mobile value', () => {
    expect(detectMobileDevice({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)',
      userAgentData: { mobile: false },
    })).toBe(false);
  });

  it.each([
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Mobile',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  ])('recognises common mobile user agents', (userAgent) => {
    expect(detectMobileDevice({ userAgent })).toBe(true);
  });

  it('recognises an iPad using its desktop-class user agent', () => {
    expect(detectMobileDevice({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })).toBe(true);
  });
});

describe('resolveWorkerCount', () => {
  const policy = createConcurrencyPolicy(8);

  it('resolves the two UI modes', () => {
    expect(resolveWorkerCount('auto', policy)).toBe(2);
    expect(resolveWorkerCount('maximum', policy)).toBe(8);
  });

  it('clamps a manual value into the safe policy range', () => {
    expect(resolveWorkerCount(0, policy)).toBe(1);
    expect(resolveWorkerCount(3.9, policy)).toBe(3);
    expect(resolveWorkerCount(100, policy)).toBe(8);
    expect(resolveWorkerCount(Number.NaN, policy)).toBe(2);
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
