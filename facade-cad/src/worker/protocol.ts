// Messages between the UI thread and the processing worker.
import { AnalyzeOptions } from '../core/ctx';
import { Mat3, Quad } from '../core/geom';
import { FacadeModel } from '../core/model';

export interface RectInfo {
  H: Mat3; Hinv: Mat3; outW: number; outH: number;
  facade: { x: number; y: number; w: number; h: number };
  aspect: number; focalPx: number; focalEstimated: boolean; confidence: number; notes: string[];
}

export type ToWorker =
  | { type: 'load'; id: string; blob: Blob; maxSourceSide: number }
  | { type: 'auto'; id: string; reqId: number }
  | {
      type: 'process'; id: string; reqId: number; quad: Quad | null; quadIsAuto: boolean; aspect?: number; ignore: Quad[]; occluders: Quad[];
      maxSide: number; options: Partial<AnalyzeOptions>; provider?: string;
    }
  | { type: 'jpeg'; id: string; reqId: number; maxSide: number }
  | { type: 'drop'; id: string };

export type FromWorker =
  | { type: 'loaded'; id: string; w: number; h: number; scale: number }
  | { type: 'auto'; id: string; reqId: number; quad: Quad; confidence: number; notes: string[] }
  | { type: 'progress'; id: string; reqId: number; stage: string; p: number }
  | {
      type: 'processed'; id: string; reqId: number; quad: Quad; quadSource: 'manual' | 'auto'; located: boolean; autoConfidence: number | null;
      rect: RectInfo; rectified: { w: number; h: number; data: ArrayBuffer }; model: FacadeModel; timings: Record<string, number>;
    }
  | { type: 'jpeg'; id: string; reqId: number; base64: string; w: number; h: number }
  | { type: 'error'; id: string; reqId?: number; message: string };
