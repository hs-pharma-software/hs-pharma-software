import { getSetting, getGlobalSetting } from "./repo/settings";
import { SERVER_DB, serverJson } from "./serverMode";
import { isTauriShell } from "./platform";
import {
  GEMINI_KEY_SETTING, GEMINI_MODEL_SETTING, BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING, BILLORI_ENABLED_SETTING, GEMINI_MODELS, DEFAULT_GEMINI_MODEL,
  AI_PROVIDER_SETTING, OPENAI_KEY_SETTING, OPENAI_MODEL_SETTING, OPENAI_MODELS, DEFAULT_OPENAI_MODEL, resolveProvider, type AiProvider,
} from "../config/aiModels";
import { toOpenAIRequest, callOpenAI, openAIErrorMessage } from "./aiOpenAI";

export {
  GEMINI_KEY_SETTING, GEMINI_MODEL_SETTING, BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING, BILLORI_ENABLED_SETTING, GEMINI_MODELS, DEFAULT_GEMINI_MODEL,
  AI_PROVIDER_SETTING, OPENAI_KEY_SETTING, OPENAI_MODEL_SETTING, OPENAI_MODELS, DEFAULT_OPENAI_MODEL,
};

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
  return (await aiConfig().catch(() => null)) !== null;
}

/** The provider, key and model to use: ChatGPT or Gemini, as the Super Admin chose. */
async function aiConfig(): Promise<{ provider: AiProvider; apiKey: string; model: string }> {
  const enabled = await getSetting(BILLORI_ENABLED_SETTING);
  if (enabled === "false") throw new Error("Billori AI Assistant is disabled. Enable it in Settings.");

  // Gemini: the tenant's own key first, then the global key set by the admin. ChatGPT: the global key.
  const [chosen, openaiKey, openaiModel, tenantKey, tenantModel, globalKey, globalModel] = await Promise.all([
    getGlobalSetting(AI_PROVIDER_SETTING),
    getGlobalSetting(OPENAI_KEY_SETTING),
    getGlobalSetting(OPENAI_MODEL_SETTING),
    getSetting(GEMINI_KEY_SETTING),
    getSetting(GEMINI_MODEL_SETTING),
    getGlobalSetting(BILLORI_KEY_SETTING),
    getGlobalSetting(BILLORI_MODEL_SETTING),
  ]);
  const geminiKey = (tenantKey ?? "").trim() || (globalKey ?? "").trim();
  const provider = resolveProvider(chosen, { openai: (openaiKey ?? "").trim(), gemini: geminiKey });
  if (!provider) throw new Error("Billori AI is not configured yet. Contact the administrator.");
  if (provider === "openai") {
    return { provider, apiKey: (openaiKey ?? "").trim(), model: (openaiModel ?? "").trim() || DEFAULT_OPENAI_MODEL };
  }
  const model = tenantModel ?? globalModel ?? null;
  return { provider, apiKey: geminiKey, model: GEMINI_MODELS.some((m) => m.id === model) ? model! : DEFAULT_GEMINI_MODEL };
}

/** Turns AI service failures into messages a shop user can act on. */
function errorMessage(status: number, body: string, provider: AiProvider): string {
  if (provider === "openai") return openAIErrorMessage(status, body);
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

/** A POST through the desktop's HTTP plugin, or fetch in a browser. */
async function anyPost(url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal }): Promise<{ status: number; text(): Promise<string> }> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, init);
  }
  return fetch(url, init);
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
  let provider: AiProvider = "gemini";
  if (viaServer()) {
    const res = await serverJson<{ status: number; body: string; provider?: AiProvider }>("/api/ai/", { request: req, model: modelOverride, timeoutMs });
    ({ status, body } = res);
    provider = res.provider ?? "gemini";
  } else {
    const cfg = await aiConfig();
    provider = cfg.provider;
    const { apiKey, model } = cfg;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const service = provider === "openai" ? "ChatGPT" : "Gemini";
    try {
      if (provider === "openai") {
        // A Gemini model override (e.g. from the FBR autofill) does not apply to ChatGPT.
        ({ status, body } = await callOpenAI(anyPost, apiKey, toOpenAIRequest(req, model), controller.signal));
      } else {
        const res = await httpPost(
          `${BASE}/${modelOverride ?? model}:generateContent`,
          apiKey,
          JSON.stringify(req),
          controller.signal,
        );
        status = res.status;
        body = await res.text();
      }
    } catch (e) {
      if (controller.signal.aborted) throw new Error(`${service} took too long to answer. Try again.`);
      throw new Error(`Could not reach ${service}. Check the internet connection. (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      clearTimeout(timer);
    }
  }
  if (status < 200 || status >= 300) throw new Error(errorMessage(status, body, provider));

  const data = JSON.parse(body) as {
    candidates?: { content?: GeminiContent; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) throw new Error(`The AI service blocked this request (${data.promptFeedback.blockReason}).`);
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
