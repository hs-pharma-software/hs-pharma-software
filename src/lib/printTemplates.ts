import { getSetting, setSetting } from "./repo/settings";

export type PaperSize = "a4" | "a5" | "thermal";
export type BlockId = "logo" | "business" | "title" | "meta" | "customer" | "items" | "totals" | "note" | "fbr" | "thanks";
export type Align = "left" | "center" | "right";
export type BlockSize = "sm" | "md" | "lg";

export interface BlockConfig {
  id: BlockId;
  visible: boolean;
  align: Align;
  size: BlockSize;
}

/** Graphical design for A4 / A5 (thermal prints black only). How each one
 * looks is defined in components/print/InvoicePrintLayout.tsx (SKINS). */
export type PrintStyle =
  | "banner"
  | "lines"
  | "gradient"
  | "wave"
  | "sidebar"
  | "boxed"
  | "ribbon"
  | "dark"
  | "pastel"
  | "diagonal"
  | "frame"
  | "minimal"
  | "medical"
  | "plain";

export interface PrintTheme {
  style: PrintStyle;
  /** Banner, table header and Grand Total bar. */
  primary: string;
  /** Lines, stripes and highlights. */
  accent: string;
}

/** Each design with the colours it starts with (changeable afterwards). */
export const PRINT_STYLES: { id: PrintStyle; label: string; hint: string; primary: string; accent: string }[] = [
  { id: "banner", label: "Classic Banner", hint: "Header banner, coloured table head, Grand Total bar", primary: "#0f766e", accent: "#f59e0b" },
  { id: "gradient", label: "Gradient", hint: "Two-colour gradient header and totals", primary: "#4f46e5", accent: "#06b6d4" },
  { id: "wave", label: "Wave", hint: "Curved wave header and footer", primary: "#0369a1", accent: "#22d3ee" },
  { id: "medical", label: "Medical Cross", hint: "Banner with a medical cross badge", primary: "#0e7490", accent: "#ef4444" },
  { id: "sidebar", label: "Corporate Sidebar", hint: "Coloured bar down the left edge", primary: "#1f2937", accent: "#f59e0b" },
  { id: "boxed", label: "Boxed Sections", hint: "Every section in its own framed box", primary: "#065f46", accent: "#84cc16" },
  { id: "ribbon", label: "Ribbon", hint: "Full-width title ribbon", primary: "#7f1d1d", accent: "#f97316" },
  { id: "dark", label: "Bold Dark", hint: "Dark header with bright highlights", primary: "#111827", accent: "#facc15" },
  { id: "pastel", label: "Soft Pastel", hint: "Light tinted panels, gentle on ink", primary: "#7c3aed", accent: "#f472b6" },
  { id: "diagonal", label: "Diagonal Stripes", hint: "Striped bands top and bottom", primary: "#b45309", accent: "#1f2937" },
  { id: "frame", label: "Double Frame", hint: "Formal double border around the page", primary: "#1e40af", accent: "#93c5fd" },
  { id: "lines", label: "Elegant Lines", hint: "Coloured rules and headings on white", primary: "#1e3a8a", accent: "#38bdf8" },
  { id: "minimal", label: "Minimal Accent", hint: "Thin accent lines only", primary: "#0f172a", accent: "#10b981" },
  { id: "plain", label: "Plain", hint: "Black and white", primary: "#111111", accent: "#999999" },
];

export const THEME_PRESETS: { name: string; primary: string; accent: string }[] = [
  { name: "Teal", primary: "#0f766e", accent: "#f59e0b" },
  { name: "Royal Blue", primary: "#1e3a8a", accent: "#38bdf8" },
  { name: "Emerald", primary: "#065f46", accent: "#84cc16" },
  { name: "Maroon", primary: "#7f1d1d", accent: "#f97316" },
  { name: "Purple", primary: "#5b21b6", accent: "#f472b6" },
  { name: "Charcoal", primary: "#1f2937", accent: "#ef4444" },
];

export const DEFAULT_THEME: PrintTheme = { style: "banner", primary: THEME_PRESETS[0].primary, accent: THEME_PRESETS[0].accent };

export interface PrintTemplate {
  paper: PaperSize;
  theme: PrintTheme;
  /** Printed top to bottom in this order. */
  blocks: BlockConfig[];
  logoHeight: number;
  thanksText: string;
  /** hsCode / tax only print on A4 and A5; thermal shows tax in the totals. */
  columns: { batch: boolean; bonus: boolean; discount: boolean; hsCode: boolean; tax: boolean };
}

export const PAPERS: { id: PaperSize; label: string; css: string; widthMm: number; marginMm: number }[] = [
  { id: "a4", label: "A4 Size", css: "A4", widthMm: 210, marginMm: 12 },
  { id: "a5", label: "A5 Size", css: "A5", widthMm: 148, marginMm: 8 },
  { id: "thermal", label: "Thermal (80 mm)", css: "80mm auto", widthMm: 80, marginMm: 3 },
];

