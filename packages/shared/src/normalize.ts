/**
 * Domain-specific normalization for clinical fields.
 *
 * Goal: make "BID" == "twice daily", "10 mg" == "10mg", "PO" == "by mouth"
 * before equality checks in medication matching.
 */

export function normalizeDose(d: string | null | undefined): string {
  if (!d) return "";
  return d
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/milligrams?/g, "mg")
    .replace(/micrograms?/g, "mcg")
    .replace(/grams?/g, "g")
    .replace(/units/g, "u")
    .trim();
}

const FREQ_MAP: Record<string, string> = {
  "qd": "once daily",
  "od": "once daily",
  "bid": "twice daily",
  "tid": "three times daily",
  "qid": "four times daily",
  "qhs": "at bedtime",
  "qam": "every morning",
  "qpm": "every evening",
  "prn": "as needed",
  "q4h": "every 4 hours",
  "q6h": "every 6 hours",
  "q8h": "every 8 hours",
  "q12h": "every 12 hours",
  "q24h": "every 24 hours",
};

export function normalizeFrequency(f: string | null | undefined): string {
  if (!f) return "";
  let s = f.toLowerCase().trim();
  // Apply token-by-token mapping so "ibuprofen 400 mg q6h prn" → "... every 6 hours as needed"
  for (const [abbr, full] of Object.entries(FREQ_MAP)) {
    const re = new RegExp(`\\b${abbr}\\b`, "g");
    s = s.replace(re, full);
  }
  return s
    .replace(/\bevery\s+(\d+)\s*(hour|hr|hours|hrs)\b/g, "every $1 hours")
    .replace(/\btwice\s+a\s+day\b/g, "twice daily")
    .replace(/\bonce\s+a\s+day\b/g, "once daily")
    .replace(/\bthree\s+times\s+a\s+day\b/g, "three times daily")
    .replace(/\bfour\s+times\s+a\s+day\b/g, "four times daily")
    .replace(/\s+/g, " ")
    .trim();
}

const ROUTE_MAP: Record<string, string> = {
  "by mouth": "po",
  "oral": "po",
  "orally": "po",
  "intravenous": "iv",
  "intravenously": "iv",
  "intramuscular": "im",
  "intramuscularly": "im",
  "subcutaneous": "sc",
  "subcutaneously": "sc",
  "subq": "sc",
  "topically": "topical",
  "inhalation": "inhaled",
  "sublingual": "sl",
  "rectal": "pr",
  "rectally": "pr",
};

export function normalizeRoute(r: string | null | undefined): string {
  if (!r) return "";
  let s = r.toLowerCase().trim();
  for (const [k, v] of Object.entries(ROUTE_MAP)) {
    if (s === k) return v;
  }
  return s;
}

export function normalizeMedName(n: string | null | undefined): string {
  if (!n) return "";
  return n.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

export function bpEquals(a: string | null, b: string | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.replace(/\s/g, "") === b.replace(/\s/g, "");
}
