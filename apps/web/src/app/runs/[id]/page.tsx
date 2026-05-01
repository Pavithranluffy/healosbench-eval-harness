"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, apiBase } from "@/lib/api";
import type { CaseRow, RunSummary } from "@/lib/types";

interface Props { params: Promise<{ id: string }> }

export default function RunDetailPage({ params }: Props) {
  const { id } = use(params);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);

  async function refresh() {
    const [r, cs] = await Promise.all([
      api<RunSummary>(`/api/v1/runs/${id}`),
      api<CaseRow[]>(`/api/v1/runs/${id}/cases`),
    ]);
    setRun(r);
    setCases(cs.sort((a, b) => a.transcript_id.localeCompare(b.transcript_id)));
  }

  useEffect(() => {
    refresh();
    // SSE for live updates as cases complete.
    const es = new EventSource(`${apiBase}/api/v1/runs/${id}/events`);
    es.addEventListener("case", () => refresh());
    es.addEventListener("done", () => refresh());
    return () => es.close();
  }, [id]);

  if (!run) return <div className="p-6">loading…</div>;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4">
        <Link href="/runs" className="underline text-sm">← back</Link>
        <h1 className="text-2xl font-semibold mt-1">{run.id}</h1>
        <div className="text-sm text-zinc-500 flex gap-3 flex-wrap">
          <span>strategy: <b>{run.strategy}</b></span>
          <span>model: <code>{run.model}</code></span>
          <span>prompt_hash: <code>{run.prompt_hash}</code></span>
          <span>status: <b>{run.status}</b></span>
          <span>{run.completed_cases}/{run.total_cases} cases</span>
          <span>cost: ${run.total_cost_usd.toFixed(4)}</span>
          <span>cache_read: {run.total_cache_read.toLocaleString()}</span>
          <span>cache_write: {run.total_cache_write.toLocaleString()}</span>
          <span>halls: {run.hallucination_count}</span>
          <span>schema_invalid: {run.schema_invalid_count}</span>
        </div>
      </div>

      {run.aggregate && (
        <div className="rounded border p-3 mb-4 text-sm grid grid-cols-7 gap-2 font-mono">
          <Cell label="CC" v={run.aggregate.chief_complaint} />
          <Cell label="vitals" v={run.aggregate.vitals} />
          <Cell label="meds F1" v={run.aggregate.medications_f1} />
          <Cell label="dx F1" v={run.aggregate.diagnoses_f1} />
          <Cell label="plan F1" v={run.aggregate.plan_f1} />
          <Cell label="follow_up" v={run.aggregate.follow_up} />
          <Cell label="overall" v={run.aggregate.overall_f1} bold />
        </div>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 pr-2">transcript</th>
            <th>status</th>
            <th>F1</th>
            <th>halls</th>
            <th>schema</th>
            <th>cache_read</th>
            <th>cost</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.case_id} className="border-b hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <td className="py-1 pr-2 font-mono text-xs">{c.transcript_id}</td>
              <td>{c.status}</td>
              <td>{c.aggregate_f1?.toFixed(3) ?? "—"}</td>
              <td className={c.hallucinations.length > 0 ? "text-amber-600" : ""}>
                {c.hallucinations.length}
              </td>
              <td className={c.schema_invalid ? "text-red-600" : ""}>
                {c.schema_invalid ? "INVALID" : "ok"}
              </td>
              <td>{c.cache_read.toLocaleString()}</td>
              <td>${c.cost_usd.toFixed(5)}</td>
              <td>
                <Link className="underline" href={`/runs/${id}/case/${c.case_id}`}>view →</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ label, v, bold }: { label: string; v: number; bold?: boolean }) {
  const color = v >= 0.8 ? "text-green-600" : v >= 0.5 ? "text-amber-600" : "text-red-600";
  return (
    <div className={`flex flex-col p-2 rounded border ${bold ? "border-black" : ""}`}>
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-base ${color} ${bold ? "font-bold" : ""}`}>{v.toFixed(3)}</span>
    </div>
  );
}
