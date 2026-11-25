// Promise-based client for the processing worker.
import type { FromWorker, ToWorker } from './protocol';

type Processed = Extract<FromWorker, { type: 'processed' }>;
type Auto = Extract<FromWorker, { type: 'auto' }>;
type Jpeg = Extract<FromWorker, { type: 'jpeg' }>;
type Loaded = Extract<FromWorker, { type: 'loaded' }>;

export class FacadeWorker {
  private w: Worker;
  private seq = 0;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (s: string, p: number) => void }>();

  constructor() {
    this.w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      const key = m.type === 'loaded' ? `load:${m.id}` : 'reqId' in m && m.reqId !== undefined ? `${m.id}:${m.reqId}` : `load:${m.id}`;
      const p = this.pending.get(key);
      if (!p) return;
      if (m.type === 'progress') { p.onProgress?.(m.stage, m.p); return; }
      this.pending.delete(key);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    };
  }
  private call<T>(key: string, msg: ToWorker, onProgress?: (s: string, p: number) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => { this.pending.set(key, { resolve, reject, onProgress }); this.w.postMessage(msg); });
  }
  load(id: string, blob: Blob, maxSourceSide = 4000) { return this.call<Loaded>(`load:${id}`, { type: 'load', id, blob, maxSourceSide }); }
  auto(id: string) { const reqId = ++this.seq; return this.call<Auto>(`${id}:${reqId}`, { type: 'auto', id, reqId }); }
  process(args: Omit<Extract<ToWorker, { type: 'process' }>, 'type' | 'reqId'>, onProgress?: (s: string, p: number) => void) {
    const reqId = ++this.seq;
    return this.call<Processed>(`${args.id}:${reqId}`, { type: 'process', reqId, ...args }, onProgress);
  }
  jpeg(id: string, maxSide = 1568) { const reqId = ++this.seq; return this.call<Jpeg>(`${id}:${reqId}`, { type: 'jpeg', id, reqId, maxSide }); }
  drop(id: string) { this.w.postMessage({ type: 'drop', id } satisfies ToWorker); }
}

export const worker = new FacadeWorker();
