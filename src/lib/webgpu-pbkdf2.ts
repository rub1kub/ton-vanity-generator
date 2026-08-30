import pbkdf2Shader from './webgpu-pbkdf2.wgsl?raw';

export const BIP39_PBKDF2_ITERATIONS = 2_048;
export const BIP39_SEED_BYTES = 64;
export const BIP39_MNEMONIC_WORDS = 12;

const MNEMONIC_STRIDE_BYTES = 128;
const WORKGROUP_SIZE = 64;
const DEFAULT_MAX_BATCH_SIZE = 256;
const BIP39_SALT = 'mnemonic';
const SELF_TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SELF_TEST_SEED_HEX =
  '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1' +
  '9a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';

// WebGPU constants are intentionally kept local so this module type-checks
// without adding a runtime dependency on @webgpu/types.
const GPU_BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;
const GPU_MAP_MODE_READ = 0x0001;

interface GpuNavigator {
  gpu?: {
    requestAdapter(options?: {
      powerPreference?: WebGpuPowerPreference;
    }): Promise<any | null>;
  };
}

export type WebGpuPowerPreference = 'high-performance' | 'low-power';

export interface PackedMnemonicBatch {
  readonly words: Uint32Array;
  readonly count: number;
  readonly strideBytes: number;
}

export interface WebGpuPbkdf2Options {
  /** Upper bound for one GPU dispatch. Smaller chunks reduce watchdog risk. */
  maxBatchSize?: number;
  powerPreference?: WebGpuPowerPreference;
  /** Enabled by default. Never use an accelerator that failed its KAT. */
  selfTest?: boolean;
}

export interface WebGpuAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

export interface WebGpuPbkdf2SupportInfo {
  supported: boolean;
  reason?: string;
  adapter?: WebGpuAdapterInfo;
  backend: 'webgpu-pbkdf2-hmac-sha512';
  iterations: typeof BIP39_PBKDF2_ITERATIONS;
  workgroupSize: typeof WORKGROUP_SIZE;
  maxBatchSize: number;
  selfTestPassed: boolean;
}

export interface WebGpuPbkdf2BenchmarkResult {
  batchSize: number;
  rounds: number;
  elapsedMs: number;
  seedsPerSecond: number;
  adapter?: WebGpuAdapterInfo;
}

export interface WebGpuPbkdf2BenchmarkOptions {
  batchSize?: number;
  rounds?: number;
}

export class WebGpuPbkdf2Error extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unsupported'
      | 'adapter-unavailable'
      | 'shader-compilation'
      | 'self-test'
      | 'device-lost'
      | 'invalid-input',
  ) {
    super(message);
    this.name = 'WebGpuPbkdf2Error';
  }
}

const textEncoder = new TextEncoder();

export function canonicalizeBip39Mnemonic(mnemonic: string): string {
  return mnemonic.normalize('NFKD').trim().split(/\s+/u).join(' ');
}

export function encodeBip39Mnemonic(mnemonic: string): Uint8Array {
  const canonical = canonicalizeBip39Mnemonic(mnemonic);
  const words = canonical.length === 0 ? [] : canonical.split(' ');

  if (words.length !== BIP39_MNEMONIC_WORDS) {
    throw new WebGpuPbkdf2Error(
      `Expected exactly ${BIP39_MNEMONIC_WORDS} BIP39 words.`,
      'invalid-input',
    );
  }

  const encoded = textEncoder.encode(canonical);
  if (encoded.byteLength > MNEMONIC_STRIDE_BYTES) {
    encoded.fill(0);
    throw new WebGpuPbkdf2Error(
      `The normalized mnemonic exceeds ${MNEMONIC_STRIDE_BYTES} UTF-8 bytes.`,
      'invalid-input',
    );
  }

  return encoded;
}

/** Packs canonical mnemonic bytes into fixed, zero-padded HMAC key blocks. */
export function packMnemonicBatch(
  mnemonics: readonly string[],
): PackedMnemonicBatch {
  if (mnemonics.length === 0) {
    return {
      words: new Uint32Array(0),
      count: 0,
      strideBytes: MNEMONIC_STRIDE_BYTES,
    };
  }

  const words = new Uint32Array(
    (mnemonics.length * MNEMONIC_STRIDE_BYTES) / Uint32Array.BYTES_PER_ELEMENT,
  );
  const bytes = new Uint8Array(words.buffer);

  try {
    mnemonics.forEach((mnemonic, index) => {
      const encoded = encodeBip39Mnemonic(mnemonic);
      bytes.set(encoded, index * MNEMONIC_STRIDE_BYTES);
      encoded.fill(0);
    });
  } catch (error) {
    words.fill(0);
    throw error;
  }

  return {
    words,
    count: mnemonics.length,
    strideBytes: MNEMONIC_STRIDE_BYTES,
  };
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) {
    throw new Error('Expected an even-length hexadecimal string.');
  }

  const result = new Uint8Array(hex.length / 2);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

