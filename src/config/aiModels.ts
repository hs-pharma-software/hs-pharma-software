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
