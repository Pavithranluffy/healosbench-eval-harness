import { z } from "zod";

export const VitalsSchema = z.object({
  bp: z.union([z.string().regex(/^[0-9]{2,3}\/[0-9]{2,3}$/), z.null()]),
  hr: z.union([z.number().int().min(20).max(250), z.null()]),
  temp_f: z.union([z.number().min(90).max(110), z.null()]),
  spo2: z.union([z.number().int().min(50).max(100), z.null()]),
});

export const MedicationSchema = z.object({
  name: z.string().min(1),
  dose: z.union([z.string(), z.null()]),
  frequency: z.union([z.string(), z.null()]),
  route: z.union([z.string(), z.null()]),
});

export const DiagnosisSchema = z.object({
  description: z.string().min(1),
  icd10: z.string().regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/).optional(),
});

export const FollowUpSchema = z.object({
  interval_days: z.union([z.number().int().min(0).max(730), z.null()]),
  reason: z.union([z.string(), z.null()]),
});

export const ClinicalExtractionSchema = z.object({
  chief_complaint: z.string().min(1),
  vitals: VitalsSchema,
  medications: z.array(MedicationSchema),
  diagnoses: z.array(DiagnosisSchema),
  plan: z.array(z.string().min(1)),
  follow_up: FollowUpSchema,
});

/** JSON Schema mirror of the data/schema.json — kept in sync intentionally; do not modify schema.json. */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["chief_complaint", "vitals", "medications", "diagnoses", "plan", "follow_up"],
  properties: {
    chief_complaint: { type: "string", minLength: 1 },
    vitals: {
      type: "object",
      additionalProperties: false,
      required: ["bp", "hr", "temp_f", "spo2"],
      properties: {
        bp: { type: ["string", "null"], pattern: "^[0-9]{2,3}/[0-9]{2,3}$" },
        hr: { type: ["integer", "null"], minimum: 20, maximum: 250 },
        temp_f: { type: ["number", "null"], minimum: 90, maximum: 110 },
        spo2: { type: ["integer", "null"], minimum: 50, maximum: 100 },
      },
    },
    medications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "dose", "frequency", "route"],
        properties: {
          name: { type: "string", minLength: 1 },
          dose: { type: ["string", "null"] },
          frequency: { type: ["string", "null"] },
          route: { type: ["string", "null"] },
        },
      },
    },
    diagnoses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description"],
        properties: {
          description: { type: "string", minLength: 1 },
          icd10: { type: "string", pattern: "^[A-Z][0-9]{2}(\\.[0-9A-Z]{1,4})?$" },
        },
      },
    },
    plan: { type: "array", items: { type: "string", minLength: 1 } },
    follow_up: {
      type: "object",
      additionalProperties: false,
      required: ["interval_days", "reason"],
      properties: {
        interval_days: { type: ["integer", "null"], minimum: 0, maximum: 730 },
        reason: { type: ["string", "null"] },
      },
    },
  },
} as const;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate an unknown value against the extraction schema using zod.
 * Returns flat error messages suitable for feeding back to the LLM in the retry loop.
 */
export function validateExtraction(value: unknown): ValidationResult {
  const result = ClinicalExtractionSchema.safeParse(value);
  if (result.success) return { valid: true, errors: [] };
  const errors = result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`);
  return { valid: false, errors };
}
