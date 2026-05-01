import { env } from "@test-evals/env/server";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

import * as schema from "./schema";

export * from "./schema";

export function createDb() {
  const sqlite = new Database(env.DATABASE_URL.replace("file:", ""));
  return drizzle(sqlite, { schema });
}

export const db = createDb();
