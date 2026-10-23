import { dbSelect } from "./db";
import { useAuthStore } from "../store/authStore";
import { activeToken, fetchFbrHsUoms, fetchFbrRates, loadFbrSettings } from "./fbr";
import { FBR_HS_CODES, FBR_SALE_TYPES, fbrProvinceCode, findSaleType } from "./fbrData";
import { STORE_HS_PREFIXES } from "./fbrAutofill";
import { geminiGenerate, type GeminiContent, type GeminiSchema } from "./gemini";
import { fetchDrapRecords, searchDrapBrands, searchDrapGenerics } from "./drapClient";

const VALID_HS = new Map(FBR_HS_CODES.map((h) => [h.code, h.description]));

const SYSTEM_PROMPT = `You are the assistant built into a retail pharmacy's point-of-sale system in Pakistan. Pharmacy staff ask you about:
1. HS codes and FBR Digital Invoicing details for products (HS code, sale type, rate, UOM, SRO schedule and item serial).
2. Medicines: generic names, strengths and dosage forms, common uses, usual adult dosing, important interactions and warnings, and whether a drug is controlled (narcotic / psychotropic).
3. Products in this pharmacy's own catalog.

Use the tools rather than memory for facts they cover:
- Never state an HS code without confirming it with search_hs_codes; only codes in FBR's list are accepted on invoices.
- For the UOM FBR allows for a code, use fbr_allowed_uoms. When FBR only allows a weight or volume (KG, Liter), tell the user to set the product's "quantity per unit" so invoice quantities convert correctly.
- For tax rates, use fbr_sale_type_rates.
- For questions about products the pharmacy stocks, use search_catalog.
- For a medicine's registration, manufacturer, strengths and composition in Pakistan, use drap_lookup.

This pharmacy's classification conventions (follow them unless a product clearly belongs elsewhere):
- Registered human medicines: HS under 30.04 (most specific match, 3004.9099 otherwise); sale type "Exempt goods"; rate 0; SRO "Eighth Schedule Table 1", item serial "81".
- Dressings and sutures (30.05): same exempt treatment.
- Medical devices and disposables (90.18-90.21), diagnostic kits and test strips (38.22), herbal / unani preparations (3004.9010), cosmetics, non-drug supplements and general store items (feeding bottles 3924.9000, rubber teats / nipples 4014.9000, disinfectants such as phenyl 3808.9400, soap, shampoo, toothpaste, diapers, tissues, cotton wool, infant formula): "Goods at standard rate (default)", 18%, no SRO.
Tax treatment is ultimately the business's decision; when a classification is uncertain, say so and suggest confirming with their tax adviser.

Medicine information is for pharmacy staff, not a diagnosis or prescription: give general, well-established information, mention when a prescription or a doctor's advice is needed, and flag controlled drugs. If you are not sure of a fact, say so instead of guessing.

Answer in the language the user writes in (English, Urdu or Roman Urdu). Keep answers short and practical; use a short list when giving FBR fields.`;

function terms(q: string) {
  return q.toUpperCase().split(/[\s,;/]+/).filter((t) => t.length > 0);
}

interface Tool {
  name: string;
  description: string;
  parameters: GeminiSchema;
  run: (args: Record<string, string>) => Promise<string>;
}

const tool = (t: Tool) => t;
const str = (description: string): GeminiSchema => ({ type: "STRING", description });
const obj = (properties: Record<string, GeminiSchema>): GeminiSchema => ({
  type: "OBJECT",
  properties,
  required: Object.keys(properties),
});

async function fbrContext() {
  const s = await loadFbrSettings();
  return { token: activeToken(s), provinceCode: fbrProvinceCode(s.sellerProvince) };
}

