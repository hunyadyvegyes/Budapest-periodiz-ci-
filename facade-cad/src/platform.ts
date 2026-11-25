// Host adapter: the same build runs as a normal web app and as a claude.ai Artifact.
// Inside an Artifact, files are saved through the `downloads` capability (normal <a download>
// links are inert there) and AI review uses the `sample` capability (no API key needed).
import { RefineRequest, RefineResult, RefinerProvider } from './ai/provider';

type Use = (name: string) => Promise<any>;
const use: Use | null = (() => {
  const c = (globalThis as any).claude;
  return c && typeof c.use === 'function' ? (n: string) => c.use(n) : null;
})();

export const inArtifact = !!use;
const cap = (name: string): Promise<any> => (use ? use(name).catch(() => null) : Promise.resolve(null));

// ------------------------------------------------------------------ zip (store only)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Minimal ZIP (no compression) – enough to carry a .dxf through hosts that only accept common types. */
export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// ------------------------------------------------------------------ saving files

const ALLOWED = /\.(svg|pdf|png|json|zip|txt|csv)$/i;

/** Save a generated file. Returns a short status message for the UI. */
export async function saveFile(filename: string, data: string | Uint8Array | Blob): Promise<string> {
  const downloads = await cap('downloads');
  if (downloads) {
    let name = filename, payload: string | Uint8Array | Blob = data;
    if (!ALLOWED.test(name)) {
      // e.g. .dxf: deliver it inside a zip
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
      payload = zip([{ name, data: bytes }]);
      name = `${name}.zip`;
    }
    try {
      await downloads.save({ filename: name, data: payload });
      return name === filename ? `Saved ${name}` : `Saved ${name} (contains ${filename})`;
    } catch (e: any) {
      if (e?.code === 'declined') return 'Save cancelled';
      return `Could not save here (${e?.code ?? 'unavailable'})`;
    }
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return `Downloaded ${filename}`;
}

// ------------------------------------------------------------------ built-in Claude (artifact)

export async function hostedRefiner(): Promise<RefinerProvider | null> {
  const sample = await cap('sample');
  if (!sample) return null;
  const limits = await sample.limits?.().catch(() => null);
  if (!limits?.images) return null;
  return {
    id: 'claude-hosted',
    label: 'Claude (built in)',
    async refine(req: RefineRequest): Promise<RefineResult> {
      const bytes = Uint8Array.from(atob(req.imageBase64), (c) => c.charCodeAt(0));
      const image = new Blob([bytes], { type: 'image/jpeg' });
      const prompt = `You review the output of a computer-vision pipeline that turns facade photographs into architectural CAD elevations.
The attached image is a perspective-corrected photo of one building facade. Coordinates are on a 0-1000 grid over the whole image (x right, y down).
For each candidate opening decide: "window", "door", "portal" (large/monumental entrance), "shopfront", "not_an_opening" (shadow, sign, reflection, part of a vehicle/tree/person or of a neighbouring building) or "uncertain".
List foreground objects hiding the facade (vehicles, trees, people, street furniture) as occluders with tight boxes.
List clearly visible openings of this facade that no candidate covers as "missed", with tight boxes on the outer edge.
Never invent elements the photo does not show.
Reply with only JSON of this shape:
{"verdicts":[{"id":"o1","verdict":"window","confidence":0.9}],"occluders":[{"kind":"car","box":{"x0":0,"y0":0,"x1":10,"y1":10}}],"missed":[{"kind":"window","box":{"x0":0,"y0":0,"x1":10,"y1":10}}],"notes":"one sentence"}

Facade region: ${JSON.stringify(req.facade)}
Candidates: ${JSON.stringify(req.candidates.map((c) => ({ id: c.id, kind: c.kind, box: c.box, local_confidence: Math.round(c.confidence * 100) / 100 })))}`;
      const r = await sample.json(prompt, { images: [image], modelTier: 'complex' });
      return {
        verdicts: Array.isArray(r?.verdicts) ? r.verdicts : [],
        occluders: Array.isArray(r?.occluders) ? r.occluders : [],
        missed: Array.isArray(r?.missed) ? r.missed : [],
        notes: typeof r?.notes === 'string' ? r.notes : '',
        model: 'Claude (built in)',
      };
    },
  };
}
