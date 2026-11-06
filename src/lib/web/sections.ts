/** Website builder: the section schema shared by the editor, the server and
 * the public pages. Pages are lists of typed sections with plain-text fields;
 * no HTML or script is ever stored or rendered. `cleanSections` and
 * `cleanSettings` validate untrusted input (the server always calls them). */

export interface Img { url: string; alt: string }
export interface Btn { label: string; href: string }

export type SectionType =
  | "hero" | "about" | "services" | "categories" | "featured" | "gallery" | "testimonials"
  | "faq" | "contact" | "cta" | "doctors" | "departments" | "hours" | "reportLookup";

export type FormKind = "none" | "contact" | "appointment" | "quotation";

export interface Section {
  id: string;
  type: SectionType;
  hidden?: boolean;
  variant?: "centered" | "split";
  heading: string;
  text?: string;
  image?: Img | null;
  mobileImage?: Img | null;
  buttons?: Btn[];
  items?: { title: string; text: string }[];
  images?: Img[];
  limit?: number;
  form?: FormKind;
}

export const SECTION_LABELS: Record<SectionType, { label: string; hint: string }> = {
  hero: { label: "Hero banner", hint: "Big heading, short text, buttons and an image." },
  about: { label: "About", hint: "Who you are, with an optional image." },
  services: { label: "Services", hint: "A list of what you offer." },
  categories: { label: "Product categories", hint: "Your online categories, linked to the store." },
  featured: { label: "Featured products", hint: "Products you marked Featured." },
  gallery: { label: "Gallery", hint: "Photos of your shop, team or work." },
  testimonials: { label: "Testimonials", hint: "What customers said (enter only real quotes)." },
  faq: { label: "FAQs", hint: "Questions and answers." },
  contact: { label: "Contact", hint: "Phone, address, hours and an optional request form." },
  cta: { label: "Call to action", hint: "A short message with one button." },
  doctors: { label: "Doctors", hint: "Doctors from your Clinic records (name, specialty, days)." },
  departments: { label: "Departments", hint: "Active departments from your Hospital records." },
  hours: { label: "Business hours", hint: "Your opening hours from Website Settings." },
  reportLookup: { label: "Get your report (labs)", hint: "Patients enter their receipt or order number and mobile number to open their verified report." },
};

/** Sections that list items (with item fields title/text). */
const ITEM_SECTIONS: SectionType[] = ["services", "testimonials", "faq"];

export interface SiteSettings {
  name: string;
  tagline: string;
  logo: Img | null;
  favicon: Img | null;
  colors: { primary: string; accent: string };
  font: FontId;
  contact: { phone: string; email: string; address: string; whatsapp: string; mapUrl: string };
  hours: { day: string; open: string; close: string; closed: boolean }[];
  social: { facebook: string; instagram: string; youtube: string; tiktok: string; x: string; linkedin: string };
  footerText: string;
  seo: { title: string; description: string; image: Img | null };
}

export const FONTS = {
  system: { label: "System (fastest)", css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", google: null },
  inter: { label: "Inter", css: "'Inter', system-ui, sans-serif", google: "Inter:wght@400;600;700" },
  poppins: { label: "Poppins", css: "'Poppins', system-ui, sans-serif", google: "Poppins:wght@400;600;700" },
  lato: { label: "Lato", css: "'Lato', system-ui, sans-serif", google: "Lato:wght@400;700" },
  merriweather: { label: "Merriweather (serif)", css: "'Merriweather', Georgia, serif", google: "Merriweather:wght@400;700" },
  noto: { label: "Noto Sans", css: "'Noto Sans', system-ui, sans-serif", google: "Noto+Sans:wght@400;600;700" },
} as const;
export type FontId = keyof typeof FONTS;

export interface StoreSettings {
  pickup: boolean;
  delivery: boolean;
  zones: { name: string; charge: number }[];
  minOrder: number;
  payment: { cod: boolean; pickup: boolean; bank: boolean };
  bankDetails: string;
  /** Hours a pending order holds its stock before it is released. */
  reserveHours: number;
  notice: string;
  rxNotice: string;
}

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const defaultStoreSettings = (): StoreSettings => ({
  pickup: true, delivery: false, zones: [], minOrder: 0, payment: { cod: false, pickup: true, bank: false }, bankDetails: "",
  reserveHours: 24, notice: "", rxNotice: "Upload a clear photo of a valid prescription. The pharmacist checks it before the order is confirmed.",
});

export class ValidationError extends Error {}
const fail = (m: string): never => { throw new ValidationError(m); };

const str = (v: unknown, max: number, field: string, required = false): string => {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") fail(`${field} must be text.`);
  const s = (v as string).replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (s.length > max) fail(`${field} is too long (at most ${max} characters).`);
  if (required && !s) fail(`${field} is required.`);
  return s;
};
const bool = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
const num = (v: unknown, min: number, max: number, field: string): number => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < min || n > max) fail(`${field} must be a number from ${min} to ${max}.`);
  return Math.round(n * 100) / 100;
};

