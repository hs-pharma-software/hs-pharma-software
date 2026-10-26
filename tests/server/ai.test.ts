/** The server picks the AI service and key; the page never gets the key. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAiConfig } from "@/server/ai";
import { DEFAULT_GEMINI_MODEL, DEFAULT_OPENAI_MODEL } from "@/config/aiModels";

const m = (o: Record<string, string>) => new Map(Object.entries(o));

test("Gemini: own key first, then the global key; turned off or no key means no assistant", () => {
  assert.deepEqual(pickAiConfig("h", m({ billori_api_key: "G" })), { provider: "gemini", apiKey: "G", model: DEFAULT_GEMINI_MODEL });
  assert.deepEqual(pickAiConfig("h", m({ billori_api_key: "G", "h::ai_gemini_api_key": "OWN", billori_model: "gemini-3.6-flash" })), { provider: "gemini", apiKey: "OWN", model: "gemini-3.6-flash" });
  assert.equal(pickAiConfig("h", m({ billori_api_key: "G", "h::billori_enabled": "false" })), null);
  assert.equal(pickAiConfig("h", m({})), null);
  assert.equal(pickAiConfig("h", m({ billori_api_key: "G", billori_model: "not-a-model" }))!.model, DEFAULT_GEMINI_MODEL, "unknown models fall back");
  assert.equal(pickAiConfig("h", m({ "other::ai_gemini_api_key": "X" })), null, "another business's key is never used");
});

test("ChatGPT: chosen by the Super Admin, or used when it is the only key; Gemini still selectable", () => {
  assert.deepEqual(pickAiConfig("h", m({ openai_api_key: "sk-1" })), { provider: "openai", apiKey: "sk-1", model: DEFAULT_OPENAI_MODEL });
  assert.deepEqual(pickAiConfig("h", m({ ai_provider: "openai", openai_api_key: "sk-1", openai_model: "gpt-4o", billori_api_key: "G" })), { provider: "openai", apiKey: "sk-1", model: "gpt-4o" });
  assert.equal(pickAiConfig("h", m({ ai_provider: "gemini", openai_api_key: "sk-1", billori_api_key: "G" }))!.provider, "gemini");
  assert.equal(pickAiConfig("h", m({ ai_provider: "openai", billori_api_key: "G" }))!.provider, "gemini", "chosen ChatGPT without a key falls back to the key there is");
  assert.equal(pickAiConfig("h", m({ openai_api_key: "sk-1", "h::billori_enabled": "false" })), null, "a business that turned the assistant off gets nothing");
});