const searchHsCodes = tool({
  name: "search_hs_codes",
  description:
    "Search FBR's official list of HS codes accepted by Digital Invoicing (about 7,800 codes) by code prefix or words in the description. Returns up to 25 matches, pharmacy and general-store headings first.",
  parameters: obj({
    query: str("Code prefix such as '3004.90' or '4014', or description words such as 'teats rubber' or 'disinfectant'"),
  }),
  run: async ({ query }) => {
    const q = query.trim();
    const words = terms(q);
    const isCode = /^\d[\d.]*$/.test(q);
    const hits = FBR_HS_CODES.filter((h) =>
      isCode ? h.code.startsWith(q) : words.every((w) => h.description.toUpperCase().includes(w) || h.code.startsWith(w))
    );
    const store = (c: string) => (STORE_HS_PREFIXES.some((p) => c.startsWith(p)) ? 0 : 1);
    hits.sort((a, b) => store(a.code) - store(b.code) || a.code.localeCompare(b.code));
    if (hits.length === 0) return `No FBR HS code matches "${query}". Try fewer or different words, or a code prefix.`;
    return `${hits.length} match(es)${hits.length > 25 ? ", first 25" : ""}:\n` + hits.slice(0, 25).map((h) => `${h.code}: ${h.description}`).join("\n");
  },
});

