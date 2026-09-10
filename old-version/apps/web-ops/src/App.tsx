import { useEffect, useState } from 'react';
import { ops, type JobStatus, type SchedRow } from './api.js';

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    ops.me().then(
      () => setAuthed(true),
      () => setAuthed(false),
    );
  }, []);
  if (authed === null) return <div className="wrap">…</div>;
  return <div className="wrap">{authed ? <Dashboard onLogout={() => setAuthed(false)} /> : <Login onIn={() => setAuthed(true)} />}</div>;
}

function Login({ onIn }: { onIn: () => void }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await ops.login(u, p);
          onIn();
        } catch (e) {
          setErr((e as Error).message || 'login failed');
        }
      }}
    >
      <h1>Ops plane — internal</h1>
      <p>
        <input placeholder="username" value={u} onChange={(e) => setU(e.target.value)} />{' '}
        <input placeholder="password" type="password" value={p} onChange={(e) => setP(e.target.value)} />{' '}
        <button>Sign in</button>
      </p>
      {err && <p className="bad">{err}</p>}
    </form>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [schedules, setSchedules] = useState<SchedRow[]>([]);
  const [note, setNote] = useState('');

  const refresh = () => {
    ops.jobs().then((r) => setJobs(r.jobs));
    ops.schedules().then((r) => setSchedules(r.schedules));
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <h1>
        Industrial RAG — Ops{' '}
        <button
          onClick={async () => {
            await ops.logout();
            onLogout();
          }}
        >
          sign out
        </button>{' '}
        <a href="http://localhost:8888" target="_blank" rel="noreferrer">
          Hindsight Control Plane ↗
        </a>
      </h1>

      <h2>Job health</h2>
      <table>
        <thead>
          <tr>
            <th>job</th>
            <th>state</th>
            <th>last run</th>
            <th>pending</th>
            <th>note</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((jb) => (
            <tr key={jb.jobName}>
              <td>{jb.jobName}</td>
              <td className={jb.healthy ? 'ok' : 'bad'}>{jb.healthy ? 'healthy' : 'unhealthy'}</td>
              <td>
                {jb.lastRun
                  ? `${new Date(jb.lastRun.startedAt).toLocaleString()} · ${jb.lastRun.status}`
                  : '—'}
              </td>
              <td>{jb.lastRun?.pendingCount ?? '—'}</td>
              <td className="bad">{jb.reason ?? jb.lastRun?.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: 12 }}>
        <button
          onClick={async () => {
            setNote('starting ingestion…');
            try {
              const r = await ops.runIngest();
              setNote(`ingestion started (pid ${r.pid ?? '?'}) — refresh in a few seconds`);
            } catch (e) {
              setNote(`failed: ${(e as Error).message}`);
            }
          }}
        >
          Retry / run ingestion now
        </button>{' '}
        <span>{note}</span>
      </p>

      <h2>Report scheduler — per user</h2>
      <table>
        <thead>
          <tr>
            <th>user</th>
            <th>query</th>
            <th>time</th>
            <th>active</th>
            <th>last run</th>
            <th>last result</th>
            <th>next run</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => (
            <tr key={s.id}>
              <td>{s.userId.slice(0, 8)}</td>
              <td>{s.queryText}</td>
              <td>
                {s.timeOfDay} {s.timezone}
              </td>
              <td>{s.active ? 'yes' : 'no'}</td>
              <td>{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '—'}</td>
              <td className={s.lastResult === 'error' ? 'bad' : 'ok'}>{s.lastResult ?? '—'}</td>
              <td>{s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '—'}</td>
            </tr>
          ))}
          {schedules.length === 0 && (
            <tr>
              <td colSpan={7}>no schedules</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
