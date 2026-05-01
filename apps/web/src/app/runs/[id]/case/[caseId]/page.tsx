"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface Attempt {
  id: string;
  attempt: number;
  schemaValid: boolean;
  validationErrors: string[];
  request: unknown;
  response: unknown;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  durationMs: number;
}

interface CaseDetail {
  case: {
    case_id: string;
    transcript_id: string;
    prediction: unknown;
    scores: unknown;
    aggregate_f1: number | null;
    schema_invalid: boolean;
    hallucinations: Array<{ field_path: string; value: string; reason: string }>;
  };
  attempts: Attempt[];
}

interface TranscriptResp {
  id: string;
  transcript: string;
  gold: unknown;
}

interface Props { params: Promise<{ id: string; caseId: string }> }

export default function CaseDetailPage({ params }: Props) {
  const { id, caseId } = use(params);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResp | null>(null);

  useEffect(() => {
    api<CaseDetail>(`/api/v1/runs/cases/${caseId}`).then((d) => {
      setDetail(d);
      api<TranscriptResp>(`/api/v1/transcripts/${d.case.transcript_id}`).then(setTranscript);
    });
  }, [caseId]);

  if (!detail || !transcript) return <div className="p-6">loading…</div>;

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      <Link href={`/runs/${id}`} className="underline text-sm">← back to run</Link>
      <h1 className="text-2xl font-semibold mt-1 mb-3">{detail.case.transcript_id}</h1>
      <div className="text-sm mb-3 flex gap-4">
        <span>F1: <b>{detail.case.aggregate_f1?.toFixed(3) ?? "—"}</b></span>
        <span>schema: <b className={detail.case.schema_invalid ? "text-red-600" : "text-green-600"}>{detail.case.schema_invalid ? "INVALID" : "valid"}</b></span>
        <span>halls: <b className={detail.case.hallucinations.length ? "text-amber-600" : ""}>{detail.case.hallucinations.length}</b></span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Section title="Transcript">
          <Highlighted transcript={transcript.transcript} prediction={detail.case.prediction} />
        </Section>
        <Section title="Gold">
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(transcript.gold, null, 2)}</pre>
        </Section>
        <Section title="Prediction">
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(detail.case.prediction, null, 2)}</pre>
        </Section>
      </div>

      {detail.case.hallucinations.length > 0 && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950">
          <b>Hallucinations</b>
          <ul className="list-disc pl-5 mt-1">
            {detail.case.hallucinations.map((h, i) => (
              <li key={i}><code>{h.field_path}</code>: <b>{h.value}</b> — {h.reason}</li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="text-lg font-semibold mt-6 mb-2">LLM trace ({detail.attempts.length} attempts)</h2>
      {detail.attempts.map((a) => (
        <div key={a.id} className="border rounded p-3 mb-2 text-xs">
          <div className="flex justify-between mb-1">
            <span>attempt {a.attempt} · {a.schemaValid ? "✓ schema valid" : "✗ schema invalid"} · {a.durationMs}ms</span>
            <span className="font-mono">in:{a.tokensIn} out:{a.tokensOut} cache_read:{a.cacheRead} cache_write:{a.cacheWrite}</span>
          </div>
          {a.validationErrors.length > 0 && (
            <div className="text-red-600">
              {a.validationErrors.map((e, i) => <div key={i}>• {e}</div>)}
            </div>
          )}
          <details className="mt-1">
            <summary className="cursor-pointer">request / response</summary>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <pre className="bg-zinc-100 dark:bg-zinc-900 p-2 overflow-auto max-h-96">{JSON.stringify(a.request, null, 2)}</pre>
              <pre className="bg-zinc-100 dark:bg-zinc-900 p-2 overflow-auto max-h-96">{JSON.stringify(a.response, null, 2)}</pre>
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border p-3">
      <h3 className="font-semibold mb-2 text-sm">{title}</h3>
      {children}
    </div>
  );
}

/**
 * Highlight transcript spans that match leaf-string values in the prediction.
 * Simple substring scan over the most informative leaf strings.
 */
function Highlighted({ transcript, prediction }: { transcript: string; prediction: unknown }) {
  const leaves: string[] = [];
  const walk = (v: unknown) => {
    if (v == null) return;
    if (typeof v === "string") leaves.push(v);
    else if (typeof v === "number") leaves.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(prediction);

  const hits = leaves
    .filter((s) => s.length >= 3)
    .map((s) => ({ s, idx: transcript.toLowerCase().indexOf(s.toLowerCase()) }))
    .filter((h) => h.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  if (hits.length === 0) {
    return <pre className="text-xs whitespace-pre-wrap">{transcript}</pre>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.idx < cursor) continue;
    parts.push(transcript.slice(cursor, h.idx));
    parts.push(<mark key={`${h.idx}-${h.s}`} className="bg-yellow-200 dark:bg-yellow-700">{transcript.slice(h.idx, h.idx + h.s.length)}</mark>);
    cursor = h.idx + h.s.length;
  }
  parts.push(transcript.slice(cursor));
  return <pre className="text-xs whitespace-pre-wrap">{parts}</pre>;
}
