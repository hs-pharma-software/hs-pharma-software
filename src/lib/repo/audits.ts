import { dbBatch, dbSelect } from "../db";
import { createTenantRepo, LINE_REFS, requireCurrentTenantId } from "./base";
import { newId, nowIso } from "../id";
import { localDate } from "../localDate";
import { stockInHandProducts } from "./stockReports";
import { useAuthStore } from "../../store/authStore";
import type { AuditRow, AuditItem } from "../types2";

export const auditsRepo = createTenantRepo<AuditRow>("audits");
export const auditItemsRepo = createTenantRepo<AuditItem>("audit_items", { refs: LINE_REFS });

export interface AuditItemWithProduct extends AuditItem {
  product_name: string;
  system_qty: number;
}

/** Each line's system qty is looked up live (current stock), not stored on
 * the audit item \u2014 a re-print or edit later reflects any stock that's
 * moved since the count, same way the variance would appear in real life. */
export async function listItemsForAudit(auditId: string): Promise<AuditItemWithProduct[]> {
  const tenantId = useAuthStore.getState().currentTenant?.id ?? null;
  return dbSelect<AuditItemWithProduct>(
    `
    SELECT ai.*, p.name AS product_name,
           COALESCE(ai.system_qty, (SELECT SUM(qty) FROM product_batches WHERE product_id = ai.product_id AND tenant_id = ? AND deleted_at IS NULL), 0) AS system_qty
    FROM audit_items ai
    LEFT JOIN products p ON p.id = ai.product_id AND (p.tenant_id = ai.tenant_id OR p.tenant_id IS NULL)
    WHERE ai.audit_id = ? AND ai.deleted_at IS NULL
  `,
    [tenantId, auditId]
  );
}

/** Soft-deletes an audit and all of its line items together, so Delete
 * never leaves orphaned audit_items behind. */
export async function deleteAuditWithItems(auditId: string, reason?: string): Promise<void> {
  const items = await listItemsForAudit(auditId);
  for (const item of items) {
    await auditItemsRepo.remove(item.id);
  }
  await auditsRepo.remove(auditId, reason, "Audit");
}

// ── Initiated audits (v94): every product with stock listed with its system
// stock and unit cost at the start, the counted ("available") stock entered,
// then closed: the report shows each difference and its amount at cost.

export interface AuditCountLine {
  id: string;
  product_id: string;
  product_name: string;
  company_name: string | null;
  system_qty: number;
  unit_cost: number;
  /** null: not counted yet. */
  counted_qty: number | null;
}

