import { describe, expect, it, vi } from 'vitest';

import {
  collectDeviceProfile,
  recommendDeviceSettings,
  type DeviceProfile,
} from './device-profile';

function baseProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    localOnly: true,
    hardwareConcurrency: 8,
    mobile: false,
    hardwareDetailsSource: 'unavailable',
    webgpu: { apiAvailable: false, adapterAvailable: false },
    ...overrides,
  };
}

describe('collectDeviceProfile', () => {
  it('collects Client Hints, approximate memory, and sanitized WebGPU info locally', async () => {
    const getHighEntropyValues = vi.fn(async () => ({
      architecture: 'x86',
      bitness: '64',
      model: '',
      platform: 'Windows',
    }));
    const requestAdapter = vi.fn(async () => ({
      info: {
        vendor: ' NVIDIA\u0000 Corporation ',
        architecture: ' Blackwell\n',
        device: ' RTX 5060 ',
        description: `Discrete GPU ${'x'.repeat(150)}`,
      },
    }));

    const profile = await collectDeviceProfile({
      navigator: {
        hardwareConcurrency: 16,
        deviceMemory: 15.9,
        userAgent: 'unused because Client Hints win',
        userAgentData: {
          mobile: false,
          platform: 'Windows',
          getHighEntropyValues,
        },
      },
      gpu: { requestAdapter },
    });

    expect(getHighEntropyValues).toHaveBeenCalledWith([
      'architecture',
      'bitness',
      'model',
      'platform',
    ]);
    expect(requestAdapter).toHaveBeenCalledWith({
      powerPreference: 'high-performance',
    });
    expect(profile).toMatchObject({
      localOnly: true,
      hardwareConcurrency: 16,
      mobile: false,
      architecture: 'x86',
      bitness: '64',
      platform: 'Windows',
      deviceMemoryGiB: 16,
      hardwareDetailsSource: 'client-hints',
      webgpu: {
        apiAvailable: true,
        adapterAvailable: true,
        adapterInfo: {
          vendor: 'NVIDIA Corporation',
          architecture: 'Blackwell',
          device: 'RTX 5060',
        },
      },
    });
    expect(profile.webgpu.adapterInfo?.description).toBeDefined();
    expect(profile.webgpu.adapterInfo?.description?.length).toBeLessThanOrEqual(96);
  });

  it('falls back to UA data when high-entropy hints are rejected', async () => {
    const profile = await collectDeviceProfile({
      navigator: {
        hardwareConcurrency: 8,
        deviceMemory: 8,
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AP4A) AppleWebKit/537.36 Mobile',
        platform: 'Linux armv8l',
        userAgentData: {
          mobile: true,
          platform: 'Android',
          getHighEntropyValues: vi.fn(async () => {
            throw new Error('privacy policy');
          }),
        },
      },
      gpu: null,
    });

    expect(profile).toMatchObject({
      mobile: true,
      hardwareConcurrency: 8,
      architecture: 'arm',
      bitness: '32',
      model: 'Pixel 9 Pro',
      platform: 'Android',
      hardwareDetailsSource: 'user-agent-fallback',
      webgpu: { apiAvailable: false, adapterAvailable: false },
    });
  });

  it('uses safe defaults and survives WebGPU adapter failures', async () => {
    const profile = await collectDeviceProfile({
      navigator: {
        hardwareConcurrency: Number.NaN,
        deviceMemory: Number.POSITIVE_INFINITY,
        userAgent: '',
      },
      gpu: {
        requestAdapter: vi.fn(async () => {
          throw new Error('adapter blocked');
        }),
      },
    });

    expect(profile).toEqual({
      localOnly: true,
      hardwareConcurrency: 4,
      mobile: false,
      architecture: undefined,
      bitness: undefined,
      model: undefined,
      platform: undefined,
      deviceMemoryGiB: undefined,
      hardwareDetailsSource: 'unavailable',
      webgpu: { apiAvailable: true, adapterAvailable: false },
    });
  });

  it('recognises desktop-UA iPadOS and never requests a GPU adapter', async () => {
    const requestDevice = vi.fn(() => {
      throw new Error('must never be called');
    });
    const requestAdapter = vi.fn(async () => ({
      info: { vendor: 'Apple' },
      requestDevice,
    }));

    const profile = await collectDeviceProfile({
      navigator: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      },
      gpu: { requestAdapter },
    });

    expect(profile.mobile).toBe(true);
    expect(profile.webgpu).toEqual({ apiAvailable: true, adapterAvailable: false });
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(requestDevice).not.toHaveBeenCalled();
  });

  it('handles an adapter with an inaccessible info getter', async () => {
    const adapter = Object.create(null) as { info?: never };
    Object.defineProperty(adapter, 'info', {
      get() {
        throw new Error('redacted');
      },
    });

    const profile = await collectDeviceProfile({
      navigator: {},
      gpu: { requestAdapter: vi.fn(async () => adapter) },
    });

    expect(profile.webgpu).toEqual({
      apiAvailable: true,
      adapterAvailable: true,
      adapterInfo: undefined,
    });
  });
});

describe('recommendDeviceSettings', () => {
  it('uses every desktop CPU up to 32 and exposes exact counts', () => {
    const recommendation = recommendDeviceSettings(baseProfile({
      hardwareConcurrency: 64,
    }));

    expect(recommendation).toMatchObject({
      recommendedEngine: 'cpu',
      cpu: {
        balancedWorkerCount: 2,
        peakWorkerCount: 32,
      },
      gpu: {
        allowed: false,
        balancedLaneCount: 0,
        peakLaneCount: 0,
      },
    });
    expect(recommendation.cpu.workerCountOptions).toHaveLength(32);
    expect(recommendation.cpu.workerCountOptions.at(-1)).toBe(32);
    expect(recommendation.gpu.laneCountOptions).toEqual([]);
  });

  it('uses measured desktop GPU lane policy and exposes all peak options', () => {
    const recommendation = recommendDeviceSettings(baseProfile({
      hardwareConcurrency: 8,
      webgpu: { apiAvailable: true, adapterAvailable: true },
    }));

    expect(recommendation).toMatchObject({
      recommendedEngine: 'gpu',
      cpu: {
        balancedWorkerCount: 2,
        peakWorkerCount: 8,
      },
      gpu: {
        allowed: true,
        balancedLaneCount: 4,
        peakLaneCount: 16,
      },
    });
    expect(recommendation.gpu.laneCountOptions).toHaveLength(16);
    expect(recommendation.gpu.laneCountOptions.at(-1)).toBe(16);
  });

  it('caps balanced GPU lanes at 8 on high-core desktops', () => {
    const recommendation = recommendDeviceSettings(baseProfile({
      hardwareConcurrency: 24,
      webgpu: { apiAvailable: true, adapterAvailable: true },
    }));

    expect(recommendation.gpu).toMatchObject({
      balancedLaneCount: 8,
      peakLaneCount: 16,
    });
  });

  it('forbids GPU and caps peak CPU load at 8 on mobile', () => {
    const recommendation = recommendDeviceSettings(baseProfile({
      hardwareConcurrency: 16,
      mobile: true,
      webgpu: {
        apiAvailable: true,
        adapterAvailable: true,
        adapterInfo: { vendor: 'Qualcomm' },
      },
    }));

    expect(recommendation).toMatchObject({
      recommendedEngine: 'cpu',
      cpu: {
        balancedWorkerCount: 2,
        peakWorkerCount: 8,
      },
      gpu: {
        allowed: false,
        balancedLaneCount: 0,
        peakLaneCount: 0,
      },
    });
    expect(recommendation.cpu.workerCountOptions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
