/** ChatGPT (OpenAI Responses API) behind the app's AI calls. The app builds
 * its requests in one format (lib/gemini.ts: contents, function tools, JSON
 * schema, web search); this module turns such a request into an OpenAI
 * request and turns OpenAI's answer back into the same answer format, so the
 * assistant and the autofills work unchanged with either provider.
 *
 * No browser or server code here: both the page (desktop) and the server
 * (/api/ai) use it. */
import type { GeminiContent, GeminiPart, GeminiRequest, GeminiSchema } from "./gemini";

export const OPENAI_URL = "https://api.openai.com/v1/responses";

type JsonSchema = { type?: string; description?: string; enum?: string[]; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema };

/** The app's schema (OBJECT / STRING ...) as JSON Schema (object / string ...). */
export function toJsonSchema(s: GeminiSchema): JsonSchema {
  const out: JsonSchema = { type: s.type.toLowerCase() };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)]));
  if (s.required) out.required = s.required;
  if (s.items) out.items = toJsonSchema(s.items);
  return out;
}

const callId = (p: { id?: string; name: string }, i: number) => p.id || `call_${p.name}_${i}`;

/** One request in the app's format as an OpenAI Responses request. */
export function toOpenAIRequest(req: GeminiRequest, model: string): Record<string, unknown> {
  const input: Record<string, unknown>[] = [];
  let n = 0;
  const pendingIds: Record<string, string[]> = {};
  for (const c of req.contents as GeminiContent[]) {
    const text = c.parts.filter((p: GeminiPart) => p.text && !p.thought).map((p) => p.text).join("");
    if (text) input.push({ role: c.role === "model" ? "assistant" : "user", content: text });
    for (const p of c.parts) {
      if (p.functionCall) {
        const id = callId(p.functionCall, n++);
        (pendingIds[p.functionCall.name] ??= []).push(id);
        input.push({ type: "function_call", call_id: id, name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) });
      }
      if (p.functionResponse) {
        const id = p.functionResponse.id || pendingIds[p.functionResponse.name]?.shift() || `call_${p.functionResponse.name}_${n++}`;
        input.push({ type: "function_call_output", call_id: id, output: JSON.stringify(p.functionResponse.response ?? {}) });
      }
    }
  }
  const body: Record<string, unknown> = { model, input, store: false };
  const instructions = req.systemInstruction?.parts.map((p) => p.text).join("\n");
  if (instructions) body.instructions = instructions;
  const tools: Record<string, unknown>[] = [];
  for (const t of req.tools ?? []) {
    if ("googleSearch" in t) tools.push({ type: "web_search" });
    else for (const f of t.functionDeclarations) tools.push({ type: "function", name: f.name, description: f.description, parameters: toJsonSchema(f.parameters), strict: false });
  }
  if (tools.length) body.tools = tools;
  const g = req.generationConfig;
  if (g?.responseSchema) body.text = { format: { type: "json_schema", name: "answer", schema: toJsonSchema(g.responseSchema), strict: false } };
  else if (g?.responseMimeType === "application/json") body.text = { format: { type: "json_object" } };
  if (g?.maxOutputTokens) body.max_output_tokens = g.maxOutputTokens;
  // Temperature is left out: the GPT-5 family does not accept it.
  return body;
}

interface OpenAIOutputItem {
  type: string;
  content?: { type: string; text?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
}

/** OpenAI's answer as the app's answer format ({ candidates: [{ content, finishReason }] }). */
export function fromOpenAIResponse(body: string): string {
  const data = JSON.parse(body) as { status?: string; incomplete_details?: { reason?: string }; output?: OpenAIOutputItem[] };
  const parts: GeminiPart[] = [];
  for (const item of data.output ?? []) {
    if (item.type === "message") {
      for (const c of item.content ?? []) if (c.type === "output_text" && c.text) parts.push({ text: c.text });
    } else if (item.type === "function_call" && item.name) {
      let args: Record<string, unknown> = {};
      try { args = item.arguments ? JSON.parse(item.arguments) : {}; } catch { args = {}; }
      parts.push({ functionCall: { id: item.call_id, name: item.name, args } });
    }
  }
  const finishReason = data.status === "incomplete" ? (data.incomplete_details?.reason === "max_output_tokens" ? "MAX_TOKENS" : "OTHER") : "STOP";
  return JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason }] });
}

/** A failed OpenAI call as a message a user can act on. */
export function openAIErrorMessage(status: number, body: string): string {
  let msg = body;
  let code = "";
  try {
    const e = (JSON.parse(body) as { error?: { message?: string; code?: string; type?: string } }).error;
    msg = e?.message ?? body;
    code = e?.code ?? e?.type ?? "";
  } catch {
    // not JSON: use the raw text
  }
  if (status === 401) return "The ChatGPT (OpenAI) API key was rejected. Check it on the Super Admin's Billori page.";
  if (status === 429 && /insufficient_quota|billing|quota/i.test(`${code} ${msg}`)) return "The OpenAI account has no credit left. Add credit at platform.openai.com > Billing.";
  if (status === 429) return "ChatGPT is receiving too many requests. Wait a minute and try again.";
  if (status === 404 || /model_not_found|does not exist/i.test(`${code} ${msg}`)) return `This ChatGPT model is not available to the key. Choose another model on the Billori page. (${msg.slice(0, 120)})`;
  return `ChatGPT error ${status}: ${msg.slice(0, 300)}`;
}

/** Calls OpenAI with any POST function (fetch on the server, the desktop's HTTP plugin in the app).
 * Older accounts know web search as "web_search_preview": the call is retried with that name. */
export async function callOpenAI(
  post: (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  const send = async (b: Record<string, unknown>) => {
    const res = await post(OPENAI_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(b), signal });
    return { status: res.status, body: await res.text() };
  };
  let r = await send(body);
  const tools = body.tools as { type: string }[] | undefined;
  if (r.status === 400 && tools?.some((t) => t.type === "web_search") && /web_search/i.test(r.body)) {
    r = await send({ ...body, tools: tools.map((t) => (t.type === "web_search" ? { type: "web_search_preview" } : t)) });
  }
  if (r.status < 200 || r.status >= 300) return r;
  return { status: r.status, body: fromOpenAIResponse(r.body) };
}
