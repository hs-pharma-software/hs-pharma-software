/** Structured ultrasound reports: the values a doctor fills in for each kind of
 * scan, how they print, and the checks before a report is released. Pure code,
 * no imports: the form, the printed report, the online copy and the tests share it.
 *
 * Reference ranges only mark a value for the doctor's attention; the doctor
 * writes the conclusion. The fetus's sex is deliberately not a field. */

export type UsRow = Record<string, string>;
export type UsValue = string | UsRow[];
export type UsValues = Record<string, UsValue>;

export interface UsContext {
  gender: string | null;
  /** yyyy-mm-dd: the day of the report. */
  reportDate: string;
}

export interface UsColumn {
  key: string;
  label: string;
  type: "number" | "text" | "select";
  unit?: string;
  options?: string[];
  required?: boolean;
  min?: number;
  max?: number;
}

export interface UsField {
  key: string;
  label: string;
  type: "number" | "text" | "select" | "yesno" | "date" | "list" | "computed";
  unit?: string;
  options?: string[];
  /** Reference range: outside it the value is marked High or Low. */
  min?: number;
  max?: number;
  /** Shown only while another field has one of these values. */
  showIf?: { key: string; is: string[] };
  gender?: "male" | "female";
  columns?: UsColumn[];
  /** list: what one row is called ("stone"). */
  itemName?: string;
  /** list: the "One / Multiple" field that decides how many rows are needed. */
  countKey?: string;
  compute?: (v: UsValues, ctx: UsContext) => string | null;
}

export interface UsSection {
  title: string;
  gender?: "male" | "female";
  showIf?: { key: string; is: string[] };
  fields: UsField[];
}

export interface UsTemplate {
  id: string;
  name: string;
  /** Finds the pattern from the study's name. */
  match: RegExp;
  sections: UsSection[];
}

export interface StructuredReport {
  template: string;
  values: UsValues;
  recommendation?: string | null;
  note?: string | null;
}

const text = (v: UsValue | undefined) => (typeof v === "string" ? v.trim() : "");
const number = (v: UsValue | undefined) => {
  const t = text(v);
  return t !== "" && Number.isFinite(Number(t)) ? Number(t) : null;
};

// ── Field builders ────────────────────────────────────────────────────────

const yes = (key: string) => ({ key, is: ["Yes"] });

/** Yes / No, then One or Multiple, then the size and location of each. */
function findingList(p: string, label: string, itemName: string, locations: string[], sizeUnit = "mm"): UsField[] {
  return [
    { key: `${p}`, label, type: "yesno" },
    { key: `${p}_count`, label: `Number of ${itemName}s`, type: "select", options: ["One", "Multiple"], showIf: yes(p) },
    {
      key: `${p}_items`, label: `${label}: details`, type: "list", itemName, countKey: `${p}_count`, showIf: yes(p),
      columns: [
        { key: "size", label: "Size", type: "number", unit: sizeUnit, required: true },
        { key: "location", label: "Location", type: "select", options: locations, required: true },
      ],
    },
  ];
}

const KIDNEY_SITES = ["Upper pole calyx", "Mid pole calyx", "Lower pole calyx", "Renal pelvis", "Pelviureteric junction"];

function kidney(p: string, side: string): UsSection {
  return {
    title: `${side} kidney`,
    fields: [
      { key: `${p}_length`, label: "Length", type: "number", unit: "cm", min: 9, max: 12 },
      { key: `${p}_width`, label: "Width", type: "number", unit: "cm" },
      { key: `${p}_cortex`, label: "Parenchymal thickness", type: "number", unit: "cm" },
      { key: `${p}_echo`, label: "Echogenicity", type: "select", options: ["Normal", "Increased", "Decreased"] },
      { key: `${p}_cmd`, label: "Corticomedullary differentiation", type: "select", options: ["Maintained", "Reduced", "Lost"] },
      { key: `${p}_hydro`, label: "Hydronephrosis", type: "select", options: ["None", "Mild", "Moderate", "Severe"] },
      ...findingList(`${p}_stone`, "Stone", "stone", KIDNEY_SITES),
      { key: `${p}_cyst`, label: "Cyst", type: "yesno" },
      { key: `${p}_cyst_detail`, label: "Cyst size and location", type: "text", showIf: yes(`${p}_cyst`) },
      { key: `${p}_mass`, label: "Mass", type: "yesno" },
      { key: `${p}_mass_detail`, label: "Mass size and location", type: "text", showIf: yes(`${p}_mass`) },
    ],
  };
}

