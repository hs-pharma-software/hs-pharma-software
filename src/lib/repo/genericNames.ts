import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";

export interface GenericName extends TenantRow {
  name: string;
}

/** Each tenant keeps its own Description suggestion list (v29). */
export const genericNamesRepo = createTenantRepo<GenericName>("generic_names");

export function normalizeGenericName(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const key = (s: string) => normalizeGenericName(s).toUpperCase();
const letters = (s: string) => key(s).replace(/[^A-Z0-9]/g, "");

/** Same id on every device and in Turso for the same name within one
 * tenant, so two devices adding the same name can never create two rows.
 * (Rows from before v29 keep their old 'gn-<hex>' ids.) */
export function genericNameId(name: string, tenantId: string): string {
  const bytes = new TextEncoder().encode(key(name));
  return "gn-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + "~" + tenantId;
}

export async function listGenericNames(): Promise<string[]> {
  const rows = await genericNamesRepo.list({ orderBy: "name ASC" });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const k = key(r.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(normalizeGenericName(r.name));
  }
  return out;
}

export function findExact(list: string[], name: string): string | undefined {
  const k = key(name);
  return list.find((n) => key(n) === k);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Existing names that differ only by punctuation/spacing or a small typo
 * ("CETRIZINE" vs "CITRIZINE"), shown before a new name is added. */
export function findSimilar(list: string[], name: string, limit = 5): string[] {
  const l = letters(name);
  if (l.length < 4) return [];
  const maxDist = l.length >= 12 ? 2 : 1;
  return list
    .filter((n) => {
      const o = letters(n);
      return o !== "" && key(n) !== key(name) && (o === l || editDistance(o, l) <= maxDist);
    })
    .slice(0, limit);
}

/** Adds a name unless it already exists (case/spacing-insensitive). Returns
 * the stored name. */
export async function addGenericName(name: string, current: string[]): Promise<string> {
  const clean = normalizeGenericName(name);
  if (!clean) throw new Error("Description is empty.");
  const existing = findExact(current, clean);
  if (existing) return existing;
  const tenantId = requireCurrentTenantId();
  // Any row of this tenant with the same name (also a deleted one, or one
  // from before v29 with an older id) is reused.
  const stored = (await dbSelect<GenericName>(`SELECT * FROM generic_names WHERE tenant_id = ? AND UPPER(TRIM(name)) = ? LIMIT 1`, [tenantId, key(clean)]))[0];
  if (stored) {
    if (stored.deleted_at) await genericNamesRepo.update(stored.id, { deleted_at: null } as Partial<GenericName>);
    return normalizeGenericName(stored.name);
  }
  await genericNamesRepo.create({ id: genericNameId(clean, tenantId), name: clean });
  return clean;
}
