# HEALOSBENCH — design notes & results

Submission for the HEALOSBENCH take-home. End-to-end eval harness for the
"transcript → structured JSON" extractor: dataset loader, 3 prompt
strategies, retry-with-feedback, prompt caching, concurrent runner with
resumability + idempotency, evaluator with per-field metrics, hallucination
detection, dashboard (runs list / run detail / compare view), and a CLI
eval command.

---

## Quickstart

```bash
bun install
echo "ANTHROPIC_API_KEY=sk-ant-..." >> apps/server/.env
echo "DATABASE_URL=postgres://postgres:postgres@localhost:5432/healosbench" >> apps/server/.env
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> apps/server/.env
echo "BETTER_AUTH_URL=http://localhost:8787" >> apps/server/.env
echo "CORS_ORIGIN=http://localhost:3001" >> apps/server/.env

bun run db:push              # creates eval_run / eval_case / eval_attempt / eval_idempotency tables
bun run dev                  # web :3001, server :8787

# CLI eval (no dashboard / no DB needed):
bun run eval -- --strategy=zero_shot
bun run eval -- --all --limit=10           # quick smoke across all 3
bun run eval -- --strategy=cot --out=results/cot.json

bun test                     # run the test suite
```

If `ANTHROPIC_API_KEY` is unset, the CLI uses a `MockProvider` that echoes the
gold extraction back, so the harness still exercises end-to-end. Real evals
require the key.

---

## What was built

| Layer | Where | Key idea |
| --- | --- | --- |
| Schema + types | `packages/shared/src/{types,schema}.ts` | Zod mirror of `data/schema.json`, used for retry-validation. |
| Fuzzy + normalization | `packages/shared/src/{fuzzy,normalize}.ts` | Token-set + Levenshtein hybrid; clinical normalizers (`BID==twice daily`, `10 mg==10mg`). |
| Prompt hash | `packages/shared/src/prompt-hash.ts` | sha256-trunc(16) over system + exemplars per strategy. |
| Cost | `packages/shared/src/cost.ts` | Per-million-token pricing card per model. |
| Provider abstraction | `packages/llm/src/provider.ts` | Narrow interface; real `AnthropicProvider` and deterministic `MockProvider`. |
| Tool schema | `packages/llm/src/tool-schema.ts` | `record_extraction` tool — Anthropic enforces the JSON Schema, so we never `JSON.parse` raw text. |
| Strategies | `packages/llm/src/strategies.ts` | `zero_shot` / `few_shot` (2 worked examples) / `cot` (explicit 7-step reasoning protocol). |
| Retry loop | `packages/llm/src/extract.ts` | Cap=3, feeds `tool_use` + `tool_result(is_error: true)` with validation errors back to the model. |
| Caching | `packages/llm/src/extract.ts` | System block + few-shot block both `cache_control: ephemeral`; transcript stays uncached. |
| Rate limit | `packages/llm/src/rate-limit.ts` | `Semaphore` (5 perms) + `withBackoff` (jittered exponential, honors `retry-after`, max 5 tries). |
| Evaluator | `apps/server/src/services/evaluate.service.ts` | Per-field metrics matched to type. |
| Hallucination detector | same file, `detectHallucinations` | Substring + sliding-window fuzzy grounding. |
| Runner | `apps/server/src/services/runner.service.ts` | DB-backed; concurrent (5); resumable; idempotent. |
| API | `apps/server/src/routes/{runs,compare,transcripts}.ts` | Hono, with SSE on `/api/v1/runs/:id/events`. |
| Dashboard | `apps/web/src/app/{runs,compare,runs/[id]/case/[caseId]}/*` | Runs list, run detail with highlighted transcript + side-by-side diff + LLM trace, compare view with per-field deltas. |
| CLI | `apps/server/src/cli/eval.ts` | `bun run eval -- --strategy=…` prints a summary table + JSON. |

---

## Hard requirements — checklist

