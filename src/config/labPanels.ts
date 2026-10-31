/** Tests reported as several parameters (a panel), with default units and
 * typical adult reference ranges. The lab can change the unit and range of a
 * parameter on the result form; ranges with "M ...; F ..." follow the patient's
 * sex. Every lab must check the ranges against its own analyser. */
import type { LabComponent } from "../lib/types-hospital";

export interface PanelParam {
  key: string;
  name: string;
  /** Short name for summaries (history, doctor's desk). */
  short: string;
  group: string | null;
  unit: string;
  range: string;
}

const P = (key: string, name: string, short: string, group: string | null, unit: string, range: string): PanelParam => ({ key, name, short, group, unit, range });

const RBC = "Red cells";
const WBC = "White cells";
const DLC = "Differential count (DLC)";
const ABS = "Absolute counts";
const PLT = "Platelets";

export const CBC_PANEL: PanelParam[] = [
  P("hb", "Haemoglobin (Hb)", "Hb", RBC, "g/dL", "M 13.0-17.0; F 12.0-15.0"),
  P("rbc", "RBC count", "RBC", RBC, "×10⁶/µL", "M 4.5-5.5; F 3.8-4.8"),
  P("hct", "Haematocrit (HCT / PCV)", "HCT", RBC, "%", "M 40-50; F 36-46"),
  P("mcv", "MCV", "MCV", RBC, "fL", "80-100"),
  P("mch", "MCH", "MCH", RBC, "pg", "27-32"),
  P("mchc", "MCHC", "MCHC", RBC, "g/dL", "32-36"),
  P("rdw", "RDW-CV", "RDW", RBC, "%", "11.5-14.5"),
  P("tlc", "Total Leucocyte Count (TLC / WBC)", "TLC", WBC, "×10³/µL", "4.0-11.0"),
  P("neut", "Neutrophils", "Neut", DLC, "%", "40-75"),
  P("lymph", "Lymphocytes", "Lymph", DLC, "%", "20-45"),
  P("mono", "Monocytes", "Mono", DLC, "%", "2-10"),
  P("eos", "Eosinophils", "Eos", DLC, "%", "1-6"),
  P("baso", "Basophils", "Baso", DLC, "%", "0-1"),
  P("anc", "Absolute Neutrophil Count", "ANC", ABS, "×10³/µL", "2.0-7.0"),
  P("alc", "Absolute Lymphocyte Count", "ALC", ABS, "×10³/µL", "1.0-3.0"),
  P("plt", "Platelet count", "Plt", PLT, "×10³/µL", "150-400"),
  P("mpv", "MPV", "MPV", PLT, "fL", "7.5-11.5"),
  P("esr", "ESR (Westergren)", "ESR", "ESR", "mm/1st hour", "M 0-15; F 0-20"),
];

export const LFT_PANEL: PanelParam[] = [
  P("tbil", "Bilirubin Total", "T.Bil", "Bilirubin", "mg/dL", "0.2-1.2"),
  P("dbil", "Bilirubin Direct", "D.Bil", "Bilirubin", "mg/dL", "0.0-0.3"),
  P("ibil", "Bilirubin Indirect", "I.Bil", "Bilirubin", "mg/dL", "0.2-0.9"),
  P("alt", "ALT (SGPT)", "ALT", "Enzymes", "U/L", "M 0-41; F 0-33"),
  P("ast", "AST (SGOT)", "AST", "Enzymes", "U/L", "M 0-40; F 0-32"),
  P("alp", "Alkaline Phosphatase (ALP)", "ALP", "Enzymes", "U/L", "40-129"),
  P("ggt", "Gamma GT (GGT)", "GGT", "Enzymes", "U/L", "M 10-71; F 6-42"),
  P("tp", "Total Protein", "TP", "Proteins", "g/dL", "6.4-8.3"),
  P("alb", "Albumin", "Alb", "Proteins", "g/dL", "3.5-5.2"),
  P("glob", "Globulin", "Glob", "Proteins", "g/dL", "2.0-3.5"),
  P("agr", "A/G Ratio", "A/G", "Proteins", "", "1.1-2.2"),
];

export const RFT_PANEL: PanelParam[] = [
  P("urea", "Urea", "Urea", "Renal", "mg/dL", "15-45"),
  P("bun", "Blood Urea Nitrogen (BUN)", "BUN", "Renal", "mg/dL", "7-20"),
  P("creat", "Creatinine", "Creat", "Renal", "mg/dL", "M 0.7-1.3; F 0.6-1.1"),
  P("uric", "Uric Acid", "UA", "Renal", "mg/dL", "M 3.4-7.0; F 2.4-5.7"),
  P("na", "Sodium (Na)", "Na", "Electrolytes", "mmol/L", "135-145"),
  P("k", "Potassium (K)", "K", "Electrolytes", "mmol/L", "3.5-5.1"),
  P("cl", "Chloride (Cl)", "Cl", "Electrolytes", "mmol/L", "98-107"),
];

export const ELECTROLYTES_PANEL: PanelParam[] = [
  P("na", "Sodium (Na)", "Na", "Electrolytes", "mmol/L", "135-145"),
  P("k", "Potassium (K)", "K", "Electrolytes", "mmol/L", "3.5-5.1"),
  P("cl", "Chloride (Cl)", "Cl", "Electrolytes", "mmol/L", "98-107"),
  P("hco3", "Bicarbonate (HCO₃)", "HCO3", "Electrolytes", "mmol/L", "22-29"),
];

