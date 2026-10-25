/** Step 5: the server picks the assistant's key; the page never gets it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAiConfig } from "@/server/ai";
import { DEFAULT_GEMINI_MODEL } from "@/config/aiModels";

const m = (o: Record<string, string>) => new Map(Object.entries(o));

test("own key first, then the global key; turned off or no key means no assistant", () => {
  assert.deepEqual(pickAiConfig("h", m({ billori_api_key: "G" })), { apiKey: "G", model: DEFAULT_GEMINI_MODEL });
  assert.deepEqual(pickAiConfig("h", m({ billori_api_key: "G", "h::ai_gemini_api_key": "OWN", billori_model: "gemini-3.6-flash" })), { apiKey: "OWN", model: "gemini-3.6-flash" });
  assert.equal(pickAiConfig("h", m({ billori_api_key: "G", "h::billori_enabled": "false" })), null);
  assert.equal(pickAiConfig("h", m({})), null);
  assert.equal(pickAiConfig("h", m({ billori_api_key: "G", billori_model: "not-a-model" }))!.model, DEFAULT_GEMINI_MODEL, "unknown models fall back");
  assert.equal(pickAiConfig("h", m({ "other::ai_gemini_api_key": "X" })), null, "another business's key is never used");
});
