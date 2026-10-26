/** Suggests a product's Category and Sub Category from its description
 * (generic name), for example "Alprazolam" -> a depressant / psychotropic
 * category. First from this business's own products with the same
 * description; otherwise Gemini chooses from the existing lists. Gemini never
 * creates a category: when nothing fits it only proposes a name for the user
 * to add. */
import { geminiGenerate, hasAiKey, type GeminiSchema } from "./gemini";
import { dbSelect } from "./db";
import { requireCurrentTenantId } from "./repo/base";

export interface Named { id: string; name: string }

export interface CategorySuggestion {
  categoryId: string | null;
  /** A name Gemini proposes when no existing category fits. */
  newCategory: string | null;
  subCategoryId: string | null;
  newSubCategory: string | null;
  source: "catalog" | "ai";
  reason: string;
}

const PICK_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    index: { type: "INTEGER", description: "Number of the best matching entry in the list, or -1 when none fits." },
    newName: { type: "STRING", description: "Only when index is -1: a short name for a new entry, in the style of the list. Otherwise empty." },
    reason: { type: "STRING", description: "One short sentence, e.g. 'Alprazolam is a benzodiazepine (anxiolytic / CNS depressant).'" },
  },
  required: ["index", "newName", "reason"],
};

const SYSTEM = `You classify pharmacy and hospital products. You are given a product (name and description, usually the generic name / active ingredient) and a numbered list. Choose the entry that best describes the product's therapeutic class or use, as a pharmacist would. Prefer an existing entry even if its spelling is imperfect. Answer -1 only when no entry is a reasonable fit. Never invent clinical facts; base the choice on the active ingredient.`;

async function pick(product: { name: string; description: string }, what: string, list: Named[]): Promise<{ id: string | null; newName: string | null; reason: string }> {
  const numbered = list.map((c, i) => `${i}. ${c.name}`).join("\n");
  const r = await geminiGenerate({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: `Product name: ${product.name || "(not given)"}\nDescription: ${product.description}\n\nChoose the ${what}:\n${numbered || "(the list is empty)"}` }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: PICK_SCHEMA, temperature: 0.1 },
  }, 45_000);
  let out: { index: number; newName: string; reason: string };
  try {
    out = JSON.parse(r.text);
  } catch {
    throw new Error("Gemini returned no usable category.");
  }
  const i = Number(out.index);
  const hit = Number.isInteger(i) && i >= 0 && i < list.length ? list[i] : null;
  return { id: hit?.id ?? null, newName: hit ? null : (out.newName ?? "").trim() || null, reason: (out.reason ?? "").trim() };
}

/** The category / sub category most used by this business's products with the same description. */
async function fromCatalog(description: string, excludeId?: string): Promise<{ categoryId: string; subCategoryId: string | null } | null> {
  const rows = await dbSelect<{ category_id: string; sub_category_id: string | null; n: number }>(
    `SELECT category_id, sub_category_id, COUNT(*) AS n FROM products
     WHERE tenant_id = ? AND deleted_at IS NULL AND category_id IS NOT NULL AND id != ?
       AND UPPER(TRIM(description)) = UPPER(TRIM(?))
     GROUP BY category_id, sub_category_id ORDER BY n DESC LIMIT 1`,
    [requireCurrentTenantId(), excludeId ?? "", description]
  );
  return rows[0] ? { categoryId: rows[0].category_id, subCategoryId: rows[0].sub_category_id } : null;
}

export async function suggestCategory(input: {
  name: string;
  description: string;
  categories: Named[];
  /** Sub categories of a category (loaded when a category is chosen). */
  loadSubCategories: (categoryId: string) => Promise<Named[]>;
  excludeId?: string;
}): Promise<CategorySuggestion | null> {
  const description = input.description.trim();
  if (!description) return null;
  const known = await fromCatalog(description, input.excludeId);
  if (known && input.categories.some((c) => c.id === known.categoryId)) {
    return { categoryId: known.categoryId, newCategory: null, subCategoryId: known.subCategoryId, newSubCategory: null, source: "catalog", reason: "Same as your other products with this description." };
  }
  if (!(await hasAiKey())) return null;
  const cat = await pick({ name: input.name, description }, "category", input.categories);
  let sub: { id: string | null; newName: string | null; reason: string } = { id: null, newName: null, reason: "" };
  if (cat.id) {
    const subs = await input.loadSubCategories(cat.id);
    if (subs.length) sub = await pick({ name: input.name, description }, "sub category (within the chosen category)", subs);
  }
  return { categoryId: cat.id, newCategory: cat.newName, subCategoryId: sub.id, newSubCategory: cat.id ? sub.newName : null, source: "ai", reason: cat.reason };
}
