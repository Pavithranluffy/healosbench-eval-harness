"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">HEALOSBENCH</h1>
      <p className="text-zinc-500 mb-6">
        Eval harness for structured clinical extraction. Synthetic data only.
      </p>
      <ul className="grid gap-3">
        <li className="rounded-lg border p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900">
          <Link href="/runs" className="font-semibold text-lg">Runs</Link>
          <p className="text-sm text-zinc-500">Start a run, watch progress, drill into cases.</p>
        </li>
        <li className="rounded-lg border p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900">
          <Link href="/compare" className="font-semibold text-lg">Compare</Link>
          <p className="text-sm text-zinc-500">Per-field deltas with winners — the "should we ship this prompt?" view.</p>
        </li>
      </ul>
    </div>
  );
}
