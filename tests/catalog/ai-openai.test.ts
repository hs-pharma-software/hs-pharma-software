/** ChatGPT behind the app's AI calls: requests are translated to the OpenAI
 * Responses API and answers back, so the assistant (function calls), the JSON
 * autofills and the category web search work unchanged. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { toOpenAIRequest, fromOpenAIResponse, openAIErrorMessage, callOpenAI } from "@/lib/aiOpenAI";
import { geminiGenerate } from "@/lib/gemini";
import { categoriesRepo, subCategoriesRepo } from "@/lib/repo/categories";
import { suggestCategory } from "@/lib/categoryAutofill";

const T = "pharm-a";
const tenant: SessionTenant = {
  id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};
let db: DatabaseSync;
const realFetch = globalThis.fetch;
const aiSkip = process.env.TENANT_SCOPE === "1" ? "AI keys are server-only under tenant scope" : false;

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
});
afterEach(() => { globalThis.fetch = realFetch; });

const openaiAnswer = (output: unknown[], status = "completed") => JSON.stringify({ status, output });

test("requests: instructions, conversation, function tools, JSON schema, web search", () => {
  const body = toOpenAIRequest({
    systemInstruction: { parts: [{ text: "Be brief." }] },
    contents: [
      { role: "user", parts: [{ text: "Stock of Panadol?" }] },
      { role: "model", parts: [{ functionCall: { id: "c1", name: "find_products", args: { q: "panadol" } } }] },
      { role: "user", parts: [{ functionResponse: { id: "c1", name: "find_products", response: { result: [{ name: "Panadol", qty: 4 }] } } }] },
    ],
    tools: [
      { functionDeclarations: [{ name: "find_products", description: "Search", parameters: { type: "OBJECT", properties: { q: { type: "STRING" } }, required: ["q"] } }] },
      { googleSearch: {} },
    ],
    generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { n: { type: "INTEGER" } } }, temperature: 0.2 },
  }, "gpt-4.1-mini");
  assert.equal(body.model, "gpt-4.1-mini");
  assert.equal(body.instructions, "Be brief.");
  assert.deepEqual(body.input, [
    { role: "user", content: "Stock of Panadol?" },
    { type: "function_call", call_id: "c1", name: "find_products", arguments: JSON.stringify({ q: "panadol" }) },
    { type: "function_call_output", call_id: "c1", output: JSON.stringify({ result: [{ name: "Panadol", qty: 4 }] }) },
  ]);
  assert.deepEqual(body.tools, [
    { type: "function", name: "find_products", description: "Search", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] }, strict: false },
    { type: "web_search" },
  ]);
  assert.deepEqual(body.text, { format: { type: "json_schema", name: "answer", schema: { type: "object", properties: { n: { type: "integer" } } }, strict: false } });
  assert.equal("temperature" in body, false, "GPT-5 models refuse a temperature");
});

test("answers: text and function calls come back in the app's format; errors are explained", () => {
  const out = JSON.parse(fromOpenAIResponse(openaiAnswer([
    { type: "web_search_call", id: "ws" },
    { type: "function_call", call_id: "call_9", name: "find_products", arguments: "{\"q\":\"brufen\"}" },
    { type: "message", content: [{ type: "output_text", text: "Looking it up." }] },
  ])));
  assert.deepEqual(out.candidates[0].content.parts, [{ functionCall: { id: "call_9", name: "find_products", args: { q: "brufen" } } }, { text: "Looking it up." }]);
  assert.equal(out.candidates[0].finishReason, "STOP");
  assert.match(openAIErrorMessage(401, "{}"), /key was rejected/);
  assert.match(openAIErrorMessage(429, JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota" } })), /no credit left/);
  assert.match(openAIErrorMessage(404, JSON.stringify({ error: { code: "model_not_found", message: "The model x does not exist" } })), /not available/);
});

test("web search falls back to the older tool name when an account does not know the new one", async () => {
  const sent: { tools: { type: string }[] }[] = [];
  const post = async (_url: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    sent.push(b);
    if (b.tools[0].type === "web_search") return { status: 400, text: async () => JSON.stringify({ error: { message: "Unsupported tool type: web_search" } }) };
    return { status: 200, text: async () => openaiAnswer([{ type: "message", content: [{ type: "output_text", text: "NAME: X" }] }]) };
  };
  const r = await callOpenAI(post, "sk", { model: "m", input: [], tools: [{ type: "web_search" }] });
  assert.equal(r.status, 200);
  assert.deepEqual(sent.map((b) => b.tools[0].type), ["web_search", "web_search_preview"]);
});

test("with ChatGPT chosen, a call goes to OpenAI with the key and the answer is read as usual", { skip: aiSkip }, async () => {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('ai_provider', 'openai', 'x'), ('openai_api_key', 'sk-test', 'x'), ('billori_api_key', 'gemini-key', 'x')`).run();
  const calls: { url: string; auth: string }[] = [];
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization ?? "" });
    return new Response(openaiAnswer([{ type: "message", content: [{ type: "output_text", text: "OK" }] }]), { status: 200 });
  }) as typeof fetch;
  const r = await geminiGenerate({ contents: [{ role: "user", parts: [{ text: "Reply OK" }] }] });
  assert.equal(r.text, "OK");
  assert.deepEqual(calls, [{ url: "https://api.openai.com/v1/responses", auth: "Bearer sk-test" }]);
});

test("category from the description through ChatGPT, including the online step", { skip: aiSkip }, async () => {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('ai_provider', 'openai', 'x'), ('openai_api_key', 'sk-test', 'x')`).run();
  const pain = await categoriesRepo.create({ name: "PAIN KILLER", description: null, flat_discount_pct: 0, image_url: null });
  const answers = [`{"index":-1,"reason":"none"}`, "NAME: ANTI ANXIETY\nWHY: Alprazolam is a benzodiazepine.", "NAME: BENZODIAZEPINES\nWHY: class"];
  const bodies: { tools?: { type: string }[] }[] = [];
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(openaiAnswer([{ type: "message", content: [{ type: "output_text", text: answers.shift() }] }]), { status: 200 });
  }) as typeof fetch;
  const s = await suggestCategory({
    name: "Xanax", description: "Alprazolam", categories: [{ id: pain.id, name: pain.name }],
    loadSubCategories: async (id) => (await subCategoriesRepo.list({ where: "category_id = ?", params: [id] })).map((x) => ({ id: x.id, name: x.name })),
    createCategory: async (n) => (await categoriesRepo.create({ name: n, description: null, flat_discount_pct: 0, image_url: null })).id,
    createSubCategory: async (c, n) => (await subCategoriesRepo.create({ category_id: c, name: n, description: null, image_url: null })).id,
  });
  assert.equal(s?.source, "web");
  assert.equal((await categoriesRepo.get(s!.categoryId!))!.name, "ANTI ANXIETY");
  assert.equal((await subCategoriesRepo.get(s!.subCategoryId!))!.name, "BENZODIAZEPINES");
  assert.deepEqual(bodies[1].tools, [{ type: "web_search" }], "the online step uses ChatGPT's web search");
});

test("Gemini: when a model has used its free requests for today, the next model answers", { skip: aiSkip }, async () => {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('ai_provider', 'gemini', 'x'), ('billori_api_key', 'g-key', 'x'), ('billori_model', 'gemini-3.8-flash', 'x')`).run();
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const model = /models\/([^:]+):/.exec(String(url))?.[1] ?? "";
    asked.push(model);
    if (model === "gemini-3.8-flash") {
      return new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 20" } }), { status: 429 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "OK" }] }, finishReason: "STOP" }] }), { status: 200 });
  }) as typeof fetch;
  const r = await geminiGenerate({ contents: [{ role: "user", parts: [{ text: "Reply OK" }] }] });
  assert.equal(r.text, "OK");
  assert.deepEqual(asked, ["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  const again = await geminiGenerate({ contents: [{ role: "user", parts: [{ text: "Again" }] }] });
  assert.equal(again.text, "OK");
  assert.deepEqual(asked.slice(2), ["gemini-3.5-flash-lite"], "a used-up model is skipped for the rest of the day");
});
