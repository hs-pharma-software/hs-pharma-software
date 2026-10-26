/** Receptionists' day closings and the hospital's finance view.
 *
 * Every payment records the login that took it. A receptionist closes their
 * day: the closing totals everything they took since their last closing, by
 * method, and records the cash they counted and handed over. Those payments
 * are then marked with the closing and are not counted again. A shortage or
 * excess needs a note, and the accountant (or the owner) verifies the
 * closing; nobody verifies their own. */
import { dbExecute, dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { nowIso } from "../id";
import { localDateTime } from "../localDate";
import { currentActor, roleAllowed } from "./medicalRecord";
import { nextSerial } from "./emergency";
import { recordOutbox } from "../sync/outbox";
import { useAuthStore } from "../../store/authStore";
import { FINANCE_ROLES, designation } from "../../config/hospitalStaff";
import type { PaymentMethod } from "../types-hospital";

export interface CashClosing {
  id: string;
  tenant_id: string;
  closing_no: string;
  user_id: string;
  user_name: string;
  desk: string | null;
  from_at: string | null;
  to_at: string;
  payments_count: number;
  cash: number;
  card: number;
  online: number;
  bank: number;
  refunds: number;
  net_total: number;
  counted_cash: number;
  difference: number;
  handed_to: string | null;
  note: string | null;
  status: "submitted" | "verified";
  verified_by_name: string | null;
  verified_at: string | null;
  verify_note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const closingsRepo = createTenantRepo<CashClosing>("hospital_cash_closings");

const round = (n: number) => Math.round(n * 100) / 100;
export const METHOD_LABEL: Record<PaymentMethod | string, string> = { cash: "Cash", card: "Card", online: "Online transfer", bank: "Bank deposit" };

export interface PaymentRow {
  id: string;
  episode_id: string;
  type: "deposit" | "payment" | "refund";
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
  received_at: string;
  received_by: string | null;
  received_by_name: string | null;
  closing_id: string | null;
  episode_no: string;
  episode_type: string;
  patient_name: string;
  mr_no: string | null;
}

const PAYMENT_SELECT = `SELECT pay.id, pay.episode_id, pay.type, pay.amount, pay.method, pay.reference, pay.notes, pay.received_at, pay.received_by,
    pay.received_by_name, pay.closing_id, e.episode_no, e.type AS episode_type, p.name AS patient_name, p.mr_no
  FROM hospital_payments pay JOIN hospital_episodes e ON e.id = pay.episode_id LEFT JOIN hospital_patients p ON p.id = e.patient_id`;

export interface Totals { count: number; cash: number; card: number; online: number; bank: number; refunds: number; net: number }

/** Money in by method, refunds out (refunds are paid back in cash unless recorded otherwise). */
export function totalsOf(rows: Pick<PaymentRow, "type" | "amount" | "method">[]): Totals {
  const t: Totals = { count: rows.length, cash: 0, card: 0, online: 0, bank: 0, refunds: 0, net: 0 };
  for (const r of rows) {
    const amt = Number(r.amount);
    if (r.type === "refund") { t.refunds += amt; continue; }
    const k = (["cash", "card", "online", "bank"].includes(r.method) ? r.method : "cash") as "cash" | "card" | "online" | "bank";
    t[k] += amt;
  }
  t.net = t.cash + t.card + t.online + t.bank - t.refunds;
  for (const k of ["cash", "card", "online", "bank", "refunds", "net"] as const) t[k] = round(t[k]);
  return t;
}
/** The cash that should be in the drawer: cash taken less refunds paid out. */
export const expectedCash = (t: Totals) => round(t.cash - t.refunds);

function me(): { id: string; name: string } {
  const u = useAuthStore.getState().currentUser;
  if (!u) throw new Error("Log in first.");
  return { id: u.id, name: u.displayName || u.username };
}

/** What the signed-in user has taken since their last closing. */
export async function myOpenCollections(): Promise<{ rows: PaymentRow[]; totals: Totals; expectedCash: number; since: string | null }> {
  const t = requireCurrentTenantId();
  const u = me();
  const rows = await dbSelect<PaymentRow>(
    `${PAYMENT_SELECT} WHERE pay.tenant_id = ? AND pay.deleted_at IS NULL AND pay.received_by = ? AND pay.closing_id IS NULL ORDER BY pay.received_at ASC`,
    [t, u.id]
  );
  const totals = totalsOf(rows);
  return { rows, totals, expectedCash: expectedCash(totals), since: rows[0]?.received_at ?? null };
}

/** Closes the signed-in user's day: everything taken since the last closing. */
export async function closeMyDay(x: { countedCash: number; handedTo?: string | null; note?: string | null }): Promise<CashClosing> {
  const u = me();
  const a = await currentActor();
  const open = await myOpenCollections();
  if (!open.rows.length) throw new Error("Nothing has been collected since your last closing.");
  const counted = Number(x.countedCash);
  if (!Number.isFinite(counted) || counted < 0) throw new Error("Enter the cash you counted.");
  const difference = round(counted - open.expectedCash);
  if (difference !== 0 && !x.note?.trim()) {
    throw new Error(`The cash counted is ${difference > 0 ? "more" : "less"} than expected by Rs ${Math.abs(difference)}. Write what happened.`);
  }
  const closing = await closingsRepo.create({
    closing_no: await nextSerial("hospital_cash_closings", "closing_no", "CL"), user_id: u.id, user_name: a.name,
    desk: designation(a.role)?.label ?? (a.full ? "Owner / admin" : null),
    from_at: open.rows[0].received_at, to_at: localDateTime(), payments_count: open.totals.count,
    cash: open.totals.cash, card: open.totals.card, online: open.totals.online, bank: open.totals.bank, refunds: open.totals.refunds,
    net_total: open.totals.net, counted_cash: round(counted), difference, handed_to: x.handedTo?.trim() || null, note: x.note?.trim() || null,
    status: "submitted",
  });
  // Mark exactly the payments this closing counted, so they are never counted again.
  const ids = open.rows.map((r) => r.id);
  const ts = nowIso();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    await dbExecute(
      `UPDATE hospital_payments SET closing_id = ?, updated_at = ? WHERE tenant_id = ? AND received_by = ? AND closing_id IS NULL AND id IN (${chunk.map(() => "?").join(",")})`,
      [closing.id, ts, requireCurrentTenantId(), u.id, ...chunk]
    );
  }
  for (const id of ids) {
    const row = (await dbSelect<Record<string, unknown>>(`SELECT * FROM hospital_payments WHERE id = ?`, [id]))[0];
    if (row) await recordOutbox("hospital_payments", id, "update", row);
  }
  return closing;
}

export async function closingPayments(closingId: string): Promise<PaymentRow[]> {
  return dbSelect<PaymentRow>(`${PAYMENT_SELECT} WHERE pay.tenant_id = ? AND pay.closing_id = ? AND pay.deleted_at IS NULL ORDER BY pay.received_at ASC`, [requireCurrentTenantId(), closingId]);
}

export async function myClosings(limit = 60): Promise<CashClosing[]> {
  return closingsRepo.list({ where: "user_id = ?", params: [me().id], orderBy: "to_at DESC" }).then((r) => r.slice(0, limit));
}

export async function listClosings(opts: { from?: string; to?: string; status?: CashClosing["status"] | "" } = {}): Promise<CashClosing[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.from) { where.push("substr(to_at, 1, 10) >= ?"); params.push(opts.from); }
  if (opts.to) { where.push("substr(to_at, 1, 10) <= ?"); params.push(opts.to); }
  if (opts.status) { where.push("status = ?"); params.push(opts.status); }
  return closingsRepo.list({ where: where.join(" AND "), params, orderBy: "to_at DESC" });
}