/**
 * Independent Web Crypto reference used by tests and browser diagnostics.
 * It is deliberately not used as a silent fallback by the GPU class.
 */
export async function deriveBip39SeedCpuReference(
  mnemonic: string,
): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new WebGpuPbkdf2Error('Web Crypto is unavailable.', 'unsupported');
  }

  const password = encodeBip39Mnemonic(mnemonic);
  const salt = textEncoder.encode(BIP39_SALT);

  try {
    // TextEncoder owns this zero-offset ArrayBuffer. Passing the buffer avoids
    // TypeScript's wider Uint8Array<ArrayBufferLike> BufferSource ambiguity.
    const key = await subtle.importKey(
      'raw',
      password.buffer as ArrayBuffer,
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-512',
        salt,
        iterations: BIP39_PBKDF2_ITERATIONS,
      },
      key,
      BIP39_SEED_BYTES * 8,
    );
    return new Uint8Array(bits);
  } finally {
    password.fill(0);
    salt.fill(0);
  }
}

function getGpuNavigator(): GpuNavigator | null {
  if (typeof navigator === 'undefined') return null;
  return navigator as Navigator & GpuNavigator;
}

function adapterInfo(adapter: any): WebGpuAdapterInfo | undefined {
  const info = adapter?.info;
  if (!info) return undefined;

  return {
    vendor: info.vendor || undefined,
    architecture: info.architecture || undefined,
    device: info.device || undefined,
    description: info.description || undefined,
  };
}

async function compilePipeline(device: any): Promise<any> {
  const shaderModule = device.createShaderModule({
    label: 'TON Suite BIP39 PBKDF2-HMAC-SHA512',
    code: pbkdf2Shader,
  });

  if (typeof shaderModule.getCompilationInfo === 'function') {
    const compilationInfo = await shaderModule.getCompilationInfo();
    const errors = compilationInfo.messages.filter(
      (message: any) => message.type === 'error',
    );
    if (errors.length > 0) {
      throw new WebGpuPbkdf2Error(
        `WebGPU shader compilation failed: ${errors
          .map((message: any) => message.message)
          .join('; ')}`,
        'shader-compilation',
      );
    }
  }

  const descriptor = {
    label: 'BIP39 PBKDF2-HMAC-SHA512 pipeline',
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
  };

  return typeof device.createComputePipelineAsync === 'function'
    ? device.createComputePipelineAsync(descriptor)
    : device.createComputePipeline(descriptor);
}

async function wipeAndDestroyBuffers(
  device: any,
  buffers: Array<{ buffer: any; size: number }>,
): Promise<void> {
  try {
    for (const { buffer, size } of buffers) {
      if (!buffer || size <= 0) continue;
      try {
        device.queue.writeBuffer(buffer, 0, new Uint8Array(size));
      } catch {
        // A lost device or still-mapped readback buffer may reject a wipe.
      }
    }
    if (typeof device.queue.onSubmittedWorkDone === 'function') {
      await device.queue.onSubmittedWorkDone();
    }
  } catch {
    // Best effort only: WebGPU cannot promise physical VRAM zeroization.
  } finally {
    for (const { buffer } of buffers) {
      try {
        buffer?.destroy();
      } catch {
        // Ignore cleanup errors after device loss.
      }
    }
  }
}

export class WebGpuPbkdf2Accelerator {
  readonly supportInfo: WebGpuPbkdf2SupportInfo;

  private destroyed = false;
  private deviceLost = false;

  private constructor(
    private readonly adapter: any,
    private readonly device: any,
    private readonly pipeline: any,
    maxBatchSize: number,
    selfTestPassed: boolean,
  ) {
    this.supportInfo = {
      supported: true,
      adapter: adapterInfo(adapter),
      backend: 'webgpu-pbkdf2-hmac-sha512',
      iterations: BIP39_PBKDF2_ITERATIONS,
      workgroupSize: WORKGROUP_SIZE,
      maxBatchSize,
      selfTestPassed,
    };

    void device.lost?.then(() => {
      this.deviceLost = true;
    });
  }

