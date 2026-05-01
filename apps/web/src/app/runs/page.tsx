"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { RunSummary, Strategy } from "@/lib/types";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [strategy, setStrategy] = useState<Strategy>("zero_shot");
  const [model, setModel] = useState("claude-haiku-4-5-20251001");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setRuns(await api<RunSummary[]>("/api/v1/runs"));
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  async function start() {
    setBusy(true);
    try {
      await api<{ run_id: string }>("/api/v1/runs", {
        method: "POST",
        body: JSON.stringify({ strategy, model }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Eval Runs</h1>
        <Link href="/compare" className="underline text-sm">Compare two runs →</Link>
      </div>

      <div className="rounded-lg border p-4 mb-6 flex flex-wrap gap-2 items-end">
        <label className="flex flex-col text-xs">
          strategy
          <select
            className="border rounded px-2 py-1"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as Strategy)}
          >
            <option value="zero_shot">zero_shot</option>
            <option value="few_shot">few_shot</option>
            <option value="cot">cot</option>
          </select>
        </label>
        <label className="flex flex-col text-xs">
          model
          <input
            className="border rounded px-2 py-1 w-72"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <button
          className="bg-black text-white rounded px-4 py-1 disabled:opacity-50"
          onClick={start}
          disabled={busy}
        >
          {busy ? "starting…" : "Start run"}
        </button>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 pr-2">id</th>
            <th>strategy</th>
            <th>model</th>
            <th>prompt_hash</th>
            <th>status</th>
            <th>cases</th>
            <th>F1</th>
            <th>cost</th>
            <th>cache_read</th>
            <th>duration</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <td className="py-1 pr-2"><Link className="underline" href={`/runs/${r.id}`}>{r.id}</Link></td>
              <td>{r.strategy}</td>
              <td className="font-mono text-xs">{r.model}</td>
              <td className="font-mono text-xs">{r.prompt_hash}</td>
              <td>{r.status}</td>
              <td>{r.completed_cases}/{r.total_cases}</td>
              <td>{r.aggregate?.overall_f1?.toFixed(3) ?? "—"}</td>
              <td>${r.total_cost_usd.toFixed(4)}</td>
              <td>{r.total_cache_read.toLocaleString()}</td>
              <td>{(r.duration_ms / 1000).toFixed(1)}s</td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={10} className="text-center py-6 text-zinc-500">
                No runs yet — start one above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