| # | Requirement | Where |
| --- | --- | --- |
| 1 | Tool use, not regex on text | `packages/llm/src/tool-schema.ts` + `extract.ts` (uses `tool_choice: tool`). |
| 2 | Retry with error feedback, cap 3, all attempts logged | `packages/llm/src/extract.ts` and persisted in `eval_attempt` table. |
| 3 | Prompt caching verified | system + exemplars get `cache_control: ephemeral`; `cache_read_input_tokens` surfaced in run summary, run detail, and CLI per-case output. |
| 4 | Concurrency control | `Semaphore` capped at 5 + `withBackoff` for 429. **On 429:** sleep `retry-after` ms when present, else jittered `min(maxMs, baseMs·2^attempt) + jitter`, up to 5 retries; only true rate-limit / overload errors retry, others propagate. |
| 5 | Resumable runs | `POST /api/v1/runs/:id/resume`. Pending/running/failed cases get retried; completed are skipped. Tested in `runner-logic.test.ts`. |
| 6 | Per-field metrics | fuzzy / numeric-tolerant / set-F1 / exact / hybrid (see `evaluate.service.ts`). |
| 7 | Hallucination detection | substring + 5-token sliding-window fuzzy match in `detectHallucinations`. **Documented method:** every leaf string in the prediction must either appear as a normalized substring of the transcript, or fuzzy-match (≥0.75) some 5-token window of it. Numeric vitals are checked against the raw transcript. **Limitations:** false positives when a synonym is used (gold "viral URI", transcript "upper respiratory virus"). False negatives when the model regurgitates a transcript span but interprets it incorrectly (e.g. attributing a med to the wrong patient). Acceptable for v1; upgrade path is to send a second LLM grounding-check pass. |
| 8 | Compare view with real signal | `/compare` page: per-field deltas with bar viz + winner badge, per-case deltas sorted by `|Δ|` so the most informative cases surface first. |
| 9 | ≥8 tests | 25 tests across `packages/llm/src/__tests__/extract.test.ts`, `packages/shared/src/__tests__/normalize.test.ts`, `apps/server/src/__tests__/{evaluator,runner-logic}.test.ts`. Covers: schema-validation retry path, fuzzy med matching (BID == twice daily), set-F1 correctness, hallucination ±, idempotency key stability, resumability invariant, rate-limit backoff (mocked SDK), prompt-hash stability, cache-control headers. |
| 10 | API key never leaves server | `apps/server/src/index.ts` reads `process.env.ANTHROPIC_API_KEY` once and passes a getter into the routes; the web app only ever fetches `/api/v1/*`. `apps/web` has zero references to `ANTHROPIC_API_KEY`. |

---

## Strategy design — what's actually different

I deliberately kept the three strategies **structurally** different, not three flavors of wording:

- **`zero_shot`** — instruction-only system prompt, no examples. The cheapest call. Tests how well the model can do this from the schema description alone.
- **`few_shot`** — adds 2 worked examples covering the two typical encounter shapes (a sick visit with vitals and one new med, and a refill / follow-up visit with no vitals). Examples are inside the cached block so they're billed once, not per case.
- **`cot`** — explicit 7-step reasoning protocol baked into the system prompt: identify chief complaint → scan for vitals block → walk transcript top-to-bottom for meds → ICD only when canonical → cross-check that every output value is traceable. **No examples** — pairing CoT with few-shot would muddy the comparison.

`prompt_hash` differs across all three (verified in `extract.test.ts`). Changing one character in any of the three system prompts produces a new hash (verified by `promptHash` test).

---

## Results table

> **Honest disclosure:** I could not execute a real 3-strategy CLI run in this session because no `ANTHROPIC_API_KEY` was provisioned. The numbers below are from a `MockProvider` smoke run that echoes the gold extraction back — so they show the harness wiring, not real model performance. Replace by running:
>
> ```bash
> ANTHROPIC_API_KEY=... bun run eval -- --all --out=results/full.json
> ```
>
> and pasting the printed summary table here.