function bladder(): UsSection {
  return {
    title: "Urinary bladder",
    fields: [
      { key: "ub_distension", label: "Distension", type: "select", options: ["Well distended", "Partially distended", "Empty"] },
      { key: "ub_wall", label: "Wall thickness", type: "number", unit: "mm", max: 5 },
      { key: "ub_contents", label: "Contents", type: "select", options: ["Anechoic (clear)", "Internal echoes", "Debris"] },
      ...findingList("ub_stone", "Stone", "stone", ["Bladder lumen", "Vesicoureteric junction, right", "Vesicoureteric junction, left"]),
      { key: "ub_mass", label: "Mass", type: "yesno" },
      { key: "ub_mass_detail", label: "Mass size and location", type: "text", showIf: yes("ub_mass") },
      { key: "ub_prevoid", label: "Pre-void volume", type: "number", unit: "ml" },
      { key: "ub_postvoid", label: "Post-void residual", type: "number", unit: "ml", max: 50 },
    ],
  };
}

function prostate(): UsSection {
  return {
    title: "Prostate",
    gender: "male",
    fields: [
      { key: "pr_l", label: "Length", type: "number", unit: "cm" },
      { key: "pr_w", label: "Width", type: "number", unit: "cm" },
      { key: "pr_h", label: "Height", type: "number", unit: "cm" },
      {
        key: "pr_volume", label: "Volume (calculated)", type: "computed",
        compute: (v) => {
          const [l, w, h] = [number(v.pr_l), number(v.pr_w), number(v.pr_h)];
          return l && w && h ? `${(0.52 * l * w * h).toFixed(1)} cc` : null;
        },
      },
      { key: "pr_echo", label: "Echotexture", type: "select", options: ["Homogeneous", "Heterogeneous"] },
      { key: "pr_median", label: "Median lobe protrusion", type: "yesno" },
    ],
  };
}

// ── Pregnancy dates ───────────────────────────────────────────────────────

const DAY = 86_400_000;
const utc = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN);

/** Gestational age on the report day from the last menstrual period, or null when the dates don't fit a pregnancy. */
export function gestationalAge(lmp: string, on: string): string | null {
  const days = Math.round((utc(on) - utc(lmp)) / DAY);
  if (!Number.isFinite(days) || days < 0 || days > 44 * 7) return null;
  const [w, d] = [Math.floor(days / 7), days % 7];
  return `${w} week${w === 1 ? "" : "s"} ${d} day${d === 1 ? "" : "s"}`;
}

/** Expected delivery date: 280 days after the last menstrual period. */
export function expectedDelivery(lmp: string): string | null {
  const t = utc(lmp);
  return Number.isFinite(t) ? new Date(t + 280 * DAY).toISOString().slice(0, 10) : null;
}

const FIRST = { key: "trimester", is: ["First"] };
const LATER = { key: "trimester", is: ["Second", "Third"] };

// ── The report patterns ───────────────────────────────────────────────────

