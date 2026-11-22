/** The website's money pages for the MAVIN Business app:
 * - Customers / Suppliers: Outstanding (components/ledger/OutstandingPage.tsx)
 *   and the party's ledger with an Adjustment (PartyLedgerPage.tsx);
 * - Cash Register (app/cash-register): Payment In / Payment Out;
 * - Expenses (components/ui/CategorizedEntryPage.tsx).
 * The same tables and rules as the web, through `run` (runForCaller in
 * production: policy, business and branch scoping, audit). New entries carry
 * an id chosen by the app, so sending one twice saves it once. */
import { HttpError } from "./db";
import { pkToday, type Res, type Runner } from "./appDocs";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

type Row = Record<string, unknown>;
const rowsOf = (r: Res | undefined): Row[] => (r ? r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) : []);
const num = (v: unknown) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const strOrNull = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DOC_ID = /^[A-Za-z0-9-]{16,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 50;

export type PartyKind = "customer" | "supplier";
const tableOf = (k: PartyKind) => (k === "customer" ? "customers" : "suppliers");
/** Unpaid bills of a party: invoices (not quotations) or purchases, returns netted out. */
const tradeOf = (k: PartyKind) =>
  k === "customer"
    ? `COALESCE((SELECT SUM(CASE WHEN is_return = 0 THEN balance ELSE -balance END) FROM invoices WHERE customer_id = p.id AND tenant_id = ? AND deleted_at IS NULL AND is_quotation = 0), 0)`
    : `COALESCE((SELECT SUM(CASE WHEN is_return = 0 THEN balance ELSE -balance END) FROM purchases WHERE supplier_id = p.id AND tenant_id = ? AND deleted_at IS NULL), 0)`;
const adjustedOf = `COALESCE((SELECT SUM(paid_amount) FROM ledger_adjustments WHERE tenant_id = ? AND party_type = ? AND party_id = p.id AND deleted_at IS NULL), 0)`;

export interface PartyBalance { id: string; name: string; phone: string | null; opening: number; adjusted: number; balance: number }

/** Outstanding: every customer (or supplier) with Opening Balance, Total Adjusted and Current Balance (opening + unpaid bills - adjustments). */
export async function partyBalances(run: Runner, tenantId: string, kind: PartyKind, search: string | null, onlyDue: boolean): Promise<{ rows: PartyBalance[]; total: number; count: number }> {
  const term = (search ?? "").trim().slice(0, 60);
  const like = `%${term}%`;
  const [r] = await run([{
    sql: `SELECT * FROM (
            SELECT p.id, p.name, p.phone, COALESCE(p.opening_balance, 0) AS opening,
                   ${adjustedOf} AS adjusted,
                   COALESCE(p.opening_balance, 0) + ${tradeOf(kind)} - ${adjustedOf} AS balance
            FROM ${tableOf(kind)} p
            WHERE p.deleted_at IS NULL AND p.tenant_id = ? ${term ? "AND (p.name LIKE ? OR p.phone LIKE ?)" : ""}
          ) ${onlyDue ? "WHERE ABS(balance) > 0.004" : ""}
          ORDER BY ${onlyDue ? "balance DESC" : "name COLLATE NOCASE ASC"}
          LIMIT 500`,
    args: [tenantId, kind, tenantId, tenantId, kind, tenantId, ...(term ? [like, like] : [])],
  }], false);
  const rows = rowsOf(r).map((x) => ({ id: String(x.id), name: String(x.name ?? ""), phone: strOrNull(x.phone), opening: r2(num(x.opening)), adjusted: r2(num(x.adjusted)), balance: r2(num(x.balance)) }));
  return { rows, total: r2(rows.reduce((t, x) => t + x.balance, 0)), count: rows.length };
}

export interface PartyLedger {
  party: PartyBalance & { address: string | null };
  /** Bills with something still to pay (or a credit), newest first. */
  bills: { id: string; no: number | null; date: string; payable: number; paid: number; balance: number; isReturn: boolean }[];
  adjustments: { id: string; date: string; method: string | null; amount: number; comment: string | null }[];
}

/** One customer's (or supplier's) account: balance, unpaid bills and the adjustments (payments) recorded. */
export async function partyLedger(run: Runner, tenantId: string, kind: PartyKind, id: string): Promise<PartyLedger> {
  if (!ID.test(id)) throw new HttpError(400, "Invalid party.");
  const bills = kind === "customer"
    ? `SELECT id, invoice_no AS no, date, payable, paid, balance, is_return FROM invoices WHERE customer_id = ? AND tenant_id = ? AND deleted_at IS NULL AND is_quotation = 0 AND ABS(balance) > 0.004 ORDER BY date DESC, created_at DESC LIMIT 200`
    : `SELECT id, purchase_no AS no, date, payable, paid_amount AS paid, balance, is_return FROM purchases WHERE supplier_id = ? AND tenant_id = ? AND deleted_at IS NULL AND ABS(balance) > 0.004 ORDER BY date DESC, created_at DESC LIMIT 200`;
  const [p, b, a] = await run([
    { sql: `SELECT p.id, p.name, p.phone, p.address, COALESCE(p.opening_balance, 0) AS opening, ${adjustedOf} AS adjusted,
                   COALESCE(p.opening_balance, 0) + ${tradeOf(kind)} - ${adjustedOf} AS balance
            FROM ${tableOf(kind)} p WHERE p.id = ? AND p.tenant_id = ? AND p.deleted_at IS NULL`,
      args: [tenantId, kind, tenantId, tenantId, kind, id, tenantId] },
    { sql: bills, args: [id, tenantId] },
    { sql: `SELECT id, date, payment_method, paid_amount, comment FROM ledger_adjustments WHERE tenant_id = ? AND party_type = ? AND party_id = ? AND deleted_at IS NULL ORDER BY date DESC, created_at DESC LIMIT 200`, args: [tenantId, kind, id] },
  ], false);
  const x = rowsOf(p)[0];
  if (!x) throw new HttpError(404, `This ${kind} was not found.`);
  return {
    party: { id: String(x.id), name: String(x.name ?? ""), phone: strOrNull(x.phone), address: strOrNull(x.address), opening: r2(num(x.opening)), adjusted: r2(num(x.adjusted)), balance: r2(num(x.balance)) },
    bills: rowsOf(b).map((y) => ({ id: String(y.id), no: y.no == null ? null : num(y.no), date: String(y.date ?? ""), payable: r2(num(y.payable)), paid: r2(num(y.paid)), balance: r2(num(y.balance)), isReturn: num(y.is_return) === 1 })),
    adjustments: rowsOf(a).map((y) => ({ id: String(y.id), date: String(y.date ?? ""), method: strOrNull(y.payment_method), amount: r2(num(y.paid_amount)), comment: strOrNull(y.comment) })),
  };
}

/** The ledger's "Add Adjustments": a payment received from a customer (or paid to a supplier) that lowers the balance. */
export async function addAdjustment(run: Runner, tenantId: string, kind: PartyKind, raw: unknown): Promise<{ id: string; duplicate: boolean }> {
  const b = (raw ?? {}) as { id?: unknown; partyId?: unknown; amount?: unknown; method?: unknown; comment?: unknown };
  if (typeof b.id !== "string" || !DOC_ID.test(b.id)) throw new HttpError(400, "Missing or invalid entry id.");
  if (typeof b.partyId !== "string" || !ID.test(b.partyId)) throw new HttpError(400, `Choose the ${kind}.`);
  const amount = Number(b.amount);
  if (!(amount > 0) || !Number.isFinite(amount)) throw new HttpError(400, "Enter the paid amount.");
  const method = b.method === "Bank" ? "Bank" : "Cash";
  const [dup, party] = await run([
    { sql: `SELECT id FROM ledger_adjustments WHERE id = ? AND tenant_id = ?`, args: [b.id, tenantId] },
    { sql: `SELECT id FROM ${tableOf(kind)} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, args: [b.partyId, tenantId] },
  ], false);
  if (rowsOf(dup)[0]) return { id: b.id, duplicate: true };
  if (!rowsOf(party)[0]) throw new HttpError(404, `This ${kind} was not found.`);
  const now = new Date().toISOString();
  await run([{
    sql: `INSERT INTO ledger_adjustments (id, tenant_id, party_type, party_id, date, invoice_no, balance_type, payment_method, paid_amount, comment, sms_sent, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, 'adjustment', ?, ?, ?, 0, ?, ?)`,
    args: [b.id, tenantId, kind, b.partyId, pkToday(), method, r2(amount), strOrNull(b.comment), now, now],
  }], true);
  return { id: b.id, duplicate: false };
}

// ── Cash Register ─────────────────────────────────────────────────────────

export interface CashPage {
  rows: { id: string; date: string; type: "in" | "out"; amount: number; description: string | null }[];
  nextOffset: number | null;
  /** All entries, as the web's footer: Cash In, Cash Out, Closing Cash. */
  cashIn: number; cashOut: number; closing: number;
}

export async function cashRegister(run: Runner, tenantId: string, offset = 0): Promise<CashPage> {
  const off = Math.max(0, Math.floor(offset));
  const [r, t] = await run([
    { sql: `SELECT id, date, transaction_type, amount, description FROM cash_register_entries WHERE deleted_at IS NULL AND tenant_id = ? ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`, args: [tenantId, PAGE + 1, off] },
    { sql: `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'in' THEN amount ELSE 0 END), 0) AS cin, COALESCE(SUM(CASE WHEN transaction_type = 'out' THEN amount ELSE 0 END), 0) AS cout FROM cash_register_entries WHERE deleted_at IS NULL AND tenant_id = ?`, args: [tenantId] },
  ], false);
  const rows = rowsOf(r);
  const tt = rowsOf(t)[0] ?? {};
  return {
    rows: rows.slice(0, PAGE).map((x) => ({ id: String(x.id), date: String(x.date ?? ""), type: x.transaction_type === "out" ? "out" : "in", amount: r2(num(x.amount)), description: strOrNull(x.description) })),
    nextOffset: rows.length > PAGE ? off + PAGE : null,
    cashIn: r2(num(tt.cin)), cashOut: r2(num(tt.cout)), closing: r2(num(tt.cin) - num(tt.cout)),
  };
}

/** "Add Cash": Payment In or Payment Out, today. */
export async function addCash(run: Runner, tenantId: string, raw: unknown): Promise<{ id: string; duplicate: boolean }> {
  const b = (raw ?? {}) as { id?: unknown; type?: unknown; amount?: unknown; description?: unknown };
  if (typeof b.id !== "string" || !DOC_ID.test(b.id)) throw new HttpError(400, "Missing or invalid entry id.");
  if (b.type !== "in" && b.type !== "out") throw new HttpError(400, "Choose Payment In or Payment Out.");
  const amount = Number(b.amount);
  if (!(amount > 0) || !Number.isFinite(amount)) throw new HttpError(400, "Enter the amount.");
  const [dup] = await run([{ sql: `SELECT id FROM cash_register_entries WHERE id = ? AND tenant_id = ?`, args: [b.id, tenantId] }], false);
  if (rowsOf(dup)[0]) return { id: b.id, duplicate: true };
  const now = new Date().toISOString();
  await run([{ sql: `INSERT INTO cash_register_entries (id, tenant_id, date, transaction_type, amount, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [b.id, tenantId, pkToday(), b.type, r2(amount), strOrNull(b.description), now, now] }], true);
  return { id: b.id, duplicate: false };
}

