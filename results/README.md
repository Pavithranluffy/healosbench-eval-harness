# results/

Each `bun run eval -- --strategy=…` writes a JSON file here with:

```jsonc
{
  "strategy": "zero_shot",
  "totals": { "in": 12345, "out": 6789, "cacheRead": 0, "cacheWrite": 1234, "cost": 0.024, "durationMs": 8123, "schemaInvalid": 0, "halls": 4 },
  "aggregate": {
    "chief_complaint": 0.84,
    "vitals": 0.91,
    "medications_f1": 0.79,
    "diagnoses_f1": 0.72,
    "plan_f1": 0.68,
    "follow_up": 0.83,
    "overall_f1": 0.795
  },
  "per_case": [ { "id": "case_001", "f1": 0.812, "scores": {...}, "schema_invalid": false, "hallucinations": [...] }, ... ]
}
```

A real 3-strategy run with `claude-haiku-4-5-20251001` should land under
$1 thanks to prompt caching (system + few-shot blocks are cache-controlled).

## How to produce results

```bash
ANTHROPIC_API_KEY=sk-ant-... bun run eval -- --all --out=results/full.json
```

Then paste the printed summary table into `NOTES.md` under "Results table".
