/** Store indents (v104).
 *
 * The purchase officer orders an indent book for a head nurse or department
 * in-charge; a store keeper issues it, and "Indent Book" then appears in the
 * holder's sidebar. With it the holder demands items from a store. The store
 * keeper issues them (out of the store's stock, in its register). The holder
 * confirms what was received (a comment when it is less) or returns items;
 * the store keeper accepts a return back into stock, or refuses it. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";
import { currentActor, type Actor } from "./medicalRecord";
import { staffRepo } from "./staff";
import { usersRepo } from "./users";
import { updateUserPermissions } from "../auth";
import { myStores, storeStockRepo } from "./hospitalStores";
import { localDate } from "../localDate";
import { isStoreId, storeLabel, type StoreId } from "../../config/hospitalStores";

export const INDENT_KEY = "hospital_indent";

export interface IndentBook extends TenantRow {
  book_no: string; holder_staff_id: string; holder_name: string | null; department: string | null; status: "requested" | "issued" | "closed";
  requested_by_name: string | null; requested_at: string | null; issued_by_name: string | null; issued_at: string | null; note: string | null;
}
export type IndentStatus = "pending" | "issued" | "received" | "cancelled";
export interface Indent extends TenantRow {
  indent_no: string; book_id: string; store: StoreId; department: string | null; requested_by_staff_id: string | null; requested_by_name: string | null;
  status: IndentStatus; note: string | null; issued_by_name: string | null; issued_at: string | null; received_at: string | null; received_by_name?: string | null;
}
export interface IndentItem extends TenantRow {
  indent_id: string; product_id: string | null; product_name: string; company_name: string | null; qty_requested: number; qty_issued: number | null;
  qty_received: number | null; received_note: string | null; return_qty: number | null; return_status: "pending" | "accepted" | "refused" | null;
  return_note: string | null; return_decided_by_name: string | null;
}
export const indentBooksRepo = createTenantRepo<IndentBook>("hospital_indent_books");
export const indentsRepo = createTenantRepo<Indent>("hospital_indents");
export const indentItemsRepo = createTenantRepo<IndentItem>("hospital_indent_items");

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const who = (a: Actor) => (a.designation ? `${a.name}, ${a.designation}` : a.name);
const rolesOf = (a: Actor) => (a.roles?.length ? a.roles : [a.role ?? ""]);

async function nextNo(table: string, column: string, prefix: string): Promise<string> {
  const rows = await dbSelect<{ n: number | null }>(
    `SELECT MAX(CAST(substr(${column}, ${prefix.length + 2}) AS INTEGER)) AS n FROM ${table} WHERE tenant_id = ? AND ${column} GLOB '${prefix}-[0-9]*'`, [requireCurrentTenantId()]
  );
  return `${prefix}-${String((Number(rows[0]?.n) || 0) + 1).padStart(4, "0")}`;
}

async function meStaff(a: Actor) {
  return a.userId ? (await staffRepo.list({ where: "user_id = ?", params: [a.userId] }))[0] ?? null : null;
}

// ── Indent books ─────────────────────────────────────────────────────────

/** The purchase officer orders an indent book for a head nurse / department in-charge. */
export async function requestIndentBook(holderStaffId: string, note?: string | null): Promise<IndentBook> {
  const a = await currentActor();
  if (!a.full && !rolesOf(a).includes("purchase_officer")) throw new Error("Indent books are ordered by the purchase officer.");
  const holder = await staffRepo.get(holderStaffId);
  if (!holder) throw new Error("Choose the head nurse or department in-charge.");
  const open = await indentBooksRepo.list({ where: "holder_staff_id = ? AND status IN ('requested', 'issued')", params: [holderStaffId] });
  if (open.length) throw new Error(`${holder.name} already has indent book ${open[0].book_no}.`);
  return indentBooksRepo.create({
    book_no: await nextNo("hospital_indent_books", "book_no", "IB"), holder_staff_id: holder.id, holder_name: holder.name, department: holder.department ?? null,
    status: "requested", requested_by_name: who(a), requested_at: new Date().toISOString(), note: note?.trim() || null,
  });
}