export const ULTRASOUND_TEMPLATES: UsTemplate[] = [
  {
    id: "kub",
    name: "KUB (kidneys, ureters, bladder)",
    match: /\bkub\b|kidney|renal|urinary|bladder/i,
    sections: [
      kidney("rk", "Right"),
      kidney("lk", "Left"),
      {
        title: "Ureters",
        fields: [
          { key: "ur_right", label: "Right ureter dilated", type: "yesno" },
          { key: "ur_left", label: "Left ureter dilated", type: "yesno" },
          ...findingList("ur_stone", "Ureteric stone", "stone", ["Right proximal", "Right mid", "Right distal", "Right vesicoureteric junction", "Left proximal", "Left mid", "Left distal", "Left vesicoureteric junction"]),
        ],
      },
      bladder(),
      prostate(),
    ],
  },
  {
    id: "obstetric",
    name: "Pregnancy (obstetric)",
    match: /obstetric|pregnan|\bobs\b|fetal|foetal|anomaly|\bnt\b|nuchal/i,
    sections: [
      {
        title: "Pregnancy",
        fields: [
          { key: "lmp", label: "Last menstrual period (LMP)", type: "date" },
          { key: "ga_lmp", label: "Gestational age by LMP", type: "computed", compute: (v, ctx) => (text(v.lmp) ? gestationalAge(text(v.lmp), ctx.reportDate) : null) },
          { key: "edd_lmp", label: "Expected delivery by LMP", type: "computed", compute: (v) => (text(v.lmp) ? expectedDelivery(text(v.lmp)) : null) },
          { key: "trimester", label: "Trimester", type: "select", options: ["First", "Second", "Third"] },
          { key: "fetus_number", label: "Number of fetuses", type: "select", options: ["Single", "Twins", "Triplets", "More than three"] },
        ],
      },
      {
        title: "Early pregnancy",
        showIf: FIRST,
        fields: [
          { key: "sac_site", label: "Gestational sac", type: "select", options: ["Intrauterine", "Not seen", "Ectopic suspected"] },
          { key: "msd", label: "Mean sac diameter", type: "number", unit: "mm" },
          { key: "yolk", label: "Yolk sac", type: "select", options: ["Seen", "Not seen"] },
          { key: "fetal_pole", label: "Fetal pole", type: "select", options: ["Seen", "Not seen"] },
          { key: "crl", label: "Crown rump length (CRL)", type: "number", unit: "mm" },
          { key: "early_cardiac", label: "Cardiac activity", type: "select", options: ["Present", "Absent", "Too early to assess"] },
          { key: "early_fhr", label: "Fetal heart rate", type: "number", unit: "bpm", showIf: { key: "early_cardiac", is: ["Present"] } },
          { key: "nt", label: "Nuchal translucency", type: "number", unit: "mm", max: 3 },
        ],
      },
      {
        title: "Fetal assessment",
        showIf: LATER,
        fields: [{
          key: "fetuses", label: "Fetus details", type: "list", itemName: "fetus",
          columns: [
            { key: "presentation", label: "Presentation", type: "select", options: ["Cephalic", "Breech", "Transverse", "Oblique", "Variable"] },
            { key: "cardiac", label: "Cardiac activity", type: "select", options: ["Present", "Absent"], required: true },
            { key: "fhr", label: "FHR", type: "number", unit: "bpm", min: 110, max: 160 },
            { key: "movement", label: "Movement", type: "select", options: ["Present", "Reduced", "Absent"] },
            { key: "bpd", label: "BPD", type: "number", unit: "mm" },
            { key: "hc", label: "HC", type: "number", unit: "mm" },
            { key: "ac", label: "AC", type: "number", unit: "mm" },
            { key: "fl", label: "FL", type: "number", unit: "mm" },
            { key: "efw", label: "Weight", type: "number", unit: "g" },
          ],
        }],
      },
      {
        title: "Dating by this scan",
        fields: [
          { key: "ga_weeks", label: "Gestational age, weeks", type: "number", unit: "weeks" },
          { key: "ga_days", label: "Gestational age, days", type: "number", unit: "days", max: 6 },
          { key: "edd_scan", label: "Expected delivery by scan", type: "date" },
        ],
      },
      {
        title: "Placenta and liquor",
        showIf: LATER,
        fields: [
          { key: "pl_site", label: "Placenta location", type: "select", options: ["Anterior", "Posterior", "Fundal", "Right lateral", "Left lateral"] },
          { key: "pl_grade", label: "Placenta grade", type: "select", options: ["0", "I", "II", "III"] },
          { key: "pl_previa", label: "Relation to cervix", type: "select", options: ["Clear of the os", "Low lying", "Marginal previa", "Complete previa"] },
          { key: "pl_os", label: "Lower edge to internal os", type: "number", unit: "cm" },
          { key: "afi", label: "Amniotic fluid index (AFI)", type: "number", unit: "cm", min: 5, max: 24 },
          { key: "dvp", label: "Deepest vertical pocket", type: "number", unit: "cm", min: 2, max: 8 },
          { key: "cervix", label: "Cervical length", type: "number", unit: "cm", min: 2.5 },
        ],
      },
      {
        title: "Fetal anatomy and mother",
        fields: [
          { key: "anatomy", label: "Fetal anatomy seen", type: "select", options: ["Normal", "Abnormal", "Not fully assessed"], showIf: LATER },
          { key: "anatomy_detail", label: "Anatomy details", type: "text", showIf: { key: "anatomy", is: ["Abnormal", "Not fully assessed"] } },
          { key: "adnexa", label: "Adnexa", type: "select", options: ["Normal", "Abnormal"] },
          { key: "adnexa_detail", label: "Adnexa details", type: "text", showIf: { key: "adnexa", is: ["Abnormal"] } },
          { key: "free_fluid", label: "Free fluid", type: "yesno" },
        ],
      },
    ],
  },
  {
    id: "abdomen",
    name: "Whole abdomen",
    match: /abdomen|abdominal|\bhepat|liver|gall ?bladder/i,
    sections: [
      {
        title: "Liver",
        fields: [
          { key: "lv_span", label: "Span", type: "number", unit: "cm", max: 15.5 },
          { key: "lv_echo", label: "Echotexture", type: "select", options: ["Normal", "Fatty, grade I", "Fatty, grade II", "Fatty, grade III", "Coarse"] },
          { key: "lv_lesion", label: "Focal lesion", type: "yesno" },
          { key: "lv_lesion_detail", label: "Lesion size and location", type: "text", showIf: yes("lv_lesion") },
          { key: "pv", label: "Portal vein", type: "number", unit: "mm", max: 13 },
        ],
      },
      {
        title: "Gall bladder and bile ducts",
        fields: [
          { key: "gb_wall", label: "Gall bladder wall", type: "number", unit: "mm", max: 3 },
          ...findingList("gb_stone", "Gall stone", "stone", ["Fundus", "Body", "Neck"]),
          { key: "gb_sludge", label: "Sludge", type: "yesno" },
          { key: "gb_polyp", label: "Polyp", type: "yesno" },
          { key: "cbd", label: "Common bile duct", type: "number", unit: "mm", max: 6 },
        ],
      },
      {
        title: "Pancreas and spleen",
        fields: [
          { key: "pan", label: "Pancreas", type: "select", options: ["Normal", "Bulky", "Atrophic", "Obscured by bowel gas"] },
          { key: "sp_size", label: "Spleen size", type: "number", unit: "cm", max: 12 },
          { key: "sp_echo", label: "Spleen echotexture", type: "select", options: ["Normal", "Abnormal"] },
        ],
      },
      kidney("rk", "Right"),
      kidney("lk", "Left"),
      bladder(),
      prostate(),
      {
        title: "Peritoneum",
        fields: [
          { key: "ascites", label: "Ascites", type: "select", options: ["None", "Mild", "Moderate", "Gross"] },
          { key: "nodes", label: "Enlarged lymph nodes", type: "yesno" },
        ],
      },
    ],
  },
  {
    id: "pelvis",
    name: "Pelvis",
    match: /pelvi|uterus|ovar|gyn/i,
    sections: [
      {
        title: "Uterus",
        gender: "female",
        fields: [
          { key: "ut_position", label: "Position", type: "select", options: ["Anteverted", "Retroverted", "Axial"] },
          { key: "ut_l", label: "Length", type: "number", unit: "cm" },
          { key: "ut_w", label: "Width", type: "number", unit: "cm" },
          { key: "ut_ap", label: "AP diameter", type: "number", unit: "cm" },
          { key: "ut_echo", label: "Myometrium", type: "select", options: ["Homogeneous", "Heterogeneous"] },
          ...findingList("fibroid", "Fibroid", "fibroid", ["Fundal", "Anterior wall", "Posterior wall", "Right lateral wall", "Left lateral wall", "Cervical", "Submucosal"]),
          { key: "endo", label: "Endometrial thickness", type: "number", unit: "mm" },
        ],
      },
      {
        title: "Ovaries and adnexa",
        gender: "female",
        fields: [
          { key: "ro_size", label: "Right ovary size", type: "text", unit: "cm" },
          ...findingList("ro_cyst", "Right ovarian cyst", "cyst", ["Right ovary"]),
          { key: "lo_size", label: "Left ovary size", type: "text", unit: "cm" },
          ...findingList("lo_cyst", "Left ovarian cyst", "cyst", ["Left ovary"]),
          { key: "pod", label: "Free fluid in pouch of Douglas", type: "yesno" },
        ],
      },
      bladder(),
      prostate(),
    ],
  },
];

