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
];

/** The panel of a test, by its name, or null for a single-value test. */
export function panelFor(testName: string | null | undefined): PanelParam[] | null {
  const n = (testName ?? "").toLowerCase();
  if (/\bcbc\b|complete blood (count|picture)|full blood count|\bcbp\b/.test(n)) return CBC_PANEL;
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
  const short = new Map(CBC_PANEL.map((p) => [p.key, p.short]));
  return components
    .filter((c) => c.value.trim())
    .map((c) => `${short.get(c.key) ?? c.name} ${c.value.trim()}${c.flag === "H" || c.flag === "L" ? ` ${c.flag}` : ""}`)
    .join(", ");
}
