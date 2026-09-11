import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useState, useRef } from 'react';
import { api } from '../lib/api.js';

export function Login({ onDone }: { onDone: () => void }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [6, -6]), { stiffness: 120, damping: 14 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-8, 8]), { stiffness: 120, damping: 14 });

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => { mx.set(0); my.set(0); };

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
      {/* ambient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[18%] top-[18%] h-[420px] w-[420px] rounded-full blur-[90px]" style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', opacity: 0.9 }} />
        <div className="absolute bottom-[12%] right-[12%] h-[360px] w-[360px] rounded-full blur-[80px]" style={{ background: 'color-mix(in srgb, var(--ok) 14%, transparent)', opacity: 0.7 }} />
      </div>
      <motion.form
        ref={ref as any}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onSubmit={submit}
        initial={{ opacity: 0, y: 28, rotateX: 10 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ type: 'spring', stiffness: 120, damping: 16 }}
        style={{ rotateX: rx as any, rotateY: ry as any, transformStyle: 'preserve-3d' as any }}
        className="card card-raise flash relative w-full max-w-sm p-7"
      >
        {/* glow edge */}
        <div className="pointer-events-none absolute -inset-[1px] rounded-[16px] opacity-60" style={{ background: `linear-gradient(120deg, transparent 20%, color-mix(in srgb, var(--accent) 22%, transparent) 50%, transparent 80%)`, filter: 'blur(14px)' }} />
        <div className="relative" style={{ transform: 'translateZ(22px)' }}>
          <div className="mb-1 flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-lg text-[13px] font-black" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', boxShadow: '0 8px 20px var(--accent-glow)' }}>LA</span>
            Line Assistant
          </div>
          <p className="muted mb-5 text-[13px]">Sign in to continue — 3D glass, mock ready.</p>

          <label className="mb-1 block text-[13px] font-semibold">Username</label>
          <input className="input input-glass mb-3" value={username} onChange={(e) => setU(e.target.value)} autoFocus />

          <label className="mb-1 block text-[13px] font-semibold">Password</label>
          <input className="input input-glass mb-4" type="password" value={password} onChange={(e) => setP(e.target.value)} />

          {err && <div className="mb-3 rounded-lg border px-3 py-2 text-[13px]" style={{ color: 'var(--warn)', borderColor: 'color-mix(in srgb, var(--warn) 30%, transparent)', background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>{err}</div>}

          <button className="btn btn-primary w-full flash" disabled={busy || !username || !password} style={{ transform: 'translateZ(12px)' }}>
            {busy ? 'Signing in…' : 'Sign in →'}
          </button>
          <div className="muted mt-3 text-center text-[11px]">Demo: demo / demo12345 · Asia/Tokyo</div>
        </div>
      </motion.form>
    </div>
  );
}
