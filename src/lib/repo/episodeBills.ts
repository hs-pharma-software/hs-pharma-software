/** Episodes & Billing > Billing, and the bills at reception: each visit /
 * admission / emergency episode's bill (its charges, discount, paid, balance),
 * and changing its discount. A line already on a surgery invoice is billed
 * through that invoice and is not changed here. */
import { dbSelect } from "../db";
import { requireCurrentTenantId } from "./base";
import { currentActor, roleAllowed } from "./medicalRecord";
import { hospitalChargesRepo, listChargesForEpisode, type HospitalCharge } from "./hospital";

/** Who may change a bill's discount: owner / admin, the accountant and reception. */
export const BILL_DISCOUNT_ROLES = ["accountant", "receptionist", "admin"];

export interface EpisodeBill {
  id: string;
  episode_no: string;
  type: string;
  date: string;
  status: string;
  patient_id: string;
  patient_name: string | null;
  mr_no: string | null;
  doctor_name: string | null;
  department: string | null;
  gross: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function listEpisodeBills(f: { from?: string; to?: string; type?: string; status?: "all" | "unpaid" | "paid"; search?: string } = {}): Promise<EpisodeBill[]> {
  const T = requireCurrentTenantId();
  const where = ["e.tenant_id = ?", "e.deleted_at IS NULL"];
  const params: unknown[] = [T];
  if (f.from) { where.push("e.date >= ?"); params.push(f.from); }
  if (f.to) { where.push("e.date <= ?"); params.push(f.to); }
  if (f.type) { where.push("e.type = ?"); params.push(f.type); }
  const q = f.search?.trim();
  if (q) { where.push("(e.episode_no LIKE ? OR p.name LIKE ? OR p.mr_no LIKE ? OR p.phone LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = await dbSelect<Omit<EpisodeBill, "balance">>(
    `SELECT e.id, e.episode_no, e.type, e.date, e.status, e.patient_id, p.name AS patient_name, p.mr_no, s.name AS doctor_name, e.department,
            COALESCE(c.gross, 0) AS gross, COALESCE(c.gross, 0) - COALESCE(c.total, 0) AS discount, COALESCE(c.total, 0) AS total,
            COALESCE((SELECT SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END) FROM hospital_payments WHERE episode_id = e.id AND tenant_id = e.tenant_id AND deleted_at IS NULL), 0) AS paid
     FROM hospital_episodes e
     LEFT JOIN hospital_patients p ON p.id = e.patient_id
     LEFT JOIN staff s ON s.id = e.doctor_id
     LEFT JOIN (SELECT episode_id, SUM(qty * rate) AS gross, SUM(amount) AS total FROM hospital_charges WHERE tenant_id = ? AND deleted_at IS NULL GROUP BY episode_id) c ON c.episode_id = e.id
     WHERE ${where.join(" AND ")}
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT 500`,
    [T, ...params]
  );
  const bills = rows.map((r) => ({ ...r, gross: round(r.gross), discount: round(r.discount), total: round(r.total), paid: round(r.paid), balance: round(r.total - r.paid) }));
  if (f.status === "unpaid") return bills.filter((b) => b.balance > 0);
  if (f.status === "paid") return bills.filter((b) => b.total > 0 && b.balance <= 0);
  return bills;
}

/** The bill's lines; `locked` lines are on a surgery invoice. */
export async function billLines(episodeId: string): Promise<(HospitalCharge & { locked: boolean })[]> {
  return (await listChargesForEpisode(episodeId)).map((c) => ({ ...c, locked: Boolean(c.invoice_id) }));
}

/** The same % on every line that takes `amount` (Rs) off these lines. */
export function pctForAmount(lines: Pick<HospitalCharge, "qty" | "rate">[], amount: number): number {
  const gross = lines.reduce((a, l) => a + Number(l.qty) * Number(l.rate), 0);
  if (!(gross > 0) || !(amount > 0)) return 0;
  return Math.min(100, Math.round((amount / gross) * 100 * 10000) / 10000);
}

/** Sets the discount % of a bill's lines, with the reason (kept on each changed line). */
export async function setBillDiscounts(episodeId: string, pcts: Record<string, number>, reason: string): Promise<number> {
  const a = await currentActor();
  if (!roleAllowed(BILL_DISCOUNT_ROLES, a)) throw new Error("Only the accountant, reception or an administrator can change a bill's discount.");
  if (!reason.trim()) throw new Error("Write why the discount is given.");
  const lines = await listChargesForEpisode(episodeId);
  let changed = 0;
  for (const [chargeId, raw] of Object.entries(pcts)) {
    const line = lines.find((l) => l.id === chargeId);
    if (!line) throw new Error("A line of this bill was not found.");
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("A discount is between 0 and 100%.");
    if (Math.abs(pct - Number(line.discount_pct || 0)) < 0.00005) continue;
    if (line.invoice_id) throw new Error(`"${line.description}" is on a surgery invoice: change it on the invoice.`);
    const amount = round(Number(line.qty) * Number(line.rate) * (1 - pct / 100));
    const note = `Discount ${pct}% by ${a.name}: ${reason.trim()}`;
    await hospitalChargesRepo.update(chargeId, { discount_pct: pct, amount, notes: line.notes ? `${line.notes}
${note}` : note });
    changed++;
  }
  return changed;
}
