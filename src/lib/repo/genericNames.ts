import { createRepo, type BaseRow } from "./base";

export interface GenericName extends BaseRow {
  name: string;
}

export const genericNamesRepo = createRepo<GenericName>("generic_names");

export function normalizeGenericName(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const key = (s: string) => normalizeGenericName(s).toUpperCase();
const letters = (s: string) => key(s).replace(/[^A-Z0-9]/g, "");

/** Same id on every device and in Turso for the same name (matches the
 * migration's 'gn-' || lower(hex(UPPER(TRIM(name))))), so two devices adding
 * the same name can never create two rows. */
export function genericNameId(name: string): string {
  const bytes = new TextEncoder().encode(key(name));
  return "gn-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
  const id = genericNameId(clean);
  const stored = await genericNamesRepo.get(id);
  if (stored) {
    if (stored.deleted_at) await genericNamesRepo.update(id, { deleted_at: null } as Partial<GenericName>);
    return normalizeGenericName(stored.name);
  }
  await genericNamesRepo.create({ id, name: clean });
  return clean;
}
