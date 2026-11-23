/** A surgery's shares and expenses (what the owner pays out for the
 * procedure): the consultant's, MO's, nurses' and anaesthesia shares, other
 * expenses, and the medicines from the linked hospital pharmacy's Pre Invoice
 * for the case (OT medicine, and IPD medicine prescribed by the consultant).
 * Taken off the surgery's charges, they give its profit. */

export interface PreInvoiceRef { id: string; name: string; total: number }

export interface SurgeryShares {
  consultant: number;
  mo: number;
  nurses: number;
  anesthesia: number;
  other: { label: string; amount: number }[];
  ot_medicine: PreInvoiceRef | null;
  ipd_medicine: PreInvoiceRef | null;
}

export const EMPTY_SHARES: SurgeryShares = { consultant: 0, mo: 0, nurses: 0, anesthesia: 0, other: [], ot_medicine: null, ipd_medicine: null };

export const SHARE_FIELDS: { key: "consultant" | "mo" | "nurses" | "anesthesia"; label: string }[] = [
  { key: "consultant", label: "Consultant share" },
  { key: "mo", label: "MO share" },
  { key: "nurses", label: "Nurses share" },
  { key: "anesthesia", label: "Anesthesia share" },
];

const round = (n: number) => Math.round(n * 100) / 100;
const amount = (v: unknown, label: string) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} cannot be negative.`);
  return round(n);
};
const ref = (v: unknown): PreInvoiceRef | null => {
  const x = v as Partial<PreInvoiceRef> | null | undefined;
  return x && typeof x.id === "string" && x.id ? { id: x.id, name: String(x.name ?? ""), total: amount(x.total, "Medicine total") } : null;
};

/** Validated copy (blank other-expense lines dropped). */
export function cleanShares(input: Partial<SurgeryShares> | null | undefined): SurgeryShares {
  const out: SurgeryShares = { ...EMPTY_SHARES, other: [] };
  for (const f of SHARE_FIELDS) out[f.key] = amount(input?.[f.key], f.label);
  for (const o of input?.other ?? []) {
    const label = String(o?.label ?? "").trim();
    const a = amount(o?.amount, label || "An other expense");
    if (!label && !a) continue;
    if (!label) throw new Error("Name each other expense.");
    out.other.push({ label, amount: a });
  }
  out.ot_medicine = ref(input?.ot_medicine);
  out.ipd_medicine = ref(input?.ipd_medicine);
  return out;
}

export function parseShares(json: string | null | undefined): SurgeryShares {
  if (!json) return { ...EMPTY_SHARES, other: [] };
  try { return cleanShares(JSON.parse(json)); } catch { return { ...EMPTY_SHARES, other: [] }; }
}

/** Everything paid out for the surgery. */
export function sharesTotal(s: SurgeryShares): number {
  return round(SHARE_FIELDS.reduce((a, f) => a + s[f.key], 0) + s.other.reduce((a, o) => a + o.amount, 0)
    + (s.ot_medicine?.total ?? 0) + (s.ipd_medicine?.total ?? 0));
}

/** The surgery's profit: its charges less its shares and expenses. */
export function surgeryProfit(chargesTotal: number, s: SurgeryShares): number {
  return round(chargesTotal - sharesTotal(s));
}
