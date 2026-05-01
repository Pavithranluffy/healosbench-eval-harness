/**
 * Thin client to the Hono server. The browser only ever talks to /api/v1/*
 * here — the API key is server-side.
 */

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const apiBase = BASE;