const fbrAllowedUoms = tool({
  name: "fbr_allowed_uoms",
  description: "Get the units of measure FBR allows on an invoice for an HS code (FBR reference API HS_UOM).",
  parameters: obj({ hs_code: str("HS code in the form 1234.5678") }),
  run: async ({ hs_code }) => {
    const code = hs_code.trim();
    if (!VALID_HS.has(code)) return `${code} is not in FBR's HS code list.`;
    const { token } = await fbrContext();
    if (!token) return "No FBR token is configured in Settings > FBR, so the live UOM list can't be fetched.";
    try {
      const list = await fetchFbrHsUoms(token, code);
      return list.length ? `FBR allows for ${code}: ${list.join(", ")}` : `FBR lists no UOM restriction for ${code}.`;
    } catch (e) {
      return `Could not reach FBR: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

const fbrSaleTypeRates = tool({
  name: "fbr_sale_type_rates",
  description: "Get the tax rates FBR currently accepts for a sale type, for the pharmacy's province.",
  parameters: obj({ sale_type: { type: "STRING", description: "Exact FBR sale type", enum: FBR_SALE_TYPES.map((t) => t.value) } }),
  run: async ({ sale_type }) => {
    const st = findSaleType(sale_type);
    if (!st) return `Unknown sale type "${sale_type}".`;
    const { token, provinceCode } = await fbrContext();
    if (!token) return `No FBR token configured. Default rate for "${st.value}": ${st.rateLabel(st.defaultRate)}.`;
    try {
      const rates = await fetchFbrRates(token, st.transTypeId, provinceCode);
      return `FBR rates for "${st.value}": ${rates.map((r) => r.label).join(", ") || "none listed"}`;
    } catch (e) {
      return `Could not reach FBR: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

const searchCatalog = tool({
  name: "search_catalog",
  description:
    "Search this pharmacy's product catalog by product name, generic name (description) or company. Returns each product's FBR fields and narcotic flag.",
  parameters: obj({ query: str("Words from the product name, generic name or company") }),
  run: async ({ query }) => {
    const words = terms(query).slice(0, 5);
    if (words.length === 0) return "Give a product, generic or company name.";
    const where = words.map(() => "(UPPER(name) LIKE ? OR UPPER(COALESCE(description, '')) LIKE ? OR UPPER(COALESCE(company_name, '')) LIKE ?)").join(" AND ");
    const rows = await dbSelect<Record<string, unknown>>(
      `SELECT name, description, company_name, hs_code, fbr_sale_type, fbr_sale_rate, fbr_uom, fbr_qty_factor,
              sro_no, sro_item_serial_no, is_narcotic
       FROM products WHERE deleted_at IS NULL AND tenant_id = ? AND ${where} ORDER BY name LIMIT 15`,
      [useAuthStore.getState().currentTenant?.id ?? null, ...words.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`])]
    );
    if (rows.length === 0) return `No catalog product matches "${query}".`;
    return rows
      .map((r) =>
        [
          `${r.name} | generic: ${r.description ?? "-"} | company: ${r.company_name ?? "-"}`,
          `  HS ${r.hs_code ?? "-"} | ${r.fbr_sale_type ?? "-"} | rate ${r.fbr_sale_rate ?? "-"} | UOM ${r.fbr_uom ?? "-"}` +
            ` (qty factor ${r.fbr_qty_factor ?? 1}) | SRO ${r.sro_no || "-"} / ${r.sro_item_serial_no || "-"}` +
            (r.is_narcotic ? " | NARCOTIC / controlled" : ""),
        ].join("\n")
      )
      .join("\n");
  },
});

const drapLookup = tool({
  name: "drap_lookup",
  description:
    "Look up medicines in DRAP's Registered Drugs Index (Pakistan) by brand or generic name: registration number and status, composition and strength, dosage form, manufacturer, authorization holder.",
  parameters: obj({
    query: str("Brand or generic name, at least 3 characters"),
    by: { type: "STRING", description: "Search by brand or generic name", enum: ["brand", "generic"] },
  }),
  run: async ({ query, by }) => {
    if (query.trim().length < 3) return "DRAP needs at least 3 characters.";
    try {
      const hits = by === "brand" ? await searchDrapBrands(query.trim()) : await searchDrapGenerics(query.trim());
      if (hits.length === 0) return `DRAP has no ${by} match for "${query}".`;
      const { records } = await fetchDrapRecords(hits.slice(0, 4).map((h) => h.regNo));
      const details = records.map(
        (r) =>
          `${r.productName} (reg ${r.regNo}, ${r.status || "status unknown"}, ${r.usedFor || "-"}): ${r.genericName || "-"}; ` +
          `strength ${r.strength || "-"}; ${r.dosageForm || "-"}; manufacturer ${r.manufacturer || "-"}; holder ${r.mah || "-"}`
      );
      const more = hits.length > 4 ? `\nOther matches: ${hits.slice(4, 15).map((h) => h.name).join("; ")}` : "";
      return details.join("\n") + more;
    } catch (e) {
      return `DRAP registry unavailable: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

export const ASSISTANT_TOOLS = [searchHsCodes, fbrAllowedUoms, fbrSaleTypeRates, searchCatalog, drapLookup];

export interface AssistantTurn {
  /** Full Gemini conversation. Model turns are kept exactly as returned
   * (their parts carry thought signatures Gemini needs back). */
  transcript: GeminiContent[];
  reply: string;
}

const MAX_TOOL_ROUNDS = 8;
const TOOLS = [{ functionDeclarations: ASSISTANT_TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters })) }];

export async function askAssistant(transcript: GeminiContent[], question: string): Promise<AssistantTurn> {
  const contents: GeminiContent[] = [...transcript, { role: "user", parts: [{ text: question }] }];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const r = await geminiGenerate(
      { systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents, tools: TOOLS, generationConfig: { maxOutputTokens: 8192 } },
      120_000
    );
    contents.push(r.content);
    if (r.functionCalls.length === 0) {
      const reply =
        r.text ||
        (r.finishReason === "MAX_TOKENS"
          ? "The answer was cut off. Please ask a narrower question."
          : r.finishReason === "SAFETY"
            ? "Sorry, I can't help with that request."
            : "I couldn't produce an answer. Please rephrase the question.");
      return { transcript: contents, reply };
    }
    // Run every requested tool and answer all calls in one user turn.
    const results = await Promise.all(
      r.functionCalls.map(async (call) => {
        const t = ASSISTANT_TOOLS.find((x) => x.name === call.name);
        const args = Object.fromEntries(Object.entries(call.args ?? {}).map(([k, v]) => [k, String(v ?? "")]));
        let result: string;
        try {
          result = t ? await t.run(args) : `Unknown tool "${call.name}".`;
        } catch (e) {
          result = `Tool failed: ${e instanceof Error ? e.message : String(e)}`;
        }
        return { functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: { result } } };
      })
    );
    contents.push({ role: "user", parts: results });
  }
  // Unfinished tool round: drop this exchange so the next question starts clean.
  return {
    transcript,
    reply: "I couldn't finish that answer (too many lookups). Please try a more specific question.",
  };
}
