import type { Plugin } from 'vite';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Helyi adatmentés a fejlesztői szerveren keresztül.
 * GET/PUT /api/sajat-adatok  ↔  public/data/sajat-modositasok.json
 *
 * Így a böngészőben felvitt / módosított épületek a projekt mappájába kerülnek
 * (nem vesznek el böngészőváltáskor), és a statikus buildbe is bekerülnek.
 * Csak a helyi gépen futó `npm run dev` / `npm run preview` alatt aktív.
 */
export default function localData(): Plugin {
  const file = resolve(__dirname, 'public/data/sajat-modositasok.json');
  const handler = (req: any, res: any, next: () => void) => {
    if (!req.url?.startsWith('/api/sajat-adatok')) return next();
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(existsSync(file) ? readFileSync(file, 'utf8') : JSON.stringify({ upserts: {}, deleted: [] }));
      return;
    }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (c: Buffer) => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (typeof data !== 'object' || !data.upserts || !Array.isArray(data.deleted)) throw new Error('hibás formátum');
          mkdirSync(dirname(file), { recursive: true });
          const tmp = file + '.tmp';
          writeFileSync(tmp, JSON.stringify(data, null, 1));
          renameSync(tmp, file); // atomikus csere – félbeszakadt írás nem rontja el a fájlt
          res.statusCode = 204;
          res.end();
        } catch (e) {
          res.statusCode = 400;
          res.end(String(e));
        }
      });
      return;
    }
    res.statusCode = 405;
    res.end();
  };
  return {
    name: 'bp-atlasz-local-data',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}
