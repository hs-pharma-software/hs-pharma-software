/** Fills a product's Category and Sub Category from its description
 * (generic name), for example "Alprazolam" -> a depressant / psychotropic
 * category:
 *
 *   1. the category of this business's own products with the same description;
 *   2. else the AI (ChatGPT or Gemini) picks from the existing categories (and their sub categories);
 *   3. else the AI looks the medicine up online (web search) and the
 *      category it names is created and selected. An existing category with
 *      the same name is reused, never duplicated.
 *
 * The form shows what was done, and Undo removes anything created. */
import { geminiGenerate, hasAiKey, type GeminiSchema } from "./gemini";
import { dbSelect } from "./db";
import { requireCurrentTenantId } from "./repo/base";

export interface Named { id: string; name: string }

export interface CategorySuggestion {
  categoryId: string | null;
  subCategoryId: string | null;
  /** Created now from an online search (Undo removes them). */
  createdCategoryId: string | null;
  createdSubCategoryId: string | null;
  source: "catalog" | "ai" | "web";
  reason: string;
}

const PICK_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    index: { type: "INTEGER", description: "Number of the best matching entry in the list, or -1 when none fits." },
    reason: { type: "STRING", description: "One short sentence, e.g. 'Alprazolam is a benzodiazepine (anxiolytic / CNS depressant).'" },
  },
  required: ["index", "reason"],
};

const PICK_SYSTEM = `You classify pharmacy and hospital products. You are given a product (name and description, usually the generic name / active ingredient) and a numbered list. Choose the entry that best describes the product's therapeutic class or use, as a pharmacist would. Prefer an existing entry even if its spelling is imperfect. Answer -1 only when no entry is a reasonable fit. Base the choice on the active ingredient; never invent clinical facts.`;

const SEARCH_SYSTEM = `You classify pharmacy and hospital products for a pharmacy's product list. Look the active ingredient up online to confirm its therapeutic class. Reply with exactly two lines and nothing else:
NAME: <the category name, 1-5 words, in capital letters, in the style of the examples given, e.g. ANTI ANXIETY or BROAD SPECTRUM ANTIBIOTIC>
WHY: <one short sentence naming the drug class>`;

async function pickFromList(product: { name: string; description: string }, what: string, list: Named[]): Promise<{ id: string | null; reason: string }> {
  if (!list.length) return { id: null, reason: "" };
  const numbered = list.map((c, i) => `${i}. ${c.name}`).join("\n");
  const r = await geminiGenerate({
    systemInstruction: { parts: [{ text: PICK_SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: `Product name: ${product.name || "(not given)"}\nDescription: ${product.description}\n\nChoose the ${what}:\n${numbered}` }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: PICK_SCHEMA, temperature: 0.1 },
  }, 45_000);
  try {
    const out = JSON.parse(r.text) as { index: number; reason: string };
    const i = Number(out.index);
    return { id: Number.isInteger(i) && i >= 0 && i < list.length ? list[i].id : null, reason: (out.reason ?? "").trim() };
  } catch {
    throw new Error("The AI returned no usable category.");
  }
}

/** The AI searches the web and names a new category (or sub category). */
async function nameFromWeb(product: { name: string; description: string }, what: string, examples: Named[], parent?: string): Promise<{ name: string; reason: string } | null> {
  const sample = examples.slice(0, 25).map((c) => c.name).join("; ");
  const r = await geminiGenerate({
    systemInstruction: { parts: [{ text: SEARCH_SYSTEM }] },
    tools: [{ googleSearch: {} }],
    contents: [{ role: "user", parts: [{ text: `Product name: ${product.name || "(not given)"}\nDescription / active ingredient: ${product.description}\n${parent ? `It is in the category: ${parent}\n` : ""}Name the ${what}.${sample ? `\nExisting ${what} names, for style: ${sample}` : ""}` }] }],
    generationConfig: { temperature: 0.1 },
  }, 60_000);
  const name = /NAME:\s*(.+)/i.exec(r.text)?.[1]?.trim().replace(/^["'*]+|["'*.]+$/g, "");
  const reason = /WHY:\s*(.+)/i.exec(r.text)?.[1]?.trim() ?? "";
  if (!name || name.length > 60) return null;
  return { name: name.toUpperCase(), reason };
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

const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

export async function suggestCategory(input: {
  name: string;
  description: string;
  categories: Named[];
  /** Sub categories of a category (loaded when a category is chosen). */
  loadSubCategories: (categoryId: string) => Promise<Named[]>;
  createCategory: (name: string) => Promise<string>;
  createSubCategory: (categoryId: string, name: string) => Promise<string>;
  excludeId?: string;
}): Promise<CategorySuggestion | null> {
  const description = input.description.trim();
  if (!description) return null;
  const product = { name: input.name, description };

  const known = await fromCatalog(description, input.excludeId);
  if (known && input.categories.some((c) => c.id === known.categoryId)) {
    return { categoryId: known.categoryId, subCategoryId: known.subCategoryId, createdCategoryId: null, createdSubCategoryId: null, source: "catalog", reason: "Same as your other products with this description." };
  }
  if (!(await hasAiKey())) return null;

  // Category: from the list, else from an online search (created, or an existing one with the same name).
  let source: CategorySuggestion["source"] = "ai";
  let { id: categoryId, reason } = await pickFromList(product, "category", input.categories);
  let createdCategoryId: string | null = null;
  if (!categoryId) {
    const web = await nameFromWeb(product, "category", input.categories);
    if (!web) return { categoryId: null, subCategoryId: null, createdCategoryId: null, createdSubCategoryId: null, source: "web", reason: "The AI could not find a category for this description." };
    source = "web";
    reason = web.reason;
    const existing = input.categories.find((c) => sameName(c.name, web.name));
    if (existing) categoryId = existing.id;
    else categoryId = createdCategoryId = await input.createCategory(web.name);
  }

  // Sub category, the same way, within the chosen category.
  const subs = createdCategoryId ? [] : await input.loadSubCategories(categoryId);
  const categoryName = input.categories.find((c) => c.id === categoryId)?.name ?? "";
  let subCategoryId = subs.length ? (await pickFromList(product, "sub category (within the chosen category)", subs)).id : null;
  let createdSubCategoryId: string | null = null;
  if (!subCategoryId) {
    const web = await nameFromWeb(product, "sub category", subs, categoryName || undefined);
    if (web) {
      const existing = subs.find((s) => sameName(s.name, web.name));
      if (existing) subCategoryId = existing.id;
      else subCategoryId = createdSubCategoryId = await input.createSubCategory(categoryId, web.name);
    }
  }
  return { categoryId, subCategoryId, createdCategoryId, createdSubCategoryId, source, reason };
}