export const ultrasoundTemplate = (id: string | null | undefined): UsTemplate | null => ULTRASOUND_TEMPLATES.find((t) => t.id === id) ?? null;

/** An ultrasound study (Doppler has its own reporting). */
export function isUltrasoundStudy(o: { modality?: string | null; modality_code?: string | null }): boolean {
  const name = o.modality ?? "";
  if (/doppler|echocardio/i.test(name)) return false;
  return o.modality_code === "US" || /ultra ?-?sound|\busg\b|sonogra/i.test(name);
}

/** The pattern that fits a study, by its name and body part. */
export function templateForStudy(o: { modality?: string | null; body_part?: string | null; modality_code?: string | null }): UsTemplate | null {
  if (!isUltrasoundStudy(o)) return null;
  const name = `${o.modality ?? ""} ${o.body_part ?? ""}`;
  // Pregnancy first: a pregnant patient's study may also name the abdomen or pelvis.
  return ULTRASOUND_TEMPLATES.find((t) => t.id === "obstetric" && t.match.test(name)) ?? ULTRASOUND_TEMPLATES.find((t) => t.match.test(name)) ?? null;
}

// ── What shows, and how it prints ─────────────────────────────────────────

const genderOf = (g: string | null | undefined): "male" | "female" | null => (/^f/i.test(g ?? "") ? "female" : /^m/i.test(g ?? "") ? "male" : null);