export async function listIndentBooks(status?: IndentBook["status"]): Promise<IndentBook[]> {
  return indentBooksRepo.list({ ...(status ? { where: "status = ?", params: [status] } : {}), orderBy: "created_at DESC" });
}

/** A store keeper issues the book: its holder's login now shows Indent Book. */
export async function issueIndentBook(bookId: string): Promise<IndentBook> {
  const a = await currentActor();
  if (!(await myStores()).length) throw new Error("Indent books are issued by a store keeper.");
  const b = await indentBooksRepo.get(bookId);
  if (!b || b.status !== "requested") throw new Error("This indent book is not waiting to be issued.");
  const holder = await staffRepo.get(b.holder_staff_id);
  if (holder?.user_id) {
    const u = await usersRepo.get(holder.user_id);
    let perms: string[] | null = null;
    try { perms = u?.permissions ? (JSON.parse(u.permissions) as string[]) : null; } catch { perms = null; }
    if (perms && !perms.includes(INDENT_KEY)) await updateUserPermissions(holder.user_id, [...perms, INDENT_KEY]);
  }
  return (await indentBooksRepo.update(bookId, { status: "issued", issued_by_name: who(a), issued_at: new Date().toISOString() }))!;
}

/** The signed-in person's issued indent book. */
export async function myIndentBook(): Promise<IndentBook | null> {
  const a = await currentActor();
  const me = await meStaff(a);
  if (!me) return null;
  return (await indentBooksRepo.list({ where: "holder_staff_id = ? AND status = 'issued'", params: [me.id] }))[0] ?? null;
}

// ── Indents ──────────────────────────────────────────────────────────────

/** The holder of an issued indent book demands items from a store. */
export async function createIndent(x: { store: StoreId; note?: string | null; items: { productId?: string | null; productName: string; companyName?: string | null; qty: number }[] }): Promise<Indent> {
  const a = await currentActor();
  const book = await myIndentBook();
  if (!book) throw new Error("You need an indent book issued by the store to demand items.");
  if (!isStoreId(x.store)) throw new Error("Choose the store.");
  const items = x.items.filter((i) => i.productName?.trim());
  if (!items.length) throw new Error("Add at least one item.");
  for (const i of items) if (!(Number(i.qty) > 0)) throw new Error(`Enter the quantity of ${i.productName}.`);
  const me = await meStaff(a);
  const indent = await indentsRepo.create({
    indent_no: await nextNo("hospital_indents", "indent_no", "IND"), book_id: book.id, store: x.store, department: book.department,
    requested_by_staff_id: me?.id ?? null, requested_by_name: who(a), status: "pending", note: x.note?.trim() || null,
  });
  for (const i of items) {
    await indentItemsRepo.create({ indent_id: indent.id, product_id: i.productId ?? null, product_name: i.productName.trim(), company_name: i.companyName ?? null, qty_requested: round3(Number(i.qty)) });
  }
  return indent;
}

export interface IndentWithItems extends Indent { items: IndentItem[] }

async function withItems(rows: Indent[]): Promise<IndentWithItems[]> {
  if (!rows.length) return [];
  const items = await dbSelect<IndentItem>(
    `SELECT * FROM hospital_indent_items WHERE tenant_id = ? AND deleted_at IS NULL AND indent_id IN (${rows.map(() => "?").join(", ")}) ORDER BY created_at`,
    [requireCurrentTenantId(), ...rows.map((r) => r.id)]
  );
  return rows.map((r) => ({ ...r, items: items.filter((i) => i.indent_id === r.id) }));
}

/** A store's indents (to issue, issued, with returns waiting). */
export async function storeIndents(store: StoreId): Promise<IndentWithItems[]> {
  if (!(await myStores()).includes(store)) throw new Error(`You do not work in the ${storeLabel(store)}.`);
  return withItems(await indentsRepo.list({ where: "store = ? AND status != 'cancelled'", params: [store], orderBy: "created_at DESC" }));
}

/** The signed-in holder's indents. */
export async function myIndents(): Promise<IndentWithItems[]> {
  const a = await currentActor();
  const me = await meStaff(a);
  if (!me) return [];
  return withItems(await indentsRepo.list({ where: "requested_by_staff_id = ?", params: [me.id], orderBy: "created_at DESC" }));
}

