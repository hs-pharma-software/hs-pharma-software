import { geminiGenerate, type GeminiSchema } from "./gemini";
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
  if (/BREAST PUMP|NEBULI[SZ]ER|BP APPARATUS/.test(t)) return device("9018.9090", "Medical instrument");
  if (/RAPID TEST|TEST CASSETTE|TEST STRIP|DIAGNOSTIC|\bHCV\b|MALARIA ANTIGEN/.test(t)) return device("3822.1900", "Diagnostic kit / reagent");
  if (/CATGUT|SUTURE|POLYPROPYLENE|SILK BRAIDED|DRESSING|BANDAGE|GAUZE/.test(t)) {
    return { hsCode: "3005.9090", uom: "KG", ...MEDICINE_DEFAULT, source: "rules", note: "Dressing / suture" };
  }
  // General store items (standard rate). UOM is FBR's allowed unit for the
  // code; for KG/Liter the product also needs its quantity factor.
  const store = (hsCode: string, uom: string, note: string): FbrSuggestion => ({
    hsCode, saleType: "Goods at standard rate (default)", saleRate: "18", uom, sroNo: "", sroItem: "", source: "rules", note,
  });
  // Feeder vs nipple: decide on the product name first ("MECHICO FEEDER" with
  // description "silicone nipple" is a feeder; "RUBBER NIPPLE" for a feeder is a teat).
  const n = name.toUpperCase();
  const feeder = () => store("3924.9000", "Numbers, pieces, units", "Feeding bottle (plastic household/toilet article)");
  const teat = () => store("4014.9000", "KG", "Rubber teat / nipple");
  const FEEDER = /FEEDER|FEEDING BOTTLE/;
  const TEAT = /NIPP?LE|\bTEATS?\b|PACIFIER|SOOTHER/;
  if (FEEDER.test(n)) return feeder();
  if (TEAT.test(n)) return teat();
  if (FEEDER.test(t)) return feeder();
  if (TEAT.test(t)) return teat();
  if (/PHENYLE?\b|DISINFECTANT|DETTOL|SAVLON|SANITI[SZ]ER|SURFACE CLEANER/.test(t)) return store("3808.9400", "KG", "Disinfectant");
  if (/CONDOM/.test(t)) return store("4014.1000", "Numbers, pieces, units", "Sheath contraceptive");
  if (/GLOVE/.test(t)) return store("4015.1200", "KG", "Medical / examination gloves");
  if (/DIAPER/.test(t)) return /ADULT/.test(t) ? store("9619.0010", "KG", "Adult diapers") : store("9619.0020", "KG", "Baby diapers");
  if (/SANITARY|\bPADS?\b|TAMPON|PANTY LINER/.test(t)) return store("9619.0090", "KG", "Sanitary pads / tampons");
  if (/TISSUE/.test(t)) return store("4818.2000", "KG", "Facial / cleansing tissues");
  if (/TOOTH ?PASTE/.test(t)) return store("3306.1010", "Numbers, pieces, units", "Toothpaste");
  if (/TOOTH ?BRUSH/.test(t)) return store("9603.2100", "Numbers, pieces, units", "Toothbrush");
  if (/MOUTH ?WASH/.test(t)) return store("3306.9000", "Numbers, pieces, units", "Oral hygiene preparation");
  if (/SHAMPOO/.test(t)) return store("3305.1000", "Numbers, pieces, units", "Shampoo");
  if (/WIPES/.test(t)) return store("3401.1910", "KG", "Wet / baby wipes");
  if (/\bSOAP\b/.test(t)) return store("3401.1100", "KG", "Toilet soap");
  if (/BABY MILK|INFANT FORMULA|FORMULA MILK|CERELAC|LACTOGEN|\bNAN\b|SIMILAC/.test(t)) return store("1901.1000", "KG", "Infant food / formula");
  if (/COTTON (?:WOOL|ROLL|BALL|BUD)/.test(t)) return store("5601.2100", "KG", "Cotton wool");
  if (/MINERAL WATER|DRINKING WATER/.test(t)) return store("2201.1010", "Liter", "Mineral water");
  if (/TALC/.test(t)) return store("3304.9120", "Numbers, pieces, units", "Talcum powder");
  if (/SUNBLOCK|SUNSCREEN|FAIRNESS|MOISTURI[SZ]|FACE WASH|BEAUTY CREAM|LIP BALM|PETROLEUM JELLY|VASELINE/.test(t)) {
    return store("3304.9910", "Numbers, pieces, units", "Skin care / cosmetic (non-medicated)");
  }
  if (/THERMOMETER/.test(t)) return store("9025.1110", "Numbers, pieces, units", "Clinical thermometer");
  if (/RAZOR|BLADE/.test(t)) return store(/BLADE/.test(t) ? "8212.2000" : "8212.1000", "Numbers, pieces, units", "Razor / blades");
  if (/BATTERY|BATTERIES/.test(t)) return store("8506.1000", "Numbers, pieces, units", "Battery");
  if (/METHYLATED SPIRIT|SURGICAL SPIRIT/.test(t)) return store("2207.2000", "Liter", "Denatured spirit");
  if (/HERBAL|UNANI|AYURVED|\bARQ\b|TINCT/.test(t)) {
    return { hsCode: "3004.9010", saleType: "Goods at standard rate (default)", saleRate: "18", uom: "Packs", sroNo: "", sroItem: "", source: "rules", note: "Herbal / unani preparation" };
  }
  // Determine if a specific medicine keyword matched — if so, use the most
  // specific medicine HS code; otherwise check dosage form before assuming medicine.
  const medicineHsCode = /PARACETAMOL/.test(t) ? "3004.9092"
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
    : null;
  if (medicineHsCode) {
    return { hsCode: medicineHsCode, uom: "Packs", ...MEDICINE_DEFAULT, source: "rules", note: "Registered medicine (keyword rules)" };
  }
  // Dosage-form abbreviations or a numeric strength suggest medicine even without
  // a named-ingredient match — use 3004.9099 (other medicines) as the catch-all.
  const hasDosageForm = /\b(TABS?|CAPS?|CAPSULES?|SYR|SYRUP|SYP|SUSP|SUSPENSION|INJ|INJECTION|VIALS?|AMP|AMPOULES?|DROPS?|SACHETS?|ENEMA|PATCH|IMPLANT|INFUSION)\b/.test(t)
    || /\b[0-9]+\s*(MG|MCG|GM|ML|IU)\b/.test(t);
  if (hasDosageForm) {
    return { hsCode: "3004.9099", uom: "Packs", ...MEDICINE_DEFAULT, source: "rules", note: "Registered medicine (keyword rules)" };
  }
  // No medicine pattern matched — leave the HS code blank so the user can
  // set the correct code; default to standard rate (18%).
  return {
    hsCode: "",
    saleType: "Goods at standard rate (default)",
    saleRate: "18",
    uom: "Numbers, pieces, units",
    sroNo: "",
    sroItem: "",
    source: "rules",
    note: "Unrecognized item — standard rate assumed. Please select the correct HS code.",
  };
}

