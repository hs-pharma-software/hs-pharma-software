/** Gemini text models offered for the Billori assistant (shared by the page and the server). */
export const GEMINI_MODELS = [
  { id: "gemini-3.5-flash-lite",    label: "Gemini 3.5 Flash-Lite (recommended for the free tier)" },
  { id: "gemini-3.1-flash-lite",    label: "Gemini 3.1 Flash-Lite" },
  { id: "gemini-flash-lite-latest", label: "Gemini Flash-Lite (latest)" },
  { id: "gemini-3.5-flash",         label: "Gemini 3.5 Flash" },
  { id: "gemini-3.6-flash",         label: "Gemini 3.6 Flash" },
  { id: "gemini-3.7-flash",         label: "Gemini 3.7 Flash" },
  { id: "gemini-3.8-flash",         label: "Gemini 3.8 Flash (smartest, only 20 free requests a day)" },
];
export const DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0].id;

/** Models to try, in order, when the chosen one has used its free daily
 * requests or is no longer offered: each model has its own free allowance. */
export function geminiModelChain(preferred: string | null | undefined): string[] {
  const all = GEMINI_MODELS.map((m) => m.id);
  return preferred && all.includes(preferred) ? [preferred, ...all.filter((m) => m !== preferred)] : all;
}

/** Models found used up or gone today, skipped until tomorrow (per process / browser tab). */
const spent = new Map<string, string>();
const today = () => new Date().toISOString().slice(0, 10);
export const markGeminiSpent = (model: string) => spent.set(model, today());
export const geminiNotSpent = (models: string[]) => {
  const left = models.filter((m) => spent.get(m) !== today());
  // All used up today: ask only the first, so the user gets the quota message without seven calls.
  return left.length ? left : models.slice(0, 1);
};

/** A Gemini answer that means "try another model": daily quota used up, or the model is not offered (any more). */
export function geminiShouldFallBack(status: number, body: string): boolean {
  return (status === 429 && /quota|RESOURCE_EXHAUSTED|free_tier/i.test(body)) || status === 404;
}

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
