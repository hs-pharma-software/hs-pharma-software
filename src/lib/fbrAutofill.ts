import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import { getSetting } from "./repo/settings";
import { activeToken, fetchFbrHsUoms, loadFbrSettings } from "./fbr";
import { FBR_HS_CODES, FBR_SALE_TYPES, findSaleType } from "./fbrData";

export interface FbrFields {
  hsCode: string;
  saleType: string;
  saleRate: string;
  uom: string;
  sroNo: string;
  sroItem: string;
}

export interface FbrSuggestion extends FbrFields {
  source: "catalog" | "ai" | "rules";
  note: string;
}

/** Minimal shape of an existing product needed to learn from the catalog. */
export interface CatalogProduct {
  id: string;
  description: string | null;
  hs_code: string | null;
  fbr_sale_type: string | null;
  fbr_sale_rate: number | null;
  fbr_uom: string | null;
  sro_no: string | null;
  sro_item_serial_no: string | null;
}

export const AI_KEY_SETTING = "ai_anthropic_api_key";
const MODEL = "claude-opus-5-5";
const VALID_HS = new Set(FBR_HS_CODES.map((h) => h.code));
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

// The pharmacy's own classification conventions (what the existing catalog
// uses), so new products are classified consistently with existing ones.
const MEDICINE_DEFAULT = { saleType: "Exempt goods", saleRate: "0", sroNo: "Eighth Schedule Table 1", sroItem: "81" };

/** Same generic already classified in the catalog: reuse the most common
 * complete classification among those products. */
export function suggestFromCatalog(description: string, catalog: CatalogProduct[], excludeId?: string): FbrSuggestion | null {
  const target = norm(description);
  if (!target) return null;
  const tally = new Map<string, { fields: FbrFields; count: number }>();
  for (const p of catalog) {
    if (p.id === excludeId || norm(p.description) !== target) continue;
    if (!p.hs_code || !VALID_HS.has(p.hs_code) || !findSaleType(p.fbr_sale_type) || !p.fbr_uom) continue;
    const fields: FbrFields = {
      hsCode: p.hs_code,
      saleType: findSaleType(p.fbr_sale_type)!.value,
      saleRate: String(p.fbr_sale_rate ?? 0),
      uom: p.fbr_uom,
      sroNo: p.sro_no ?? "",
      sroItem: p.sro_item_serial_no ?? "",
    };
    const k = JSON.stringify(fields);
    tally.set(k, { fields, count: (tally.get(k)?.count ?? 0) + 1 });
  }
  const best = [...tally.values()].sort((a, b) => b.count - a.count)[0];
  if (!best) return null;
  return { ...best.fields, source: "catalog", note: `Same as ${best.count} existing product(s) with this description` };
}

/** Keyword rules used when no AI key is configured or the AI call fails. */
export function suggestFromRules(name: string, description: string): FbrSuggestion {
  const t = `${name} ${description}`.toUpperCase();
  const device = (hsCode: string, note: string): FbrSuggestion => ({
    hsCode, saleType: "Goods at standard rate (default)", saleRate: "18", uom: "Numbers, pieces, units", sroNo: "", sroItem: "", source: "rules", note,
  });
  if (/SYRING/.test(t)) return device("9018.3110", "Syringe (medical device)");
  if (/SPINAL NEEDLE|LUMBAR|NEEDLE/.test(t)) return device("9018.3200", "Needle (medical device)");
  if (/CANNULA|CANULA|CATHETER|FOLEY|DRAINAGE BAG|URINE BAG/.test(t)) return device("9018.3990", "Cannula / catheter / bag (medical device)");
  if (/SLING|BRACE|SPLINT|BELT/.test(t)) return device("9021.1000", "Orthopaedic appliance");
  if (/BREAST PUMP|THERMOMETER|NEBULI[SZ]ER|BP APPARATUS/.test(t)) return device("9018.9090", "Medical instrument");
  if (/RAPID TEST|TEST CASSETTE|TEST STRIP|DIAGNOSTIC|\bHCV\b|MALARIA ANTIGEN/.test(t)) return device("3822.1900", "Diagnostic kit / reagent");
  if (/CATGUT|SUTURE|POLYPROPYLENE|SILK BRAIDED|DRESSING|BANDAGE|GAUZE/.test(t)) {
    return { hsCode: "3005.9090", uom: "KG", ...MEDICINE_DEFAULT, source: "rules", note: "Dressing / suture" };
  }
  if (/HERBAL|UNANI|AYURVED|\bARQ\b|TINCT/.test(t)) {
    return { hsCode: "3004.9010", saleType: "Goods at standard rate (default)", saleRate: "18", uom: "Packs", sroNo: "", sroItem: "", source: "rules", note: "Herbal / unani preparation" };
  }
  const hsCode = /PARACETAMOL/.test(t) ? "3004.9092"
    : /COUGH|EXPECTORANT/.test(t) && /SYR|SYP|SUSP/.test(t) ? "3004.9091"
    : /EYE DROP|OPHTHALMIC/.test(t) ? "3004.9050"
    : /OINTMENT/.test(t) ? "3004.9060"
    : /AMOXICILLIN|AMPICILLIN|CLOXACILLIN|PENICILLIN|CO-AMOXICLAV/.test(t) ? "3004.1090"
    : /CEF|CIPRO|LEVOFLOX|MOXIFLOX|AZITHRO|CLARITHRO|ERYTHRO|DOXYCYCL|TETRACYCL|METRONIDAZOLE|CLINDAMYCIN|LINCOMYCIN/.test(t) ? "3004.2000"
    : /DEXAMETH|PREDNISOL|HYDROCORTISONE|BETAMETH|TRIAMCINOLONE|BUDESONIDE|FLUTICASONE|CLOBETASOL/.test(t) ? "3004.3200"
    : /INSULIN/.test(t) ? "3004.3100"
    // "Calcium" alone is often just the salt of another drug (Rosuvastatin
    // Calcium), so it only counts as a supplement when it leads or is paired
    // with a supplement form.
    : /VITAMIN|FOLIC|FOLATE|MULTIVIT|\bIRON\b|\bZINC\b|SUPPLEMENT/.test(t) ||
      /^\s*CALCIUM\b|CALCIUM\s+(?:CARBONATE|CITRATE|LACTATE|GLUCONATE|PHOSPHATE)|CALCIUM\s*\+\s*VITAMIN/.test(description.toUpperCase())
      ? "3004.5090"
    : "3004.9099";
  return { hsCode, uom: "Packs", ...MEDICINE_DEFAULT, source: "rules", note: "Registered medicine (keyword rules)" };
}

