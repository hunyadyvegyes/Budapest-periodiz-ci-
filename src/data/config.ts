/**
 * Futásidejű beállítások: public/config.json (a közzétett weboldalon is szerkeszthető),
 * ennek híján a build idejű környezeti változók (.env.local).
 *
 * A Supabase „publishable” (anon) kulcsa nyilvános, böngészőbe szánt kulcs: a hozzáférést
 * az adatbázis jogosultsági szabályai (supabase/setup.sql) védik. A titkos (service_role / secret)
 * kulcs SOHA nem kerülhet ide.
 */
export interface AtlasConfig {
  supabaseUrl?: string;
  supabaseKey?: string;
  siteTitle?: string;
}

let cached: Promise<AtlasConfig> | null = null;

export function loadConfig(): Promise<AtlasConfig> {
  if (cached) return cached;
  cached = (async () => {
    let file: AtlasConfig = {};
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' });
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) file = await r.json();
    } catch { /* nincs config.json */ }
    return {
      supabaseUrl: file.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || undefined,
      supabaseKey: file.supabaseKey || import.meta.env.VITE_SUPABASE_ANON_KEY || undefined,
      siteTitle: file.siteTitle,
    };
  })();
  return cached;
}