  static async create(
    options: WebGpuPbkdf2Options = {},
  ): Promise<WebGpuPbkdf2Accelerator> {
    const gpuNavigator = getGpuNavigator();
    if (!gpuNavigator?.gpu) {
      throw new WebGpuPbkdf2Error(
        'WebGPU is unavailable in this browser or context.',
        'unsupported',
      );
    }

    const adapter = await gpuNavigator.gpu.requestAdapter({
      powerPreference: options.powerPreference ?? 'high-performance',
    });
    if (!adapter) {
      throw new WebGpuPbkdf2Error(
        'No compatible WebGPU adapter was returned.',
        'adapter-unavailable',
      );
    }

    const device = await adapter.requestDevice();
    let accelerator: WebGpuPbkdf2Accelerator | undefined;

    try {
      const pipeline = await compilePipeline(device);
      const storageLimit = Number(
        device.limits?.maxStorageBufferBindingSize ?? Number.MAX_SAFE_INTEGER,
      );
      const requestedBatchSize = Math.max(
        1,
        Math.floor(options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE),
      );
      const maxBatchSize = Math.max(
        1,
        Math.min(
          requestedBatchSize,
          Math.floor(storageLimit / MNEMONIC_STRIDE_BYTES),
          Math.floor(storageLimit / BIP39_SEED_BYTES),
        ),
      );

      accelerator = new WebGpuPbkdf2Accelerator(
        adapter,
        device,
        pipeline,
        maxBatchSize,
        false,
      );

      if (options.selfTest !== false) {
        await accelerator.runSelfTest();
        accelerator.supportInfo.selfTestPassed = true;
      }

      return accelerator;
    } catch (error) {
      accelerator?.destroy();
      if (!accelerator) {
        try {
          device.destroy?.();
        } catch {
          // Ignore cleanup errors.
        }
      }
      throw error;
    }
  }

  async deriveSeeds(mnemonics: readonly string[]): Promise<Uint8Array[]> {
    this.assertUsable();
    if (mnemonics.length === 0) return [];

    const seeds: Uint8Array[] = [];
    const maxBatchSize = this.supportInfo.maxBatchSize;

    try {
      for (let offset = 0; offset < mnemonics.length; offset += maxBatchSize) {
        const chunk = mnemonics.slice(offset, offset + maxBatchSize);
        seeds.push(...(await this.deriveChunk(chunk)));
      }
      return seeds;
    } catch (error) {
      for (const seed of seeds) seed.fill(0);
      throw error;
    }
  }

  async benchmark(
    options: WebGpuPbkdf2BenchmarkOptions = {},
  ): Promise<WebGpuPbkdf2BenchmarkResult> {
    this.assertUsable();
    const batchSize = Math.max(
      1,
      Math.min(
        Math.floor(options.batchSize ?? 64),
        this.supportInfo.maxBatchSize,
      ),
    );
    const rounds = Math.max(1, Math.floor(options.rounds ?? 3));
    const batch = Array.from({ length: batchSize }, () => SELF_TEST_MNEMONIC);

    // One untimed warmup covers lazy pipeline and driver initialization.
    const warmup = await this.deriveSeeds(batch.slice(0, Math.min(4, batchSize)));
    for (const seed of warmup) seed.fill(0);

    const startedAt = performance.now();
    for (let round = 0; round < rounds; round += 1) {
      const seeds = await this.deriveSeeds(batch);
      for (const seed of seeds) seed.fill(0);
    }
    const elapsedMs = performance.now() - startedAt;

    return {
      batchSize,
      rounds,
      elapsedMs,
      seedsPerSecond:
        elapsedMs > 0 ? (batchSize * rounds * 1_000) / elapsedMs : 0,
      adapter: this.supportInfo.adapter,
    };
  }

  async runSelfTest(): Promise<void> {
    this.assertUsable();
    const expected = hexToBytes(SELF_TEST_SEED_HEX);
    let actual: Uint8Array | undefined;

    try {
      [actual] = await this.deriveSeeds([SELF_TEST_MNEMONIC]);
      if (!actual || !bytesEqual(actual, expected)) {
        throw new WebGpuPbkdf2Error(
          'WebGPU PBKDF2 failed the standard BIP39 known-answer test.',
          'self-test',
        );
      }
    } finally {
      actual?.fill(0);
      expected.fill(0);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.device.destroy?.();
    } catch {
      // Ignore cleanup errors after device loss.
    }
  }

  private assertUsable(): void {
    if (this.destroyed) {
      throw new WebGpuPbkdf2Error(
        'The WebGPU PBKDF2 accelerator has been destroyed.',
        'device-lost',
      );
    }
    if (this.deviceLost) {
      throw new WebGpuPbkdf2Error(
        'The WebGPU device was lost.',
        'device-lost',
      );
    }
  }

