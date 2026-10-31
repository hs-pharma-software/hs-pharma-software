import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { isMissingSchemaError } from "../dbErrors";
import { localDate } from "../localDate";
import { useAuthStore } from "../../store/authStore";
import type { Salesman } from "../types2";

export const salesmenRepo = createTenantRepo<Salesman>("salesmen");

export interface SalesmanInput {
  name: string;
  phone?: string | null;
  /** The login this salesman uses; null unlinks. */
  userId?: string | null;
  monthlyTarget?: number | null;
}

/** Edits a salesman. A login belongs to at most one salesman. */
export async function saveSalesman(id: string | null, s: SalesmanInput): Promise<Salesman> {
  const name = s.name.trim();
  if (!name) throw new Error("Enter the salesman's name.");
  const target = s.monthlyTarget == null || String(s.monthlyTarget) === "" ? 0 : Number(s.monthlyTarget);
  if (!(target >= 0)) throw new Error("The monthly target cannot be negative.");
  const userId = s.userId || null;
  const base = { name, phone: s.phone?.trim() || null };
  const linked = { user_id: userId, monthly_target: target };
  try {
    if (userId) {
      const taken = (await salesmenRepo.list({ where: "user_id = ?", params: [userId] })).find((x) => x.id !== id);
      if (taken) throw new Error(`That login is already linked to ${taken.name}.`);
    }
    if (id) {
      if (!(await salesmenRepo.get(id))) throw new Error("Salesman not found.");
      return (await salesmenRepo.update(id, { ...base, ...linked }))!;
    }
    return await salesmenRepo.create({ ...base, ...linked });
  } catch (e) {
    if (isMissingSchemaError(e)) {
      // Before the v62 database update: name and phone are still saved.
      if (userId || target > 0) throw new Error("Linking a login and the monthly target need the latest database update (v62). Ask the administrator to run it.");
      return id ? (await salesmenRepo.update(id, base))! : salesmenRepo.create(base);
    }
    throw e;
  }
}

/** The salesman linked to the logged-in user, if any (null before v62). */
export async function mySalesman(): Promise<Salesman | null> {
  const u = useAuthStore.getState().currentUser;
  if (!u) return null;
  try {
    return (await salesmenRepo.list({ where: "user_id = ?", params: [u.id] }))[0] ?? null;
  } catch {
    return null;
  }
}

export interface SalesmanPerformance {
  id: string;
  name: string;
  phone: string | null;
  user_id: string | null;
  monthly_target: number;
  invoice_count: number;
  sale: number;
  sale_return: number;
  net_sale: number;
  /** Net sales this calendar month. */
  month_sale: number;
}

/** Every salesman with all-time and this month's sales (returns subtracted). */
export async function listSalesmanPerformance(today: string = localDate()): Promise<SalesmanPerformance[]> {
  const t = requireCurrentTenantId();
  const month = `${today.slice(0, 7)}%`;
  const inv = `FROM invoices i WHERE i.salesman_id = sm.id AND i.tenant_id = ? AND i.deleted_at IS NULL AND COALESCE(i.is_quotation, 0) = 0 AND COALESCE(i.is_memorized, 0) = 0`;
  const select = (linked: boolean) => `
    SELECT sm.id, sm.name, sm.phone,
      ${linked ? "sm.user_id AS user_id, COALESCE(sm.monthly_target, 0) AS monthly_target_x" : "NULL AS user_id, 0 AS monthly_target_x"},
      (SELECT COUNT(*) ${inv} AND COALESCE(i.is_return, 0) = 0) AS invoice_count,
      COALESCE((SELECT SUM(total) ${inv} AND COALESCE(i.is_return, 0) = 0), 0) AS sale,
      COALESCE((SELECT SUM(total) ${inv} AND COALESCE(i.is_return, 0) = 1), 0) AS sale_return,
      COALESCE((SELECT SUM(CASE WHEN COALESCE(i.is_return, 0) = 1 THEN -total ELSE total END) ${inv} AND i.date LIKE ?), 0) AS month_sale
    FROM salesmen sm WHERE sm.deleted_at IS NULL AND sm.tenant_id = ? ORDER BY sm.name ASC`;
  const args = [t, t, t, t, month, t];
  type Raw = Omit<SalesmanPerformance, "monthly_target" | "net_sale" | "user_id"> & { user_id?: string | null; monthly_target_x: number };
  let rows: Raw[];
  try {
    rows = await dbSelect<Raw>(select(true), args);
  } catch (e) {
    // Before the v62 database update: no login or target yet.
    if (!isMissingSchemaError(e)) throw e;
    rows = await dbSelect<Raw>(select(false), args);
  }
  return rows.map((r) => ({
    id: r.id, name: r.name, phone: r.phone ?? null, user_id: r.user_id ?? null, monthly_target: Number(r.monthly_target_x) || 0,
    invoice_count: Number(r.invoice_count) || 0, sale: Number(r.sale) || 0, sale_return: Number(r.sale_return) || 0,
    net_sale: (Number(r.sale) || 0) - (Number(r.sale_return) || 0), month_sale: Number(r.month_sale) || 0,
  }));
}