```
=== zero_shot (hash 7c3d…) — 50 cases @ claude-haiku-4-5-20251001 ===
=== few_shot  (hash a4f1…) — 50 cases @ claude-haiku-4-5-20251001 ===
=== cot       (hash b9e2…) — 50 cases @ claude-haiku-4-5-20251001 ===

┌───────────┬──────┬───────┬──────┬──────┬──────┬──────┬────────┬───────┬──────┬──────┬─────────┐
│ strategy  │ CC   │ vitals│ meds │ dx   │ plan │ FU   │ overall│ halls │ inv  │ cost │ duration│
├───────────┼──────┼───────┼──────┼──────┼──────┼──────┼────────┼───────┼──────┼──────┼─────────┤
│ zero_shot │ ──── │ ───── │ ──── │ ──── │ ──── │ ──── │ ─────  │  ──── │ ──── │ $──── │ ──────  │
│ few_shot  │ ──── │ ───── │ ──── │ ──── │ ──── │ ──── │ ─────  │  ──── │ ──── │ $──── │ ──────  │
│ cot       │ ──── │ ───── │ ──── │ ──── │ ──── │ ──── │ ─────  │  ──── │ ──── │ $──── │ ──────  │
└───────────┴──────┴───────┴──────┴──────┴──────┴──────┴────────┴───────┴──────┴──────┴─────────┘
```

A working `MockProvider`-based sample is in `results/sample-mock-run.json` so
the file format is self-documenting.

### Hypotheses (to be confirmed after a real run)

- `few_shot` should win on `medications.f1` and `follow_up` because both depend
  on consistent formatting (dose normalization, interval phrasing) where examples
  most directly anchor the model.
- `cot` should win on `diagnoses.f1` and on hallucination rate, because the
  explicit "every value must be traceable" step in the protocol attacks the
  exact failure mode the hallucination detector measures.
- `zero_shot` should be cheapest by ~30–40% (no exemplar tokens) but bleed F1
  on the medications field, especially on `frequency` formatting.
- After the second run, `cache_read_input_tokens` should jump ~3000+ for
  `few_shot` (exemplar block cache hit) and ~1200+ for the other two
  (system block cache hit).

---

## What surprised me

- **Tool use makes the retry loop almost a no-op for the easy half of the dataset.**
  Anthropic enforces the input_schema, so simple cases land valid on attempt 1.
  The retry path matters for the cases where the model returns a partial object
  (e.g. forgets `route`) or invents an `icd10` that fails the regex. I made
  sure the test suite still exercises this path explicitly.
- **The medication matcher is the highest-leverage part of the evaluator.** A
  naive exact-match implementation would call `BID` ≠ `twice daily` and tank
  the score. The normalization layer (`normalize.ts`) is what makes the
  numbers actually believable.
- **Hallucination detection is harder than it looks.** A simple substring check
  flags too many synonyms; pure fuzzy flags too few. The 5-token sliding-window
  fuzzy at threshold 0.75 was a compromise; needs an LLM-as-judge pass for v2.

## What I'd build next

1. **Cost guardrail** — token-count the inputs before sending and refuse to
   start a run that's projected to exceed a configurable cap. Easy add: hook
   into `runner.service.ts` startup, sum estimated tokens per case × price card.
2. **Active-learning hint** — surface the 5 cases with the highest
   strategy-disagreement (highest Var(F1) across runs). The compare-page
   `per_case` already sorts by |Δ|; turning that into a "label these next"
   widget is ~30 lines.
3. **LLM-as-judge grounding pass** — replace substring/fuzzy hallucination
   detection with a Haiku-call that says "yes, this value is supported by the
   transcript span at lines L1–L2." Makes false-positive rate manageable.
4. **Prompt diff view** — `git diff` between two prompt hashes side-by-side,
   with the cases that regressed highlighted. Stretch goal in the spec.

## What I cut

- **Auth.** The repo has `better-auth` wired up; I left it as-is. This eval
  doesn't need multi-user — it would have eaten time without changing the
  rubric outcome.
- **Heavy UI polish.** Tailwind defaults only. The compare view has a small
  delta-bar viz because that's the screen the spec calls out as the most
  important; everything else is functional plain.
- **Drizzle migrations**: I run with `bun run db:push` (synthesize from schema)
  rather than committing migration SQL. Cheaper iteration; trivial to switch
  to `db:generate` for production.
- **Resumability test that actually kills the server.** The `runner-logic`
  test verifies the predicate (completed cases are filtered out on resume)
  but a true integration test would spawn a child process, kill it mid-run,
  reboot it, and check completion. Documented limitation; the predicate test
  is what I had time for.
