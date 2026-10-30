import { RotationError } from './tg-rotation-types';
import type { RotationCommand, RotationResponse, RotationResult } from './tg-rotation-types';

export class RotationClient {
  private worker = new Worker(new URL('../workers/rotation.worker.ts', import.meta.url), { type: 'module' });
  private id = 0;
  private failed = false;
  private calls = new Map<number, { resolve: (result: RotationResult) => void; reject: (error: Error) => void }>();
  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<RotationResponse>) => {
      const call = this.calls.get(data.id);
      if (!call) return;
      this.calls.delete(data.id);
      if (data.ok) call.resolve(data.result);
      else call.reject(new RotationError(data.code));
    };
    this.worker.onerror = (event) => { event.preventDefault(); this.failed = true; this.rejectCalls(); };
    this.worker.onmessageerror = () => { this.failed = true; this.rejectCalls(); };
  }
  request<T extends RotationResult>(command: RotationCommand): Promise<T> {
    if (this.failed) return Promise.reject(new RotationError('internal'));
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.calls.set(id, { resolve: (result) => resolve(result as T), reject });
      this.worker.postMessage({ ...command, id });
    });
  }
  private rejectCalls() {
    for (const call of this.calls.values()) call.reject(new RotationError('internal'));
    this.calls.clear();
  }
  dispose() { this.failed = true; this.worker.terminate(); this.rejectCalls(); }
}
