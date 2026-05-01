/**
 * Per-field evaluator.
 *
 * Each field gets the metric appropriate to its shape:
 *   chief_complaint → fuzzy token-set ratio
 *   vitals.*        → exact (with ±0.2 °F tolerance for temp_f), then averaged
 *   medications     → set-F1, name fuzzy-matched + dose/frequency normalized-equal
 *   diagnoses       → set-F1 by description fuzzy match + ICD-10 bonus credit
 *   plan            → set-F1 fuzzy
 *   follow_up       → exact on interval_days, fuzzy on reason
 *
 * Hallucination detection: every leaf string in the prediction must have a
 * trace in the transcript (substring, normalized substring, or fuzzy match
 * against any 5-word window). Anything that doesn't trace is flagged.
 */

import {
  bpEquals,
  fuzzyEquals,
  fuzzyScore,
  normalizeDose,
  normalizeFrequency,
  normalizeMedName,
  normalizeRoute,
  normalizeText,
  type AggregateScores,
  type CaseResult,
  type ClinicalExtraction,
  type FieldScores,
  type HallucinationFlag,
  type Medication,
  type Diagnosis,
  type Vitals,
} from "@test-evals/shared";

const FUZZY_THRESHOLD = 0.7;
const STRICT_FUZZY_THRESHOLD = 0.8;

// ─── Field-level scorers ──────────────────────────────────────────────────────

export function scoreChiefComplaint(pred: string, gold: string): number {
  return fuzzyScore(pred, gold);
}

export function scoreVitals(pred: Vitals, gold: Vitals): number {
  let hits = 0;
  let total = 0;

  // bp
  total++;
  if (bpEquals(pred.bp ?? null, gold.bp ?? null)) hits++;

  // hr
  total++;
  if (pred.hr === gold.hr) hits++;

  // temp_f — ±0.2 tolerance
  total++;
  if (pred.temp_f == null && gold.temp_f == null) hits++;
  else if (pred.temp_f != null && gold.temp_f != null && Math.abs(pred.temp_f - gold.temp_f) <= 0.2) hits++;

  // spo2
  total++;
  if (pred.spo2 === gold.spo2) hits++;

  return hits / total;
}

export interface SetF1 {
  precision: number;
  recall: number;
  f1: number;
}

