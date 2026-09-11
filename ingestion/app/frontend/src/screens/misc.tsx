import { Link } from "react-router-dom";

export function Placeholder({ code, name, verdict }: { code: string; name: string; verdict: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{verdict}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">
        {code} · {name} — built in the next slice.
      </p>
      <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-ink-700">
        <div className="font-semibold">Coming next</div>
        <p className="mt-1 text-sm text-slate-500">
          Definition locked in <span className="font-mono text-xs">feature-definition/</span>.
        </p>
      </div>
    </div>
  );
}

export function Home() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Ingestion platform</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">isolated app · merges into the bigger app later</p>
      <div className="mt-6 grid max-w-2xl grid-cols-2 gap-4">
        <Link to="/setter/connections" className="rounded-xl border border-slate-200 p-6 hover:border-accent-500 dark:border-ink-800">
          <div className="font-bold">Setter console</div>
          <div className="mt-1 text-sm text-slate-500">F1–F5: connections, lines, cards, history, Hindsight</div>
        </Link>
        <div className="rounded-xl border border-dashed border-slate-300 p-6 opacity-60 dark:border-ink-700">
          <div className="font-bold">Main app</div>
          <div className="mt-1 text-sm text-slate-500">plant users · placeholder for the merge</div>
        </div>
      </div>
    </div>
  );
}