const passes = (rule: { key: string; is: string[] } | undefined, v: UsValues) => !rule || rule.is.includes(text(v[rule.key]));
const genderFits = (want: "male" | "female" | undefined, g: string | null) => !want || !genderOf(g) || genderOf(g) === want;

export const sectionShown = (s: UsSection, v: UsValues, gender: string | null) => genderFits(s.gender, gender) && passes(s.showIf, v);
export const fieldShown = (f: UsField, v: UsValues, gender: string | null) => genderFits(f.gender, gender) && passes(f.showIf, v);

/** "High" or "Low" against the reference range, otherwise null. */
export function rangeFlag(value: UsValue | undefined, range: { min?: number; max?: number }): "High" | "Low" | null {
  const n = number(value);
  if (n == null) return null;
  if (range.max != null && n > range.max) return "High";
  if (range.min != null && n < range.min) return "Low";
  return null;
}

export interface UsPrintRow { label: string; value: string; flag: "High" | "Low" | null }
export interface UsPrintTable { label: string; columns: string[]; rows: { value: string; flag: "High" | "Low" | null }[][] }
export interface UsPrintSection { title: string; rows: UsPrintRow[]; tables: UsPrintTable[] }

/** The filled-in values, section by section; blank and hidden fields are left out. */
export function reportSections(t: UsTemplate, v: UsValues, ctx: UsContext): UsPrintSection[] {
  const out: UsPrintSection[] = [];
  for (const s of t.sections) {
    if (!sectionShown(s, v, ctx.gender)) continue;
    const section: UsPrintSection = { title: s.title, rows: [], tables: [] };
    for (const f of s.fields) {
      if (!fieldShown(f, v, ctx.gender)) continue;
      if (f.type === "list") {
        const cols = f.columns ?? [];
        const rows = (Array.isArray(v[f.key]) ? (v[f.key] as UsRow[]) : []).filter((r) => cols.some((c) => text(r[c.key])));
        // Only the columns someone filled in print, so a narrow page keeps its table readable.
        const used = cols.filter((c) => rows.some((r) => text(r[c.key])));
        if (rows.length) {
          section.tables.push({
            label: f.label,
            columns: used.map((c) => (c.unit ? `${c.label} (${c.unit})` : c.label)),
            rows: rows.map((r) => used.map((c) => ({ value: text(r[c.key]) || "-", flag: rangeFlag(r[c.key], c) }))),
          });
        }
        continue;
      }
      const value = f.type === "computed" ? f.compute?.(v, ctx) ?? "" : text(v[f.key]);
      if (!value) continue;
      section.rows.push({ label: f.label, value: f.unit ? `${value} ${f.unit}` : value, flag: f.type === "number" ? rangeFlag(value, f) : null });
    }
    if (section.rows.length || section.tables.length) out.push(section);
  }
  return out;
}