function f1FromCounts(tp: number, fp: number, fn: number): SetF1 {
  if (tp + fp === 0 && tp + fn === 0) return { precision: 1, recall: 1, f1: 1 };
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

export function scoreMedications(pred: Medication[], gold: Medication[]): SetF1 {
  // Greedy bipartite matching: for each gold med, find the best unmatched
  // pred med whose name fuzzy-matches AND whose normalized dose+frequency match.
  const matchedPred = new Set<number>();
  let tp = 0;
  for (const g of gold) {
    let best: { idx: number; score: number } | null = null;
    pred.forEach((p, i) => {
      if (matchedPred.has(i)) return;
      const nameScore = fuzzyScore(p.name, g.name);
      if (nameScore < STRICT_FUZZY_THRESHOLD) return;
      const doseOk = normalizeDose(p.dose) === normalizeDose(g.dose);
      const freqOk = fuzzyScore(normalizeFrequency(p.frequency), normalizeFrequency(g.frequency)) >= FUZZY_THRESHOLD;
      if (!doseOk || !freqOk) return;
      const composite = nameScore;
      if (!best || composite > best.score) best = { idx: i, score: composite };
    });
    if (best) {
      matchedPred.add((best as { idx: number }).idx);
      tp++;
    }
  }
  const fp = pred.length - matchedPred.size;
  const fn = gold.length - tp;
  return f1FromCounts(tp, fp, fn);
}

export interface DiagnosisScore extends SetF1 {
  /** Average ICD-10 hit rate among matched gold diagnoses that had an icd10. */
  icd10_bonus: number;
}

export function scoreDiagnoses(pred: Diagnosis[], gold: Diagnosis[]): DiagnosisScore {
  const matchedPred = new Set<number>();
  let tp = 0;
  let icdHits = 0;
  let icdGoldCount = 0;

  for (const g of gold) {
    let best: { idx: number; score: number } | null = null;
    pred.forEach((p, i) => {
      if (matchedPred.has(i)) return;
      const score = fuzzyScore(p.description, g.description);
      if (score < FUZZY_THRESHOLD) return;
      if (!best || score > best.score) best = { idx: i, score };
    });
    if (best) {
      const matchIdx = (best as { idx: number }).idx;
      const matched = pred[matchIdx]!;
      matchedPred.add(matchIdx);
      tp++;
      if (g.icd10) {
        icdGoldCount++;
        if (matched.icd10 && matched.icd10.toUpperCase() === g.icd10.toUpperCase()) icdHits++;
      }
    }
  }
  const fp = pred.length - matchedPred.size;
  const fn = gold.length - tp;
  const setScore = f1FromCounts(tp, fp, fn);
  const icd10_bonus = icdGoldCount === 0 ? 1 : icdHits / icdGoldCount;
  return { ...setScore, icd10_bonus };
}

export function scorePlan(pred: string[], gold: string[]): SetF1 {
  const matchedPred = new Set<number>();
  let tp = 0;
  for (const g of gold) {
    let best: { idx: number; score: number } | null = null;
    pred.forEach((p, i) => {
      if (matchedPred.has(i)) return;
      const score = fuzzyScore(p, g);
      if (score < FUZZY_THRESHOLD) return;
      if (!best || score > best.score) best = { idx: i, score };
    });
    if (best) {
      matchedPred.add((best as { idx: number }).idx);
      tp++;
    }
  }
  return f1FromCounts(tp, pred.length - matchedPred.size, gold.length - tp);
}

export function scoreFollowUp(
  pred: { interval_days: number | null; reason: string | null },
  gold: { interval_days: number | null; reason: string | null },
): number {
  const intervalOk = pred.interval_days === gold.interval_days ? 1 : 0;
  const reasonScore = fuzzyScore(pred.reason ?? "", gold.reason ?? "");
  return (intervalOk + reasonScore) / 2;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

export function scorePrediction(prediction: ClinicalExtraction, gold: ClinicalExtraction): FieldScores {
  return {
    chief_complaint: scoreChiefComplaint(prediction.chief_complaint, gold.chief_complaint),
    vitals: scoreVitals(prediction.vitals, gold.vitals),
    medications: scoreMedications(prediction.medications, gold.medications),
    diagnoses: scoreDiagnoses(prediction.diagnoses, gold.diagnoses),
    plan: scorePlan(prediction.plan, gold.plan),
    follow_up: scoreFollowUp(prediction.follow_up, gold.follow_up),
  };
}

export function aggregateF1(scores: FieldScores): number {
  // Macro-average over fields. Diagnoses ICD-10 bonus is folded in as a small uplift.
  const fields = [
    scores.chief_complaint,
    scores.vitals,
    scores.medications.f1,
    scores.diagnoses.f1 * 0.9 + scores.diagnoses.icd10_bonus * 0.1,
    scores.plan.f1,
    scores.follow_up,
  ];
  return fields.reduce((s, x) => s + x, 0) / fields.length;
}

export function aggregateRun(perCase: CaseResult[]): AggregateScores {
  const scored = perCase.filter((c) => c.scores != null);
  if (scored.length === 0) {
    return {
      chief_complaint: 0,
      vitals: 0,
      medications_f1: 0,
      diagnoses_f1: 0,
      plan_f1: 0,
      follow_up: 0,
      overall_f1: 0,
    };
  }
  const sum = (sel: (s: FieldScores) => number) =>
    scored.reduce((acc, c) => acc + sel(c.scores!), 0) / scored.length;
  return {
    chief_complaint: sum((s) => s.chief_complaint),
    vitals: sum((s) => s.vitals),
    medications_f1: sum((s) => s.medications.f1),
    diagnoses_f1: sum((s) => s.diagnoses.f1),
    plan_f1: sum((s) => s.plan.f1),
    follow_up: sum((s) => s.follow_up),
    overall_f1: scored.reduce((acc, c) => acc + (c.aggregate_f1 ?? 0), 0) / scored.length,
  };
}

// ─── Hallucination detection ─────────────────────────────────────────────────

/**
 * A predicted leaf-string value is "grounded" if a normalized form of it
 * appears in the transcript, or fuzzy-matches some 5-token window of it.
 *
 * Numeric values inside vitals are checked separately (substring on raw transcript).
 *
 * This is intentionally simple — sophisticated grounding is out of scope.
 * Documented in NOTES.md.
 */
export function detectHallucinations(
  prediction: ClinicalExtraction,
  transcript: string,
): HallucinationFlag[] {
  const flags: HallucinationFlag[] = [];
  const normTranscript = normalizeText(transcript);

  const isGrounded = (raw: string | null | undefined): boolean => {
    if (!raw) return true;
    const norm = normalizeText(raw);
    if (!norm) return true;
    if (normTranscript.includes(norm)) return true;
    // Sliding 5-token window fuzzy check.
    const tokens = normTranscript.split(" ");
    const win = Math.min(8, Math.max(3, norm.split(" ").length + 2));
    for (let i = 0; i + win <= tokens.length; i++) {
      const windowStr = tokens.slice(i, i + win).join(" ");
      if (fuzzyEquals(norm, windowStr, 0.75)) return true;
    }
    return false;
  };

  const checkBpInTranscript = (bp: string): boolean => {
    if (transcript.replace(/\s/g, "").includes(bp.replace(/\s/g, ""))) return true;
    return false;
  };

  // chief_complaint
  if (!isGrounded(prediction.chief_complaint)) {
    flags.push({
      field_path: "chief_complaint",
      value: prediction.chief_complaint,
      reason: "no textual support found in transcript",
    });
  }

  // vitals
  if (prediction.vitals.bp != null && !checkBpInTranscript(prediction.vitals.bp)) {
    flags.push({ field_path: "vitals.bp", value: prediction.vitals.bp, reason: "BP not present in transcript" });
  }
  if (prediction.vitals.hr != null && !transcript.includes(String(prediction.vitals.hr))) {
    flags.push({ field_path: "vitals.hr", value: String(prediction.vitals.hr), reason: "HR not present in transcript" });
  }
  if (prediction.vitals.temp_f != null) {
    const tStr = String(prediction.vitals.temp_f);
    if (!transcript.includes(tStr) && !transcript.includes(tStr.replace(".0", ""))) {
      flags.push({ field_path: "vitals.temp_f", value: tStr, reason: "temperature not present in transcript" });
    }
  }
  if (prediction.vitals.spo2 != null && !transcript.includes(String(prediction.vitals.spo2))) {
    flags.push({ field_path: "vitals.spo2", value: String(prediction.vitals.spo2), reason: "SpO2 not present in transcript" });
  }

  // medications — name + dose
  prediction.medications.forEach((m, i) => {
    if (!isGrounded(m.name)) {
      flags.push({ field_path: `medications[${i}].name`, value: m.name, reason: "medication name not in transcript" });
    }
    if (m.dose && !isGrounded(m.dose)) {
      flags.push({ field_path: `medications[${i}].dose`, value: m.dose, reason: "dose not in transcript" });
    }
  });

  // diagnoses — description
  prediction.diagnoses.forEach((d, i) => {
    if (!isGrounded(d.description)) {
      flags.push({
        field_path: `diagnoses[${i}].description`,
        value: d.description,
        reason: "diagnosis not supported by transcript text",
      });
    }
  });

  // plan items
  prediction.plan.forEach((p, i) => {
    if (!isGrounded(p)) {
      flags.push({ field_path: `plan[${i}]`, value: p, reason: "plan item not supported by transcript" });
    }
  });

  // follow_up.reason
  if (prediction.follow_up.reason && !isGrounded(prediction.follow_up.reason)) {
    flags.push({
      field_path: "follow_up.reason",
      value: prediction.follow_up.reason,
      reason: "follow-up reason not in transcript",
    });
  }

  return flags;
}
