/** PRA tax rules (Super Admin → PRA Tax Suggestions): the catalogue's shape,
 * the starting entries (drafts), the rule in force on a day, and the payment
 * checks a fiscal submission needs. Pure functions, no imports: the server,
 * the pages and the tests use the same code.
 *
 * Nothing here decides a tax treatment on its own: a rule only applies once
 * the Super Admin has verified it against the law, approved it and assigned
 * it to a business (and branch). Anything unresolved blocks the submission. */

export type RateType = "percent" | "fixed";
/** any: one rate. digital_split: `rate` when paid by debit / credit card, mobile wallet or QR; `alt_rate` otherwise. */
export type PaymentCondition = "any" | "digital_split";
export type RuleStatus = "draft" | "approved" | "retired";
export type EimsApplicable = "yes" | "no" | "unconfirmed";

export interface PraRule {
  id: string;
  rule_key: string;
  version: number;
  sector: string;
  service: string;
  classification_code: string | null;
  rate_type: RateType;
  rate: number | null;
  fixed_amount: number | null;
  fixed_unit: string | null;
  payment_condition: PaymentCondition;
  alt_rate: number | null;
  input_adjustment: string;
  exemptions: string | null;
  effective_from: string;
  effective_to: string | null;
  source: string;
  clause: string | null;
  source_url: string | null;
  last_verified_at: string | null;
  status: RuleStatus;
  review_notes: string | null;
  needs_scope_review: number;
  eims_applicable: EimsApplicable;
}

export const PRA_SECTORS = [
  { id: "restaurant", label: "Restaurant, café, coffee shop, food outlet" },
  { id: "hotel", label: "Hotel, motel, guest house" },
  { id: "marriage_hall", label: "Marriage hall / lawn, marquee, banquet" },
  { id: "catering", label: "Catering and ancillary services" },
  { id: "goods_transport", label: "Carriage of goods by road or rail" },
  { id: "freight_forwarding", label: "Freight forwarding" },
  { id: "courier", label: "Courier" },
  { id: "contractor", label: "Service contractor / construction" },
  { id: "general", label: "Other taxable services (general rate)" },
] as const;
export type PraSector = (typeof PRA_SECTORS)[number]["id"];

/** Where the starting entries were read: a consolidated copy of the Second
 * Schedule (2026-27) whose footnotes cite the Punjab Finance Act 2026. It is
 * not the official Gazette: every entry stays a draft until checked there. */
const SCHEDULE_COPY = "https://conseric.pk/wp-content/uploads/2026/07/pra-second-schedule-2026-27.pdf";
const FA2026 = "Punjab Finance Act 2026 (L of 2026), Punjab Gazette (Extraordinary) 1 July 2026, s.5k";

export type RuleSeed = Omit<PraRule, "id" | "version" | "status" | "last_verified_at">;