// The full FBR list has ~7,800 codes; the prompt gets the headings a pharmacy
// and general store sells (answers outside it are still accepted if FBR-valid).
export const STORE_HS_PREFIXES = [
  "0401", "0402", "1704", "1806", "1901", "1905", "2106", "2201", "2202", "2207", "2710.1995",
  "3002", "3003", "3004", "3005", "3006", "3302.1090", "3303", "3304", "3305", "3306", "3307", "3401", "3402",
  "3808.94", "3822", "3923.3", "3924", "3926", "4014", "4015", "4818", "5601", "8212", "8506",
  "9018", "9019", "9020", "9021", "9025.11", "9603.2", "9619",
];
export const STORE_HS_CODES = FBR_HS_CODES.filter((h) => STORE_HS_PREFIXES.some((p) => h.code.startsWith(p)));
const HS_LIST = STORE_HS_CODES.map((h) => `${h.code}: ${h.description}`).join("\n");
const SALE_TYPE_LIST = FBR_SALE_TYPES.map((t) => `${t.value}: ${t.description}`).join("\n");

const SYSTEM_PROMPT = `You classify products of a retail pharmacy in Pakistan for FBR (Federal Board of Revenue) Digital Invoicing. Given a product name and its description (usually the generic name / active ingredients), choose the FBR fields for that product.

Follow this pharmacy's existing conventions, which the rest of its catalog already uses:
- Registered human medicines (tablets, capsules, syrups, suspensions, injections, infusions, drops, creams, ointments and other medicated products): the most specific HS code under 30.04; sale type "Exempt goods"; rate 0; SRO schedule "Eighth Schedule Table 1"; SRO item serial "81".
- Dressings, gauze and sutures (30.05): sale type "Exempt goods"; rate 0; SRO "Eighth Schedule Table 1"; serial "81".
- Medical devices and disposables (syringes, needles, cannulae, catheters, bags, instruments, orthopaedic appliances; 90.18-90.21), diagnostic kits, test strips and reagents (38.22), herbal / unani / ayurvedic preparations (3004.9010), cosmetics and non-drug supplements: sale type "Goods at standard rate (default)"; rate 18; no SRO (empty strings).
- General store items are not medicines even when sold in a pharmacy - feeding bottles (3924.9000), rubber teats / nipples / pacifiers (4014.9000), disinfectants such as phenyl (3808.9400), soap (3401.x), shampoo (3305.1000), toothpaste (3306.1010), diapers and sanitary pads (9619.x), tissues (4818.x), cotton wool (5601.2100), infant formula (1901.1000), skin creams and lotions without a drug (3304.9910), gloves (4015.x), condoms (4014.1000): sale type "Goods at standard rate (default)"; rate 18; no SRO.
Only depart from these conventions when the product clearly belongs elsewhere, and say why in "reason".

Pick hsCode from this list of codes FBR accepts (other FBR codes are allowed only if none of these fits):
${HS_LIST}

Sale types FBR accepts:
${SALE_TYPE_LIST}

Prefer a specific code that matches the active ingredient or form (for example 3004.2000 for non-penicillin antibiotics, 3004.1090 for penicillin-family antibiotics, 3004.3200 for corticosteroids, 3004.3100 for insulin, 3004.5090 for vitamin products, 3004.9092 for paracetamol, 3004.9091 for medicinal cough syrups, 3004.9050 for eye drops, 3004.9060 for medicinal ointments) and use 3004.9099 for other medicines. Keep "reason" to one short sentence.`;

