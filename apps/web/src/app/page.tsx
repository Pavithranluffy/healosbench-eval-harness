"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-4xl font-bold mb-4 tracking-tight">HEALOSBENCH</h1>
      <p className="text-zinc-500 text-lg mb-10">
        Professional evaluation harness for structured clinical extraction.
        <br />
        <span className="text-sm italic opacity-75">Demo Mode: No login required to view pre-populated results.</span>
      </p>
      <ul className="grid gap-4">
        <li>
          <Link href="/runs" className="block rounded-xl border-2 p-6 hover:border-black hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all group">
            <div className="font-bold text-xl mb-1 group-hover:underline">View Evaluation Runs →</div>
            <p className="text-zinc-500">Start new evaluations, monitor progress in real-time, and drill into individual cases.</p>
          </Link>
        </li>
        <li>
          <Link href="/compare" className="block rounded-xl border-2 p-6 hover:border-black hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all group">
            <div className="font-bold text-xl mb-1 group-hover:underline">Compare Strategies →</div>
            <p className="text-zinc-500">Analyze per-field deltas and determine which prompt strategy (Zero-Shot, Few-Shot, CoT) is superior.</p>
          </Link>
        </li>
      </ul>
    </div>
  );
}
