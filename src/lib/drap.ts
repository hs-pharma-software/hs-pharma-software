/**
 * DRAP (Drug Regulatory Authority of Pakistan) product import.
 *
 * Pure logic only (no DB / network) so it can be tested in isolation:
 * parsing DRAP records, building the POS Product Name / Description /
 * Company Name, eligibility, duplicate matching against existing products,
 * planning an import and applying it through injected insert/update ops.
 */
import { detectNarcotic } from "./narcotics";

export interface DrapRecord {
  regNo: string;
  /** Product name as registered (brand, often with form/strength words). */
  productName: string;
  /** "" when the source has no strength; never invented. */
  strength: string;
  dosageForm: string;
  /** Generic name / active ingredients exactly as the source lists them. */
  genericName: string;
  /** Manufacturer (NOT the marketing authorization holder). */
  manufacturer: string;
  /** Marketing authorization holder (DRAP "Company Name"). */
  mah: string;
  usedFor: string;
  status: string;
  regDate: string;
  route: string;
  labelClaim: string;
  packSizes: string;
  gtins: string[];
  source: "drap-online" | "csv";
}

/** Stored as JSON in products.drap_meta. */
export interface DrapMeta {
  regNo: string;
  registeredName: string;
  strength: string;
  dosageForm: string;
  genericName: string;
  manufacturer: string;
  mah: string;
  usedFor: string;
  status: string;
  regDate: string;
  route: string;
  labelClaim: string;
  packSizes: string;
  gtins: string[];
  source: string;
}

export interface ExistingProduct {
  id: string;
  name: string;
  description: string | null;
  company_name: string | null;
  drap_reg_no: string | null;
  drap_meta: string | null;
}

export type ImportMode = "insert" | "update" | "manual";
export type PlanAction = "insert" | "update" | "skip" | "reject" | "conflict";
export type ConflictChoice = "skip" | "link" | "overwrite" | "insert";

export interface FieldChange {
  field: "name" | "description" | "company_name" | "drap_reg_no";
  from: string;
  to: string;
}

export interface PlanRow {
  key: string;
  record: DrapRecord;
  productName: string;
  description: string;
  companyName: string;
  action: PlanAction;
  reason: string;
  flags: string[];
  match: ExistingProduct | null;
  /** How the match was found. */
  matchBy: "reg_no" | "name" | "probable" | null;
  /** Empty existing fields that the DRAP value fills (safe updates). */
  fills: FieldChange[];
  /** Non-empty existing values that differ from DRAP (never auto-overwritten). */
  differences: FieldChange[];
  metaChanged: boolean;
}

