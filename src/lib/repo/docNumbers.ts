/** Bill and purchase numbers that are never shared or reused.
 *
 * The next number is the highest one the business ever used, deleted bills
 * included, plus one, so a deleted bill's number is not given out again.
 * Two cashiers saving at the same moment can still both read the same
 * highest number; right after saving, a document that finds an older one
 * with its number takes the next free number instead. */
import { dbExecute, dbSelect } from "../db";
import { requireCurrentTenantId } from "./base";
import { nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";

export interface NumberedDoc {
  table: "invoices" | "purchases";
  column: "invoice_no" | "purchase_no";
  /** Extra condition for the documents that share the number sequence. */
  scope: string;
}

export const INVOICE_NUMBERS: NumberedDoc = { table: "invoices", column: "invoice_no", scope: "COALESCE(is_quotation, 0) = 0" };
export const PURCHASE_NUMBERS: NumberedDoc = { table: "purchases", column: "purchase_no", scope: "1 = 1" };

/** The next number: one more than any the business ever used (deleted too). */
export async function nextDocNo(d: NumberedDoc): Promise<number> {
  const rows = await dbSelect<{ n: number | null }>(
    `SELECT MAX(${d.column}) AS n FROM ${d.table} WHERE tenant_id = ? AND ${d.scope}`,
    [requireCurrentTenantId()]
  );
  return (Number(rows[0]?.n) || 0) + 1;
}

/** After saving: if an older document has this one's number, take the next
 * free number. Returns the number the document keeps. */
export async function settleDocNo(d: NumberedDoc, id: string, no: number, createdAt: string): Promise<number> {
  const tenantId = requireCurrentTenantId();
  let current = no;
  for (let i = 0; i < 10; i++) {
    const others = await dbSelect<{ id: string; created_at: string }>(
      `SELECT id, created_at FROM ${d.table} WHERE tenant_id = ? AND ${d.column} = ? AND id != ? AND ${d.scope}`,
      [tenantId, current, id]
    );
    // The oldest document (then the smaller id) keeps the number.
    const olderExists = others.some((o) => o.created_at < createdAt || (o.created_at === createdAt && o.id < id));
    if (!olderExists) return current;
    current = await nextDocNo(d);
    const ts = nowIso();
    await dbExecute(`UPDATE ${d.table} SET ${d.column} = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [current, ts, id, tenantId]);
    const [row] = await dbSelect<Record<string, unknown>>(`SELECT * FROM ${d.table} WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
    if (row) await recordOutbox(d.table, id, "update", row);
  }
  return current;
}

/** A generated code (order no, booking no, token...) that must not be shared:
 * after saving, if an older record of the business has the same code (within
 * `scope`), this record takes a freshly generated one. */
export async function settleCode<V extends string | number>(o: {
  table: string;
  column: string;
  id: string;
  createdAt: string;
  value: V;
  scope?: { sql: string; params: unknown[] };
  regenerate: () => Promise<V>;
}): Promise<V> {
  const tenantId = requireCurrentTenantId();
  let current = o.value;
  for (let i = 0; i < 10; i++) {
    const older = await dbSelect<{ id: string }>(
      `SELECT id FROM ${o.table} WHERE tenant_id = ? AND ${o.column} = ? AND id != ? AND deleted_at IS NULL
         AND (created_at < ? OR (created_at = ? AND id < ?))${o.scope ? ` AND ${o.scope.sql}` : ""}`,
      [tenantId, current, o.id, o.createdAt, o.createdAt, o.id, ...(o.scope?.params ?? [])]
    );
    if (!older.length) return current;
    current = await o.regenerate();
    const ts = nowIso();
    await dbExecute(`UPDATE ${o.table} SET ${o.column} = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [current, ts, o.id, tenantId]);
    const [row] = await dbSelect<Record<string, unknown>>(`SELECT * FROM ${o.table} WHERE id = ? AND tenant_id = ?`, [o.id, tenantId]);
    if (row) await recordOutbox(o.table, o.id, "update", row);
  }
  return current;
}

/** A repository whose create settles a generated code (see settleCode). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Creating = { create: (d: any) => Promise<{ id: string; created_at: string }> };
type RowOf<R extends Creating> = Awaited<ReturnType<R["create"]>>;
export function settlingCreate<R extends Creating>(
  repo: R,
  table: string,
  column: keyof RowOf<R> & string,
  how: { regenerate: (row: RowOf<R>) => Promise<string | number>; scope?: (row: RowOf<R>) => { sql: string; params: unknown[] } }
): R {
  return {
    ...repo,
    async create(data: Parameters<R["create"]>[0]) {
      const created = (await repo.create(data)) as RowOf<R>;
      const value = (created as Record<string, unknown>)[column] as string | number | null;
      if (value == null) return created;
      const settled = await settleCode({
        table, column, id: created.id, createdAt: created.created_at, value,
        scope: how.scope?.(created), regenerate: () => how.regenerate(created),
      });
      return settled === value ? created : { ...created, [column]: settled };
    },
  };
}