export const BLOCK_LABELS: Record<BlockId, string> = {
  logo: "Pharmacy logo",
  business: "Pharmacy name & address",
  title: "Invoice title & number",
  meta: "Date, payment & salesman",
  customer: "Customer details",
  items: "Items",
  totals: "Totals",
  note: "Invoice note",
  fbr: "FBR invoice no & QR",
  thanks: "Thank-you message",
};

/** Printed under every template; not editable. */
export const DEVELOPER_CREDIT = "UhuD Developers, +92 3006049200";

const b = (id: BlockId, align: Align, size: BlockSize = "md", visible = true): BlockConfig => ({ id, visible, align, size });

export const DEFAULT_TEMPLATES: Record<PaperSize, PrintTemplate> = {
  a4: {
    paper: "a4",
    theme: { ...DEFAULT_THEME },
    blocks: [
      b("logo", "left"), b("business", "left", "lg"), b("title", "right", "lg"), b("meta", "right"),
      b("customer", "left"), b("items", "left"), b("totals", "right"), b("note", "left", "sm"),
      b("fbr", "left"), b("thanks", "center", "sm"),
    ],
    logoHeight: 64,
    thanksText: "Thank you for your business!",
    columns: { batch: true, bonus: true, discount: true, hsCode: true, tax: true },
  },
  a5: {
    paper: "a5",
    theme: { ...DEFAULT_THEME },
    blocks: [
      b("logo", "center"), b("business", "center", "md"), b("title", "center", "md"), b("meta", "left", "sm"),
      b("customer", "left", "sm"), b("items", "left", "sm"), b("totals", "right", "sm"), b("note", "left", "sm"),
      b("fbr", "center", "sm"), b("thanks", "center", "sm"),
    ],
    logoHeight: 48,
    thanksText: "Thank you for your visit!",
    columns: { batch: true, bonus: false, discount: true, hsCode: true, tax: true },
  },
  thermal: {
    paper: "thermal",
    theme: { ...DEFAULT_THEME, style: "plain" },
    blocks: [
      b("logo", "center"), b("business", "center", "md"), b("title", "center", "sm"), b("meta", "center", "sm"),
      b("customer", "left", "sm"), b("items", "left", "sm"), b("totals", "left", "sm"), b("note", "left", "sm"),
      b("fbr", "center", "sm"), b("thanks", "center", "sm"),
    ],
    logoHeight: 40,
    thanksText: "Thank you for your visit!",
    columns: { batch: true, bonus: true, discount: true, hsCode: false, tax: false },
  },
};

const KEY = (p: PaperSize) => `print_template_${p}`;
export const LOGO_KEY = "print_logo";
const DEFAULT_PAPER_KEY = "print_default_paper";

/** Saved template merged over the default, so blocks added in later versions
 * still appear (at the end) in older saved templates. */
export async function loadTemplate(paper: PaperSize, tenantId?: string): Promise<PrintTemplate> {
  const def = DEFAULT_TEMPLATES[paper];
  const raw = await getSetting(KEY(paper), tenantId);
  if (!raw) return structuredClone(def);
  try {
    const saved = JSON.parse(raw) as Partial<PrintTemplate>;
    const known = new Set(def.blocks.map((x) => x.id));
    const blocks = (saved.blocks ?? []).filter((x) => known.has(x.id));
    for (const d of def.blocks) if (!blocks.some((x) => x.id === d.id)) blocks.push({ ...d });
    return {
      ...def,
      ...saved,
      paper,
      blocks,
      columns: { ...def.columns, ...(saved.columns ?? {}) },
      theme: { ...def.theme, ...(saved.theme ?? {}) },
    };
  } catch {
    return structuredClone(def);
  }
}

export async function saveTemplate(t: PrintTemplate, tenantId?: string): Promise<void> {
  await setSetting(KEY(t.paper), JSON.stringify(t), tenantId);
}

export async function loadLogo(tenantId?: string): Promise<string | null> {
  return (await getSetting(LOGO_KEY, tenantId)) || null;
}

export async function saveLogo(dataUrl: string | null, tenantId?: string): Promise<void> {
  await setSetting(LOGO_KEY, dataUrl ?? "", tenantId);
}

/** Paper used when an invoice is printed (Settings > Print Templates).
 * All loaders/savers here take an optional tenantId for the Super Admin. */
export async function loadDefaultPaper(tenantId?: string): Promise<PaperSize> {
  const v = await getSetting(DEFAULT_PAPER_KEY, tenantId);
  return v === "a5" || v === "thermal" ? v : "a4";
}

export async function saveDefaultPaper(p: PaperSize, tenantId?: string): Promise<void> {
  await setSetting(DEFAULT_PAPER_KEY, p, tenantId);
}

/** Shrinks an uploaded logo so it stays small in settings/sync (max 600x300). */
export function resizeLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not an image."));
      img.onload = () => {
        const scale = Math.min(1, 600 / img.width, 300 / img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(file.type === "image/jpeg" ? canvas.toDataURL("image/jpeg", 0.85) : canvas.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
