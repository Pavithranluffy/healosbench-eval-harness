"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { CompareResult, RunSummary } from "@/lib/types";

export default function ComparePage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const [data, setData] = useState<CompareResult | null>(null);

  useEffect(() => { api<RunSummary[]>("/api/v1/runs").then(setRuns); }, []);

  useEffect(() => {
    if (!a || !b) { setData(null); return; }
    api<CompareResult>(`/api/v1/compare?a=${a}&b=${b}`).then(setData).catch(() => setData(null));
  }, [a, b]);

  const completed = useMemo(() => runs.filter((r) => r.aggregate), [runs]);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="flex justify-between mb-4">
        <h1 className="text-2xl font-semibold">Compare runs</h1>
        <Link href="/runs" className="underline text-sm">← all runs</Link>
      </div>

      <div className="rounded-lg border p-3 mb-4 grid grid-cols-2 gap-3">
        <RunPicker label="Run A" runs={completed} value={a} onChange={setA} />
        <RunPicker label="Run B" runs={completed} value={b} onChange={setB} />
      </div>

      {!data && <p className="text-sm text-zinc-500">Pick two completed runs to compare.</p>}

      {data && (
        <>
          <div className="mb-4 text-sm flex gap-4 flex-wrap">
            <span><b>A:</b> {data.run_a.strategy} · <code>{data.run_a.prompt_hash}</code> · ${data.run_a.total_cost_usd.toFixed(4)}</span>
            <span><b>B:</b> {data.run_b.strategy} · <code>{data.run_b.prompt_hash}</code> · ${data.run_b.total_cost_usd.toFixed(4)}</span>
            <span>Overall winner: <b className={badge(data.overall_winner)}>{data.overall_winner.toUpperCase()}</b></span>
          </div>

          <h2 className="text-lg font-semibold mb-2">Per-field deltas</h2>
          <table className="w-full text-sm border-collapse mb-6">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">field</th>
                <th>A</th>
                <th>B</th>
                <th>Δ (B−A)</th>
                <th>winner</th>
              </tr>
            </thead>
            <tbody>
              {data.per_field.map((f) => (
                <tr key={f.field} className="border-b">
                  <td className="py-1 pr-2 font-mono">{f.field}</td>
                  <td>{f.a.toFixed(3)}</td>
                  <td>{f.b.toFixed(3)}</td>
                  <td className={f.delta > 0 ? "text-green-600" : f.delta < 0 ? "text-red-600" : ""}>
                    {f.delta > 0 ? "+" : ""}{f.delta.toFixed(3)}
                    <Bar delta={f.delta} />
                  </td>
                  <td className={badge(f.winner)}>{f.winner.toUpperCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="text-lg font-semibold mb-2">Per-case deltas</h2>
          <p className="text-xs text-zinc-500 mb-2">
            Cases where A and B disagree most are surfaced first — these are the cases most worth re-annotating or tightening prompts on.
          </p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">transcript</th>
                <th>A F1</th>
                <th>B F1</th>
                <th>Δ</th>
                <th>winner</th>
              </tr>
            </thead>
            <tbody>
              {[...data.per_case]
                .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
                .map((c) => (
                  <tr key={c.case_id} className="border-b">
                    <td className="py-1 pr-2 font-mono text-xs">{c.case_id}</td>
                    <td>{c.a_f1?.toFixed(3) ?? "—"}</td>
                    <td>{c.b_f1?.toFixed(3) ?? "—"}</td>
                    <td className={c.delta > 0 ? "text-green-600" : c.delta < 0 ? "text-red-600" : ""}>
                      {c.delta > 0 ? "+" : ""}{c.delta.toFixed(3)}
                    </td>
                    <td className={badge(c.winner)}>{c.winner.toUpperCase()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function RunPicker({ label, runs, value, onChange }: {
  label: string; runs: RunSummary[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col text-xs">
      {label}
      <select className="border rounded px-2 py-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— pick —</option>
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {r.strategy} · {r.id.slice(-6)} · F1={r.aggregate?.overall_f1.toFixed(3)} · ${r.total_cost_usd.toFixed(4)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Bar({ delta }: { delta: number }) {
  const w = Math.min(100, Math.abs(delta) * 200);
  const color = delta > 0 ? "bg-green-500" : "bg-red-500";
  return <span className="inline-block ml-2 align-middle h-1.5 w-24 bg-zinc-200 rounded relative">
    <span className={`absolute top-0 ${delta >= 0 ? "left-1/2" : "right-1/2"} h-full ${color}`} style={{ width: `${w / 2}%` }} />
  </span>;
}

function badge(w: "a" | "b" | "tie"): string {
  if (w === "a") return "text-blue-600";
  if (w === "b") return "text-purple-600";
  return "text-zinc-500";
}
