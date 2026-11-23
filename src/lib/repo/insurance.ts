/** Pharmacy insurance (v96): insurance companies, a customer's policy
 * (company, number, expiry), and a claim per invoice for the whole invoice.
 *
 * An insurance invoice is a sale to an insured customer dated on or before the
 * policy's expiry, or any invoice already claimed. With no claim row it is
 * "not claimed"; a claim moves Sent for claim -> In process -> Paid / Unpaid.
 * A claim keeps the company and amount it was sent with. */
import { dbSelect } from "../db";
import { localDate } from "../localDate";
import { useAuthStore } from "../../store/authStore";
import { createTenantRepo, requireCurrentTenantId } from "./base";

export type ClaimStatus = "not_claimed" | "sent" | "in_process" | "paid" | "unpaid";
export const CLAIM_STATUSES: { id: ClaimStatus; label: string; tone: string }[] = [
  { id: "not_claimed", label: "Not claimed", tone: "bg-neutral-100 text-neutral-600" },
  { id: "sent", label: "Sent for claim", tone: "bg-sky-100 text-sky-800" },
  { id: "in_process", label: "In process", tone: "bg-amber-100 text-amber-800" },
  { id: "paid", label: "Paid", tone: "bg-emerald-100 text-emerald-800" },
  { id: "unpaid", label: "Unpaid", tone: "bg-rose-100 text-rose-800" },
];
export const claimLabel = (s: ClaimStatus) => CLAIM_STATUSES.find((x) => x.id === s)?.label ?? s;

/** Offered when adding a company (Pakistan's health and life insurers); a business adds its own too. */
export const COMMON_INSURERS = [
  "Jubilee Life Insurance", "Jubilee General Insurance", "EFU Life Assurance", "EFU General Insurance", "State Life Insurance Corporation",
  "Adamjee Insurance", "Adamjee Life Assurance", "Allianz EFU Health Insurance", "IGI Life Insurance", "IGI General Insurance",
  "TPL Insurance", "TPL Life Insurance", "Askari General Insurance", "Pak-Qatar Family Takaful", "Salaam Takaful", "UBL Insurers",
  "Sehat Sahulat Program",
];

interface CompanyRow { id: string; tenant_id: string; name: string; phone: string | null; notes: string | null; created_at: string; updated_at: string; deleted_at: string | null }
interface ClaimRow {
  id: string; tenant_id: string; invoice_id: string; customer_id: string | null; company_id: string | null; amount: number; status: string;
  claim_ref: string | null; notes: string | null; sent_on: string | null; settled_on: string | null; updated_by_name: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}
export const insuranceCompaniesRepo = createTenantRepo<CompanyRow>("insurance_companies");
export const insuranceClaimsRepo = createTenantRepo<ClaimRow>("insurance_claims");

export interface InsuranceCompany { id: string; name: string; phone: string | null }

export async function listInsuranceCompanies(): Promise<InsuranceCompany[]> {
  return (await insuranceCompaniesRepo.list({ orderBy: "name COLLATE NOCASE ASC" })).map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
}

/** Adds a company, or returns the one already there with that name. */
export async function addInsuranceCompany(name: string, phone?: string | null): Promise<InsuranceCompany> {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new Error("Enter the insurance company's name.");
  const same = await insuranceCompaniesRepo.list({ where: "LOWER(name) = LOWER(?)", params: [n] });
  if (same[0]) return { id: same[0].id, name: same[0].name, phone: same[0].phone };
  const c = await insuranceCompaniesRepo.create({ name: n, phone: phone?.trim() || null });
  return { id: c.id, name: c.name, phone: c.phone };
}