/** Starting entries (drafts). Each must be verified against the Gazette and PRA notifications before approval. */
export const SEED_RULES: RuleSeed[] = [
  {
    rule_key: "restaurant-9801.2000", sector: "restaurant", service: "Restaurants including cafés, food (and ice-cream) parlours, coffee houses / shops, deras, food huts, eateries, resorts and similar outlets",
    classification_code: "9801.2000", rate_type: "percent", rate: 8, fixed_amount: null, fixed_unit: null, payment_condition: "digital_split", alt_rate: 16,
    input_adjustment: "8 %: without input tax adjustment. 16 %: as under the Act.", exemptions: null, effective_from: "2026-07-01", effective_to: null,
    source: `Punjab Sales Tax on Services Act 2012, Second Schedule, Part III Sr. 4, as amended by ${FA2026}(ii) ("Five" → "Eight").`,
    clause: "Part III Sr. 4: (a) 8 % without input tax adjustment where payment is received through debit or credit cards, mobile wallets or QR scanning; (b) 16 % for others. Heading 9801.9000 also listed.",
    source_url: SCHEDULE_COPY, review_notes: "Confirm against the official Gazette. 9801.9000 (bracketed in the copy) needs its own entry if used.", needs_scope_review: 0, eims_applicable: "yes",
  },
  {
    rule_key: "hotel-9801.1000", sector: "hotel", service: "Hotels, motels and guest houses",
    classification_code: "9801.1000", rate_type: "percent", rate: 8, fixed_amount: null, fixed_unit: null, payment_condition: "digital_split", alt_rate: 16,
    input_adjustment: "8 %: without input tax adjustment.", exemptions: null, effective_from: "2026-07-01", effective_to: null,
    source: `Second Schedule, Part III Sr. 1, as substituted by ${FA2026}(i).`, clause: "(a) 8 % without input tax adjustment where payment is received through debit or credit cards, mobile wallets or QR scanning; (b) 16 % for others.",
    source_url: SCHEDULE_COPY, review_notes: "Confirm against the official Gazette.", needs_scope_review: 0, eims_applicable: "yes",
  },
  {
    rule_key: "marriage-hall-9801.3000", sector: "marriage_hall", service: "Marriage halls and lawns (by whatever name called) including pandal and shamiana; qualifying marquee and banquet services",
    classification_code: "9801.3000", rate_type: "percent", rate: 8, fixed_amount: null, fixed_unit: null, payment_condition: "any", alt_rate: null,
    input_adjustment: "Without input tax adjustment.", exemptions: null, effective_from: "2026-07-01", effective_to: null,
    source: `Second Schedule, Part III Sr. 2, as amended by ${FA2026}(ii) ("Five" → "Eight").`, clause: "Part III Sr. 2: Eight percent without input tax adjustment.",
    source_url: SCHEDULE_COPY, review_notes: "Ask PRA whether marriage halls report through eIMS POS integration, and when a booking is fiscalised (advance, event day or final bill).", needs_scope_review: 0, eims_applicable: "unconfirmed",
  },
  {
    rule_key: "catering-9801.5000", sector: "catering", service: "Catering services, including ancillary / allied services (floral or other decoration, furnishing of space, rental of equipment and accessories)",
    classification_code: "9801.5000", rate_type: "percent", rate: 8, fixed_amount: null, fixed_unit: null, payment_condition: "any", alt_rate: null,
    input_adjustment: "Without input tax adjustment.", exemptions: null, effective_from: "2026-07-01", effective_to: null,
    source: `Second Schedule, Part III Sr. 2, as amended by ${FA2026}(ii).`, clause: "Part III Sr. 2: Eight percent without input tax adjustment.",
    source_url: SCHEDULE_COPY, review_notes: "Ask PRA whether catering reports through eIMS.", needs_scope_review: 0, eims_applicable: "unconfirmed",
  },
  {
    rule_key: "goods-carriage-98.04", sector: "goods_transport", service: "Carriage of goods by road or rail",
    classification_code: "9804.2000", rate_type: "percent", rate: 15, fixed_amount: null, fixed_unit: null, payment_condition: "any", alt_rate: null,
    input_adjustment: "With input tax adjustment for the service provider and the service recipient.", exemptions: null, effective_from: "2026-07-01", effective_to: null,
    source: "Second Schedule, Part I Sr. 2.", clause: "Part I Sr. 2: 98.04, 9804.2000, 9804.9000 and respective headings: 15 % with input tax adjustment for service provider and service recipient.",
    source_url: SCHEDULE_COPY, review_notes: "Effective date to confirm (the copy does not mark this entry as amended in 2026). 9804.9000 needs its own entry if used. Freight forwarding and courier are separate.", needs_scope_review: 0, eims_applicable: "unconfirmed",
  },
  {
    rule_key: "freight-forwarding-9805.3000", sector: "freight_forwarding", service: "Freight forwarding agents",
    classification_code: "9805.3000", rate_type: "fixed", rate: null, fixed_amount: 1000, fixed_unit: "per bill of lading", payment_condition: "any", alt_rate: null,
    input_adjustment: "Fixed tax (Part II).", exemptions: null, effective_from: "2026-07-01", effective_to: null,
    source: "Second Schedule, Part II Sr. 2 (fixed-taxed services).", clause: "Part II Sr. 2: Freight forwarding agents, 9805.3000: Rs. 1000 per bill of lading.",
    source_url: SCHEDULE_COPY, review_notes: "Fixed amount per bill of lading: the invoice must carry the number of bills of lading. Effective date to confirm. eIMS item mapping (TaxRate for a fixed amount) to confirm with PRA.", needs_scope_review: 0, eims_applicable: "unconfirmed",
  },
  {
    rule_key: "courier-general", sector: "courier", service: "Courier services",
    classification_code: null, rate_type: "percent", rate: 16, fixed_amount: null, fixed_unit: null, payment_condition: "any", alt_rate: null,
    input_adjustment: "As under the Act.", exemptions: null, effective_from: "2026-07-01", effective_to: null,
    source: "Second Schedule, Part I Sr. 1 (all services not specified elsewhere: sixteen percent).", clause: "Part I Sr. 1: all services except those in Sr. 2 and 3, Part II and Part III: respective headings, sixteen percent.",
    source_url: SCHEDULE_COPY, review_notes: "No specific courier entry was found in the copy: confirm the classification code (heading 98.05) and the rate with PRA. Cannot be approved without a classification code.", needs_scope_review: 0, eims_applicable: "unconfirmed",
  },
  {
    rule_key: "contractor-general-16", sector: "contractor", service: "Construction services and contractors (building, water / gas / sanitary, roads and bridges, electrical and mechanical, horticultural, multi-discipline): others",
    classification_code: "9824.0000", rate_type: "percent", rate: 16, fixed_amount: null, fixed_unit: null, payment_condition: "any", alt_rate: null,
    input_adjustment: "With input tax credit or adjustment.", exemptions: null, effective_from: "2026-07-01", effective_to: null,
    source: "Second Schedule, Part III Sr. 6.", clause: "Part III Sr. 6 (9824.0000 and 9814.2000): sixteen percent with input tax credit or adjustment for others.",
    source_url: SCHEDULE_COPY, review_notes: "Ask for the scope of work: contractual services, construction, government projects, mixed goods and services, or goods only. Review the contract before assigning.", needs_scope_review: 1, eims_applicable: "unconfirmed",
  },
  {
    rule_key: "contractor-govt-civil-5", sector: "contractor", service: "Construction / contractor services: Government civil works",
    classification_code: "9824.0000", rate_type: "percent", rate: 5, fixed_amount: null, fixed_unit: null, payment_condition: "any", alt_rate: null,
    input_adjustment: "Without input tax credit or adjustment.", exemptions: "Further reduced 1 % / 0 % for specified ADP / foreign-loan / PSDP / cantonment projects (Explanation to Sr. 6).", effective_from: "2026-07-01", effective_to: null,
    source: "Second Schedule, Part III Sr. 6 and its Explanation.", clause: "Five percent without input tax credit or adjustment in respect of Government civil works; Explanation (a) one percent and (b) zero percent for specified projects.",
    source_url: SCHEDULE_COPY, review_notes: "Only for Government civil works shown by the contract. The 1 % and 0 % cases depend on the project's start year and funding: add separate entries after review.", needs_scope_review: 1, eims_applicable: "unconfirmed",
  },
  {
    rule_key: "services-general-16", sector: "general", service: "Other taxable services (general rate)",
    classification_code: null, rate_type: "percent", rate: 16, fixed_amount: null, fixed_unit: null, payment_condition: "any", alt_rate: null,
    input_adjustment: "As under the Act.", exemptions: null, effective_from: "2026-07-01", effective_to: null,
    source: "Second Schedule, Part I Sr. 1.", clause: "All services except those in Part I Sr. 2 and 3, Part II and Part III: respective headings, sixteen percent.",
    source_url: SCHEDULE_COPY, review_notes: "A classification code must be chosen for the actual service before approval.", needs_scope_review: 1, eims_applicable: "unconfirmed",
  },
];