// ── Expenses ──────────────────────────────────────────────────────────────

export interface ExpensePage {
  rows: { id: string; date: string; category: string | null; amount: number; method: string | null; by: string | null; description: string | null }[];
  nextOffset: number | null;
  total: number;
  categories: { id: string; name: string }[];
}

export async function expenses(run: Runner, tenantId: string, q: { from?: string | null; to?: string | null; offset?: number }): Promise<ExpensePage> {
  const from = q.from && DATE.test(q.from) ? q.from : null;
  const to = q.to && DATE.test(q.to) ? q.to : null;
  if ((q.from && !from) || (q.to && !to)) throw new HttpError(400, "Invalid date.");
  const off = Math.max(0, Math.floor(q.offset ?? 0));
  const where = `e.deleted_at IS NULL AND e.tenant_id = ?${from ? " AND e.date >= ?" : ""}${to ? " AND e.date <= ?" : ""}`;
  const args = [tenantId, ...(from ? [from] : []), ...(to ? [to] : [])];
  const [r, t, c] = await run([
    { sql: `SELECT e.id, e.date, c.name AS category, e.amount, e.payment_method, e.expense_by, e.description FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id WHERE ${where} ORDER BY e.date DESC, e.created_at DESC LIMIT ? OFFSET ?`, args: [...args, PAGE + 1, off] },
    { sql: `SELECT COALESCE(SUM(e.amount), 0) AS n FROM expenses e WHERE ${where}`, args },
    { sql: `SELECT id, name FROM expense_categories WHERE deleted_at IS NULL AND tenant_id = ? ORDER BY name COLLATE NOCASE`, args: [tenantId] },
  ], false);
  const rows = rowsOf(r);
  return {
    rows: rows.slice(0, PAGE).map((x) => ({ id: String(x.id), date: String(x.date ?? ""), category: strOrNull(x.category), amount: r2(num(x.amount)), method: strOrNull(x.payment_method), by: strOrNull(x.expense_by), description: strOrNull(x.description) })),
    nextOffset: rows.length > PAGE ? off + PAGE : null,
    total: r2(num(rowsOf(t)[0]?.n)),
    categories: rowsOf(c).map((x) => ({ id: String(x.id), name: String(x.name ?? "") })),
  };
}

