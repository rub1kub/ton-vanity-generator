export const DEFAULT_LOGICAL_PROCESSOR_COUNT = 4;
export const MOBILE_CPU_WORKER_CAP = 8;
export const DESKTOP_CPU_WORKER_CAP = 32;
export const DESKTOP_GPU_BALANCED_LANE_CAP = 8;
export const DESKTOP_GPU_PEAK_LANE_CAP = 16;

const HARDWARE_LABEL_MAX_LENGTH = 96;

export interface UserAgentHighEntropyValuesLike {
  readonly architecture?: string;
  readonly bitness?: string;
  readonly model?: string;
  readonly platform?: string;
}

export interface UserAgentDataLike {
  readonly mobile?: boolean;
  readonly platform?: string;
  getHighEntropyValues?(
    hints: readonly string[],
  ): Promise<UserAgentHighEntropyValuesLike>;
}

export interface GpuAdapterInfoLike {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
}

export interface GpuAdapterLike {
  readonly info?: GpuAdapterInfoLike;
}

export interface GpuSourceLike {
  requestAdapter(options?: {
    readonly powerPreference?: 'low-power' | 'high-performance';
  }): Promise<GpuAdapterLike | null>;
}

export interface DeviceNavigatorLike {
  readonly hardwareConcurrency?: number;
  readonly deviceMemory?: number;
  readonly userAgent?: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
  readonly userAgentData?: UserAgentDataLike;
  readonly gpu?: GpuSourceLike;
}

export interface SanitizedGpuAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

export interface WebGpuProfile {
  /** Whether the browser exposes the WebGPU entry point. */
  apiAvailable: boolean;
  /** Whether WebGPU returned an adapter suitable for computation. */
  adapterAvailable: boolean;
  adapterInfo?: SanitizedGpuAdapterInfo;
}

export type HardwareDetailsSource =
  | 'client-hints'
  | 'user-agent-fallback'
  | 'navigator-fallback'
  | 'unavailable';

export interface DeviceProfile {
  /** Documents the privacy boundary for callers and UI copy. */
  readonly localOnly: true;
  hardwareConcurrency: number;
  mobile: boolean;
  architecture?: string;
  bitness?: string;
  model?: string;
  platform?: string;
  /** Approximate, privacy-reduced RAM value reported by the browser. */
  deviceMemoryGiB?: number;
  hardwareDetailsSource: HardwareDetailsSource;
  webgpu: WebGpuProfile;
}

export interface DeviceProfileSources {
  /** Pass null to explicitly collect an SSR-safe empty profile. */
  readonly navigator?: DeviceNavigatorLike | null;
  /** Overrides navigator.gpu, primarily for deterministic tests. */
  readonly gpu?: GpuSourceLike | null;
}

export interface WorkloadRecommendation {
  balancedWorkerCount: number;
  peakWorkerCount: number;
  workerCountOptions: readonly number[];
}

export interface GpuWorkloadRecommendation {
  allowed: boolean;
  balancedLaneCount: number;
  peakLaneCount: number;
  laneCountOptions: readonly number[];
}

export interface DeviceSettingsRecommendation {
  recommendedEngine: 'cpu' | 'gpu';
  cpu: WorkloadRecommendation;
  gpu: GpuWorkloadRecommendation;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value < 1) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function sanitizeHardwareLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const sanitized = value
    // Adapter and UA strings are browser-controlled but are still treated as
    // untrusted text before being rendered in the interface.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, HARDWARE_LABEL_MAX_LENGTH);

  return sanitized || undefined;
}

function normalizeDeviceMemory(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return undefined;
  }

  // Browsers deliberately reduce this value's precision. Keep that property
  // and reject implausibly large injected values rather than presenting them
  // as exact physical RAM.
  return Math.min(64, Math.max(0.25, Math.round(value * 4) / 4));
}

function detectMobile(navigatorSource: DeviceNavigatorLike | null): boolean {
  if (typeof navigatorSource?.userAgentData?.mobile === 'boolean') {
    return navigatorSource.userAgentData.mobile;
  }

  const userAgent = navigatorSource?.userAgent ?? '';
  if (/Android|webOS|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(userAgent)) {
    return true;
  }

  // Current iPadOS Safari may identify itself as macOS.
  return navigatorSource?.platform === 'MacIntel'
    && (navigatorSource.maxTouchPoints ?? 0) > 1;
}

