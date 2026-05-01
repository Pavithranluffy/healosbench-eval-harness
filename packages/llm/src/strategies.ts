import { promptHash, type Strategy } from "@test-evals/shared";

export interface PromptStrategy {
  name: Strategy;
  /** System prompt — sent with cache_control so it's billed once across runs. */
  system: string;
  /** Optional few-shot exemplar block — also cache-controlled. Empty string → no block. */
  exemplars: string;
  /** Builds the user-turn message wrapping the transcript. */
  buildUserMessage(transcript: string): string;
  /** Stable content hash so prompt v6 vs v7 is unambiguous. */
  hash(): string;
}

const SYSTEM_BASE = `You are a clinical-information extraction tool. The user will provide a single doctor-patient encounter transcript. Your job is to extract the structured fields and call the \`record_extraction\` tool exactly once.

Rules:
- Return values strictly in the schema. Do NOT invent fields.
- For vitals not mentioned in the transcript, use null. Do NOT guess.
- Medication routes use abbreviations (PO, IV, IM, topical, inhaled, SL, PR). Default to "PO" only if the transcript clearly implies oral administration; otherwise null.
- chief_complaint must be a brief clinical summary in the patient's perspective, not a sentence.
- ICD-10 codes are optional; include them only when you are confident.
- Plan items are concise free-text statements, one per discrete action.
- follow_up.interval_days is integer days; "no follow-up" → null.
- Do NOT add any commentary; only the tool call.`;

export const zeroShot: PromptStrategy = {
  name: "zero_shot",
  system: SYSTEM_BASE,
  exemplars: "",
  buildUserMessage: (t) => `TRANSCRIPT:\n\`\`\`\n${t}\n\`\`\`\n\nExtract and call record_extraction.`,
  hash() {
    return promptHash("v1-zero-shot", this.system, this.exemplars);
  },
};

const FEW_SHOT_EXAMPLES = `Here are two reference examples of correct extractions. Use them to calibrate naming, formatting, and the level of summarization.

EXAMPLE 1
TRANSCRIPT:
[Vitals: BP 130/85, HR 92, Temp 99.1, SpO2 97%]
Doctor: What's bothering you today?
Patient: My ankle has been swollen for three days after I twisted it.
Doctor: Mild lateral sprain. Take ibuprofen 400 mg every 6 hours as needed and ice it. Follow up in two weeks if not better.

EXTRACTION:
{
  "chief_complaint": "right ankle swelling for three days after twisting injury",
  "vitals": { "bp": "130/85", "hr": 92, "temp_f": 99.1, "spo2": 97 },
  "medications": [{ "name": "ibuprofen", "dose": "400 mg", "frequency": "every 6 hours as needed", "route": "PO" }],
  "diagnoses": [{ "description": "mild lateral ankle sprain", "icd10": "S93.4" }],
  "plan": ["ibuprofen 400 mg every 6 hours as needed", "ice the ankle"],
  "follow_up": { "interval_days": 14, "reason": "if not improving" }
}

EXAMPLE 2
TRANSCRIPT:
Doctor: Refill on your metformin?
Patient: Yes — 500 mg twice daily, I'm doing fine on it.
Doctor: Sugars look great. Refill sent. Annual labs in 3 months.

EXTRACTION:
{
  "chief_complaint": "diabetes follow-up and metformin refill",
  "vitals": { "bp": null, "hr": null, "temp_f": null, "spo2": null },
  "medications": [{ "name": "metformin", "dose": "500 mg", "frequency": "twice daily", "route": "PO" }],
  "diagnoses": [{ "description": "type 2 diabetes mellitus", "icd10": "E11.9" }],
  "plan": ["refill metformin 500 mg twice daily", "annual labs in 3 months"],
  "follow_up": { "interval_days": 90, "reason": "annual labs" }
}`;

export const fewShot: PromptStrategy = {
  name: "few_shot",
  system: SYSTEM_BASE,
  exemplars: FEW_SHOT_EXAMPLES,
  buildUserMessage: (t) => `TRANSCRIPT:\n\`\`\`\n${t}\n\`\`\`\n\nExtract and call record_extraction.`,
  hash() {
    return promptHash("v1-few-shot", this.system, this.exemplars);
  },
};

const COT_SYSTEM = `${SYSTEM_BASE}

REASONING PROCESS (private — do not output text, but use these steps internally before calling the tool):
1. Identify the chief complaint from the patient's first substantive statement.
2. Scan for any vitals block ([Vitals: ...] or "BP", "HR", "Temp", "SpO2"); leave null when missing.
3. Walk the transcript top to bottom; whenever a medication is named, capture {name, dose, frequency, route}. Default frequency = null when not stated.
4. Resolve diagnoses from the doctor's assessment statements ("this looks like…", "I'm diagnosing…"). Add ICD-10 only for canonical, well-known codes (J06.9, E11.9, R51.9, K21.9).
5. Plan = the doctor's instructions, one per discrete action.
6. follow_up.interval_days: parse phrases like "two weeks" → 14, "three months" → 90, "no follow-up needed" → null.
7. Cross-check: every value you put in the JSON should be traceable to a span in the transcript. If you can't trace it, prefer null.`;

export const cot: PromptStrategy = {
  name: "cot",
  system: COT_SYSTEM,
  exemplars: "",
  buildUserMessage: (t) =>
    `TRANSCRIPT:\n\`\`\`\n${t}\n\`\`\`\n\nThink through the 7 reasoning steps internally, then call record_extraction with the result.`,
  hash() {
    return promptHash("v1-cot", this.system, this.exemplars);
  },
};

export const STRATEGIES: Record<Strategy, PromptStrategy> = {
  zero_shot: zeroShot,
  few_shot: fewShot,
  cot,
};

export function getStrategy(name: Strategy): PromptStrategy {
  const s = STRATEGIES[name];
  if (!s) throw new Error(`Unknown strategy: ${name}`);
  return s;
}
