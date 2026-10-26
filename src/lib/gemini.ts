import { getSetting, getGlobalSetting } from "./repo/settings";
import { SERVER_DB, serverJson } from "./serverMode";
import { isTauriShell } from "./platform";
import {
  GEMINI_KEY_SETTING, GEMINI_MODEL_SETTING, BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING, BILLORI_ENABLED_SETTING, GEMINI_MODELS, DEFAULT_GEMINI_MODEL,
} from "../config/aiModels";

export { GEMINI_KEY_SETTING, GEMINI_MODEL_SETTING, BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING, BILLORI_ENABLED_SETTING, GEMINI_MODELS, DEFAULT_GEMINI_MODEL };

/** The web version through the server: the server holds the key and calls Gemini (src/server/ai.ts). */
const viaServer = () => SERVER_DB && !isTauriShell();

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

/** OpenAPI-subset schema used by Gemini for tool parameters and JSON output. */
export interface GeminiSchema {
  type: "OBJECT" | "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN" | "ARRAY";
  description?: string;
  enum?: string[];
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
}

export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: { text: string }[] };
  /** Function tools, or Google Search grounding ({ googleSearch: {} }) for answers that need current web information. */
  tools?: ({ functionDeclarations: { name: string; description: string; parameters: GeminiSchema }[] } | { googleSearch: Record<string, never> })[];
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    responseMimeType?: string;
    responseSchema?: GeminiSchema;
  };
}

export interface GeminiResult {
  /** The model's turn exactly as returned; send it back unchanged in later
   * requests (its parts may carry thought signatures). */
  content: GeminiContent;
  text: string;
  functionCalls: NonNullable<GeminiPart["functionCall"]>[];
  finishReason: string;
}

/** True when the Billori assistant has a usable key (global or tenant-own)
 * and is not explicitly disabled by this tenant. */
export async function hasAiKey(): Promise<boolean> {
  if (viaServer()) return (await serverJson<{ available: boolean }>("/api/ai/").catch(() => ({ available: false }))).available;
  const enabled = await getSetting(BILLORI_ENABLED_SETTING);
  if (enabled === "false") return false;
  const tenantKey = (await getSetting(GEMINI_KEY_SETTING)) ?? "";
  if (tenantKey.trim()) return true;
  return !!((await getGlobalSetting(BILLORI_KEY_SETTING)) ?? "").trim();
}

async function geminiConfig(): Promise<{ apiKey: string; model: string }> {
  const enabled = await getSetting(BILLORI_ENABLED_SETTING);
  if (enabled === "false") throw new Error("Billori AI Assistant is disabled. Enable it in Settings.");

  // Tenant-own key first; fall back to global Billori key set by admin.
  const [tenantKey, tenantModel, globalKey, globalModel] = await Promise.all([
    getSetting(GEMINI_KEY_SETTING),
    getSetting(GEMINI_MODEL_SETTING),
    getGlobalSetting(BILLORI_KEY_SETTING),
    getGlobalSetting(BILLORI_MODEL_SETTING),
  ]);
  const apiKey = (tenantKey ?? "").trim() || (globalKey ?? "").trim();
  if (!apiKey) throw new Error("Billori AI is not configured yet. Contact the administrator.");
  const model = tenantModel ?? globalModel ?? null;
  return { apiKey, model: GEMINI_MODELS.some((m) => m.id === model) ? model! : DEFAULT_GEMINI_MODEL };
}

/** Turns Gemini API failures into messages a shop user can act on. */
function errorMessage(status: number, body: string): string {
  let msg = body;
  try {
    msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
  } catch {
    // not JSON: use the raw body
  }
  if (status === 400 && /api key/i.test(msg)) return "Gemini API key was rejected. Check it in Settings > AI Assistant.";
  if (status === 403) return "This Gemini API key is not allowed to use the Gemini API. Create a key at aistudio.google.com/apikey.";
  if (status === 429) return "Gemini free-tier limit reached. Wait a minute and try again, or pick Flash-Lite in Settings > AI Assistant.";
  if (status === 503) return `Gemini is busy right now. Try again in a moment. (${msg.slice(0, 120)})`;
  return `Gemini API error ${status}: ${msg.slice(0, 300)}`;
}

/** Use Tauri HTTP plugin when inside the desktop shell; native fetch otherwise. */
async function httpPost(url: string, apiKey: string, body: string, signal: AbortSignal): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  const opts = {
    method: "POST" as const,
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body,
    signal,
  };
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, opts);
  }
  return fetch(url, opts);
}

/** One generateContent call — works in both Tauri desktop and browser preview. */
export async function geminiGenerate(req: GeminiRequest, timeoutMs = 60_000, modelOverride?: string): Promise<GeminiResult> {
  let status: number;
  let body: string;
  if (viaServer()) {
    ({ status, body } = await serverJson<{ status: number; body: string }>("/api/ai/", { request: req, model: modelOverride, timeoutMs }));
  } else {
    const { apiKey, model } = await geminiConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await httpPost(
        `${BASE}/${modelOverride ?? model}:generateContent`,
        apiKey,
        JSON.stringify(req),
        controller.signal,
      );
      status = res.status;
      body = await res.text();
    } catch (e) {
      if (controller.signal.aborted) throw new Error("Gemini took too long to answer. Try again.");
      throw new Error(`Could not reach Gemini. Check the internet connection. (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      clearTimeout(timer);
    }
  }
  if (status < 200 || status >= 300) throw new Error(errorMessage(status, body));

  const data = JSON.parse(body) as {
    candidates?: { content?: GeminiContent; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked this request (${data.promptFeedback.blockReason}).`);
  const cand = data.candidates?.[0];
  const content: GeminiContent = { role: "model", parts: cand?.content?.parts ?? [] };
  return {
    content,
    text: content.parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("")
      .trim(),
    functionCalls: content.parts.flatMap((p) => (p.functionCall ? [p.functionCall] : [])),
    finishReason: cand?.finishReason ?? "UNKNOWN",
  };
}

/** Quick check used by the Settings "Test" button. */
export async function testGemini(): Promise<string> {
  const r = await geminiGenerate({ contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }] }, 30_000);
  return r.text || "(empty reply)";
}