/** "9801.2000" → "98012000" (eIMS PCTCode: 8 digits). Null when it is not a full 8-digit code. */
export function pctCodeOf(classification: string | null | undefined): string | null {
  const d = String(classification ?? "").replace(/\D/g, "");
  return d.length === 8 ? d : null;
}

/** The approved version of a rule in force on a day (yyyy-mm-dd), or null. */
export function ruleOn<T extends Pick<PraRule, "rule_key" | "status" | "effective_from" | "effective_to" | "version">>(rules: T[], ruleKey: string, day: string): T | null {
  const hits = rules.filter((r) => r.rule_key === ruleKey && r.status === "approved" && r.effective_from <= day && (!r.effective_to || r.effective_to >= day));
  return hits.sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.version - a.version)[0] ?? null;
}

/** Why a rule can't be approved yet (empty: it can). */
export function approvalProblems(r: Pick<PraRule, "source" | "last_verified_at" | "classification_code" | "rate_type" | "rate" | "fixed_amount" | "payment_condition" | "alt_rate" | "effective_from">): string[] {
  const p: string[] = [];
  if (!r.source?.trim()) p.push("Give the legal source (Act, schedule, notification).");
  if (!r.last_verified_at) p.push("Record the date it was last verified against the official text.");
  if (!pctCodeOf(r.classification_code)) p.push("A full 8-digit classification code is needed (e.g. 9801.2000).");
  if (r.rate_type === "percent" && !(Number(r.rate) >= 0)) p.push("Enter the rate.");
  if (r.rate_type === "fixed" && !(Number(r.fixed_amount) > 0)) p.push("Enter the fixed amount.");
  if (r.payment_condition === "digital_split" && !(Number(r.alt_rate) >= 0)) p.push("Enter the rate for other (non-digital) payments.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.effective_from)) p.push("Effective-from date is required.");
  return p;
}

// ── Payments ─────────────────────────────────────────────────────────────

/** How one of MAVIN's payment methods counts: for the rate (a qualifying
 * digital payment: debit / credit card, mobile wallet or QR) and for PRA's
 * PaymentMode code. `confirmed`: verified with PRA; unconfirmed ones block. */
export interface MethodRule { taxClass: "qualifying_digital" | "other" | "unknown"; praMode: number | null; confirmed: boolean; note?: string }
export type MethodMap = Record<string, MethodRule>;

/** Defaults: cash and card are documented (eIMS manual v1.0 §6.1: 1 Cash, 2 Card).
 * A mobile wallet / QR has no PaymentMode of its own and a bank transfer is not
 * a listed qualifying payment: both stay unresolved until PRA confirms. */
export const DEFAULT_METHOD_MAP: MethodMap = {
  cash: { taxClass: "other", praMode: 1, confirmed: true },
  card: { taxClass: "qualifying_digital", praMode: 2, confirmed: true },
  digital: { taxClass: "qualifying_digital", praMode: null, confirmed: false, note: "Mobile wallet / QR: the law lists it as qualifying, but eIMS has no PaymentMode for it. Ask PRA which code to send." },
  bank: { taxClass: "unknown", praMode: null, confirmed: false, note: "Bank transfer is not among card / mobile wallet / QR in the law. Ask PRA how it is taxed and reported." },
};

export interface PaymentCheck {
  methods: string[];
  taxClass: "qualifying_digital" | "other" | null;
  praMode: number | null;
  problems: string[];
}

/** One bill's payment for PRA. Mixed payments (more than one method) are
 * unresolved: the law does not say which rate a split bill takes. */
export function checkPayment(methods: string[], map: MethodMap = DEFAULT_METHOD_MAP): PaymentCheck {
  const distinct = [...new Set(methods.filter(Boolean))];
  const problems: string[] = [];
  if (!distinct.length) return { methods: distinct, taxClass: null, praMode: null, problems: ["The bill has no payment recorded."] };
  if (distinct.length > 1) {
    return { methods: distinct, taxClass: null, praMode: 5, problems: [`Mixed payment (${distinct.join(" + ")}): which rate a split bill takes, and how it is reported, is not confirmed with PRA.`] };
  }
  const m = map[distinct[0]];
  if (!m) return { methods: distinct, taxClass: null, praMode: null, problems: [`Payment method "${distinct[0]}" has no PRA mapping.`] };
  if (!m.confirmed) problems.push(m.note ?? `Payment method "${distinct[0]}" is not confirmed with PRA.`);
  if (m.praMode == null) problems.push(`No PRA PaymentMode for "${distinct[0]}".`);
  if (m.taxClass === "unknown") problems.push(`How "${distinct[0]}" is taxed is not confirmed.`);
  return { methods: distinct, taxClass: m.taxClass === "unknown" ? null : m.taxClass, praMode: m.praMode, problems };
}

/** The rate a bill must carry under a rule, for its payment class. Null: not a percentage rule. */
export function expectedRate(rule: Pick<PraRule, "rate_type" | "rate" | "payment_condition" | "alt_rate">, taxClass: PaymentCheck["taxClass"]): number | null {
  if (rule.rate_type !== "percent") return null;
  if (rule.payment_condition === "any") return Number(rule.rate);
  if (taxClass === "qualifying_digital") return Number(rule.rate);
  if (taxClass === "other") return Number(rule.alt_rate);
  return null;
}

/** In words, for the catalogue and the receipt preview. */
export function ruleSummary(r: Pick<PraRule, "rate_type" | "rate" | "fixed_amount" | "fixed_unit" | "payment_condition" | "alt_rate">): string {
  if (r.rate_type === "fixed") return `Rs ${r.fixed_amount} ${r.fixed_unit ?? ""}`.trim();
  if (r.payment_condition === "digital_split") return `${r.rate} % by card / mobile wallet / QR, ${r.alt_rate} % otherwise`;
  return `${r.rate} %`;
}