/** The accountant or a full-access login confirms the cash was received. Not your own closing. */
export async function verifyClosing(id: string, note?: string | null): Promise<CashClosing> {
  const a = await currentActor();
  if (!roleAllowed(FINANCE_ROLES, a)) throw new Error("The accountant or the owner verifies closings.");
  const c = await closingsRepo.get(id);
  if (!c) throw new Error("Closing not found.");
  if (c.status === "verified") throw new Error("Already verified.");
  if (a.userId && c.user_id === a.userId) throw new Error("Your own closing is verified by someone else.");
  return (await closingsRepo.update(id, { status: "verified", verified_by_name: a.designation ? `${a.name}, ${a.designation}` : a.name, verified_at: nowIso(), verify_note: note?.trim() || null }))!;
}

// ── Finance view ──────────────────────────────────────────────────────────

export async function listCollections(range: { from: string; to: string }, opts: { receiver?: string; method?: string } = {}): Promise<PaymentRow[]> {
  const where = ["pay.tenant_id = ?", "pay.deleted_at IS NULL", "substr(pay.received_at, 1, 10) BETWEEN ? AND ?"];
  const params: unknown[] = [requireCurrentTenantId(), range.from, range.to];
  if (opts.receiver === "__none") where.push("pay.received_by IS NULL");
  else if (opts.receiver) { where.push("pay.received_by = ?"); params.push(opts.receiver); }
  if (opts.method) { where.push("pay.method = ?"); params.push(opts.method); }
  return dbSelect<PaymentRow>(`${PAYMENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY pay.received_at DESC LIMIT 2000`, params);
}

