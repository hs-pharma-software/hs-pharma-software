/** Designs of the printed lab report (Settings > Lab Report Templates).
 * Each design is a combination of an accent colour, a typeface and how the
 * header, title, patient details, results table, abnormal flags and page
 * border look. The report's content never changes with the design; only its
 * appearance. Stored as the lab template's `design` (clinicPrintTemplates). */

export type DesignFamily = "Classic" | "Clinical" | "Modern" | "Minimal" | "Bold" | "Elegant" | "Compact" | "Colourful";

export interface LabReportDesign {
  id: string;
  name: string;
  family: DesignFamily;
  /** Accent colour (hex). */
  accent: string;
  font: "sans" | "serif" | "mono";
  /** plain: a rule under the header; rule: a thick accent rule; band: an accent bar on top;
   * boxed: the header in an accent box; sidebar: an accent bar on the left. */
  header: "plain" | "rule" | "band" | "boxed" | "sidebar";
  /** How "Laboratory Report" is shown: centred, left, an accent pill, or a full-width accent bar. */
  title: "center" | "left" | "pill" | "bar";
  /** Patient details: between lines, in a box, on a tinted panel, or in a bordered grid. */
  info: "lines" | "box" | "shaded" | "grid";
  /** Results table: ruled lines, striped rows, full grid, shaded head row, or minimal. */
  table: "lines" | "striped" | "grid" | "shaded-head" | "minimal";
  /** Abnormal results: the word (High / Low), arrows (↑ ↓), letters (H / L) or a coloured badge. */
  flag: "word" | "arrow" | "letter" | "badge";
  /** Border round the page. */
  frame: "none" | "single" | "double";
}

const d = (
  id: string, name: string, family: DesignFamily, accent: string, font: LabReportDesign["font"], header: LabReportDesign["header"],
  title: LabReportDesign["title"], info: LabReportDesign["info"], table: LabReportDesign["table"], flag: LabReportDesign["flag"],
  frame: LabReportDesign["frame"] = "none",
): LabReportDesign => ({ id, name, family, accent, font, header, title, info, table, flag, frame });

export const LAB_REPORT_DESIGNS: LabReportDesign[] = [
  // Classic
  d("classic", "Classic", "Classic", "#1f2937", "sans", "plain", "center", "lines", "lines", "word"),
  d("classic-navy", "Classic Navy", "Classic", "#0b2a6b", "sans", "rule", "center", "lines", "lines", "word"),
  d("classic-serif", "Classic Serif", "Classic", "#374151", "serif", "plain", "center", "lines", "lines", "word"),
  d("pathology-classic", "Pathology Classic", "Classic", "#1e40af", "serif", "boxed", "center", "grid", "grid", "word", "single"),
  // Clinical
  d("hospital-blue", "Hospital Blue", "Clinical", "#1565c0", "sans", "band", "bar", "box", "shaded-head", "arrow"),
  d("clinical-teal", "Clinical Teal", "Clinical", "#0f766e", "sans", "band", "left", "shaded", "striped", "arrow"),
  d("clinical-green", "Clinical Green", "Clinical", "#15803d", "sans", "rule", "pill", "box", "grid", "letter"),
  d("clinical-red", "Clinical Red", "Clinical", "#b91c1c", "sans", "band", "bar", "lines", "shaded-head", "badge"),
  d("diagnostic-pro", "Diagnostic Pro", "Clinical", "#0b2a6b", "sans", "band", "bar", "box", "shaded-head", "badge", "single"),
  // Modern
  d("modern-indigo", "Modern Indigo", "Modern", "#4f46e5", "sans", "sidebar", "left", "shaded", "striped", "badge"),
  d("modern-sky", "Modern Sky", "Modern", "#0284c7", "sans", "boxed", "pill", "box", "minimal", "badge"),
  d("modern-violet", "Modern Violet", "Modern", "#7c3aed", "sans", "rule", "left", "shaded", "striped", "arrow"),
  d("modern-slate", "Modern Slate", "Modern", "#334155", "sans", "sidebar", "left", "box", "minimal", "letter"),
  // Minimal
  d("minimal-mono", "Minimal Mono", "Minimal", "#111827", "mono", "plain", "left", "lines", "minimal", "letter"),
  d("minimal-gray", "Minimal Grey", "Minimal", "#6b7280", "sans", "plain", "left", "lines", "minimal", "word"),
  d("minimal-blue", "Minimal Blue", "Minimal", "#2563eb", "sans", "rule", "left", "lines", "minimal", "arrow"),
  d("minimal-serif", "Minimal Serif", "Minimal", "#44403c", "serif", "plain", "center", "lines", "minimal", "word"),
  d("lab-notebook", "Lab Notebook", "Minimal", "#1f2937", "mono", "rule", "left", "grid", "grid", "arrow"),
  // Bold
  d("bold-black", "Bold Black", "Bold", "#000000", "sans", "boxed", "bar", "grid", "grid", "letter", "single"),
  d("bold-blue", "Bold Blue", "Bold", "#1d4ed8", "sans", "band", "bar", "grid", "shaded-head", "badge", "single"),
  d("bold-maroon", "Bold Maroon", "Bold", "#7f1d1d", "serif", "band", "bar", "box", "shaded-head", "word", "double"),
  d("bold-emerald", "Bold Emerald", "Bold", "#047857", "sans", "boxed", "bar", "shaded", "grid", "badge", "single"),
  // Elegant
  d("elegant-gold", "Elegant Gold", "Elegant", "#a16207", "serif", "rule", "center", "lines", "lines", "word", "double"),
  d("elegant-navy", "Elegant Navy", "Elegant", "#1e3a8a", "serif", "boxed", "center", "box", "lines", "word", "double"),
  d("elegant-plum", "Elegant Plum", "Elegant", "#6b21a8", "serif", "rule", "center", "shaded", "striped", "arrow", "double"),
  d("elegant-forest", "Elegant Forest", "Elegant", "#166534", "serif", "plain", "center", "box", "lines", "word", "single"),
  d("heritage", "Heritage", "Elegant", "#78350f", "serif", "boxed", "center", "lines", "lines", "word", "double"),
  // Compact
  d("compact-dark", "Compact Dark", "Compact", "#0f172a", "sans", "plain", "left", "grid", "grid", "letter"),
  d("compact-teal", "Compact Teal", "Compact", "#0d9488", "sans", "rule", "left", "grid", "striped", "letter"),
  d("compact-receipt", "Compact Receipt", "Compact", "#000000", "mono", "plain", "center", "lines", "minimal", "letter"),
  // Colourful
  d("colour-orange", "Sunrise Orange", "Colourful", "#ea580c", "sans", "band", "pill", "shaded", "striped", "badge"),
  d("colour-pink", "Rose Pink", "Colourful", "#be185d", "sans", "sidebar", "pill", "shaded", "striped", "badge"),
  d("colour-cyan", "Ocean Cyan", "Colourful", "#0891b2", "sans", "band", "pill", "box", "shaded-head", "arrow"),
  d("colour-lime", "Fresh Lime", "Colourful", "#4d7c0f", "sans", "rule", "pill", "shaded", "striped", "badge"),
];

export const DESIGN_FAMILIES: DesignFamily[] = ["Classic", "Clinical", "Modern", "Minimal", "Bold", "Elegant", "Compact", "Colourful"];
export const DEFAULT_LAB_DESIGN = "classic";

/** The design with this id, or the default when unknown (an old or removed design). */
export function labDesign(id: string | null | undefined): LabReportDesign {
  return LAB_REPORT_DESIGNS.find((x) => x.id === id) ?? LAB_REPORT_DESIGNS[0];
}