/** Links: a page of this site (/...), a section (#...), phone, email, WhatsApp or another https page. */
export function safeHref(v: unknown, field = "Link"): string {
  const s = str(v, 300, field);
  if (!s) return "";
  if (/^\/(?![/\\])[\w\-./?=&%#]*$/.test(s) || /^#[\w-]+$/.test(s)) return s;
  if (/^tel:\+?[\d\s-]{5,20}$/.test(s) || /^mailto:[^\s@]+@[^\s@]+$/.test(s)) return s;
  if (/^https:\/\/[^\s<>"']+$/i.test(s)) return s;
  return fail(`${field}: use a page like /shop, a phone (tel:), an email (mailto:) or an https:// address.`);
}

/** Images: https only (uploads live on Cloudinary). */
export function cleanImg(v: unknown, field = "Image"): Img | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const url = str(o.url, 500, `${field} address`);
  if (!url) return null;
  if (!/^https:\/\/[^\s<>"']+$/i.test(url)) fail(`${field} must be an uploaded image (https).`);
  return { url, alt: str(o.alt, 160, `${field} description`) };
}

const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback);

export const MAX_SECTIONS = 30;

export function cleanSections(input: unknown): Section[] {
  if (!Array.isArray(input)) fail("Sections must be a list.");
  const list = input as unknown[];
  if (list.length > MAX_SECTIONS) fail(`A page can have at most ${MAX_SECTIONS} sections.`);
  const ids = new Set<string>();
  return list.map((raw, i) => {
    if (!raw || typeof raw !== "object") fail(`Section ${i + 1} is not valid.`);
    const r = raw as Record<string, unknown>;
    const type = r.type as SectionType;
    if (!SECTION_LABELS[type]) fail(`Section ${i + 1}: unknown type.`);
    let id = typeof r.id === "string" && /^[\w-]{4,40}$/.test(r.id) ? r.id : `s${i}-${Math.random().toString(36).slice(2, 8)}`;
    if (ids.has(id)) id = `${id}-${i}`;
    ids.add(id);
    const label = SECTION_LABELS[type].label;
    const s: Section = { id, type, heading: str(r.heading, 140, `${label} heading`) };
    if (bool(r.hidden)) s.hidden = true;
    if (type === "hero") s.variant = r.variant === "split" ? "split" : "centered";
    const text = str(r.text, 3000, `${label} text`);
    if (text) s.text = text;
    if (type === "reportLookup" && !s.heading) s.heading = "Get your report";
    if (["hero", "about"].includes(type)) {
      s.image = cleanImg(r.image, `${label} image`);
      if (type === "hero") s.mobileImage = cleanImg(r.mobileImage, `${label} mobile image`);
    }
    if (["hero", "cta"].includes(type)) {
      const btns = Array.isArray(r.buttons) ? r.buttons.slice(0, type === "hero" ? 2 : 1) : [];
      s.buttons = btns.map((b, j) => {
        const o = (b ?? {}) as Record<string, unknown>;
        return { label: str(o.label, 40, `${label} button ${j + 1} label`, true), href: safeHref(o.href, `${label} button ${j + 1} link`) || "/" };
      });
    }
    if (ITEM_SECTIONS.includes(type)) {
      const items = Array.isArray(r.items) ? r.items : [];
      if (items.length > 24) fail(`${label}: at most 24 items.`);
      s.items = items.map((it, j) => {
        const o = (it ?? {}) as Record<string, unknown>;
        return { title: str(o.title, 160, `${label} item ${j + 1} title`), text: str(o.text, 1200, `${label} item ${j + 1} text`) };
      }).filter((it) => it.title || it.text);
    }
    if (type === "gallery") {
      const imgs = Array.isArray(r.images) ? r.images : [];
      if (imgs.length > 24) fail("Gallery: at most 24 images.");
      s.images = imgs.map((im, j) => cleanImg(im, `Gallery image ${j + 1}`)).filter((x): x is Img => x !== null);
    }
    if (type === "featured") s.limit = Math.round(num(r.limit ?? 8, 1, 24, "Number of products"));
    if (type === "contact") s.form = (["none", "contact", "appointment", "quotation"] as FormKind[]).includes(r.form as FormKind) ? (r.form as FormKind) : "contact";
    return s;
  });
}

export function cleanSettings(input: unknown, fallbackName: string): SiteSettings {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const c = (r.contact ?? {}) as Record<string, unknown>;
  const so = (r.social ?? {}) as Record<string, unknown>;
  const colors = (r.colors ?? {}) as Record<string, unknown>;
  const seo = (r.seo ?? {}) as Record<string, unknown>;
  const social = (k: string, label: string) => {
    const v = str(so[k], 300, label);
    if (v && !/^https:\/\/[^\s<>"']+$/i.test(v)) fail(`${label}: enter the full https:// address of your page.`);
    return v;
  };
  const wa = str(c.whatsapp, 20, "WhatsApp number").replace(/[\s-]/g, "");
  if (wa && !/^\+?\d{10,15}$/.test(wa)) fail("WhatsApp number: digits only, e.g. 923001234567.");
  const email = str(c.email, 120, "Email");
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) fail("Email is not valid.");
  const hours = Array.isArray(r.hours) ? r.hours.slice(0, 7) : [];
  const time = (v: unknown, f: string) => { const t = str(v, 5, f); if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) fail(`${f}: use 24-hour time like 09:00.`); return t; };
  return {
    name: str(r.name, 120, "Business name") || fallbackName,
    tagline: str(r.tagline, 160, "Tagline"),
    logo: cleanImg(r.logo, "Logo"),
    favicon: cleanImg(r.favicon, "Favicon"),
    colors: { primary: hex(colors.primary, "#0b2a6b"), accent: hex(colors.accent, "#1e88e5") },
    font: (Object.keys(FONTS) as FontId[]).includes(r.font as FontId) ? (r.font as FontId) : "system",
    contact: {
      phone: str(c.phone, 40, "Phone"), email, address: str(c.address, 300, "Address"), whatsapp: wa,
      mapUrl: (() => { const m = str(c.mapUrl, 500, "Map link"); if (m && !/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)\S*$/i.test(m)) fail("Map link: paste a Google Maps share link."); return m; })(),
    },
    hours: hours.map((h, i) => {
      const o = (h ?? {}) as Record<string, unknown>;
      return { day: DAYS.includes(String(o.day)) ? String(o.day) : DAYS[i], open: time(o.open, `${DAYS[i]} opening time`), close: time(o.close, `${DAYS[i]} closing time`), closed: bool(o.closed) };
    }),
    social: { facebook: social("facebook", "Facebook"), instagram: social("instagram", "Instagram"), youtube: social("youtube", "YouTube"), tiktok: social("tiktok", "TikTok"), x: social("x", "X"), linkedin: social("linkedin", "LinkedIn") },
    footerText: str(r.footerText, 300, "Footer text"),
    seo: { title: str(seo.title, 70, "Search title"), description: str(seo.description, 170, "Search description"), image: cleanImg(seo.image, "Sharing image") },
  };
}

export function cleanStoreSettings(input: unknown): StoreSettings {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const p = (r.payment ?? {}) as Record<string, unknown>;
  const zones = Array.isArray(r.zones) ? r.zones.slice(0, 30) : [];
  const out: StoreSettings = {
    pickup: bool(r.pickup), delivery: bool(r.delivery),
    zones: zones.map((z, i) => { const o = (z ?? {}) as Record<string, unknown>; return { name: str(o.name, 60, `Zone ${i + 1} name`, true), charge: num(o.charge, 0, 100000, `Zone ${i + 1} charge`) }; }),
    minOrder: num(r.minOrder, 0, 10_000_000, "Minimum order"),
    payment: { cod: bool(p.cod), pickup: bool(p.pickup), bank: bool(p.bank) },
    bankDetails: str(r.bankDetails, 600, "Bank details"),
    reserveHours: Math.round(num(r.reserveHours ?? 24, 1, 168, "Hold stock for (hours)")),
    notice: str(r.notice, 400, "Store notice"),
    rxNotice: str(r.rxNotice, 400, "Prescription notice"),
  };
  if (!out.pickup && !out.delivery) fail("Turn on pickup, delivery or both.");
  if (out.delivery && !out.zones.length) fail("Add at least one delivery zone with its charge.");
  if (!out.payment.cod && !out.payment.pickup && !out.payment.bank) fail("Turn on at least one way to pay.");
  if (out.payment.bank && !out.bankDetails) fail("Enter the bank details customers should pay to.");
  return out;
}

/** A page address part: lower-case letters, digits and dashes. */
export const pageSlug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
/** Page addresses that the store and system use. */
export const RESERVED_PAGE_SLUGS = new Set(["shop", "order", "admin", "api", "cart", "checkout", "preview", "sitemap.xml", "robots.txt", "_next", "web"]);
