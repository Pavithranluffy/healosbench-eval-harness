import { describe, expect, test } from "bun:test";
import { normalizeDose, normalizeFrequency, normalizeRoute, normalizeMedName, bpEquals } from "../normalize";
import { fuzzyScore, fuzzyEquals, tokenSetRatio, levenshteinRatio } from "../fuzzy";

describe("dose normalization", () => {
  test.each([
    ["10 mg", "10mg"],
    ["500 milligrams", "500mg"],
    ["1 gram", "1g"],
  ])("%s → %s match", (a, b) => {
    expect(normalizeDose(a)).toBe(normalizeDose(b));
  });
});

describe("frequency normalization", () => {
  test.each([
    ["BID", "twice daily"],
    ["TID", "three times daily"],
    ["q6h", "every 6 hours"],
    ["once a day", "once daily"],
  ])("%s ≡ %s", (a, b) => {
    expect(normalizeFrequency(a)).toBe(normalizeFrequency(b));
  });

  test("PRN preserved", () => {
    expect(normalizeFrequency("ibuprofen 400 mg q6h prn")).toContain("every 6 hours");
    expect(normalizeFrequency("q6h prn")).toContain("as needed");
  });
});

describe("route normalization", () => {
  test("by mouth → po", () => expect(normalizeRoute("by mouth")).toBe("po"));
  test("intravenous → iv", () => expect(normalizeRoute("Intravenous")).toBe("iv"));
});

describe("med name normalization", () => {
  test("strips punctuation and case", () => {
    expect(normalizeMedName("Ibuprofen!")).toBe("ibuprofen");
  });
});

describe("BP equality", () => {
  test("whitespace tolerant", () => {
    expect(bpEquals("120/80", " 120 / 80 ")).toBe(true);
    expect(bpEquals("120/80", "121/80")).toBe(false);
  });
});

describe("fuzzy", () => {
  test("token set ratio robust to word order", () => {
    expect(tokenSetRatio("sore throat and stuffy nose", "stuffy nose and sore throat")).toBe(1);
  });
  test("levenshtein ratio handles small typos", () => {
    expect(levenshteinRatio("amoxicillin", "amoxicilin")).toBeGreaterThan(0.9);
  });
  test("fuzzy hybrid above threshold", () => {
    expect(fuzzyEquals("ibuprofen", "Ibuprofen", 0.8)).toBe(true);
  });
  test("nulls handled", () => {
    expect(fuzzyScore(null, null)).toBe(1);
    expect(fuzzyScore("x", null)).toBe(0);
  });
});