export interface FinanceOverview {
  totals: Totals;
  byReceiver: { id: string | null; name: string; totals: Totals; openCash: number; openCount: number }[];
  byDay: { day: string; totals: Totals }[];
  byVisitType: { type: string; net: number }[];
  billedByDepartment: { department: string; billed: number }[];
  billed: number;
  outstanding: { episode_id: string; episode_no: string; patient_name: string; mr_no: string | null; type: string; status: string; balance: number }[];
  outstandingTotal: number;
  closingsPending: number;
  closingsShort: number;
}

export async function financeOverview(range: { from: string; to: string }): Promise<FinanceOverview> {
  const t = requireCurrentTenantId();
  const rows = await listCollections(range);
  const open = await dbSelect<{ received_by: string | null; name: string | null; type: PaymentRow["type"]; amount: number; method: string }>(
    `SELECT received_by, received_by_name AS name, type, amount, method FROM hospital_payments WHERE tenant_id = ? AND deleted_at IS NULL AND received_by IS NOT NULL AND closing_id IS NULL`,
    [t]
  );
  const receivers = new Map<string, { id: string | null; name: string; rows: PaymentRow[] }>();
  for (const r of rows) {
    const k = r.received_by ?? "__none";
    if (!receivers.has(k)) receivers.set(k, { id: r.received_by, name: r.received_by_name ?? "Not recorded (before day closings)", rows: [] });
    receivers.get(k)!.rows.push(r);
  }
  for (const o of open) if (o.received_by && !receivers.has(o.received_by)) receivers.set(o.received_by, { id: o.received_by, name: o.name ?? "—", rows: [] });
  const days = new Map<string, PaymentRow[]>();
  for (const r of rows) { const d = r.received_at.slice(0, 10); days.set(d, [...(days.get(d) ?? []), r]); }
  const visit = new Map<string, number>();
  for (const r of rows) visit.set(r.episode_type, round((visit.get(r.episode_type) ?? 0) + (r.type === "refund" ? -1 : 1) * Number(r.amount)));
  const billed = await dbSelect<{ department: string | null; billed: number }>(
    `SELECT COALESCE(NULLIF(department, ''), 'Other') AS department, SUM(amount) AS billed FROM hospital_charges
     WHERE tenant_id = ? AND deleted_at IS NULL AND charge_date BETWEEN ? AND ? GROUP BY COALESCE(NULLIF(department, ''), 'Other') ORDER BY billed DESC`,
    [t, range.from, range.to]
  );
  const outstanding = await dbSelect<FinanceOverview["outstanding"][number]>(
    `SELECT e.id AS episode_id, e.episode_no, p.name AS patient_name, p.mr_no, e.type, e.status,
       COALESCE((SELECT SUM(amount) FROM hospital_charges c WHERE c.episode_id = e.id AND c.deleted_at IS NULL), 0)
       - COALESCE((SELECT SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END) FROM hospital_payments pay WHERE pay.episode_id = e.id AND pay.deleted_at IS NULL), 0) AS balance
     FROM hospital_episodes e LEFT JOIN hospital_patients p ON p.id = e.patient_id
     WHERE e.tenant_id = ? AND e.deleted_at IS NULL AND e.status != 'cancelled'
     ORDER BY balance DESC LIMIT 500`,
    [t]
  );
  const owing = outstanding.filter((o) => o.balance > 0.5).map((o) => ({ ...o, balance: round(o.balance) }));
  const closings = await listClosings({});
  return {
    totals: totalsOf(rows),
    byReceiver: [...receivers.values()].map((r) => {
      const mine = open.filter((o) => o.received_by === r.id);
      return { id: r.id, name: r.name, totals: totalsOf(r.rows), openCash: expectedCash(totalsOf(mine)), openCount: mine.length };
    }).sort((x, y) => y.totals.net - x.totals.net),
    byDay: [...days.entries()].map(([day, r]) => ({ day, totals: totalsOf(r) })).sort((x, y) => y.day.localeCompare(x.day)),
    byVisitType: [...visit.entries()].map(([type, net]) => ({ type, net })),
    billedByDepartment: billed.map((b) => ({ department: b.department ?? "Other", billed: round(Number(b.billed)) })),
    billed: round(billed.reduce((s, b) => s + Number(b.billed), 0)),
    outstanding: owing.slice(0, 100),
    outstandingTotal: round(owing.reduce((s, o) => s + o.balance, 0)),
    closingsPending: closings.filter((c) => c.status === "submitted").length,
    closingsShort: closings.filter((c) => c.status === "submitted" && c.difference < 0).length,
  };
}