// ── Text helpers ──────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function clean(s: string | null | undefined): string {
  return decodeHtml(String(s ?? ""))
    .replace(/[ \s]+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return clean(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "));
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Parsing DRAP's registry record (eapp.dra.gov.pk productView.php) ─────

function fieldHtml(html: string, label: string): string {
  const m = html.match(new RegExp(`>${escapeRe(label)}</span>\\s*<span class="fw-semibold">([\\s\\S]*?)</div>`));
  return m ? m[1].replace(/(<\/span>\s*)+$/, "") : "";
}

/** Splits "Amoxicillin as trihydrate ...... 250 mg" into name and amount. */
function splitCompositionLine(line: string): { ingredient: string; amount: string } {
  const parts = line.split(/(?:\s*[.…]{2,}\s*)+/).map(clean).filter(Boolean);
  if (parts.length >= 2) return { ingredient: parts[0], amount: parts[parts.length - 1] };
  const m = line.match(/^(.*?)\s+(\d[\d.,]*\s*[a-zA-Z%µμ]+(?:\s*\/\s*[\d.]*\s*[a-zA-Z]+)?)\s*$/);
  return m ? { ingredient: clean(m[1]), amount: clean(m[2]) } : { ingredient: clean(line), amount: "" };
}

/** Builds strength from composition amounts and the label-claim basis
 * ("Each 5ml contains" -> "/5ml"). Returns "" if the source has no amounts. */
// An amount only counts as a strength when it carries a unit; DRAP has
// entries like "665 0" that must not be shown as a strength.
const AMOUNT_WITH_UNIT = /^\d[\d.,]*\s*(?:mg|mcg|µg|μg|g|gm|gms|kg|ml|l|iu|miu|mu|%|meq|mmol|units?|u|lac|million)\b/i;

export function deriveStrength(amounts: string[], labelClaim: string): string {
  const real = Array.from(new Set(amounts.map(clean).filter((a) => AMOUNT_WITH_UNIT.test(a))));
  if (real.length === 0) return "";
  const basis = labelClaim.match(/\beach\s+([\d.]+\s*(?:ml|g|gm))\b/i)?.[1]?.replace(/\s+/g, "");
  const joined = real.join("/");
  if (!basis || joined.toLowerCase().replace(/\s+/g, "").includes(`/${basis.toLowerCase()}`)) return joined;
  return real.length === 1 ? `${joined}/${basis}` : `${joined} per ${basis}`;
}

export function parseDrapRecordHtml(html: string): DrapRecord | null {
  const regNo = stripTags(fieldHtml(html, "Registration No")).replace(/[\s,;.]+$/, "");
  const productName = stripTags(fieldHtml(html, "Product Name")).replace(/\.$/, "").trim();
  if (!regNo && !productName) return null;

  // DRAP sometimes repeats the same ingredient line several times.
  const compositionLines = Array.from(
    new Map(
      fieldHtml(html, "Composition")
        .split(/<br\s*\/?>/i)
        .map(stripTags)
        .filter(Boolean)
        .map(splitCompositionLine)
        .map((c) => [`${c.ingredient.toLowerCase()}|${c.amount.toLowerCase()}`, c] as const)
    ).values()
  );
  const labelClaim = stripTags(fieldHtml(html, "Label Claim")).replace(/\n/g, " ");

  const manufacturers: { name: string; role: string }[] = [];
  const tbody = html.match(/Manufacturer Details[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  for (const row of tbody.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? []).map(stripTags);
    if (cells[0]) manufacturers.push({ name: cells[0], role: cells[2] ?? "" });
  }
  const manufacturer =
    manufacturers.find((m) => /manufactur/i.test(m.role))?.name ?? manufacturers[0]?.name ?? "";

  const packHtml = fieldHtml(html, "Pack Size(s)");
  const gtins = Array.from(packHtml.matchAll(/GTIN\s*:\s*(?:<[^>]+>\s*)*(\d{8,14})/gi)).map((m) => m[1]);

  return {
    regNo,
    productName,
    strength: deriveStrength(compositionLines.map((c) => c.amount), labelClaim),
    dosageForm: stripTags(fieldHtml(html, "Dosage Form")),
    genericName: Array.from(new Set(compositionLines.map((c) => c.ingredient).filter(Boolean))).join(", "),
    manufacturer,
    mah: stripTags(fieldHtml(html, "Company Name")),
    usedFor: stripTags(fieldHtml(html, "Used For")),
    status: stripTags(fieldHtml(html, "Registration Status")),
    regDate: stripTags(fieldHtml(html, "Registration Date")),
    route: stripTags(fieldHtml(html, "Route of Admin")),
    labelClaim,
    packSizes: stripTags(packHtml).replace(/\n/g, " "),
    gtins,
    source: "drap-online",
  };
}

// ── CSV (DRAP dataset files) ─────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  const delim = (src.split("\n")[0].match(/\t/g)?.length ?? 0) > (src.split("\n")[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADER_ALIASES: Record<keyof Omit<DrapRecord, "gtins" | "source" | "labelClaim" | "packSizes" | "route" | "regDate">, string[]> = {
  regNo: ["registrationno", "regno", "registrationnumber", "drapregno", "drapregistrationno", "drapregistrationnumber"],
  productName: ["brandname", "productname", "brand", "approvedname", "name", "proprietaryname"],
  strength: ["strength", "strengths"],
  dosageForm: ["dosageform", "type", "form", "dosage"],
  genericName: ["genericname", "generic", "activeingredients", "activeingredient", "composition"],
  manufacturer: ["manufacturername", "manufacturer", "manufacturedby", "manufacturingcompany"],
  mah: ["marketingauthorizationholder", "marketingauthorisationholder", "mah", "holder", "companyname", "company"],
  usedFor: ["usedfor", "use"],
  status: ["registrationstatus", "status"],
};

export interface CsvImport {
  records: DrapRecord[];
  columns: Partial<Record<keyof typeof HEADER_ALIASES, string>>;
  missingRequired: string[];
}

export function csvToRecords(text: string): CsvImport {
  const rows = parseCsv(text);
  if (rows.length === 0) return { records: [], columns: {}, missingRequired: ["header row"] };
  const header = rows[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const idx: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  const columns: CsvImport["columns"] = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof typeof HEADER_ALIASES, string[]][]) {
    for (const a of aliases) {
      const i = header.indexOf(a);
      if (i >= 0 && !Object.values(idx).includes(i)) { idx[field] = i; columns[field] = rows[0][i].trim(); break; }
    }
  }
  const missingRequired = idx.productName === undefined ? ["Brand Name / Product Name"] : [];
  const get = (r: string[], f: keyof typeof HEADER_ALIASES) => (idx[f] === undefined ? "" : clean(r[idx[f]!]));
  const records = rows.slice(1).map((r) => ({
    regNo: get(r, "regNo"),
    productName: get(r, "productName"),
    strength: get(r, "strength"),
    dosageForm: get(r, "dosageForm"),
    genericName: get(r, "genericName"),
    manufacturer: get(r, "manufacturer"),
    mah: get(r, "mah"),
    usedFor: get(r, "usedFor"),
    status: get(r, "status"),
    regDate: "",
    route: "",
    labelClaim: "",
    packSizes: "",
    gtins: [],
    source: "csv" as const,
  }));
  return { records, columns, missingRequired };
}

// ── Product Name formatting ──────────────────────────────────────────────

const FORM_ABBREV: [RegExp, string][] = [
  [/infusion/i, "Inf"],
  [/inject|ampoule|vial/i, "Inj"],
  [/suspension|\bsusp\b/i, "Susp"],
  [/syrup|elixir/i, "Syp"],
  [/tablet|\btabs?\b|caplet/i, "Tab"],
  [/capsule|\bcaps?\b/i, "Cap"],
  [/drop/i, "Drops"],
  [/ointment|\boint\b/i, "Oint"],
  [/cream/i, "Cream"],
  [/\bgel\b/i, "Gel"],
  [/lotion/i, "Lotion"],
  [/sachet|granule/i, "Sachet"],
  [/inhal/i, "Inhaler"],
  [/spray/i, "Spray"],
  [/suppositor/i, "Supp"],
  [/solution/i, "Soln"],
  [/liquid/i, "Liquid"],
  [/powder/i, "Powder"],
];

export function dosageAbbrev(form: string): string {
  const f = clean(form);
  if (!f) return "";
  for (const [re, abbrev] of FORM_ABBREV) if (re.test(f)) return abbrev;
  return f;
}

// Dosage-form wording DRAP puts inside registered names ("Panadol Tablet",
// "Agloclave 250mg/5ml Dry Powder Suspension"). Only wording that repeats the
// record's own dosage form is removed (it is shown once, abbreviated, at the
// end); other words stay, so "Example Syrup" sold as a suspension keeps
// "Syrup" in its brand.
const FORM_PREFIX =
  "(?:(?:dry\\s+)?powder\\s+for\\s+(?:oral\\s+)?|dry\\s+powder\\s+(?:for\\s+)?|oral\\s+|film[- ]?coated\\s+|" +
  "(?:extended|sustained|modified|delayed|prolonged)[- ]release\\s+|enteric[- ]coated\\s+|chewable\\s+|" +
  "dispersible\\s+|effervescent\\s+|i\\.?v\\.?\\s+|i\\.?m\\.?\\s+)*";
const FORM_TERMS: [string, string][] = [
  ["tablets?|tabs?|caplets?", "Tab"],
  ["capsules?|caps?", "Cap"],
  ["syrup|elixir", "Syp"],
  ["suspension|susp", "Susp"],
  ["injections?|injectable|inj|for\\s+injection", "Inj"],
  ["infusion", "Inf"],
  ["(?:eye\\s+|ear\\s+|nasal\\s+|oral\\s+)?drops?", "Drops"],
  ["cream", "Cream"],
  ["ointment|oint", "Oint"],
  ["gel", "Gel"],
  ["lotion", "Lotion"],
  ["sachets?|granules", "Sachet"],
  ["inhaler", "Inhaler"],
  ["spray", "Spray"],
  ["suppositor(?:y|ies)", "Supp"],
  ["solution", "Soln"],
  ["liquid", "Liquid"],
  ["powder", "Powder"],
];
const SAME_FORM: Record<string, string[]> = { Inj: ["Inj", "Inf"], Inf: ["Inj", "Inf"] };

function numbersIn(s: string): number[] {
  return Array.from(s.matchAll(/\d+(?:[.,]\d+)?/g)).map((m) => parseFloat(m[0].replace(",", ".")));
}

export function brandFromName(name: string, dosageForm = ""): string {
  const original = clean(name)
    .replace(/\.$/, "")
    .replace(/\b(injection|tablets?|capsules?|suspension|syrup|infusion)(\d)/gi, "$1 $2");
  const type = dosageAbbrev(dosageForm);
  if (!type) return original;
  const removable = SAME_FORM[type] ?? [type];
  let out = original.replace(/\(\s*(?:i\.?v\.?|i\.?m\.?|oral)\s*\)/gi, " ");
  for (const [terms, cls] of FORM_TERMS) {
    if (!removable.includes(cls)) continue;
    out = out.replace(new RegExp(`\\b${FORM_PREFIX}(?:${terms})\\b`, "gi"), " ");
  }
  if (removable.includes("Inj")) out = out.replace(/\b(?:i\.?v\.?|i\.?m\.?)(?=\s|$)/gi, " ");
  // Only a "/" left between two removed words ("Injection/Infusion") is
  // dropped; "+" and other notation inside the name is preserved.
  const stripped = clean(out.replace(/(^|\s)\/(?=\s|$)/g, " ")).replace(/[\s,\-/(]+$/, "").trim();
  return stripped || original;
}

/** Brand + Strength + Type, e.g. "Panadol 500 mg Tab". Strength is only
 * appended if present in the source and not already in the name. */
export function formatProductName(rec: Pick<DrapRecord, "productName" | "strength" | "dosageForm">): string {
  const brand = brandFromName(rec.productName, rec.dosageForm);
  const strength = clean(rec.strength);
  const firstStrengthNumber = numbersIn(strength)[0];
  // The registered name already states a strength ("Stamentin ... 156.25mg",
  // "Panadol Night 500mg/25mg"): don't append a second one.
  const nameHasStrength = /\d(?:[\d.,]*)\s*(?:mg|mcg|µg|μg|g|gm|ml|iu|miu|%|meq|mmol)\b/i.test(brand);
  const alreadyHasStrength =
    nameHasStrength || (firstStrengthNumber !== undefined && numbersIn(brand).includes(firstStrengthNumber));
  const type = dosageAbbrev(rec.dosageForm);
  return clean([brand, strength && !alreadyHasStrength ? strength : "", type].filter(Boolean).join(" "));
}

// ── Eligibility ──────────────────────────────────────────────────────────

const INELIGIBLE_STATUS = /cancel|suspend|withdraw|revok|expire|reject|deregist|discontinu/i;

export function rejectionReason(rec: DrapRecord): string | null {
  if (!clean(rec.productName)) return "No brand / product name in source";
  if (rec.source === "drap-online" && !clean(rec.regNo)) return "No DRAP registration number";
  if (rec.usedFor && !/human/i.test(rec.usedFor)) return `Not for human use (${rec.usedFor})`;
  if (rec.status && INELIGIBLE_STATUS.test(rec.status)) return `Registration status: ${rec.status}`;
  return null;
}

export function toMeta(rec: DrapRecord): DrapMeta {
  return {
    regNo: rec.regNo,
    registeredName: rec.productName,
    strength: rec.strength,
    dosageForm: rec.dosageForm,
    genericName: rec.genericName,
    manufacturer: rec.manufacturer,
    mah: rec.mah,
    usedFor: rec.usedFor,
    status: rec.status,
    regDate: rec.regDate,
    route: rec.route,
    labelClaim: rec.labelClaim,
    packSizes: rec.packSizes,
    gtins: rec.gtins,
    source: rec.source,
  };
}

// ── Duplicate matching ───────────────────────────────────────────────────

const norm = (s: string | null | undefined) =>
  clean(s).toUpperCase().replace(/\\/g, "/").replace(/[^A-Z0-9.]+/g, " ").trim();
const compact = (s: string | null | undefined) => norm(s).replace(/[ .]/g, "");

const FORM_CLASS: [RegExp, string][] = [
  [/\b(TAB|TABS|TABLET|TABLETS|CAPLET)\b/, "tab"],
  [/\b(CAP|CAPS|CAPSULE|CAPSULES)\b/, "cap"],
  [/\b(SYP|SYRUP|SUSP|SUSPENSION|ELIXIR|LIQUID|SOLN|SOLUTION|DS)\b/, "liquid"],
  [/\b(INF|INFUSION)\b/, "inf"],
  [/\b(INJ|INJECTION|AMP|AMPOULE|VIAL|IV|IM)\b/, "inj"],
  [/\b(DROP|DROPS)\b/, "drops"],
  [/\b(CREAM)\b/, "cream"],
  [/\b(OINT|OINTMENT)\b/, "oint"],
  [/\b(GEL)\b/, "gel"],
  [/\b(LOTION|LOYION)\b/, "lotion"],
  [/\b(SACHET|SACHETS|GRANULES)\b/, "sachet"],
  [/\b(SPRAY)\b/, "spray"],
];

function formClass(text: string): string | null {
  const t = norm(text);
  for (const [re, c] of FORM_CLASS) if (re.test(t)) return c;
  return null;
}

const NON_BRAND_WORDS = new Set([
  "CHILDREN", "CHILDRENS", "S", "THE", "PER", "X",
  "MG", "MCG", "UG", "ML", "G", "GM", "GMS", "KG", "L", "IU", "MEQ", "MMOL", "W", "V", "PERCENT",
  "TAB", "TABS", "TABLET", "TABLETS", "CAP", "CAPS", "CAPSULE", "CAPSULES", "SYP", "SYRUP", "SUSP", "SUSPENSION",
  "INJ", "INJECTION", "INF", "INFUSION", "DROP", "DROPS", "CREAM", "OINT", "OINTMENT", "GEL", "LOTION", "LOYION",
  "SACHET", "SACHETS", "SPRAY", "SOLN", "SOLUTION", "LIQUID", "POWDER", "IV", "IM", "ORAL",
  "DRY", "FOR", "FILM", "COATED", "ELIXIR", "INJECTABLE", "GRANULES", "EMULSION",
]);

/** Brand words only (no dosage form, units or numbers): "Panadol Extra" and
 * "Panadol" are different brands even at the same strength. */
function brandWords(text: string): string[] {
  return Array.from(
    new Set(norm(text).split(" ").filter((t) => /^[A-Z]+$/.test(t) && !NON_BRAND_WORDS.has(t)))
  ).sort();
}

function brandKey(text: string): string {
  return brandWords(text).join(" ");
}

function companyCompatible(existing: string | null, ...drap: string[]): boolean {
  const e = norm(existing);
  if (!e) return true;
  const firstWord = (s: string) => norm(s).split(" ").find((w) => w.length >= 3) ?? "";
  const ew = firstWord(e);
  return drap.some((d) => {
    const n = norm(d);
    return !!n && (n.includes(e) || e.includes(n) || (!!ew && firstWord(n) === ew));
  });
}

export interface ExistingIndex {
  byReg: Map<string, ExistingProduct>;
  byName: Map<string, ExistingProduct>;
  byBrand: Map<string, ExistingProduct[]>;
}

export function indexExisting(products: ExistingProduct[]): ExistingIndex {
  const byReg = new Map<string, ExistingProduct>();
  const byName = new Map<string, ExistingProduct>();
  const byBrand = new Map<string, ExistingProduct[]>();
  for (const p of products) {
    if (p.drap_reg_no) byReg.set(clean(p.drap_reg_no), p);
    byName.set(compact(p.name), p);
    const b = brandKey(p.name);
    if (b) byBrand.set(b, [...(byBrand.get(b) ?? []), p]);
  }
  return { byReg, byName, byBrand };
}

function findMatch(
  rec: DrapRecord,
  productName: string,
  idx: ExistingIndex
): { match: ExistingProduct; by: "reg_no" | "name" | "probable"; note?: string } | null {
  if (rec.regNo && idx.byReg.has(clean(rec.regNo))) return { match: idx.byReg.get(clean(rec.regNo))!, by: "reg_no" };
  const exact = idx.byName.get(compact(productName));
  if (exact) return { match: exact, by: "name" };

  const candidates = idx.byBrand.get(brandKey(productName)) ?? [];
  const formD = formClass(productName);
  const numsD = numbersIn(productName);
  let best: { match: ExistingProduct; score: number; note?: string } | null = null;
  for (const p of candidates) {
    const formE = formClass(p.name) ?? formClass(p.description ?? "");
    if (formD && formE && formD !== formE) continue;
    let numsE = numbersIn(p.name);
    if (numsE.length === 0) numsE = numbersIn(p.description ?? "");
    if (numsD.length > 0 && numsE.length > 0 && numsD[0] !== numsE[0]) continue;
    const sameCompany = companyCompatible(p.company_name, rec.manufacturer, rec.mah);
    const score = (sameCompany ? 2 : 0) + (numsE.length > 0 ? 1 : 0) + (formE ? 1 : 0);
    if (!best || score > best.score) {
      best = { match: p, score, note: sameCompany ? undefined : `company differs (${p.company_name})` };
    }
  }
  return best ? { match: best.match, by: "probable", note: best.note } : null;
}

// ── Planning ─────────────────────────────────────────────────────────────

function metaEqual(a: string | null, b: DrapMeta): boolean {
  if (!a) return false;
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function planImport(records: DrapRecord[], existing: ExistingProduct[], mode: ImportMode): PlanRow[] {
  const idx = indexExisting(existing);
  const seenReg = new Map<string, string>();
  const seenName = new Map<string, { company: string; label: string }[]>();
  const rows: PlanRow[] = [];

  records.forEach((rec, i) => {
    const productName = formatProductName(rec);
    const description = clean(rec.genericName);
    const companyName = clean(rec.manufacturer);
    const flags: string[] = [];
    if (!clean(rec.strength)) flags.push("No usable strength in source");
    if (!description) flags.push("No generic name in source");
    if (!companyName) flags.push("No manufacturer in source - review");
    const base: PlanRow = {
      key: `${rec.regNo || "row"}-${i}`,
      record: rec,
      productName,
      description,
      companyName,
      action: "skip",
      reason: "",
      flags,
      match: null,
      matchBy: null,
      fills: [],
      differences: [],
      metaChanged: false,
    };

    const rejected = rejectionReason(rec);
    if (rejected) return rows.push({ ...base, action: "reject", reason: rejected });

    // Same registration twice, or the same product re-registered (same name,
    // company unknown or compatible) within the batch: keep only the first.
    const label = rec.regNo ? `DRAP ${clean(rec.regNo)}` : productName;
    const company = companyName || clean(rec.mah);
    const regDup = rec.regNo ? seenReg.get(clean(rec.regNo)) : undefined;
    const nameDup = (seenName.get(compact(productName)) ?? []).find(
      (s) => !s.company || !company || companyCompatible(s.company, company)
    );
    if (regDup || nameDup) return rows.push({ ...base, action: "skip", reason: `Duplicate in source of ${regDup ?? nameDup!.label}` });
    if (rec.regNo) seenReg.set(clean(rec.regNo), label);
    seenName.set(compact(productName), [...(seenName.get(compact(productName)) ?? []), { company, label }]);

    const found = findMatch(rec, productName, idx);
    if (!found) return rows.push({ ...base, action: "insert", reason: "New product" });

    const p = found.match;
    const meta = toMeta(rec);
    const fills: FieldChange[] = [];
    const differences: FieldChange[] = [];
    const compare = (field: FieldChange["field"], current: string | null, incoming: string) => {
      const cur = clean(current);
      if (!incoming) return;
      if (!cur) fills.push({ field, from: "", to: incoming });
      else if (compact(cur) !== compact(incoming)) differences.push({ field, from: cur, to: incoming });
    };
    if (found.by !== "name") compare("name", p.name, productName);
    compare("description", p.description, description);
    compare("company_name", p.company_name, companyName);
    if (rec.regNo) {
      if (!clean(p.drap_reg_no)) fills.push({ field: "drap_reg_no", from: "", to: clean(rec.regNo) });
      else if (clean(p.drap_reg_no) !== clean(rec.regNo)) differences.push({ field: "drap_reg_no", from: clean(p.drap_reg_no), to: clean(rec.regNo) });
    }
    const metaChanged = !metaEqual(p.drap_meta, meta);
    const row: PlanRow = { ...base, match: p, matchBy: found.by, fills, differences, metaChanged };
    const where = `"${p.name}"`;

    if (mode === "insert") {
      return rows.push({ ...row, action: "skip", reason: found.by === "probable" ? `Possible duplicate of ${where}` : `Already exists as ${where}` });
    }
    if (found.by === "probable" || differences.some((d) => d.field === "drap_reg_no")) {
      const why = found.by === "probable"
        ? `Possible duplicate of ${where}${found.note ? `; ${found.note}` : ""}`
        : `${where} has a different DRAP reg no`;
      return rows.push({ ...row, action: mode === "manual" ? "conflict" : "skip", reason: mode === "manual" ? why : `${why} - needs manual review` });
    }
    if (mode === "manual" && differences.length > 0) {
      return rows.push({ ...row, action: "conflict", reason: `Existing values differ from DRAP for ${where}` });
    }
    if (fills.length === 0 && !metaChanged) {
      return rows.push({ ...row, action: "skip", reason: `Unchanged: ${where}` });
    }
    const kept = differences.length > 0 ? ` (kept existing ${differences.map((d) => d.field).join(", ")})` : "";
    return rows.push({ ...row, action: "update", reason: `Update ${where}${kept}` });
  });
  return rows;
}

// ── Applying ─────────────────────────────────────────────────────────────

export interface ProductInsert {
  name: string;
  description: string | null;
  company_name: string | null;
  drap_reg_no: string | null;
  drap_meta: string;
  packing: number;
  is_narcotic: number;
  base_unit_id: string | null;
}

/** The only columns a DRAP import may change on an existing product. Stock,
 * prices, barcodes, tax/FBR settings and units are never touched. */
export interface ProductPatch {
  name?: string;
  description?: string;
  company_name?: string;
  drap_reg_no?: string;
  drap_meta?: string;
}

export interface ImportOps {
  insert(p: ProductInsert): Promise<void>;
  update(id: string, patch: ProductPatch): Promise<void>;
  /** UOM id for a dosage-form abbreviation, if a matching UOM exists. */
  uomFor?(abbrev: string): string | null;
}

export interface ReportLine {
  regNo: string;
  productName: string;
  existing: string;
  detail: string;
}

export interface ImportReport {
  inserted: ReportLine[];
  updated: ReportLine[];
  skipped: ReportLine[];
  rejected: ReportLine[];
  failed: ReportLine[];
}

function patchFrom(row: PlanRow, overwrite: boolean): ProductPatch {
  const patch: ProductPatch = { drap_meta: JSON.stringify(toMeta(row.record)) };
  const apply = (changes: FieldChange[]) => {
    for (const c of changes) {
      if (c.field === "name") patch.name = c.to;
      if (c.field === "description") patch.description = c.to;
      if (c.field === "company_name") patch.company_name = c.to;
      if (c.field === "drap_reg_no") patch.drap_reg_no = c.to;
    }
  };
  // Name is only filled/overwritten on an explicit overwrite decision.
  apply(row.fills.filter((f) => f.field !== "name" || overwrite));
  if (overwrite) apply(row.differences);
  return patch;
}

export async function applyImport(
  rows: PlanRow[],
  decisions: Record<string, ConflictChoice>,
  ops: ImportOps
): Promise<ImportReport> {
  const report: ImportReport = { inserted: [], updated: [], skipped: [], rejected: [], failed: [] };
  const line = (r: PlanRow, detail: string): ReportLine => ({
    regNo: r.record.regNo,
    productName: r.productName,
    existing: r.match?.name ?? "",
    detail,
  });

  for (const r of rows) {
    let action: PlanAction = r.action;
    let overwrite = false;
    if (r.action === "conflict") {
      const choice = decisions[r.key] ?? "skip";
      if (choice === "skip") { report.skipped.push(line(r, `Conflict left unresolved: ${r.reason}`)); continue; }
      if (choice === "insert") action = "insert";
      else { action = "update"; overwrite = choice === "overwrite"; }
    }
    try {
      if (action === "insert") {
        await ops.insert({
          name: r.productName,
          description: r.description || null,
          company_name: r.companyName || null,
          drap_reg_no: clean(r.record.regNo) || null,
          drap_meta: JSON.stringify(toMeta(r.record)),
          packing: 1,
          is_narcotic: detectNarcotic(r.productName, r.description) ? 1 : 0,
          base_unit_id: ops.uomFor?.(dosageAbbrev(r.record.dosageForm)) ?? null,
        });
        report.inserted.push(line(r, r.flags.join("; ") || "Inserted"));
      } else if (action === "update" && r.match) {
        const patch = patchFrom(r, overwrite);
        await ops.update(r.match.id, patch);
        const changed = Object.keys(patch).filter((k) => k !== "drap_meta");
        report.updated.push(line(r, changed.length ? `Set ${changed.join(", ")}` : "Regulatory details refreshed"));
      } else if (action === "reject") {
        report.rejected.push(line(r, r.reason));
      } else {
        report.skipped.push(line(r, r.reason));
      }
    } catch (e) {
      report.failed.push(line(r, e instanceof Error ? e.message : String(e)));
    }
  }
  return report;
}

export function reportToCsv(report: ImportReport): string {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const out = [["Result", "DRAP Reg No", "Product Name", "Existing Product", "Detail"].join(",")];
  for (const [label, lines] of Object.entries(report) as [string, ReportLine[]][]) {
    for (const l of lines) out.push([label, l.regNo, l.productName, l.existing, l.detail].map(esc).join(","));
  }
  return out.join("\r\n");
}
