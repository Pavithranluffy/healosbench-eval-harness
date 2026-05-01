import { EXTRACTION_JSON_SCHEMA } from "@test-evals/shared";
import type { ToolDef } from "./provider";

export const EXTRACTION_TOOL_NAME = "record_extraction";

/**
 * Single tool the model is forced to call. Anthropic enforces the input_schema,
 * which is exactly the JSON Schema from data/schema.json — so a successful
 * tool call gives us schema-valid JSON without any string-parsing.
 */
export const extractionTool: ToolDef = {
  name: EXTRACTION_TOOL_NAME,
  description:
    "Record the structured clinical extraction for the provided transcript. Call this exactly once with the full extraction.",
  input_schema: EXTRACTION_JSON_SCHEMA as unknown as object,
};
