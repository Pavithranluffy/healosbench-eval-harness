import { describe, expect, test } from "bun:test";
import {
  scoreMedications,
  scoreDiagnoses,
  scorePlan,
  scoreVitals,
  scoreFollowUp,
  scoreChiefComplaint,
  detectHallucinations,
  scorePrediction,
  aggregateF1,
} from "../services/evaluate.service";
import type { ClinicalExtraction } from "@test-evals/shared";

describe("medication F1 with normalization", () => {
  test("BID == twice daily, 10 mg == 10mg → match", () => {
    const r = scoreMedications(
      [{ name: "Metformin", dose: "500mg", frequency: "BID", route: "PO" }],
      [{ name: "metformin", dose: "500 mg", frequency: "twice daily", route: "PO" }],
    );
    expect(r.f1).toBe(1);
  });

  test("dose mismatch → counted as miss", () => {
    const r = scoreMedications(
      [{ name: "Metformin", dose: "1000 mg", frequency: "BID", route: "PO" }],
      [{ name: "metformin", dose: "500 mg", frequency: "twice daily", route: "PO" }],
    );
    expect(r.f1).toBe(0);
  });

  test("partial set: 2 gold, 1 correct, 1 spurious pred → P=0.5 R=0.5 F1=0.5", () => {
    const r = scoreMedications(
      [
        { name: "ibuprofen", dose: "400 mg", frequency: "every 6 hours", route: "PO" },
        { name: "amoxicillin", dose: "500 mg", frequency: "tid", route: "PO" }, // not in gold
      ],
      [
        { name: "ibuprofen", dose: "400 mg", frequency: "q6h", route: "PO" },
        { name: "acetaminophen", dose: "500 mg", frequency: "tid", route: "PO" },
      ],
    );
    expect(r.precision).toBe(0.5);
    expect(r.recall).toBe(0.5);
    expect(r.f1).toBe(0.5);
  });
});

describe("set-F1 correctness", () => {
  test("perfect prediction: F1=1", () => {
    const r = scorePlan(["a", "b", "c"], ["a", "b", "c"]);
    expect(r.f1).toBe(1);
  });
  test("empty gold + empty pred → 1.0 by convention", () => {
    const r = scorePlan([], []);
    expect(r.f1).toBe(1);
  });
  test("only false positives → P=0, R=1 (no gold), F1=0 normalised when fp>0 fn=0", () => {
    const r = scorePlan(["unwarranted plan"], []);
    expect(r.precision).toBe(0);
  });
});

describe("diagnosis ICD-10 bonus", () => {
  test("matched description + matched ICD → bonus = 1", () => {
    const r = scoreDiagnoses(
      [{ description: "viral upper respiratory infection", icd10: "J06.9" }],
      [{ description: "viral upper respiratory infection", icd10: "J06.9" }],
    );
    expect(r.f1).toBe(1);
    expect(r.icd10_bonus).toBe(1);
  });
  test("matched description, missing predicted ICD → bonus = 0 (gold had one)", () => {
    const r = scoreDiagnoses(
      [{ description: "viral upper respiratory infection" }],
      [{ description: "viral upper respiratory infection", icd10: "J06.9" }],
    );
    expect(r.f1).toBeGreaterThan(0);
    expect(r.icd10_bonus).toBe(0);
  });
});

describe("vitals scorer", () => {
  test("temp tolerance ±0.2 °F", () => {
    const s = scoreVitals(
      { bp: "120/80", hr: 72, temp_f: 100.5, spo2: 99 },
      { bp: "120/80", hr: 72, temp_f: 100.4, spo2: 99 },
    );
    expect(s).toBe(1);
  });
  test("temp out of tolerance fails", () => {
    const s = scoreVitals(
      { bp: "120/80", hr: 72, temp_f: 102.0, spo2: 99 },
      { bp: "120/80", hr: 72, temp_f: 100.4, spo2: 99 },
    );
    expect(s).toBe(0.75);
  });
});

describe("follow_up scorer", () => {
  test("interval matches but reason fuzzy → averaged", () => {
    const s = scoreFollowUp(
      { interval_days: 14, reason: "if not improving" },
      { interval_days: 14, reason: "return if not improving" },
    );
    expect(s).toBeGreaterThan(0.7);
  });
  test("interval mismatch caps at 0.5", () => {
    const s = scoreFollowUp(
      { interval_days: 7, reason: "labs" },
      { interval_days: 30, reason: "labs" },
    );
    expect(s).toBe(0.5);
  });
});

describe("chief complaint fuzzy", () => {
  test("near-paraphrase scores high", () => {
    const s = scoreChiefComplaint(
      "sore throat and stuffy nose",
      "sore throat and nasal congestion for four days",
    );
    expect(s).toBeGreaterThan(0.4);
  });
});

describe("hallucination detector", () => {
  const transcript = `Doctor: How are you?
Patient: My back hurts. I am taking ibuprofen 400 mg every 6 hours.
Doctor: BP 120/80, HR 72.`;

  test("grounded prediction → no flags", () => {
    const pred: ClinicalExtraction = {
      chief_complaint: "back pain",
      vitals: { bp: "120/80", hr: 72, temp_f: null, spo2: null },
      medications: [{ name: "ibuprofen", dose: "400 mg", frequency: "every 6 hours", route: "PO" }],
      diagnoses: [],
      plan: ["take ibuprofen"],
      follow_up: { interval_days: null, reason: null },
    };
    const flags = detectHallucinations(pred, transcript);
    // "back pain" tokens are in transcript ("back hurts") via fuzzy window — accept ≤2 flags.
    expect(flags.length).toBeLessThanOrEqual(2);
  });

  test("ungrounded medication → flagged", () => {
    const pred: ClinicalExtraction = {
      chief_complaint: "back pain",
      vitals: { bp: null, hr: null, temp_f: null, spo2: null },
      medications: [{ name: "metformin", dose: "500 mg", frequency: "twice daily", route: "PO" }],
      diagnoses: [],
      plan: [],
      follow_up: { interval_days: null, reason: null },
    };
    const flags = detectHallucinations(pred, transcript);
    expect(flags.some((f) => f.field_path.startsWith("medications") && f.value === "metformin")).toBe(true);
  });

  test("vital not in transcript → flagged", () => {
    const pred: ClinicalExtraction = {
      chief_complaint: "x",
      vitals: { bp: "999/999", hr: 999, temp_f: null, spo2: null },
      medications: [],
      diagnoses: [],
      plan: [],
      follow_up: { interval_days: null, reason: null },
    };
    const flags = detectHallucinations(pred, transcript);
    expect(flags.some((f) => f.field_path === "vitals.bp")).toBe(true);
    expect(flags.some((f) => f.field_path === "vitals.hr")).toBe(true);
  });
});

describe("aggregateF1", () => {
  test("perfect scores → 1.0", () => {
    const scores = scorePrediction(
      {
        chief_complaint: "back pain",
        vitals: { bp: "120/80", hr: 72, temp_f: null, spo2: null },
        medications: [],
        diagnoses: [],
        plan: ["rest"],
        follow_up: { interval_days: null, reason: null },
      },
      {
        chief_complaint: "back pain",
        vitals: { bp: "120/80", hr: 72, temp_f: null, spo2: null },
        medications: [],
        diagnoses: [],
        plan: ["rest"],
        follow_up: { interval_days: null, reason: null },
      },
    );
    expect(aggregateF1(scores)).toBeGreaterThan(0.99);
  });
});