/** The web's expense form: Category, Amount, Payment Method, Expense By, Description; today. */
export async function addExpense(run: Runner, tenantId: string, raw: unknown): Promise<{ id: string; duplicate: boolean }> {
  const b = (raw ?? {}) as { id?: unknown; categoryId?: unknown; amount?: unknown; method?: unknown; by?: unknown; description?: unknown };
  if (typeof b.id !== "string" || !DOC_ID.test(b.id)) throw new HttpError(400, "Missing or invalid entry id.");
  if (typeof b.categoryId !== "string" || !ID.test(b.categoryId)) throw new HttpError(400, "Choose the category.");
  const amount = Number(b.amount);
  if (!(amount > 0) || !Number.isFinite(amount)) throw new HttpError(400, "Enter the amount.");
  const [dup, cat] = await run([
    { sql: `SELECT id FROM expenses WHERE id = ? AND tenant_id = ?`, args: [b.id, tenantId] },
    { sql: `SELECT id FROM expense_categories WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, args: [b.categoryId, tenantId] },
  ], false);
  if (rowsOf(dup)[0]) return { id: b.id, duplicate: true };
  if (!rowsOf(cat)[0]) throw new HttpError(400, "That category was not found.");
  const now = new Date().toISOString();
  await run([{
    sql: `INSERT INTO expenses (id, tenant_id, date, category_id, expense_by, amount, payment_method, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [b.id, tenantId, pkToday(), b.categoryId, strOrNull(b.by, 120), r2(amount), b.method === "Bank" ? "Bank" : "Cash", strOrNull(b.description), now, now],
  }], true);
  return { id: b.id, duplicate: false };
}
