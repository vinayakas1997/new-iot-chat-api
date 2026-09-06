import { motion } from 'framer-motion';
import { useState } from 'react';
import { api } from '../lib/api.js';

export function Login({ onDone }: { onDone: () => void }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.login(username.trim(), password);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scene grid h-full place-items-center px-4">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 24, rotateX: 8 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ type: 'spring', stiffness: 120, damping: 16 }}
        className="card card-raise tilt w-full max-w-sm p-7"
      >
        <div className="mb-1 text-lg font-bold tracking-tight">Line Assistant</div>
        <p className="muted mb-5 text-[13px]">Sign in to continue.</p>

        <label className="mb-1 block text-[13px] font-semibold">Username</label>
        <input className="input mb-3" value={username} onChange={(e) => setU(e.target.value)} autoFocus />

        <label className="mb-1 block text-[13px] font-semibold">Password</label>
        <input
          className="input mb-4"
          type="password"
          value={password}
          onChange={(e) => setP(e.target.value)}
        />

        {err && <div className="mb-3 text-[13px]" style={{ color: 'var(--warn)' }}>{err}</div>}

        <button className="btn btn-primary w-full" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </motion.form>
    </div>
  );
}
