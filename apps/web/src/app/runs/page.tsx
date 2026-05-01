"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { RunSummary, Strategy } from "@/lib/types";
import { buttonVariants } from "@test-evals/ui/components/button";
import { cn } from "@test-evals/ui/lib/utils";

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
    } catch (e) {
      console.error(e);
      alert("Failed to start run. Make sure the server is running and you are signed in if required.");
    } finally {
      setBusy(false);
    }
  }

  const bestF1 = Math.max(...runs.map((r) => r.aggregate?.overall_f1 ?? 0), 0);
  const totalCost = runs.reduce((acc, r) => acc + r.total_cost_usd, 0);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Evaluation Dashboard</h1>
          <p className="text-zinc-500">Structured clinical extraction benchmarking</p>
        </div>
        <Link
          href="/compare"
          className={cn(
            buttonVariants({ variant: "secondary" }),
            "rounded-lg transition-colors px-4 py-2 text-sm font-medium"
          )}
        >
          Compare Strategies →
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="border rounded-xl p-6 bg-white dark:bg-zinc-950 shadow-sm">
          <div className="text-sm text-zinc-500 mb-1">Total Runs</div>
          <div className="text-3xl font-bold">{runs.length}</div>
        </div>
        <div className="border rounded-xl p-6 bg-white dark:bg-zinc-950 shadow-sm">
          <div className="text-sm text-zinc-500 mb-1">Best Overall F1</div>
          <div className="text-3xl font-bold text-green-600">{bestF1.toFixed(3)}</div>
        </div>
        <div className="border rounded-xl p-6 bg-white dark:bg-zinc-950 shadow-sm">
          <div className="text-sm text-zinc-500 mb-1">Total Budget Spent</div>
          <div className="text-3xl font-bold">${totalCost.toFixed(4)}</div>
        </div>
      </div>

      <div className="rounded-xl border bg-zinc-50/50 dark:bg-zinc-900/50 p-6 mb-8">
        <h3 className="font-semibold mb-4">Start New Evaluation</h3>
        <div className="flex flex-wrap gap-4 items-end">
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
    </div>

    <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b text-zinc-500 font-medium">
              <th className="py-4 pr-4">Run ID</th>
              <th className="py-4">Strategy</th>
              <th className="py-4">Model</th>
              <th className="py-4">Status</th>
              <th className="py-4">Progress</th>
              <th className="py-4">Overall F1</th>
              <th className="py-4">Cost</th>
              <th className="py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b hover:bg-zinc-50/80 dark:hover:bg-zinc-900/80 transition-colors">
                <td className="py-4 pr-4 font-mono text-xs">{r.id}</td>
                <td className="py-4 capitalize">{r.strategy.replace("_", " ")}</td>
                <td className="py-4 font-mono text-[10px] text-zinc-500">{r.model}</td>
                <td className="py-4">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                    r.status === "completed" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                  }`}>
                    {r.status}
                  </span>
                </td>
                <td className="py-4 text-zinc-600">{r.completed_cases}/{r.total_cases}</td>
                <td className="py-4 font-bold">{r.aggregate?.overall_f1?.toFixed(3) ?? "—"}</td>
                <td className="py-4 text-zinc-500">${r.total_cost_usd.toFixed(4)}</td>
                <td className="py-4 text-right">
                  <Link className="text-black dark:text-white font-medium hover:underline" href={`/runs/${r.id}`}>
                    Details →
                  </Link>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-zinc-400 italic">
                  No evaluation runs found. Start your first run above!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