// hsCode / saleType are plain strings rather than enums: they are validated
// against FBR's lists in suggestFbrDetails, so an off-list value is corrected
// instead of losing the whole answer.
const SUGGESTION_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    hsCode: { type: "STRING", description: "FBR HS code, form 1234.5678" },
    saleType: { type: "STRING", description: "Exact FBR sale type name" },
    saleRatePercent: { type: "NUMBER" },
    sroScheduleNo: { type: "STRING", description: "Empty string when no SRO applies" },
    sroItemSerialNo: { type: "STRING", description: "Empty string when no SRO applies" },
    reason: { type: "STRING", description: "One short sentence" },
  },
  required: ["hsCode", "saleType", "saleRatePercent", "sroScheduleNo", "sroItemSerialNo", "reason"],
};

interface AiSuggestion {
  hsCode: string;
  saleType: string;
  saleRatePercent: number;
  sroScheduleNo: string;
  sroItemSerialNo: string;
  reason: string;
}

export async function suggestFromAi(name: string, description: string): Promise<FbrSuggestion> {
  const r = await geminiGenerate({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: `Product name: ${name || "(not given)"}\nDescription: ${description}` }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SUGGESTION_SCHEMA, temperature: 0.2 },
  });
  let out: AiSuggestion;
  try {
    out = JSON.parse(r.text) as AiSuggestion;
  } catch {
    throw new Error(r.finishReason === "SAFETY" ? "Gemini declined to classify this product." : "Gemini returned no usable classification.");
  }
  if (typeof out.hsCode !== "string" || typeof out.saleType !== "string") throw new Error("Gemini returned no usable classification.");
  return {
    hsCode: out.hsCode.trim(),
    saleType: out.saleType.trim(),
    saleRate: String(Number(out.saleRatePercent) || 0),
    uom: "",
    sroNo: out.sroScheduleNo ?? "",
    sroItem: out.sroItemSerialNo ?? "",
    source: "ai",
    note: out.reason ?? "",
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

/** Catalog first (same generic already classified), then Gemini, then rules. */
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