export const LIPID_PANEL: PanelParam[] = [
  P("chol", "Cholesterol Total", "Chol", "Lipids", "mg/dL", "< 200"),
  P("tg", "Triglycerides", "TG", "Lipids", "mg/dL", "< 150"),
  P("hdl", "HDL Cholesterol", "HDL", "Lipids", "mg/dL", "> 40"),
  P("ldl", "LDL Cholesterol", "LDL", "Lipids", "mg/dL", "< 130"),
  P("vldl", "VLDL Cholesterol", "VLDL", "Lipids", "mg/dL", "< 30"),
  P("chol_hdl", "Cholesterol / HDL ratio", "Chol/HDL", "Lipids", "", "< 5"),
];

const PHYS = "Physical";
const CHEM = "Chemical";
const MICRO = "Microscopic";
export const URINE_RE_PANEL: PanelParam[] = [
  P("u_colour", "Colour", "Colour", PHYS, "", "Pale yellow"),
  P("u_appear", "Appearance", "Appearance", PHYS, "", "Clear"),
  P("u_sg", "Specific gravity", "SG", PHYS, "", "1.005-1.030"),
  P("u_ph", "pH", "pH", CHEM, "", "4.5-8.0"),
  P("u_protein", "Protein", "Protein", CHEM, "", "Nil"),
  P("u_glucose", "Glucose (sugar)", "Sugar", CHEM, "", "Nil"),
  P("u_ketones", "Ketones", "Ketones", CHEM, "", "Nil"),
  P("u_blood", "Blood", "Blood", CHEM, "", "Nil"),
  P("u_bili", "Bilirubin", "Bil", CHEM, "", "Nil"),
  P("u_nitrite", "Nitrite", "Nitrite", CHEM, "", "Negative"),
  P("u_pus", "Pus cells", "Pus", MICRO, "/HPF", "0-5"),
  P("u_rbc", "Red blood cells", "RBCs", MICRO, "/HPF", "0-2"),
  P("u_epi", "Epithelial cells", "Epi", MICRO, "/HPF", "Few"),
  P("u_casts", "Casts", "Casts", MICRO, "", "Nil"),
  P("u_crystals", "Crystals", "Crystals", MICRO, "", "Nil"),
  P("u_bacteria", "Bacteria", "Bacteria", MICRO, "", "Nil"),
];

const ALL_PANELS = [CBC_PANEL, LFT_PANEL, RFT_PANEL, ELECTROLYTES_PANEL, LIPID_PANEL, URINE_RE_PANEL];

/** The panel of a test, by its name, or null for a single-value test. */
export function panelFor(testName: string | null | undefined): PanelParam[] | null {
  const n = (testName ?? "").toLowerCase();
  if (/\bcbc\b|complete blood (count|picture)|full blood count|\bcbp\b/.test(n)) return CBC_PANEL;
  if (/\blft\b|liver function/.test(n)) return LFT_PANEL;
  if (/\brft\b|renal function|kidney function|\bkft\b/.test(n)) return RFT_PANEL;
  if (/lipid/.test(n)) return LIPID_PANEL;
  if (/electrolyte/.test(n)) return ELECTROLYTES_PANEL;
  if (/urine (routine|r\/?e|complete|analysis)|urinalysis|\bu\/?re\b/.test(n)) return URINE_RE_PANEL;
  return null;
}

/** The part of a range that applies to the patient: "M 13-17; F 12-15" with a
 * female patient gives "12-15". A range without sexes is returned as it is. */
export function rangeForSex(range: string | null | undefined, gender: string | null | undefined): string | null {
  if (!range?.trim()) return null;
  const parts = range.split(";").map((p) => p.trim()).filter(Boolean);
  const bySex = parts.map((p) => /^([MF])\s+(.+)$/i.exec(p)).filter((m): m is RegExpExecArray => Boolean(m));
  if (bySex.length !== parts.length) return range.trim();
  const sex = (gender ?? "").trim().charAt(0).toUpperCase();
  return bySex.find((m) => m[1].toUpperCase() === sex)?.[2] ?? null;
}

/** H / L / N for a numeric value against a range ("4.0-11.0", "<5", ">40",
 * "M 13-17; F 12-15"); null when it cannot be judged (text result, no range,
 * a sex-specific range and the patient's sex is unknown). */
export function flagFor(value: string | null | undefined, range: string | null | undefined, gender?: string | null): "N" | "H" | "L" | null {
  const v = Number(String(value ?? "").trim().replace(/,/g, ""));
  if (!String(value ?? "").trim() || !Number.isFinite(v)) return null;
  const r = rangeForSex(range, gender);
  if (!r) return null;
  const between = /^(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)$/.exec(r);
  if (between) return v < Number(between[1]) ? "L" : v > Number(between[2]) ? "H" : "N";
  const below = /^(?:<|≤|<=|up to)\s*(\d+(?:\.\d+)?)$/i.exec(r);
  if (below) return v > Number(below[1]) ? "H" : "N";
  const above = /^(?:>|≥|>=)\s*(\d+(?:\.\d+)?)$/.exec(r);
  if (above) return v < Number(above[1]) ? "L" : "N";
  return null;
}

/** Parses the stored components of a result; [] for none or bad data. */
export function parseComponents(json: string | null | undefined): LabComponent[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as LabComponent[]) : [];
  } catch {
    return [];
  }
}

/** One line for the whole panel: "Hb 10.1 L, TLC 7.5, Plt 250". */
export function summarizeComponents(components: LabComponent[]): string {
  const short = new Map(ALL_PANELS.flat().map((p) => [p.key, p.short]));
  return components
    .filter((c) => c.value.trim())
    .map((c) => `${short.get(c.key) ?? c.name} ${c.value.trim()}${c.flag === "H" || c.flag === "L" ? ` ${c.flag}` : ""}`)
    .join(", ");
}