const HS_LIST = FBR_HS_CODES.map((h) => `${h.code}: ${h.description}`).join("\n");
const SALE_TYPE_LIST = FBR_SALE_TYPES.map((t) => `${t.value}: ${t.description}`).join("\n");

const SYSTEM_PROMPT = `You classify products of a retail pharmacy in Pakistan for FBR (Federal Board of Revenue) Digital Invoicing. Given a product name and its description (usually the generic name / active ingredients), choose the FBR fields for that product.

Follow this pharmacy's existing conventions, which the rest of its catalog already uses:
- Registered human medicines (tablets, capsules, syrups, suspensions, injections, infusions, drops, creams, ointments and other medicated products): the most specific HS code under 30.04; sale type "Exempt goods"; rate 0; SRO schedule "Eighth Schedule Table 1"; SRO item serial "81".
- Dressings, gauze and sutures (30.05): sale type "Exempt goods"; rate 0; SRO "Eighth Schedule Table 1"; serial "81".
- Medical devices and disposables (syringes, needles, cannulae, catheters, bags, instruments, orthopaedic appliances; 90.18-90.21), diagnostic kits and reagents (38.22), herbal / unani / ayurvedic preparations (3004.9010), cosmetics and non-drug supplements: sale type "Goods at standard rate (default)"; rate 18; no SRO (empty strings).
Only depart from these conventions when the product clearly belongs elsewhere, and say why in "reason".

Pick hsCode only from this list of codes FBR accepts:
${HS_LIST}

Sale types FBR accepts:
${SALE_TYPE_LIST}

Prefer a specific code that matches the active ingredient or form (for example 3004.2000 for non-penicillin antibiotics, 3004.1090 for penicillin-family antibiotics, 3004.3200 for corticosteroids, 3004.3100 for insulin, 3004.5090 for vitamin products, 3004.9092 for paracetamol, 3004.9091 for medicinal cough syrups, 3004.9050 for eye drops, 3004.9060 for medicinal ointments) and use 3004.9099 for other medicines. Keep "reason" to one short sentence.`;

// hsCode / saleType are plain strings: the SDK's Zod helper turns enums into
// a description hint rather than a hard constraint, so a value outside FBR's
// lists would fail parsing and lose the whole answer. They are validated
// against FBR's lists in suggestFbrDetails instead.
const SuggestionSchema = z.object({
  hsCode: z.string(),
  saleType: z.string(),
  saleRatePercent: z.number(),
  sroScheduleNo: z.string(),
  sroItemSerialNo: z.string(),
  reason: z.string(),
});