  private async deriveChunk(
    mnemonics: readonly string[],
  ): Promise<Uint8Array[]> {
    const packed = packMnemonicBatch(mnemonics);
    const inputSize = packed.words.byteLength;
    const outputSize = packed.count * BIP39_SEED_BYTES;
    const params = new Uint32Array([packed.count, 0, 0, 0]);

    let inputBuffer: any;
    let outputBuffer: any;
    let paramsBuffer: any;
    let readbackBuffer: any;
    let mapped = false;
    let rawOutput: Uint8Array | undefined;

    try {
      inputBuffer = this.device.createBuffer({
        label: 'BIP39 mnemonic HMAC key blocks',
        size: inputSize,
        usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
      });
      outputBuffer = this.device.createBuffer({
        label: 'BIP39 derived seeds',
        size: outputSize,
        usage:
          GPU_BUFFER_USAGE.STORAGE |
          GPU_BUFFER_USAGE.COPY_SRC |
          GPU_BUFFER_USAGE.COPY_DST,
      });
      paramsBuffer = this.device.createBuffer({
        label: 'BIP39 PBKDF2 batch parameters',
        size: params.byteLength,
        usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
      });
      readbackBuffer = this.device.createBuffer({
        label: 'BIP39 seed readback',
        size: outputSize,
        usage: GPU_BUFFER_USAGE.MAP_READ | GPU_BUFFER_USAGE.COPY_DST,
      });

      this.device.queue.writeBuffer(inputBuffer, 0, packed.words);
      this.device.queue.writeBuffer(paramsBuffer, 0, params);

      const bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: outputBuffer } },
          { binding: 2, resource: { buffer: paramsBuffer } },
        ],
      });

      const commandEncoder = this.device.createCommandEncoder({
        label: 'BIP39 PBKDF2 command encoder',
      });
      const pass = commandEncoder.beginComputePass({
        label: 'BIP39 PBKDF2-HMAC-SHA512',
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(packed.count / WORKGROUP_SIZE));
      pass.end();
      commandEncoder.copyBufferToBuffer(
        outputBuffer,
        0,
        readbackBuffer,
        0,
        outputSize,
      );
      this.device.queue.submit([commandEncoder.finish()]);

      await readbackBuffer.mapAsync(GPU_MAP_MODE_READ, 0, outputSize);
      mapped = true;
      rawOutput = new Uint8Array(
        readbackBuffer.getMappedRange(0, outputSize),
      ).slice();
      readbackBuffer.unmap();
      mapped = false;

      const seeds = Array.from({ length: packed.count }, (_, index) =>
        rawOutput!.slice(
          index * BIP39_SEED_BYTES,
          (index + 1) * BIP39_SEED_BYTES,
        ),
      );
      return seeds;
    } finally {
      if (mapped) {
        try {
          readbackBuffer?.unmap();
        } catch {
          // Ignore cleanup errors after device loss.
        }
      }
      packed.words.fill(0);
      params.fill(0);
      rawOutput?.fill(0);
      await wipeAndDestroyBuffers(this.device, [
        { buffer: inputBuffer, size: inputSize },
        { buffer: outputBuffer, size: outputSize },
        { buffer: paramsBuffer, size: params.byteLength },
        { buffer: readbackBuffer, size: outputSize },
      ]);
    }
  }
}

export async function getWebGpuPbkdf2SupportInfo(
  options: WebGpuPbkdf2Options = {},
): Promise<WebGpuPbkdf2SupportInfo> {
  let accelerator: WebGpuPbkdf2Accelerator | undefined;
  try {
    accelerator = await WebGpuPbkdf2Accelerator.create(options);
    return { ...accelerator.supportInfo };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : 'Unknown WebGPU error.',
      backend: 'webgpu-pbkdf2-hmac-sha512',
      iterations: BIP39_PBKDF2_ITERATIONS,
      workgroupSize: WORKGROUP_SIZE,
      maxBatchSize: 0,
      selfTestPassed: false,
    };
  } finally {
    accelerator?.destroy();
  }
}

/**
 * Browser-only diagnostic path (run from an HTTPS page or localhost):
 *
 *   await runWebGpuPbkdf2BrowserSelfTest()
 *
 * Creation already performs the known-answer test; this helper also returns
 * a small real-PBKDF2 benchmark and always destroys its WebGPU device.
 */
export async function runWebGpuPbkdf2BrowserSelfTest(): Promise<{
  support: WebGpuPbkdf2SupportInfo;
  benchmark: WebGpuPbkdf2BenchmarkResult;
}> {
  const accelerator = await WebGpuPbkdf2Accelerator.create();
  try {
    return {
      support: { ...accelerator.supportInfo },
      benchmark: await accelerator.benchmark({ batchSize: 16, rounds: 1 }),
    };
  } finally {
    accelerator.destroy();
  }
}