/** What the store holds of an item now, and its average cost. */
async function onHand(store: StoreId, productId: string | null, name: string): Promise<{ qty: number; cost: number }> {
  const r = (await dbSelect<{ qty: number | null; value: number | null }>(
    `SELECT SUM(qty) AS qty, SUM(qty * unit_cost) AS value FROM hospital_store_stock WHERE tenant_id = ? AND store = ? AND deleted_at IS NULL
       AND ${productId ? "product_id = ?" : "product_id IS NULL AND LOWER(product_name) = LOWER(?)"}`,
    [requireCurrentTenantId(), store, productId ?? name]
  ))[0];
  const qty = Number(r?.qty) || 0;
  return { qty: round3(qty), cost: qty > 0 ? Math.round(((Number(r?.value) || 0) / qty) * 100) / 100 : 0 };
}

/** The store keeper issues the indent (default: as demanded); the items leave the store's stock. */
export async function issueIndent(indentId: string, issued: Record<string, number> = {}): Promise<Indent> {
  const ind = await indentsRepo.get(indentId);
  if (!ind || ind.status !== "pending") throw new Error("This indent is not waiting to be issued.");
  if (!(await myStores()).includes(ind.store)) throw new Error(`You do not work in the ${storeLabel(ind.store)}.`);
  const a = await currentActor();
  const items = await indentItemsRepo.list({ where: "indent_id = ?", params: [indentId] });
  const today = localDate();
  // Every item is checked before anything is issued: a refused line leaves the indent untouched.
  const plan: { it: IndentItem; qty: number; have: { qty: number; cost: number } }[] = [];
  const planned = new Map<string, { qty: number; have: { qty: number; cost: number } }>();
  for (const it of items) {
    const qty = round3(issued[it.id] ?? Number(it.qty_requested));
    if (!(qty >= 0) || qty > Number(it.qty_requested) + 1e-9) throw new Error(`Issue between 0 and ${it.qty_requested} of ${it.product_name}.`);
    const key = it.product_id ? `id:${it.product_id}` : `name:${it.product_name.replace(/[A-Z]/g, (c) => c.toLowerCase())}`;
    const previous = planned.get(key);
    const have = previous?.have ?? await onHand(ind.store, it.product_id, it.product_name);
    const total = round3((previous?.qty ?? 0) + qty);
    if (total > have.qty + 1e-9) throw new Error(`Only ${have.qty} of ${it.product_name} in the ${storeLabel(ind.store)}.`);
    planned.set(key, { qty: total, have });
    plan.push({ it, qty, have });
  }
  for (const { it, qty, have } of plan) {
    await indentItemsRepo.update(it.id, { qty_issued: qty });
    if (qty > 0) {
      await storeStockRepo.create({
        store: ind.store, product_id: it.product_id, product_name: it.product_name, company_name: it.company_name, vendor_id: null, qty: -qty, unit_cost: have.cost,
        kind: "issue", ref_type: "indent", ref_id: indentId, entry_no: ind.indent_no, date: today, notes: [ind.department, ind.requested_by_name].filter(Boolean).join(" · ") || null, by_name: who(a),
      });
    }
  }
  return (await indentsRepo.update(indentId, { status: "issued", issued_by_name: who(a), issued_at: new Date().toISOString() }))!;
}

/** The holder confirms what was received (default: as issued); a shortfall needs a comment. */
export async function receiveIndent(indentId: string, received: Record<string, { qty: number; note?: string | null }> = {}): Promise<Indent> {
  const ind = await indentsRepo.get(indentId);
  if (!ind || ind.status !== "issued") throw new Error("This indent has not been issued yet.");
  const a = await currentActor();
  const me = await meStaff(a);
  if (!a.full && me?.id !== ind.requested_by_staff_id) throw new Error("Only the person who demanded it confirms the receipt.");
  const checked: { id: string; qty: number; note: string | null }[] = [];
  for (const it of await indentItemsRepo.list({ where: "indent_id = ?", params: [indentId] })) {
    const r = received[it.id];
    const qty = round3(r?.qty ?? Number(it.qty_issued ?? 0));
    if (!(qty >= 0) || qty > Number(it.qty_issued ?? 0) + 1e-9) throw new Error(`Received between 0 and ${it.qty_issued ?? 0} of ${it.product_name}.`);
    if (qty < Number(it.qty_issued ?? 0) && !r?.note?.trim()) throw new Error(`Write why less ${it.product_name} was received.`);
    checked.push({ id: it.id, qty, note: r?.note?.trim() || null });
  }
  for (const c of checked) await indentItemsRepo.update(c.id, { qty_received: c.qty, received_note: c.note });
  return (await indentsRepo.update(indentId, { status: "received", received_at: new Date().toISOString(), received_by_name: who(a) }))!;
}