function fallbackArchitecture(userAgent: string): string | undefined {
  if (/\b(?:arm64|aarch64)\b/i.test(userAgent)) return 'arm64';
  if (/\b(?:armv\d+[a-z]*|arm)\b/i.test(userAgent)) return 'arm';
  if (/\b(?:x86_64|amd64|x64|Win64)\b/i.test(userAgent)) return 'x86_64';
  if (/\b(?:i[3-6]86|x86)\b/i.test(userAgent)) return 'x86';
  return undefined;
}

function fallbackBitness(userAgent: string): string | undefined {
  if (/\b(?:arm64|aarch64|x86_64|amd64|x64|Win64)\b/i.test(userAgent)) {
    return '64';
  }
  if (/\b(?:armv\d+[a-z]*|i[3-6]86|x86)\b/i.test(userAgent)) return '32';
  return undefined;
}

function fallbackModel(
  userAgent: string,
  navigatorPlatform?: string,
  maxTouchPoints = 0,
): string | undefined {
  const androidModel = userAgent.match(/;\s*([^;()]+?)\s+Build\//i)?.[1];
  if (androidModel) return sanitizeHardwareLabel(androidModel);
  if (/\biPad\b/i.test(userAgent)) return 'iPad';
  if (/\biPhone\b/i.test(userAgent)) return 'iPhone';
  if (/\biPod\b/i.test(userAgent)) return 'iPod';
  if (navigatorPlatform === 'MacIntel' && maxTouchPoints > 1) return 'iPad';
  return undefined;
}

function fallbackPlatform(
  userAgent: string,
  navigatorPlatform: string | undefined,
  maxTouchPoints = 0,
): string | undefined {
  if (/Android/i.test(userAgent)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS';
  if (navigatorPlatform === 'MacIntel' && maxTouchPoints > 1) return 'iPadOS';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return sanitizeHardwareLabel(navigatorPlatform);
}

function safeAdapterInfo(adapter: GpuAdapterLike): SanitizedGpuAdapterInfo | undefined {
  let info: GpuAdapterInfoLike | undefined;
  try {
    info = adapter.info;
  } catch {
    return undefined;
  }

  if (!info) return undefined;

  const result: SanitizedGpuAdapterInfo = {};
  const keys = ['vendor', 'architecture', 'device', 'description'] as const;
  for (const key of keys) {
    try {
      const value = sanitizeHardwareLabel(info[key]);
      if (value) result[key] = value;
    } catch {
      // A single exotic browser getter must not discard the other fields.
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

async function collectWebGpuProfile(
  gpu: GpuSourceLike | null | undefined,
): Promise<WebGpuProfile> {
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    return { apiAvailable: false, adapterAvailable: false };
  }

  try {
    // This intentionally stops before requestDevice(): profiling does not
    // allocate a GPU device, buffers, or any persistent resources.
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { apiAvailable: true, adapterAvailable: false };

    return {
      apiAvailable: true,
      adapterAvailable: true,
      adapterInfo: safeAdapterInfo(adapter),
    };
  } catch {
    return { apiAvailable: true, adapterAvailable: false };
  }
}

function getGlobalNavigator(): DeviceNavigatorLike | null {
  if (typeof navigator === 'undefined') return null;
  return navigator as unknown as DeviceNavigatorLike;
}

/**
 * Collects a privacy-reduced device profile using browser APIs only. No data is
 * persisted or transmitted, and every optional capability is failure-tolerant.
 */
export async function collectDeviceProfile(
  sources: DeviceProfileSources = {},
): Promise<DeviceProfile> {
  const navigatorSource = sources.navigator === undefined
    ? getGlobalNavigator()
    : sources.navigator;
  const gpu = sources.gpu === undefined ? navigatorSource?.gpu : sources.gpu;
  const userAgent = navigatorSource?.userAgent ?? '';
  const mobile = detectMobile(navigatorSource);
  const architectureFallbackText = `${userAgent} ${navigatorSource?.platform ?? ''}`;
  const userAgentData = navigatorSource?.userAgentData;

  let highEntropyValues: UserAgentHighEntropyValuesLike | undefined;
  if (typeof userAgentData?.getHighEntropyValues === 'function') {
    try {
      highEntropyValues = await userAgentData.getHighEntropyValues([
        'architecture',
        'bitness',
        'model',
        'platform',
      ]);
    } catch {
      // Safari/Firefox and privacy-hardened Chromium can omit or reject hints.
    }
  }

  const highEntropyArchitecture = sanitizeHardwareLabel(highEntropyValues?.architecture);
  const highEntropyBitness = sanitizeHardwareLabel(highEntropyValues?.bitness);
  const highEntropyModel = sanitizeHardwareLabel(highEntropyValues?.model);
  const highEntropyPlatform = sanitizeHardwareLabel(highEntropyValues?.platform);
  const hasHighEntropyDetail = Boolean(
    highEntropyArchitecture
    || highEntropyBitness
    || highEntropyModel
    || highEntropyPlatform,
  );

  const architecture = highEntropyArchitecture
    ?? fallbackArchitecture(architectureFallbackText);
  const bitness = highEntropyBitness
    ?? fallbackBitness(architectureFallbackText);
  const model = highEntropyModel
    ?? fallbackModel(
      userAgent,
      navigatorSource?.platform,
      navigatorSource?.maxTouchPoints,
    );
  const platform = highEntropyPlatform
    ?? sanitizeHardwareLabel(userAgentData?.platform)
    ?? fallbackPlatform(
      userAgent,
      navigatorSource?.platform,
      navigatorSource?.maxTouchPoints,
    );

  let hardwareDetailsSource: HardwareDetailsSource = 'unavailable';
  if (architecture || bitness || model || platform) {
    hardwareDetailsSource = hasHighEntropyDetail
      ? 'client-hints'
      : userAgent
        ? 'user-agent-fallback'
        : 'navigator-fallback';
  }

  return {
    localOnly: true,
    hardwareConcurrency: positiveInteger(
      navigatorSource?.hardwareConcurrency,
      DEFAULT_LOGICAL_PROCESSOR_COUNT,
    ),
    mobile,
    architecture,
    bitness,
    model,
    platform,
    deviceMemoryGiB: normalizeDeviceMemory(navigatorSource?.deviceMemory),
    hardwareDetailsSource,
    // Mobile search intentionally uses CPU: avoid even requesting a high-power
    // GPU adapter while merely building the passive device profile.
    webgpu: mobile
      ? { apiAvailable: Boolean(gpu), adapterAvailable: false }
      : await collectWebGpuProfile(gpu),
  };
}

function integerOptions(maximum: number): number[] {
  return Array.from({ length: Math.max(0, maximum) }, (_, index) => index + 1);
}

/**
 * Produces reproducible initial settings from the passive profile. A runtime
 * benchmark may refine these values later; model names are intentionally not
 * mapped to guessed performance tiers.
 */
export function recommendDeviceSettings(
  profile: DeviceProfile,
): DeviceSettingsRecommendation {
  const logicalProcessors = positiveInteger(
    profile.hardwareConcurrency,
    DEFAULT_LOGICAL_PROCESSOR_COUNT,
  );
  const cpuCap = profile.mobile
    ? MOBILE_CPU_WORKER_CAP
    : DESKTOP_CPU_WORKER_CAP;
  const peakCpuWorkers = Math.min(logicalProcessors, cpuCap);
  // hardwareConcurrency describes logical processors, not the concurrency of
  // Chromium's native WebCrypto PBKDF2 queue. Browser profiling peaks around
  // two workers on both desktop and mobile; higher exact counts stay available.
  const balancedCpuWorkers = Math.min(2, peakCpuWorkers);

  const gpuAllowed = !profile.mobile && profile.webgpu.adapterAvailable;
  const balancedGpuLanes = gpuAllowed
    ? Math.min(
        DESKTOP_GPU_BALANCED_LANE_CAP,
        Math.max(1, Math.ceil(logicalProcessors / 2)),
      )
    : 0;
  const peakGpuLanes = gpuAllowed
    ? Math.min(
        DESKTOP_GPU_PEAK_LANE_CAP,
        Math.max(1, logicalProcessors * 2),
      )
    : 0;

  return {
    recommendedEngine: gpuAllowed ? 'gpu' : 'cpu',
    cpu: {
      balancedWorkerCount: balancedCpuWorkers,
      peakWorkerCount: peakCpuWorkers,
      workerCountOptions: integerOptions(peakCpuWorkers),
    },
    gpu: {
      allowed: gpuAllowed,
      balancedLaneCount: balancedGpuLanes,
      peakLaneCount: peakGpuLanes,
      laneCountOptions: integerOptions(peakGpuLanes),
    },
  };
}
