/** Gemini text models offered for the Billori assistant (shared by the page and the server). */
export const GEMINI_MODELS = [
  { id: "gemini-3.8-flash",      label: "Gemini 3.8 Flash (recommended)" },
  { id: "gemini-3.6-flash",      label: "Gemini 3.6 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (fastest, highest free limits)" },
];
export const DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0].id;

/** Settings keys. Tenant keys are stored as "<tenant>::<key>"; Billori keys are global. */
export const GEMINI_KEY_SETTING = "ai_gemini_api_key";
export const GEMINI_MODEL_SETTING = "ai_gemini_model";
export const BILLORI_KEY_SETTING = "billori_api_key";
export const BILLORI_MODEL_SETTING = "billori_model";
export const BILLORI_ENABLED_SETTING = "billori_enabled";

/** Which AI service the assistant and the autofills use: "openai" (ChatGPT) or "gemini". */
export const AI_PROVIDER_SETTING = "ai_provider";
export type AiProvider = "openai" | "gemini";
/** Global ChatGPT key and model, set by the Super Admin. */
export const OPENAI_KEY_SETTING = "openai_api_key";
export const OPENAI_MODEL_SETTING = "openai_model";
export const OPENAI_MODELS = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini (recommended: fast, low cost)" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-5-mini", label: "GPT-5 mini" },
  { id: "gpt-5", label: "GPT-5" },
];
export const DEFAULT_OPENAI_MODEL = OPENAI_MODELS[0].id;

/** The provider to use: the one chosen, else whichever has a key (ChatGPT first). */
export function resolveProvider(chosen: string | null | undefined, keys: { openai: string; gemini: string }): AiProvider | null {
  if (chosen === "openai" && keys.openai) return "openai";
  if (chosen === "gemini" && keys.gemini) return "gemini";
  if (keys.openai) return "openai";
  if (keys.gemini) return "gemini";
  return null;
}
