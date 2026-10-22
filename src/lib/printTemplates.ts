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

export interface PrintTemplate {
  paper: PaperSize;
  /** Printed top to bottom in this order. */
  blocks: BlockConfig[];
  logoHeight: number;
  thanksText: string;
  columns: { batch: boolean; bonus: boolean; discount: boolean };
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
    blocks: [
      b("logo", "left"), b("business", "left", "lg"), b("title", "right", "lg"), b("meta", "right"),
      b("customer", "left"), b("items", "left"), b("totals", "right"), b("note", "left", "sm"),
      b("fbr", "left"), b("thanks", "center", "sm"),
    ],
    logoHeight: 64,
    thanksText: "Thank you for your business!",
    columns: { batch: true, bonus: true, discount: true },
  },
  a5: {
    paper: "a5",
    blocks: [
      b("logo", "center"), b("business", "center", "md"), b("title", "center", "md"), b("meta", "left", "sm"),
      b("customer", "left", "sm"), b("items", "left", "sm"), b("totals", "right", "sm"), b("note", "left", "sm"),
      b("fbr", "center", "sm"), b("thanks", "center", "sm"),
    ],
    logoHeight: 48,
    thanksText: "Thank you for your visit!",
    columns: { batch: true, bonus: false, discount: true },
  },
  thermal: {
    paper: "thermal",
    blocks: [
      b("logo", "center"), b("business", "center", "md"), b("title", "center", "sm"), b("meta", "center", "sm"),
      b("customer", "left", "sm"), b("items", "left", "sm"), b("totals", "left", "sm"), b("note", "left", "sm"),
      b("fbr", "center", "sm"), b("thanks", "center", "sm"),
    ],
    logoHeight: 40,
    thanksText: "Thank you for your visit!",
    columns: { batch: true, bonus: true, discount: true },
  },
};

const KEY = (p: PaperSize) => `print_template_${p}`;
export const LOGO_KEY = "print_logo";
const LAST_PAPER_KEY = "print_last_paper";

/** Saved template merged over the default, so blocks added in later versions
 * still appear (at the end) in older saved templates. */
export async function loadTemplate(paper: PaperSize): Promise<PrintTemplate> {
  const def = DEFAULT_TEMPLATES[paper];
  const raw = await getSetting(KEY(paper));
  if (!raw) return structuredClone(def);
  try {
    const saved = JSON.parse(raw) as Partial<PrintTemplate>;
    const known = new Set(def.blocks.map((x) => x.id));
    const blocks = (saved.blocks ?? []).filter((x) => known.has(x.id));
    for (const d of def.blocks) if (!blocks.some((x) => x.id === d.id)) blocks.push({ ...d });
    return { ...def, ...saved, paper, blocks, columns: { ...def.columns, ...(saved.columns ?? {}) } };
  } catch {
    return structuredClone(def);
  }
}

export async function saveTemplate(t: PrintTemplate): Promise<void> {
  await setSetting(KEY(t.paper), JSON.stringify(t));
}

export async function loadLogo(): Promise<string | null> {
  return (await getSetting(LOGO_KEY)) || null;
}

export async function saveLogo(dataUrl: string | null): Promise<void> {
  await setSetting(LOGO_KEY, dataUrl ?? "");
}

export function lastPaper(): PaperSize {
  try {
    const v = localStorage.getItem(LAST_PAPER_KEY);
    return v === "a5" || v === "thermal" ? v : "a4";
  } catch {
    return "a4";
  }
}

export function rememberPaper(p: PaperSize) {
  try {
    localStorage.setItem(LAST_PAPER_KEY, p);
  } catch {
    // storage unavailable: just don't remember
  }
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