export async function suggestFromAi(name: string, description: string): Promise<FbrSuggestion> {
  const apiKey = ((await getSetting(AI_KEY_SETTING)) ?? "").trim();
  if (!apiKey) throw new Error("No Claude API key set in Settings > AI Assistant.");

  const client = new Anthropic({
    apiKey,
    // Runs inside the desktop app's webview; requests go through the Tauri
    // HTTP plugin (allow-listed to api.anthropic.com) rather than the browser.
    dangerouslyAllowBrowser: true,
    fetch: tauriFetch as unknown as typeof fetch,
    maxRetries: 1,
    timeout: 60_000,
  });

  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(SuggestionSchema) },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Product name: ${name || "(not given)"}\nDescription: ${description}` }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error("Claude API key was rejected. Check it in Settings > AI Assistant.");
    if (error instanceof Anthropic.RateLimitError) throw new Error("Claude API rate limit reached. Try again shortly.");
    if (error instanceof Anthropic.APIConnectionError) throw new Error("Could not reach the Claude API. Check the internet connection.");
    if (error instanceof Anthropic.APIError) throw new Error(`Claude API error ${error.status}: ${error.message}`);
    throw error;
  }

  if (response.stop_reason === "refusal") throw new Error("Claude declined to classify this product.");
  const out = response.parsed_output;
  if (!out) throw new Error("Claude returned no usable classification.");
  return {
    hsCode: out.hsCode,
    saleType: out.saleType,
    saleRate: String(out.saleRatePercent),
    uom: "",
    sroNo: out.sroScheduleNo,
    sroItem: out.sroItemSerialNo,
    source: "ai",
    note: out.reason,
  };
}

/** Makes any suggestion FBR-valid: rate per sale type, UOM allowed for the HS
 * code (from FBR's HS_UOM API when a token is set), SRO only where required. */
export async function finalizeSuggestion(s: FbrSuggestion): Promise<FbrSuggestion> {
  const saleType = findSaleType(s.saleType) ?? findSaleType("Exempt goods")!;
  let saleRate = Number(s.saleRate) || 0;
  if (saleType.value.startsWith("Goods at standard")) saleRate = 18;
  if (saleType.value === "Exempt goods" || saleType.value === "Goods at zero-rate") saleRate = 0;

  const needsSro = saleType.value !== "3rd Schedule Goods" && !(saleType.value.startsWith("Goods at standard") && saleRate === 18);
  let { sroNo, sroItem } = s;
  if (!needsSro) {
    sroNo = "";
    sroItem = "";
  } else if (saleType.value === "Exempt goods" && (!sroNo || !sroItem)) {
    sroNo = MEDICINE_DEFAULT.sroNo;
    sroItem = MEDICINE_DEFAULT.sroItem;
  }

  const fallbackUom = s.hsCode.startsWith("3004.") ? "Packs" : s.hsCode.startsWith("3005.") ? "KG" : "Numbers, pieces, units";
  let uom = s.uom || fallbackUom;
  try {
    const token = activeToken(await loadFbrSettings());
    if (token) {
      const allowed = await fetchFbrHsUoms(token, s.hsCode);
      if (allowed.length > 0 && !allowed.includes(uom)) {
        uom = allowed.includes(fallbackUom) ? fallbackUom : allowed.includes("Packs") ? "Packs" : allowed[0];
      }
    }
  } catch {
    // FBR reference API unreachable: keep the rule-based UOM.
  }

  return { ...s, saleType: saleType.value, saleRate: String(saleRate), uom, sroNo, sroItem };
}

/** Catalog first (same generic already classified), then Claude, then rules. */
export async function suggestFbrDetails(
  name: string,
  description: string,
  catalog: CatalogProduct[],
  opts: { excludeId?: string; forceAi?: boolean } = {}
): Promise<FbrSuggestion> {
  if (!opts.forceAi) {
    const fromCatalog = suggestFromCatalog(description, catalog, opts.excludeId);
    if (fromCatalog) return finalizeSuggestion(fromCatalog);
  }
  try {
    const ai = await suggestFromAi(name, description);
    const rules = suggestFromRules(name, description);
    const fixes: string[] = [];
    if (!VALID_HS.has(ai.hsCode)) {
      fixes.push(`HS "${ai.hsCode}" is not an FBR code, used ${rules.hsCode}`);
      ai.hsCode = rules.hsCode;
    }
    if (!findSaleType(ai.saleType)) {
      fixes.push(`sale type "${ai.saleType}" is not an FBR sale type, used "${rules.saleType}"`);
      ai.saleType = rules.saleType;
      ai.saleRate = rules.saleRate;
    }
    if (fixes.length) ai.note = `${ai.note} (corrected: ${fixes.join("; ")})`;
    return await finalizeSuggestion(ai);
  } catch (e) {
    const rules = suggestFromRules(name, description);
    const why = e instanceof Error ? e.message : String(e);
    return finalizeSuggestion({ ...rules, note: `${rules.note}. AI not used: ${why}` });
  }
}
