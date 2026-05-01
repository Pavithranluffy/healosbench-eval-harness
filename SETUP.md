# SETUP — Run HEALOSBENCH from scratch

Step-by-step guide to get the eval harness running on a fresh machine.
Tested on macOS / Linux / Windows (PowerShell or Git Bash).

---

## 0. What you'll have at the end

- Hono server on `http://localhost:8787` exposing the runs / compare / SSE API.
- Next.js dashboard on `http://localhost:3001`.
- Postgres on `localhost:5432` storing runs, cases, attempts.
- A working `bun run eval` CLI that runs a 50-case eval and prints a summary table.

---

## 1. Prerequisites

| Tool | Version | Why | Install |
| --- | --- | --- | --- |
| Bun | ≥ 1.3 | runtime + workspaces + test runner | https://bun.sh |
| Postgres | ≥ 14 | runs / cases / attempts storage | https://www.postgresql.org/download/ |
| Node.js | optional, ≥ 20 | not strictly required (Bun handles everything) | https://nodejs.org |
| An Anthropic API key | — | needed for real runs | https://console.anthropic.com/settings/keys |

### Install Bun

**macOS / Linux:**
```bash
curl -fsSL https://bun.sh/install | bash
# then re-open the terminal or `source ~/.bashrc`
bun --version    # should print 1.3.x or higher
```

**Windows (PowerShell, run as user):**
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
# close PowerShell and re-open
bun --version
```

### Install Postgres

**macOS:**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Ubuntu / Debian:**
```bash
sudo apt install postgresql postgresql-contrib
sudo service postgresql start
```

**Windows:**
- Download the installer from https://www.postgresql.org/download/windows/.
- During install, set the postgres user password to `postgres` (or remember what you set; you'll put it in `.env`).
- Make sure "Add to PATH" is checked.

**Docker alternative (any OS):**
```bash
docker run --name healosbench-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
```

### Create the database

```bash
# any OS, in a shell where psql is on PATH:
createdb -U postgres healosbench

# or with docker:
docker exec -it healosbench-pg psql -U postgres -c "CREATE DATABASE healosbench;"
```

If `createdb` asks for a password, use whatever you set during Postgres install.

---

## 2. Clone & install

```bash
git clone <your-fork-url> healosbench
cd healosbench

bun install
```

`bun install` reads the workspace + catalog from `package.json` and installs
all five packages + two apps in one shot. Should take 30-90 seconds.

---

## 3. Configure environment

Copy the example file and fill in your values:

```bash
cp apps/server/.env.example apps/server/.env
```

Then edit `apps/server/.env`:

```env
ANTHROPIC_API_KEY=sk-ant-paste-your-key-here

# Match what you set during Postgres install:
DATABASE_URL=postgres://postgres:postgres@localhost:5432/healosbench

# better-auth requires a 32+ byte secret. Generate one:
#   macOS / Linux: openssl rand -hex 32
#   PowerShell:    -join ((1..64) | ForEach-Object { '{0:X}' -f (Get-Random -Max 16) })
BETTER_AUTH_SECRET=replace_with_64_hex_chars_replace_with_64_hex_chars

