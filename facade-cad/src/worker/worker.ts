/// <reference lib="webworker" />
// Processing worker: decodes photos, corrects perspective and runs facade analysis off the UI thread.
import { RGBAImage } from '../core/image';
import { autoQuad, processFacade } from '../core/pipeline';
import type { FromWorker, ToWorker } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const sources = new Map<string, RGBAImage>();
const rectified = new Map<string, RGBAImage>();
const post = (m: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

async function decode(blob: Blob, maxSide: number) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const id = g.getImageData(0, 0, w, h);
  return { img: { w, h, data: id.data } as RGBAImage, scale };
}

async function toJpegBase64(img: RGBAImage, maxSide: number) {
  const s = Math.min(1, maxSide / Math.max(img.w, img.h));
  const src = new OffscreenCanvas(img.w, img.h);
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  const w = Math.round(img.w * s), h = Math.round(img.h * s);
  const dst = new OffscreenCanvas(w, h);
  const g = dst.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.drawImage(src, 0, 0, w, h);
  const blob = await dst.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(bin), w, h };
}

ctx.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'load': {
        const { img, scale } = await decode(msg.blob, msg.maxSourceSide);
        sources.set(msg.id, img);
        post({ type: 'loaded', id: msg.id, w: img.w, h: img.h, scale });
        break;
      }
      case 'auto': {
        const src = sources.get(msg.id);
        if (!src) throw new Error('Image not loaded');
        const a = autoQuad(src);
        post({ type: 'auto', id: msg.id, reqId: msg.reqId, quad: a.quad, confidence: a.confidence, notes: a.notes });
        break;
      }
      case 'process': {
        const src = sources.get(msg.id);
        if (!src) throw new Error('Image not loaded');
        const res = processFacade({
          source: src, quad: msg.quad, quadIsAuto: msg.quadIsAuto, aspect: msg.aspect, ignore: msg.ignore, occluders: msg.occluders, maxSide: msg.maxSide,
          options: msg.options, provider: msg.provider,
          onProgress: (stage, p) => post({ type: 'progress', id: msg.id, reqId: msg.reqId, stage, p }),
        });
        rectified.set(msg.id, res.rectified);
        const copy = new Uint8ClampedArray(res.rectified.data);
        const r = res.rect;
        post({
          type: 'processed', id: msg.id, reqId: msg.reqId, quad: res.quad, quadSource: res.quadSource, located: res.located, autoConfidence: res.autoConfidence,
          rect: { H: r.H, Hinv: r.Hinv, outW: r.outW, outH: r.outH, facade: r.facade, aspect: r.aspect, focalPx: r.focalPx, focalEstimated: r.focalEstimated, confidence: r.confidence, notes: r.notes },
          rectified: { w: res.rectified.w, h: res.rectified.h, data: copy.buffer }, model: res.model, timings: res.timings,
        }, [copy.buffer]);
        break;
      }
      case 'jpeg': {
        const img = rectified.get(msg.id);
        if (!img) throw new Error('Process the image first');
        const j = await toJpegBase64(img, msg.maxSide);
        post({ type: 'jpeg', id: msg.id, reqId: msg.reqId, ...j });
        break;
      }
      case 'drop':
        sources.delete(msg.id); rectified.delete(msg.id);
        break;
    }
  } catch (e) {
    post({ type: 'error', id: msg.id, reqId: 'reqId' in msg ? msg.reqId : undefined, message: e instanceof Error ? e.message : String(e) });
  }
};
