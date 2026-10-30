/// <reference lib="webworker" />
import { Buffer } from 'buffer';
import { RotationError } from '../lib/tg-rotation-types';
import type { RotationRequest, RotationResponse, RotationResult } from '../lib/tg-rotation-types';

(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
const runtime = Promise.all([import('../lib/tg-rpc'), import('../lib/tg-rotation-session')])
  .then(([rpcModule, { RotationSession }]) => {
    const rpc = new rpcModule.TonCenterRpc();
    return { rpc, session: new RotationSession(rpc), check: rpcModule.checkRotation };
  });
let queue = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<RotationRequest>) => {
  queue = queue.then(async () => {
    let response: RotationResponse;
    try {
      const { rpc, session, check } = await runtime;
      let result: RotationResult;
      switch (data.action) {
        case 'prepare':
          try { result = await session.prepare(data.phrase, data.address); }
          finally { data.phrase = ''; }
          break;
        case 'sign':
          try { result = await session.sign(data.answers, data.fee); }
          finally { data.answers.fill(''); }
          break;
        case 'send': result = await session.send(data.messageHash); break;
        case 'status': result = await check(rpc, data.pending); break;
      }
      response = { id: data.id, ok: true, result };
    } catch (error) {
      response = { id: data.id, ok: false, code: error instanceof RotationError ? error.code : 'internal' };
    }
    self.postMessage(response);
  });
};
