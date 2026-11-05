/** The public product directory. Each page's workflow, features and known
 * gaps come from the app's own type registry (config/businessTypes.ts), so
 * the site never claims more than the app records; this file adds only the
 * buyer-facing wording. Draft content: approve before publishing. */
import { businessType, type BusinessTypeDef } from "./businessTypes";

export type ProductGroup = "Pharmacy" | "Retail" | "Distribution" | "Healthcare" | "Food & Events" | "Contractor Billing";
export const PRODUCT_GROUPS: ProductGroup[] = ["Pharmacy", "Retail", "Distribution", "Healthcare", "Food & Events", "Contractor Billing"];

export interface SiteProduct {
  slug: string;
  /** config/businessTypes.ts id */
  typeId: string;
  name: string;
  group: ProductGroup;
  /** Pilot: offered as a supervised pilot, not a standard rollout. */
  cta: "demo" | "pilot";
  headline: string;
  intro: string;
  setup: string[];
  faqs: { q: string; a: string }[];
}

const COMMON_SETUP = [
  "A Windows computer for the desktop app, or a current web browser",
  "Internet for the first sign-in on each computer; the desktop app then bills offline and syncs when online",
  "Your product or service list (a CSV import is available)",
];
const FBR_SETUP = "For FBR Digital Invoicing: an active FBR registration and your PRAL integration token";
const FBR_FAQ = {
  q: "Can invoices be sent to FBR Digital Invoicing?",
  a: "Submission to FBR Digital Invoicing is built in for registered businesses and is switched on per business during onboarding, after we check your registration and token. We confirm what applies to your sector before go-live.",
};
const OFFLINE_FAQ = {
  q: "Does it work without internet?",
  a: "The Windows desktop app keeps a local copy and continues billing offline; it syncs when the connection returns. The web version needs a connection.",
};