/** The findings as plain text: what screens that show a report as text display. */
export function findingsText(t: UsTemplate, v: UsValues, ctx: UsContext): string {
  const mark = (c: { value: string; flag: "High" | "Low" | null }) => (c.flag ? `${c.value} (${c.flag})` : c.value);
  return reportSections(t, v, ctx).map((s) => [
    s.title.toUpperCase(),
    ...s.rows.map((r) => `${r.label}: ${mark(r)}`),
    ...s.tables.flatMap((x) => x.rows.map((row, i) => `${x.label} ${i + 1}: ${row.map((c, j) => `${x.columns[j]} ${mark(c)}`).join(", ")}`)),
  ].join("\n")).join("\n\n");
}

/** What must be corrected before the report can be released. */
export function validateUltrasound(t: UsTemplate, v: UsValues, ctx: UsContext): string[] {
  const errors: string[] = [];
  for (const s of t.sections) {
    if (!sectionShown(s, v, ctx.gender)) continue;
    for (const f of s.fields) {
      if (!fieldShown(f, v, ctx.gender)) continue;
      const where = `${s.title}, ${f.label}`;
      if (f.type === "number" && text(v[f.key]) && (number(v[f.key]) == null || number(v[f.key])! < 0)) errors.push(`${where}: enter a number.`);
      if (f.type === "date" && text(v[f.key]) && f.key === "lmp" && !(utc(text(v[f.key])) <= utc(ctx.reportDate))) errors.push(`${where}: the date can't be in the future.`);
      if (f.key.endsWith("_count") && !text(v[f.key])) errors.push(`${where}: choose One or Multiple.`);
      if (f.type !== "list") continue;
      const rows = Array.isArray(v[f.key]) ? (v[f.key] as UsRow[]) : [];
      const item = f.itemName ?? "item";
      rows.forEach((r, i) => {
        for (const c of f.columns ?? []) {
          if (c.required && !text(r[c.key])) errors.push(`${s.title}, ${item} ${i + 1}: enter the ${c.label.toLowerCase()}.`);
          if (c.type === "number" && text(r[c.key]) && (number(r[c.key]) == null || number(r[c.key])! <= 0)) errors.push(`${s.title}, ${item} ${i + 1}: ${c.label} must be a number.`);
        }
      });
      if (f.countKey) {
        const count = text(v[f.countKey]);
        if (count === "One" && rows.length !== 1) errors.push(`${s.title}: enter the details of the one ${item}.`);
        if (count === "Multiple" && rows.length < 2) errors.push(`${s.title}: enter the details of each ${item} (at least two).`);
      }
    }
  }
  if (!reportSections(t, v, ctx).length) errors.push("Enter the scan's values.");
  return [...new Set(errors)];
}

/** A saved report, or null when it is missing or its pattern is unknown. */
export function parseStructuredReport(raw: string | null | undefined): StructuredReport | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as StructuredReport;
    return ultrasoundTemplate(r?.template) && r.values && typeof r.values === "object" ? r : null;
  } catch {
    return null;
  }
}
