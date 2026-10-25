/** The Billori assistant's calls to Gemini, made by the server for the web
 * version, so the API key never reaches the browser. The key is the
 * business's own (if one was saved) or the global key set by the Super Admin. */
import { serverDb, HttpError } from "./db";
import type { Caller } from "./sqlPolicy";
import {
  GEMINI_MODELS, DEFAULT_GEMINI_MODEL, GEMINI_KEY_SETTING, GEMINI_MODEL_SETTING, BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING, BILLORI_ENABLED_SETTING,
} from "../config/aiModels";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_BODY = 1_000_000;
const MAX_TIMEOUT = 120_000;
/** Calls per user per minute. */
const RATE = 30;
const recent = new Map<string, number[]>();

async function settings(keys: string[]): Promise<Map<string, string>> {
  const rs = await serverDb().execute({ sql: `SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`, args: keys });
  return new Map(rs.rows.map((r) => [String(r.key), r.value == null ? "" : String(r.value)]));
}

const settingKeys = (t: string | null) => {
  const own = (k: string) => (t ? `${t}::${k}` : k);
  return { enabled: own(BILLORI_ENABLED_SETTING), key: own(GEMINI_KEY_SETTING), model: own(GEMINI_MODEL_SETTING) };
};

/** The key and model this caller's business uses, or null when the assistant is off or not set up. */
export async function aiConfigFor(caller: Caller): Promise<{ apiKey: string; model: string } | null> {
  const k = settingKeys(caller.tenantId);
  return pickAiConfig(caller.tenantId, await settings([k.enabled, k.key, k.model, BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING]));
}

/** The business's own key first, then the global key; null when turned off or no key. */
export function pickAiConfig(t: string | null, s: Map<string, string>): { apiKey: string; model: string } | null {
  const own = (k: string) => (t ? `${t}::${k}` : k);
  if (t && s.get(own(BILLORI_ENABLED_SETTING)) === "false") return null;
  const apiKey = ((t ? s.get(own(GEMINI_KEY_SETTING)) : "") || s.get(BILLORI_KEY_SETTING) || "").trim();
  if (!apiKey) return null;
  const model = (t ? s.get(own(GEMINI_MODEL_SETTING)) : "") || s.get(BILLORI_MODEL_SETTING) || "";
  return { apiKey, model: GEMINI_MODELS.some((m) => m.id === model) ? model : DEFAULT_GEMINI_MODEL };
}

function limit(userId: string) {
  const now = Date.now();
  const calls = (recent.get(userId) ?? []).filter((x) => now - x < 60_000);
  if (calls.length >= RATE) throw new HttpError(429, "Too many assistant requests. Wait a minute and try again.");
  calls.push(now);
  recent.set(userId, calls);
}

/** One generateContent call. Returns Gemini's status and body as they came, for the page to read. */
export async function generateForCaller(caller: Caller, body: { request?: unknown; model?: string; timeoutMs?: number }): Promise<{ status: number; body: string }> {
  const cfg = await aiConfigFor(caller);
  if (!cfg) throw new HttpError(403, "Billori AI is not set up or is turned off for this business.");
  if (!body.request || typeof body.request !== "object") throw new HttpError(400, "No request.");
  const payload = JSON.stringify(body.request);
  if (payload.length > MAX_BODY) throw new HttpError(413, "The request is too large.");
  const model = body.model && GEMINI_MODELS.some((m) => m.id === body.model) ? body.model : cfg.model;
  limit(caller.userId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(body.timeoutMs) || 60_000, 5_000), MAX_TIMEOUT));
  try {
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey }, body: payload, signal: controller.signal,
    });
    return { status: res.status, body: await res.text() };
  } catch {
    if (controller.signal.aborted) throw new HttpError(504, "Gemini took too long to answer. Try again.");
    throw new HttpError(502, "The server could not reach Gemini.");
  } finally {
    clearTimeout(timer);
  }
}