/** Starts an audit of every product with stock (optionally one company's): the lines keep today's system stock and unit cost. */
export async function initiateAudit(x: { name: string; description?: string | null; company?: string | null }): Promise<AuditRow> {
  const name = x.name.trim();
  if (!name) throw new Error("Enter the audit name.");
  const tenantId = requireCurrentTenantId();
  const stock = (await stockInHandProducts()).filter((r) => !x.company || r.company === x.company);
  if (!stock.length) throw new Error(x.company ? `No product of ${x.company} has stock.` : "No product has stock to audit.");
  const audit = await auditsRepo.create({ date: localDate(), audit_name: name, description: x.description?.trim() || null, status: "open" });
  const now = nowIso();
  const rows = stock.map((r) => ({
    sql: `INSERT INTO audit_items (id, tenant_id, audit_id, product_id, counted_qty, system_qty, unit_cost, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    params: [newId(), tenantId, audit.id, r.id, Math.round(r.qty * 1000) / 1000, r.qty > 0 ? Math.round((r.cost / r.qty) * 100) / 100 : 0, now, now],
  }));
  for (let i = 0; i < rows.length; i += 250) await dbBatch(rows.slice(i, i + 250));
  return audit;
}

/** The lines of an initiated audit, by product name. */
export async function auditCountLines(auditId: string): Promise<AuditCountLine[]> {
  return dbSelect<AuditCountLine>(
    `SELECT ai.id, ai.product_id, COALESCE(p.name, 'Removed product') AS product_name, NULLIF(TRIM(p.company_name), '') AS company_name,
            COALESCE(ai.system_qty, 0) AS system_qty, COALESCE(ai.unit_cost, 0) AS unit_cost, ai.counted_qty
     FROM audit_items ai
     LEFT JOIN products p ON p.id = ai.product_id AND (p.tenant_id = ai.tenant_id OR p.tenant_id IS NULL)
     WHERE ai.audit_id = ? AND ai.tenant_id = ? AND ai.deleted_at IS NULL
     ORDER BY p.name COLLATE NOCASE`,
    [auditId, requireCurrentTenantId()]
  );
}

async function openAudit(auditId: string): Promise<AuditRow> {
  const a = await auditsRepo.get(auditId);
  if (!a) throw new Error("Audit not found.");
  if (a.status !== "open") throw new Error("This audit is closed; its counts can no longer change.");
  return a;
}

/** Saves counted stock (null clears a count). */
export async function saveAuditCounts(auditId: string, counts: Record<string, number | null>): Promise<number> {
  await openAudit(auditId);
  const tenantId = requireCurrentTenantId();
  const now = nowIso();
  const entries = Object.entries(counts);
  for (const [, v] of entries) if (v != null && (!Number.isFinite(v) || v < 0)) throw new Error("Available stock can't be negative.");
  const stmts = entries.map(([itemId, v]) => ({
    sql: `UPDATE audit_items SET counted_qty = ?, updated_at = ? WHERE id = ? AND audit_id = ? AND tenant_id = ?`,
    params: [v, now, itemId, auditId, tenantId],
  }));
  for (let i = 0; i < stmts.length; i += 250) await dbBatch(stmts.slice(i, i + 250));
  return stmts.length;
}

/** Closes the audit; products not counted are taken as not found (0) when `uncountedAsZero`, else closing is refused. */
export async function closeAudit(auditId: string, uncountedAsZero = false): Promise<AuditRow> {
  await openAudit(auditId);
  const lines = await auditCountLines(auditId);
  const missing = lines.filter((l) => l.counted_qty == null);
  if (missing.length && !uncountedAsZero) throw new Error(`${missing.length} product${missing.length === 1 ? " is" : "s are"} not counted yet.`);
  if (missing.length) await saveAuditCounts(auditId, Object.fromEntries(missing.map((l) => [l.id, 0])));
  const who = useAuthStore.getState().currentUser;
  return (await auditsRepo.update(auditId, { status: "closed", closed_at: nowIso(), closed_by_name: who?.displayName || who?.username || null }))!;
}

export interface AuditReport {
  lines: (AuditCountLine & { diff: number; amount: number })[];
  products: number;
  matched: number;
  short: { n: number; qty: number; amount: number };
  excess: { n: number; qty: number; amount: number };
  /** Excess minus shortage, at cost. */
  net: number;
}

/** The audit report: each difference (available minus system stock) and its amount at the unit cost of the day the audit started. */
export async function auditReport(auditId: string): Promise<AuditReport> {
  const lines = (await auditCountLines(auditId)).map((l) => {
    const diff = Math.round(((l.counted_qty ?? 0) - l.system_qty) * 1000) / 1000;
    return { ...l, diff, amount: Math.round(diff * l.unit_cost * 100) / 100 };
  });
  const shortL = lines.filter((l) => l.diff < 0);
  const excessL = lines.filter((l) => l.diff > 0);
  const sum = (xs: typeof lines, k: "diff" | "amount") => Math.round(xs.reduce((a, l) => a + l[k], 0) * 100) / 100;
  return {
    lines,
    products: lines.length,
    matched: lines.filter((l) => l.diff === 0).length,
    short: { n: shortL.length, qty: -sum(shortL, "diff"), amount: -sum(shortL, "amount") },
    excess: { n: excessL.length, qty: sum(excessL, "diff"), amount: sum(excessL, "amount") },
    net: sum(lines, "amount"),
  };
}