export const SITE_PRODUCTS: SiteProduct[] = [
  {
    slug: "retail-pharmacy-pos", typeId: "retail_pharmacy", name: "Retail Pharmacy POS", group: "Pharmacy", cta: "demo",
    headline: "Pharmacy billing with batch, expiry and controlled-drug checks.",
    intro: "For licensed pharmacies that sell over the counter. Every unit belongs to a batch with an expiry date, the earliest-expiring batch is picked first, and controlled medicines record the buyer.",
    setup: [...COMMON_SETUP, "Opening stock by batch and expiry", "A thermal (80 mm) or A4 printer", FBR_SETUP],
    faqs: [
      { q: "Can we sell loose tablets from a strip or box?", a: "Yes. Products carry their packing, and a sale can be in packs or loose units with the price worked out from the pack price." },
      { q: "What happens to expired stock?", a: "Expired batches cannot be sold, and expiry reports list what is close to expiry." },
      OFFLINE_FAQ, FBR_FAQ,
    ],
  },
  {
    slug: "medical-store-pos", typeId: "medical_store", name: "Medical Store POS", group: "Pharmacy", cta: "demo",
    headline: "A simpler medicine and healthcare store system.",
    intro: "For smaller licensed outlets selling medicines, surgical items and healthcare products, with the same batch and expiry handling as the pharmacy system and a lighter product form.",
    setup: [...COMMON_SETUP, "Opening stock (batch and expiry where you track them)", FBR_SETUP],
    faqs: [
      { q: "Is it different from the Retail Pharmacy system?", a: "It uses the same billing and stock engine with a simpler product form. Licence-class restrictions and equipment serials are on the roadmap, not available yet." },
      OFFLINE_FAQ, FBR_FAQ,
    ],
  },
  {
    slug: "hospital-pharmacy", typeId: "hospital_pharmacy", name: "Hospital Pharmacy", group: "Healthcare", cta: "pilot",
    headline: "Counter dispensing for a pharmacy inside a hospital.",
    intro: "For hospital pharmacies that dispense to OPD patients at the counter with batch-tracked stock. Ward transfers, patient-linked IPD issue and controlled-drug authorisation are still in development, so we offer it as a supervised pilot.",
    setup: [...COMMON_SETUP, "Opening stock by batch and expiry", "Agreement on the wards and departments to include in the pilot"],
    faqs: [
      { q: "Is this the same as Hospital Management?", a: "No. Hospital Pharmacy covers the pharmacy's own stock and dispensing. Hospital Management covers patient episodes and departmental billing and is a separate product." },
      { q: "Why a pilot?", a: "Ward and IPD workflows are not finished. A pilot lets us confirm your process before a wider rollout." },
    ],
  },
  {
    slug: "general-store-pos", typeId: "general_store", name: "General Store POS", group: "Retail", cta: "demo",
    headline: "Fast barcode billing for grocery and general retail.",
    intro: "For grocery and FMCG stores that bill by barcode and keep stock and purchases in one place.",
    setup: [...COMMON_SETUP, "A barcode scanner", "A thermal (80 mm) printer", FBR_SETUP],
    faqs: [
      { q: "Do you support weighing-scale barcodes and promotions?", a: "Not yet. Both are on the roadmap." },
      OFFLINE_FAQ, FBR_FAQ,
    ],
  },
  {
    slug: "contractor-invoicing", typeId: "contractor", name: "Contractor Invoicing", group: "Contractor Billing", cta: "pilot",
    headline: "Invoices for contractors and suppliers, with or without stock.",
    intro: "For contractors and suppliers who mainly need correct invoices for their clients: quotations, labour and material lines, part payments and outstanding balances. Projects, running bills and retention are still being built, so we start with a pilot.",
    setup: ["A Windows computer or a current web browser", "Your client list and the items or services you invoice", FBR_SETUP],
    faqs: [
      { q: "Do we have to keep stock?", a: "No. Stock is optional. Non-stock service items and project tracking are in development." },
      { q: "Can we clone an invoice?", a: "Yes. A previous invoice can be cloned and edited." },
      FBR_FAQ,
    ],
  },
  {
    slug: "restaurant-pos", typeId: "restaurant", name: "Restaurant POS", group: "Food & Events", cta: "demo",
    headline: "Orders, kitchen tickets and bills for restaurants.",
    intro: "For dine-in, takeaway and delivery restaurants: take the order, send it to the kitchen, run the bill and close the table, with menu items linked to ingredient stock.",
    setup: [...COMMON_SETUP, "A thermal (80 mm) printer for bills and kitchen tickets", "Your provincial tax registration where it applies"],
    faqs: [
      { q: "Which tax authority applies to restaurants?", a: "Restaurant services are usually taxed by the province. We confirm the applicable authority with you during onboarding." },
      { q: "Do you have kitchen display screens?", a: "Not yet. Kitchen tickets print; per-station display screens are on the roadmap." },
      OFFLINE_FAQ,
    ],
  },
  {
    slug: "electronics-solar-pos", typeId: "electronics_solar", name: "Electronics & Solar POS", group: "Retail", cta: "demo",
    headline: "Serial numbers, warranties and quotations for electrical and solar stores.",
    intro: "For electrical, electronics and solar shops that sell serial-numbered goods, quote complete systems and handle warranty claims.",
    setup: [...COMMON_SETUP, "Product specifications and serial numbers of stock on hand", FBR_SETUP],
    faqs: [
      { q: "Can we quote a full solar system?", a: "Yes. Quotations can be turned into invoices, and installation can be added as a line." },
      { q: "Instalments and repair job cards?", a: "Both are on the roadmap, not available yet." },
      OFFLINE_FAQ, FBR_FAQ,
    ],
  },
  {
    slug: "distribution-software", typeId: "distributor", name: "Distribution Software", group: "Distribution", cta: "demo",
    headline: "Field bookings, credit invoicing and recovery for distributors.",
    intro: "For pharma and general distributors: company catalogs, salesmen who book orders at the customer with location checks, approval, credit invoices with withholding tax, and recovery.",
    setup: [...COMMON_SETUP, "Your companies, catalog and customer list", "Phones with a web browser for field salesmen", FBR_SETUP],
    faqs: [
      { q: "Does it track batch and expiry for distributors?", a: "Not yet. Batch and expiry stock, delivery challans and van loads are on the roadmap." },
      FBR_FAQ,
    ],
  },
  {
    slug: "mobile-shop-pos", typeId: "mobile_shop", name: "Mobile Shop POS", group: "Retail", cta: "demo",
    headline: "Every handset bought and sold by IMEI.",
    intro: "For mobile phone and accessory shops: each handset is entered by IMEI on purchase, picked by IMEI on sale with the buyer's CNIC and mobile, and traceable in the IMEI register.",
    setup: [...COMMON_SETUP, "IMEIs of handsets in stock", FBR_SETUP],
    faqs: [
      { q: "Does it check PTA approval?", a: "Not yet. PTA checks and repair job cards are on the roadmap." },
      OFFLINE_FAQ, FBR_FAQ,
    ],
  },
  {
    slug: "cloth-store-pos", typeId: "cloth_store", name: "Cloth Store POS", group: "Retail", cta: "demo",
    headline: "Garments by type, colour and size, with a customer measurements book.",
    intro: "For garment and fabric shops: products carry type, colour and size, and customers' measurements are saved and found again by name or mobile.",
    setup: [...COMMON_SETUP, FBR_SETUP],
    faqs: [
      { q: "Can we track stitching orders?", a: "Not yet. Stitching orders with delivery dates are on the roadmap." },
      OFFLINE_FAQ, FBR_FAQ,
    ],
  },
  {
    slug: "clinic-management", typeId: "clinic", name: "Clinic Management", group: "Healthcare", cta: "pilot",
    headline: "Consultation and procedure billing for clinics.",
    intro: "For independent clinics and small medical centres: walk-ins or appointments, a queue, consultation and procedure billing, receipts and daily cash closing. The clinic service master is still in development, so we start with a pilot.",
    setup: ["A Windows computer or a current web browser", "Your doctors, their fees and the procedures you bill"],
    faqs: [
      { q: "Can a clinic send prescriptions to a linked pharmacy?", a: "A clinic can be linked to a pharmacy on the platform with the pharmacy's consent. We confirm the workflow during the pilot." },
      OFFLINE_FAQ,
    ],
  },
  {
    slug: "diagnostic-lab-software", typeId: "lab", name: "Diagnostic Lab Software", group: "Healthcare", cta: "demo",
    headline: "From reception to verified report for pathology labs.",
    intro: "For pathology laboratories: reception registers the patient, tests and payment; the technologist collects samples and enters results; the pathologist verifies before the report is released and printed.",
    setup: [...COMMON_SETUP, "Your test list with parameters and reference ranges", FBR_SETUP],
    faqs: [
      { q: "Can patients open reports online?", a: "Online reports by QR code and analyser interfacing are on the roadmap. We confirm availability before go-live." },
      FBR_FAQ,
    ],
  },
  {
    slug: "hospital-management", typeId: "hospital", name: "Hospital Management", group: "Healthcare", cta: "pilot",
    headline: "Patient-episode billing for hospitals, delivered as a pilot.",
    intro: "For hospitals that bill OPD, emergency and admissions against each patient's episode, with an attached pharmacy. Episodes, wards and beds, and lab and imaging orders are still being completed, so Hospital Management runs as its own pilot release.",
    setup: ["A Windows computer or a current web browser per department", "Your departments, services and charges", "A named project lead at the hospital"],
    faqs: [
      { q: "Is the hospital pharmacy included?", a: "The hospital pharmacy is a separate product. Both can run together in a pilot." },
      { q: "Why a pilot?", a: "Several hospital workflows are not finished. A pilot lets us agree acceptance criteria with you before a wider rollout." },
    ],
  },
  {
    slug: "marquee-banquet-software", typeId: "banquet_hall", name: "Marquee & Banquet Software", group: "Food & Events", cta: "demo",
    headline: "Hall bookings, menus and payments for marquees.",
    intro: "For marquees and banquet halls: check a date and slot, book the hall, choose a menu package or dishes per head, add extras, and take the advance and final payment.",
    setup: [...COMMON_SETUP, "Your halls, slots, dishes and packages"],
    faqs: [
      { q: "Do you produce kitchen production sheets?", a: "Not yet. It is on the roadmap." },
      OFFLINE_FAQ,
    ],
  },
];

export const siteProduct = (slug: string) => SITE_PRODUCTS.find((p) => p.slug === slug);

/** The app's own record of the type: workflow, features and gaps. */
export function productFacts(p: SiteProduct): Pick<BusinessTypeDef, "workflow" | "mvp" | "planned" | "status" | "purpose"> {
  const t = businessType(p.typeId);
  return { workflow: t.workflow, mvp: t.mvp, planned: t.planned ?? [], status: t.status, purpose: t.purpose };
}