/** Removes a company no customer or claim uses. */
export async function deleteInsuranceCompany(id: string): Promise<void> {
  const T = requireCurrentTenantId();
  const used = await dbSelect<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM customers WHERE tenant_id = ? AND deleted_at IS NULL AND insurance_company_id = ?)
          + (SELECT COUNT(*) FROM insurance_claims WHERE tenant_id = ? AND deleted_at IS NULL AND company_id = ?) AS n`,
    [T, id, T, id]
  );
  if (Number(used[0]?.n ?? 0) > 0) throw new Error("This company has insured customers or claims; it can't be deleted.");
  await insuranceCompaniesRepo.remove(id);
}

export interface InsuranceInvoice {
  id: string;
  invoiceNo: number | null;
  date: string;
  customerId: string;
  customerName: string;
  phone: string | null;
  policyNo: string | null;
  companyId: string | null;
  companyName: string;
  amount: number;
  status: ClaimStatus;
  claimId: string | null;
  claimRef: string | null;
  sentOn: string | null;
  settledOn: string | null;
}

export interface InsuranceFilter { from?: string | null; to?: string | null; companyId?: string | null; customerId?: string | null; status?: ClaimStatus | null }

/** Insurance invoices, newest first. */
export async function insuranceInvoices(f: InsuranceFilter = {}): Promise<InsuranceInvoice[]> {
  const T = requireCurrentTenantId();
  const where: string[] = [];
  const params: unknown[] = [T, T, T, T];
  if (f.from) { where.push("substr(i.date, 1, 10) >= ?"); params.push(f.from); }
  if (f.to) { where.push("substr(i.date, 1, 10) <= ?"); params.push(f.to); }
  if (f.companyId) { where.push("COALESCE(cl.company_id, c.insurance_company_id) = ?"); params.push(f.companyId); }
  if (f.customerId) { where.push("i.customer_id = ?"); params.push(f.customerId); }
  if (f.status) { where.push("COALESCE(cl.status, 'not_claimed') = ?"); params.push(f.status); }
  const rows = await dbSelect<{
    id: string; invoice_no: number | null; date: string; customer_id: string; customer_name: string; phone: string | null; policy_no: string | null;
    company_id: string | null; company_name: string | null; amount: number; status: string; claim_id: string | null; claim_ref: string | null;
    sent_on: string | null; settled_on: string | null;
  }>(
    `SELECT i.id, i.invoice_no, substr(i.date, 1, 10) AS date, i.customer_id, c.name AS customer_name, c.phone, c.insurance_policy_no AS policy_no,
            COALESCE(cl.company_id, c.insurance_company_id) AS company_id, ic.name AS company_name,
            COALESCE(cl.amount, i.payable, 0) AS amount, COALESCE(cl.status, 'not_claimed') AS status,
            cl.id AS claim_id, cl.claim_ref, cl.sent_on, cl.settled_on
     FROM invoices i
     JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
     LEFT JOIN insurance_claims cl ON cl.invoice_id = i.id AND cl.tenant_id = ? AND cl.deleted_at IS NULL
     LEFT JOIN insurance_companies ic ON ic.id = COALESCE(cl.company_id, c.insurance_company_id) AND ic.tenant_id = ?
     WHERE i.tenant_id = ? AND i.deleted_at IS NULL
       AND COALESCE(i.is_return, 0) = 0 AND COALESCE(i.is_memorized, 0) = 0 AND COALESCE(i.is_quotation, 0) = 0
       AND (cl.id IS NOT NULL OR (c.insurance_company_id IS NOT NULL AND c.insurance_company_id <> ''
            AND (COALESCE(c.insurance_expiry, '') = '' OR substr(i.date, 1, 10) <= c.insurance_expiry)))
       AND c.tenant_id = ?
       ${where.length ? `AND ${where.join(" AND ")}` : ""}
     ORDER BY i.date DESC, i.invoice_no DESC`,
    params
  );
  return rows.map((r) => ({
    id: r.id, invoiceNo: r.invoice_no, date: r.date, customerId: r.customer_id, customerName: r.customer_name, phone: r.phone, policyNo: r.policy_no,
    companyId: r.company_id, companyName: r.company_name ?? "Unknown company", amount: Number(r.amount) || 0, status: r.status as ClaimStatus,
    claimId: r.claim_id, claimRef: r.claim_ref, sentOn: r.sent_on, settledOn: r.settled_on,
  }));
}

/** Sets the claim status of invoices: "not_claimed" withdraws the claim; others send it (whole invoice, the customer's company) or move it on. */
export async function setClaimStatus(invoiceIds: string[], status: ClaimStatus, ref?: string | null): Promise<number> {
  if (!CLAIM_STATUSES.some((s) => s.id === status)) throw new Error("Unknown claim status.");
  const T = requireCurrentTenantId();
  const who = useAuthStore.getState().currentUser;
  const by = who?.displayName || who?.username || null;
  const today = localDate();
  let changed = 0;
  for (const invoiceId of [...new Set(invoiceIds)]) {
    const claim = (await insuranceClaimsRepo.list({ where: "invoice_id = ?", params: [invoiceId] }))[0];
    if (status === "not_claimed") {
      if (claim) { await insuranceClaimsRepo.remove(claim.id); changed++; }
      continue;
    }
    const settled = status === "paid" || status === "unpaid" ? today : null;
    const refValue = ref === undefined ? undefined : ref?.trim() || null;
    if (claim) {
      if (claim.status === status && (refValue === undefined || refValue === claim.claim_ref)) continue;
      await insuranceClaimsRepo.update(claim.id, { status, settled_on: settled, updated_by_name: by, ...(refValue === undefined ? {} : { claim_ref: refValue }) });
      changed++;
      continue;
    }
    const inv = (await dbSelect<{ customer_id: string | null; payable: number | null; company_id: string | null }>(
      `SELECT i.customer_id, i.payable, c.insurance_company_id AS company_id FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
       WHERE i.id = ? AND i.tenant_id = ? AND i.deleted_at IS NULL`,
      [invoiceId, T]
    ))[0];
    if (!inv) throw new Error("Invoice not found.");
    if (!inv.company_id) throw new Error("This invoice's customer has no insurance company.");
    await insuranceClaimsRepo.create({
      invoice_id: invoiceId, customer_id: inv.customer_id, company_id: inv.company_id, amount: Number(inv.payable) || 0,
      status, claim_ref: refValue ?? null, sent_on: today, settled_on: settled, updated_by_name: by,
    });
    changed++;
  }
  return changed;
}

export interface InsuredCustomer {
  id: string;
  name: string;
  phone: string | null;
  policyNo: string | null;
  expiry: string | null;
  companyId: string;
  companyName: string;
}

/** Customers with a policy (optionally of one company), by name. */
export async function insuredCustomers(companyId?: string | null): Promise<InsuredCustomer[]> {
  const T = requireCurrentTenantId();
  const rows = await dbSelect<{ id: string; name: string; phone: string | null; policy_no: string | null; expiry: string | null; company_id: string; company_name: string | null }>(
    `SELECT c.id, c.name, c.phone, c.insurance_policy_no AS policy_no, NULLIF(c.insurance_expiry, '') AS expiry, c.insurance_company_id AS company_id, ic.name AS company_name
     FROM customers c LEFT JOIN insurance_companies ic ON ic.id = c.insurance_company_id AND ic.tenant_id = ?
     WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND COALESCE(c.insurance_company_id, '') <> '' ${companyId ? "AND c.insurance_company_id = ?" : ""}
     ORDER BY c.name COLLATE NOCASE`,
    [T, T, ...(companyId ? [companyId] : [])]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, policyNo: r.policy_no, expiry: r.expiry, companyId: r.company_id, companyName: r.company_name ?? "Unknown company" }));
}

// ── Reports ────────────────────────────────────────────────────────────

export interface ClaimTotals { invoices: number; total: number; byStatus: Record<ClaimStatus, number> }
const emptyTotals = (): ClaimTotals => ({ invoices: 0, total: 0, byStatus: { not_claimed: 0, sent: 0, in_process: 0, paid: 0, unpaid: 0 } });
function add(t: ClaimTotals, r: InsuranceInvoice) {
  t.invoices += 1;
  t.total = Math.round((t.total + r.amount) * 100) / 100;
  t.byStatus[r.status] = Math.round((t.byStatus[r.status] + r.amount) * 100) / 100;
}

/** Totals over a list of insurance invoices. */
export function claimTotals(rows: InsuranceInvoice[]): ClaimTotals {
  const t = emptyTotals();
  for (const r of rows) add(t, r);
  return t;
}

export type InsuranceGroup = "company" | "patient" | "month";
export interface InsuranceGroupRow extends ClaimTotals { id: string; label: string; sub: string | null }

/** Insurance invoices grouped by company, patient or month (yyyy-mm), largest first (months newest first). */
export function groupInsurance(rows: InsuranceInvoice[], by: InsuranceGroup): InsuranceGroupRow[] {
  const m = new Map<string, InsuranceGroupRow>();
  for (const r of rows) {
    const id = by === "company" ? (r.companyId ?? "") : by === "patient" ? r.customerId : r.date.slice(0, 7);
    let g = m.get(id);
    if (!g) {
      const label = by === "company" ? r.companyName : by === "patient" ? r.customerName : r.date.slice(0, 7);
      const sub = by === "patient" ? [r.companyName, r.policyNo ? `Policy ${r.policyNo}` : null].filter(Boolean).join(" · ") : null;
      g = { id, label, sub, ...emptyTotals() };
      m.set(id, g);
    }
    add(g, r);
  }
  const list = [...m.values()];
  return by === "month" ? list.sort((a, b) => b.id.localeCompare(a.id)) : list.sort((a, b) => b.total - a.total);
}
