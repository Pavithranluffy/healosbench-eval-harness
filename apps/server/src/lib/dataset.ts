import { readdir, readFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import type { ClinicalExtraction } from "@test-evals/shared";

export interface Case {
  id: string;
  transcript: string;
  gold: ClinicalExtraction;
}

/**
 * Resolves the data directory by walking up from cwd until we find one that
 * contains transcripts/ + gold/ — works whether the CLI is run from repo root,
 * apps/server, or compiled output.
 */
export async function resolveDataDir(start = process.cwd()): Promise<string> {
  const fs = await import("node:fs");
  let cur = start;
  for (let i = 0; i < 6; i++) {
    const candidate = join(cur, "data");
    if (fs.existsSync(join(candidate, "transcripts")) && fs.existsSync(join(candidate, "gold"))) {
      return candidate;
    }
    const parent = join(cur, "..");
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(`Could not find data/ directory starting from ${start}`);
}

export async function loadCases(filter?: string[] | null): Promise<Case[]> {
  const dataDir = await resolveDataDir();
  const tDir = join(dataDir, "transcripts");
  const gDir = join(dataDir, "gold");

  const transcriptFiles = (await readdir(tDir)).filter((f) => f.endsWith(".txt")).sort();

  const cases: Case[] = [];
  for (const f of transcriptFiles) {
    const id = basename(f, extname(f));
    if (filter && filter.length > 0 && !filter.includes(id)) continue;
    const transcript = await readFile(join(tDir, f), "utf-8");
    const goldRaw = await readFile(join(gDir, `${id}.json`), "utf-8");
    const gold = JSON.parse(goldRaw) as ClinicalExtraction;
    cases.push({ id, transcript, gold });
  }
  return cases;
}
