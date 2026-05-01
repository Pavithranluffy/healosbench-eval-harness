import { Hono } from "hono";
import { loadCases } from "../lib/dataset";

export const transcriptsRouter = new Hono();

transcriptsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const cases = await loadCases([id]);
  if (cases.length === 0) return c.json({ error: "transcript not found" }, 404);
  const found = cases[0]!;
  return c.json({ id: found.id, transcript: found.transcript, gold: found.gold });
});
