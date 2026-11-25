// Claude vision refiner (optional). Runs in the browser with the user's own API key, which is
// kept in memory (or sessionStorage if the user opts in) and sent only to api.anthropic.com.
import Anthropic from '@anthropic-ai/sdk';
import { RefineRequest, RefineResult, RefinerProvider } from './provider';

import { CLAUDE_MODEL } from './models';

const box = {
  type: 'object',
  properties: { x0: { type: 'integer' }, y0: { type: 'integer' }, x1: { type: 'integer' }, y1: { type: 'integer' } },
  required: ['x0', 'y0', 'x1', 'y1'],
  additionalProperties: false,
};
const KINDS = ['window', 'door', 'portal', 'shopfront'];

const SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: [...KINDS, 'not_an_opening', 'uncertain'] },
          confidence: { type: 'number' },
        },
        required: ['id', 'verdict', 'confidence'],
        additionalProperties: false,
      },
    },
    occluders: {
      type: 'array',
      items: { type: 'object', properties: { kind: { type: 'string' }, box }, required: ['kind', 'box'], additionalProperties: false },
    },
    missed: {
      type: 'array',
      items: { type: 'object', properties: { kind: { type: 'string', enum: KINDS }, box }, required: ['kind', 'box'], additionalProperties: false },
    },
    notes: { type: 'string' },
  },
  required: ['verdicts', 'occluders', 'missed', 'notes'],
  additionalProperties: false,
};

const SYSTEM = `You review the output of a computer-vision pipeline that turns facade photographs into architectural CAD elevations.
The image is a perspective-corrected photo of one building facade. Coordinates are on a 0-1000 grid over the whole image (x to the right, y downward).
For each candidate opening, decide whether it is really a window, door, portal (large or monumental entrance) or shopfront of this facade, or not an opening at all
(a shadow, a sign, a reflection, part of a vehicle, tree or person, or part of a neighbouring building). Use "uncertain" when the photo does not show enough.
List foreground objects that hide parts of the facade (vehicles, trees, people, street furniture, scaffolding) as occluders with tight boxes.
List clearly visible openings of this facade that no candidate covers as missed, with tight boxes on the outer edge of the opening.
Never invent elements the photo does not show; prefer "uncertain" and omissions over guesses. Keep notes to one or two sentences.`;

export function claudeProvider(apiKey: string): RefinerProvider {
  // The key belongs to the person using the app; it is never bundled or sent anywhere else.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return {
    id: 'claude',
    label: `Claude (${CLAUDE_MODEL})`,
    async refine(req: RefineRequest, signal?: AbortSignal): Promise<RefineResult> {
      const prompt = {
        facade: req.facade,
        image_size_px: { width: req.width, height: req.height },
        candidates: req.candidates.map((c) => ({ id: c.id, kind: c.kind, box: c.box, local_confidence: Math.round(c.confidence * 100) / 100 })),
      };
      const response = await client.beta.messages.create(
        {
          model: CLAUDE_MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: req.imageBase64 } },
                { type: 'text', text: `Candidates from the local pipeline (JSON):\n${JSON.stringify(prompt)}` },
              ],
            },
          ],
        },
        { signal },
      );
      if (response.stop_reason === 'refusal') throw new Error('The model declined to review this image.');
      if (response.stop_reason === 'max_tokens') throw new Error('The review was cut off (too many candidates).');
      const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      const parsed = JSON.parse(text) as Omit<RefineResult, 'model'>;
      return { ...parsed, model: response.model };
    },
  };
}
