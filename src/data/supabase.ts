import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from './config';

let client: Promise<SupabaseClient | null> | null = null;

/** A Supabase-kliens (lustán betöltve, hogy online adatbázis nélkül ne növelje a letöltést). */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (client) return client;
  client = (async () => {
    const cfg = await loadConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseKey) return null;
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  })();
  return client;
}

export interface EditorSession {
  email: string;
}

export async function currentSession(): Promise<EditorSession | null> {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user?.email ? { email: data.session.user.email } : null;
}

export async function signIn(email: string, password: string): Promise<EditorSession> {
  const sb = await getSupabase();
  if (!sb) throw new Error('Nincs beállítva online adatbázis.');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message.includes('Invalid login') ? 'Hibás e-mail-cím vagy jelszó.' : error.message);
  return { email: data.user?.email ?? email };
}

export async function signOut(): Promise<void> {
  const sb = await getSupabase();
  await sb?.auth.signOut();
}

export async function onAuthChange(cb: (s: EditorSession | null) => void) {
  const sb = await getSupabase();
  sb?.auth.onAuthStateChange((_e, session) => cb(session?.user?.email ? { email: session.user.email } : null));
}