/** The holder returns received items to the store, with the reason; the store keeper decides. */
export async function returnIndentItems(indentId: string, returns: Record<string, { qty: number; note: string }>): Promise<number> {
  const ind = await indentsRepo.get(indentId);
  if (!ind || ind.status !== "received") throw new Error("Confirm the receipt before returning items.");
  const a = await currentActor();
  const me = await meStaff(a);
  if (!a.full && me?.id !== ind.requested_by_staff_id) throw new Error("Only the person who demanded it returns items.");
  const checked: { id: string; qty: number; note: string }[] = [];
  for (const it of await indentItemsRepo.list({ where: "indent_id = ?", params: [indentId] })) {
    const r = returns[it.id];
    if (!r || !(Number(r.qty) > 0)) continue;
    if (it.return_status === "pending") throw new Error(`A return of ${it.product_name} is already waiting for the store.`);
    const already = it.return_status === "accepted" ? Number(it.return_qty ?? 0) : 0;
    if (Number(r.qty) > Number(it.qty_received ?? 0) - already + 1e-9) throw new Error(`Return at most ${round3(Number(it.qty_received ?? 0) - already)} of ${it.product_name}.`);
    if (!r.note?.trim()) throw new Error(`Write why ${it.product_name} is returned.`);
    checked.push({ id: it.id, qty: round3(Number(r.qty) + already), note: r.note.trim() });
  }
  if (!checked.length) throw new Error("Enter what is returned.");
  for (const c of checked) await indentItemsRepo.update(c.id, { return_qty: c.qty, return_status: "pending", return_note: c.note, return_decided_by_name: null });
  return checked.length;
}

/** The store keeper accepts a return back into stock, or refuses it. The holder sees the status. */
export async function decideIndentReturn(itemId: string, accept: boolean): Promise<IndentItem> {
  const it = await indentItemsRepo.get(itemId);
  if (!it || it.return_status !== "pending") throw new Error("No return of this item is waiting.");
  const ind = (await indentsRepo.get(it.indent_id))!;
  if (!(await myStores()).includes(ind.store)) throw new Error(`You do not work in the ${storeLabel(ind.store)}.`);
  const a = await currentActor();
  const prior = await dbSelect<{ q: number | null }>(
    `SELECT SUM(qty) AS q FROM hospital_store_stock WHERE tenant_id = ? AND ref_type = 'indent_return' AND ref_id = ? AND deleted_at IS NULL`, [requireCurrentTenantId(), itemId]
  );
  const qty = round3(Number(it.return_qty ?? 0) - (Number(prior[0]?.q) || 0));
  if (accept && qty > 0) {
    const cost = (await dbSelect<{ c: number | null }>(
      `SELECT unit_cost AS c FROM hospital_store_stock WHERE tenant_id = ? AND ref_type = 'indent' AND ref_id = ? AND product_name = ? AND deleted_at IS NULL LIMIT 1`,
      [requireCurrentTenantId(), ind.id, it.product_name]
    ))[0];
    await storeStockRepo.create({
      store: ind.store, product_id: it.product_id, product_name: it.product_name, company_name: it.company_name, vendor_id: null, qty, unit_cost: Number(cost?.c) || 0,
      kind: "return_in", ref_type: "indent_return", ref_id: itemId, entry_no: ind.indent_no, date: localDate(), notes: it.return_note, by_name: who(a),
    });
  }
  return (await indentItemsRepo.update(itemId, accept
    ? { return_status: "accepted", return_decided_by_name: who(a) }
    : { return_status: "refused", return_qty: round3(Number(it.return_qty ?? 0) - qty), return_decided_by_name: who(a) }))!;
}