BETTER_AUTH_URL=http://localhost:8787
CORS_ORIGIN=http://localhost:3001
NODE_ENV=development
```

> The eval harness itself doesn't use `better-auth` — those vars only exist
> because the server entry imports the auth module. Setting placeholder
> values is fine.

> **API key safety:** the key is read only by the Hono server. The browser
> dashboard hits `/api/v1/*`; it never sees the key. Don't commit `.env`.

---

## 4. Push the schema to Postgres

```bash
bun run db:push
```

This applies the Drizzle schema to your DB, creating:
- `eval_run`
- `eval_case`
- `eval_attempt`
- `eval_idempotency`
- (plus the existing `user` / `session` / `account` / `verification` from auth)

If `db:push` errors with `connect ECONNREFUSED`, Postgres isn't running.
If it errors with auth, your `DATABASE_URL` password is wrong.

---

## 5. Run the tests (no DB / no API key required)

```bash
bun test
```

Should print 25 passing tests across 4 files. These exercise:
- schema-validation retry path with mocked SDK
- fuzzy medication matching (BID == twice daily)
- set-F1 correctness on tiny synthetic cases
- hallucination detector ±
- idempotency-key stability
- resumability invariant
- rate-limit backoff (mocked)
- prompt-hash stability + cache-control headers

If they all pass, the core logic is sound. You don't need an API key for this.

---

## 6. Run the CLI eval

The CLI is the fastest way to see end-to-end behavior. It works without the
dashboard or the DB.

```bash
# Real run: needs ANTHROPIC_API_KEY in apps/server/.env
bun run eval -- --strategy=zero_shot

# Run all three strategies:
bun run eval -- --all

# Limit to first 10 cases (fast smoke test):
bun run eval -- --strategy=cot --limit=10

# Write JSON results to a specific file:
bun run eval -- --strategy=few_shot --out=results/few_shot.json

# Override the model:
bun run eval -- --strategy=cot --model=claude-haiku-4-5-20251001
```

You'll see per-case progress lines like:

```
[3/50] case_003  f1=0.842  halls=0  cache_read=4823
```

…and a final summary table per strategy with per-field aggregates, total
cost, cache hits, and duration.

> **No API key?** The CLI falls back to a `MockProvider` that echoes the gold
> extraction back. It exercises the wiring (you'll see "1.000" on every
> field) but isn't a real eval. Useful for verifying the install before
> spending tokens.

---

## 7. Run the dashboard

In one terminal:
```bash
bun run dev
```

This boots:
- Hono server on `http://localhost:8787`
- Next.js dashboard on `http://localhost:3001`

Open the dashboard:

| URL | Page |
| --- | --- |
| http://localhost:3001 | Home — links to Runs and Compare |
| http://localhost:3001/runs | Runs list with a "Start run" form |
| http://localhost:3001/runs/{id} | Run detail (live SSE updates as cases complete) |
| http://localhost:3001/runs/{id}/case/{caseId} | Case detail — transcript with grounded values highlighted, gold vs pred side-by-side, full LLM retry trace |
| http://localhost:3001/compare | Per-field deltas between two runs with winners |

Workflow:
1. Go to `/runs`, pick a strategy + model, click "Start run".
2. Click into the new run → watch the per-case rows fill in via SSE.
3. Repeat with a different strategy.
4. Go to `/compare`, pick the two runs, see per-field deltas + per-case
   disagreements (sorted by |Δ| so the most informative cases bubble up).

---

## 8. Resumability check

Want to verify resumability works? Start a run, kill the server mid-run,
restart it, and resume:

```bash
# terminal 1
bun run dev
# Start a run via the dashboard, note the run_id printed.

# while it's running, hit ctrl-C in terminal 1.

# restart
bun run dev

# terminal 2 — resume
curl -X POST http://localhost:8787/api/v1/runs/<run_id>/resume
```

Completed cases are skipped (no double-charging); only pending / running /
failed cases get retried.

---

## 9. Common issues

| Symptom | Fix |
| --- | --- |
| `bun: command not found` | Re-open the terminal after install, or `source ~/.bashrc` / `source ~/.zshrc`. On Windows, log out and back in. |
| `ECONNREFUSED 127.0.0.1:5432` | Postgres isn't running. `brew services start postgresql@16` / `sudo service postgresql start` / `docker start healosbench-pg`. |
| `password authentication failed for user "postgres"` | Your `DATABASE_URL` password doesn't match what Postgres expects. Check your install or run `ALTER USER postgres WITH PASSWORD 'postgres';` in psql. |
| `BETTER_AUTH_SECRET … min 32` | Your secret is too short. Run `openssl rand -hex 32` and paste the 64-char hex result. |
| `404 Not Found` on `/api/v1/runs` | The Next dashboard is on :3001 but it calls the Hono server on :8787. Make sure both are running (the `dev` script starts both). |
| `bun run eval` prints "MockProvider" warning | `ANTHROPIC_API_KEY` not in `apps/server/.env`. The CLI keeps going with a mock so you can verify wiring; add the key for real evals. |
| Drizzle push hangs or errors | Make sure `apps/server/.env` has `DATABASE_URL`. The push command reads from there. |
| Cost shows $0.00 even with API key | Make sure you're using a paid key, and check the model name matches one in the `PRICING` map (`claude-haiku-4-5-20251001`). Unknown models default to Haiku pricing. |

---

## 10. Repository layout

```
.
├── README.md                    # the assignment spec (don't edit)
├── NOTES.md                     # design notes, results table, decisions
├── SETUP.md                     # ← this file
├── data/                        # 50 transcripts + gold + schema.json (don't edit)
├── results/                     # CLI eval outputs (created on first run)
├── apps/
│   ├── server/                  # Hono on :8787
│   │   ├── src/
│   │   │   ├── index.ts                   # entry, wires routes
│   │   │   ├── cli/eval.ts                # `bun run eval`
│   │   │   ├── routes/{runs,compare,transcripts}.ts
│   │   │   ├── services/{extract,evaluate,runner}.service.ts
│   │   │   ├── lib/dataset.ts             # transcript+gold loader
│   │   │   └── __tests__/
│   │   └── .env.example
│   └── web/                     # Next.js dashboard on :3001
│       └── src/app/{runs,compare,...}/
└── packages/
    ├── shared/                  # types, zod schema, fuzzy, normalize, prompt-hash, cost
    ├── llm/                     # provider, strategies, retry, caching, mock
    ├── db/                      # Drizzle schema (auth + evals)
    ├── env/                     # zod-validated env loader
    ├── auth/                    # better-auth (unused by eval)
    ├── ui/                      # shadcn-ish primitives
    └── config/                  # shared tsconfig
```

---

## 11. Reproducing a results.json for submission

The assignment asks for "the output of one full 3-strategy CLI run". After
setup:

```bash
ANTHROPIC_API_KEY=sk-ant-... bun run eval -- --all --out=results/full.json
```

That writes `results/full.json` with all three strategies' per-case scores
and aggregates, AND prints the summary table to stdout. Paste the table
into `NOTES.md` under "Results table", commit `results/full.json`, push.

Done.
