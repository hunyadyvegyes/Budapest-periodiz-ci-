import { useState } from 'react';
import { useStore } from '../state/store';

export default function LoginDialog() {
  const open = useStore((s) => s.loginOpen);
  const setOpen = useStore((s) => s.setLoginOpen);
  const signIn = useStore((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      setPassword('');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <form className="modal login" role="dialog" aria-modal="true" aria-label="Bejelentkezés" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="modal-head">
          <div>
            <div className="bp-kicker">Szerkesztőknek</div>
            <h2>Bejelentkezés</h2>
          </div>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Bezárás">✕</button>
        </header>
        <div className="modal-body form">
          <p className="muted">Az atlaszt bárki böngészheti; épületet felvenni és szerkeszteni bejelentkezve lehet.</p>
          <label>E-mail-cím<input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Jelszó<input id="login-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <p className="form-error block">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn" onClick={() => setOpen(false)}>Mégse</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Belépés…' : 'Belépés'}</button>
        </footer>
      </form>
    </div>
  );
}
