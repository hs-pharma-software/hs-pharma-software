/** The AI calls of the web version (assistant, autofills), made by the
 * server so the API key never reaches the browser. The service is ChatGPT
 * (OpenAI) or Gemini, as the Super Admin chose on the Billori page. Gemini
 * uses the business's own key if one was saved, else the global key. */
import { serverDb, HttpError } from "./db";
import type { Caller } from "./sqlPolicy";
import {
  GEMINI_MODELS, DEFAULT_GEMINI_MODEL, GEMINI_KEY_SETTING, GEMINI_MODEL_SETTING, BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING, BILLORI_ENABLED_SETTING,
  AI_PROVIDER_SETTING, OPENAI_KEY_SETTING, OPENAI_MODEL_SETTING, DEFAULT_OPENAI_MODEL, resolveProvider, type AiProvider,
} from "../config/aiModels";
import { toOpenAIRequest, callOpenAI } from "../lib/aiOpenAI";
import type { GeminiRequest } from "../lib/gemini";

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

export interface AiConfig { provider: AiProvider; apiKey: string; model: string }

/** The service, key and model this caller's business uses, or null when the assistant is off or not set up. */
export async function aiConfigFor(caller: Caller): Promise<AiConfig | null> {
  const k = settingKeys(caller.tenantId);
  return pickAiConfig(caller.tenantId, await settings([
    k.enabled, k.key, k.model, BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING, AI_PROVIDER_SETTING, OPENAI_KEY_SETTING, OPENAI_MODEL_SETTING,
  ]));
}

/** ChatGPT or Gemini as chosen (else whichever has a key); null when turned off or no key. */
export function pickAiConfig(t: string | null, s: Map<string, string>): AiConfig | null {
  const own = (k: string) => (t ? `${t}::${k}` : k);
  if (t && s.get(own(BILLORI_ENABLED_SETTING)) === "false") return null;
  const geminiKey = ((t ? s.get(own(GEMINI_KEY_SETTING)) : "") || s.get(BILLORI_KEY_SETTING) || "").trim();
  const openaiKey = (s.get(OPENAI_KEY_SETTING) ?? "").trim();
  const provider = resolveProvider(s.get(AI_PROVIDER_SETTING), { openai: openaiKey, gemini: geminiKey });
  if (provider === "openai") return { provider, apiKey: openaiKey, model: (s.get(OPENAI_MODEL_SETTING) ?? "").trim() || DEFAULT_OPENAI_MODEL };
  if (provider === "gemini") {
    const model = (t ? s.get(own(GEMINI_MODEL_SETTING)) : "") || s.get(BILLORI_MODEL_SETTING) || "";
    return { provider, apiKey: geminiKey, model: GEMINI_MODELS.some((m) => m.id === model) ? model : DEFAULT_GEMINI_MODEL };
  }
  return null;
}

function limit(userId: string) {
  const now = Date.now();
  const calls = (recent.get(userId) ?? []).filter((x) => now - x < 60_000);
  if (calls.length >= RATE) throw new HttpError(429, "Too many assistant requests. Wait a minute and try again.");
  calls.push(now);
  recent.set(userId, calls);
}

/** One AI call. Returns the status and the answer in the app's format (an
 * OpenAI answer is converted), with the provider, for the page to read. */
export async function generateForCaller(caller: Caller, body: { request?: unknown; model?: string; timeoutMs?: number }): Promise<{ status: number; body: string; provider: AiProvider }> {
  const cfg = await aiConfigFor(caller);
  if (!cfg) throw new HttpError(403, "Billori AI is not set up or is turned off for this business.");
  if (!body.request || typeof body.request !== "object") throw new HttpError(400, "No request.");
  const payload = JSON.stringify(body.request);
  if (payload.length > MAX_BODY) throw new HttpError(413, "The request is too large.");
  limit(caller.userId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(body.timeoutMs) || 60_000, 5_000), MAX_TIMEOUT));
  const service = cfg.provider === "openai" ? "ChatGPT" : "Gemini";
  try {
    if (cfg.provider === "openai") {
      const r = await callOpenAI(fetch, cfg.apiKey, toOpenAIRequest(body.request as GeminiRequest, cfg.model), controller.signal);
      return { ...r, provider: "openai" };
    }
    const model = body.model && GEMINI_MODELS.some((m) => m.id === body.model) ? body.model : cfg.model;
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey }, body: payload, signal: controller.signal,
    });
    return { status: res.status, body: await res.text(), provider: "gemini" };
  } catch {
    if (controller.signal.aborted) throw new HttpError(504, `${service} took too long to answer. Try again.`);
    throw new HttpError(502, `The server could not reach ${service}.`);
  } finally {
    clearTimeout(timer);
  }
}
