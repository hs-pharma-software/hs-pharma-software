/** Fees at the counters. The lab counter sees and collects only lab fees, the
 * radiology counter only radiology fees; the main reception sees everything.
 *
 * Collecting a visit's balance marks every test or scan it pays for as paid,
 * so the lab / radiology can start it and it leaves "Fees to collect". A fee
 * already covered by an earlier lump payment is marked paid without taking
 * the money twice. */
import { dbSelect } from "../db";
import { requireCurrentTenantId } from "./base";
import { localDateTime } from "../localDate";
import { currentActor, roleAllowed } from "./medicalRecord";
import { addPayment, hospitalImagingRepo, hospitalLabRepo } from "./hospital";
import { listUnpaidOrders, payOrderFee, listOpdQueue, type OpdQueueRow, type UnpaidOrderRow } from "./hospitalOpd";
import { getVisitReceipt, type VisitReceipt } from "./hospitalCare";
import { FEE_SCOPE_LAB_ROLES, FEE_SCOPE_IMAGING_ROLES } from "../../config/hospitalStaff";
import type { HospitalCharge, PaymentMethod } from "../types-hospital";

/** Which fees a desk works with: all of them, or only the lab's / radiology's. */
export type FeeScope = "all" | "lab" | "imaging";
export const FEE_SCOPE_LABEL: Record<FeeScope, string> = { all: "All fees", lab: "Lab fees", imaging: "Radiology fees" };

/** The desk of the signed-in user, and whether they may switch to another view. */
export async function feeScopeForCurrentUser(): Promise<{ scope: FeeScope; canChoose: boolean }> {
  const a = await currentActor();
  if (a.full) return { scope: "all", canChoose: true };
  if (roleAllowed(FEE_SCOPE_LAB_ROLES, { ...a, full: false })) return { scope: "lab", canChoose: false };
  if (roleAllowed(FEE_SCOPE_IMAGING_ROLES, { ...a, full: false })) return { scope: "imaging", canChoose: false };
  return { scope: "all", canChoose: true };
}

const inScope = (scope: FeeScope, kind: UnpaidOrderRow["kind"]) => scope === "all" || scope === kind;
const chargeInScope = (scope: FeeScope, c: Pick<HospitalCharge, "category">) => scope === "all" || c.category === scope;
const round = (n: number) => Math.round(n * 100) / 100;

export async function listUnpaidOrdersFor(scope: FeeScope): Promise<UnpaidOrderRow[]> {
  return (await listUnpaidOrders()).filter((o) => inScope(scope, o.kind));
}

export interface ScopedQueueRow extends OpdQueueRow {
  /** What this desk has to collect on the visit. */
  due: number;
}

/** Today's OPD with the amount due for this desk: the whole bill at the main
 * reception, the unpaid lab (or radiology) fees at that counter. */
export async function opdQueueFor(scope: FeeScope, opts: Parameters<typeof listOpdQueue>[0] = {}): Promise<ScopedQueueRow[]> {
  const rows = await listOpdQueue(opts);
  if (scope === "all") return rows.map((r) => ({ ...r, due: round(r.charges - r.paid) }));
  const unpaid = await listUnpaidOrdersFor(scope);
  return rows.map((r) => ({ ...r, due: round(unpaid.filter((o) => o.episode_id === r.id).reduce((t, o) => t + Number(o.fee), 0)) }));
}

interface OrderFee { kind: "lab" | "imaging"; id: string; order_no: string; charge_id: string | null; fee: number; paid: number; ordered_at: string }

async function visitOrders(episodeId: string): Promise<OrderFee[]> {
  const t = requireCurrentTenantId();
  return dbSelect<OrderFee>(
    `SELECT 'lab' AS kind, id, order_no, charge_id, fee, COALESCE(paid, 0) AS paid, ordered_at FROM hospital_lab_orders
       WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL AND status != 'cancelled' AND fee > 0
     UNION ALL
     SELECT 'imaging' AS kind, id, order_no, charge_id, fee, COALESCE(paid, 0) AS paid, ordered_at FROM hospital_imaging_orders
       WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL AND status != 'cancelled' AND fee > 0
     ORDER BY ordered_at ASC`,
    [t, episodeId, t, episodeId]
  );
}

export interface ScopedReceipt extends VisitReceipt {
  scope: FeeScope;
  /** Charge id -> paid / unpaid, for the charges of a test or scan. */
  chargePaid: Record<string, boolean>;
}

/** The visit's receipt for this desk: at a counter, only its own charges, each
 * marked paid or unpaid, and the balance of those. */
export async function visitReceiptFor(episodeId: string, scope: FeeScope): Promise<ScopedReceipt> {
  const [r, orders] = await Promise.all([getVisitReceipt(episodeId), visitOrders(episodeId)]);
  const chargePaid: Record<string, boolean> = {};
  for (const o of orders) if (o.charge_id) chargePaid[o.charge_id] = o.paid === 1;
  if (scope === "all") return { ...r, scope, chargePaid };
  const charges = r.charges.filter((c) => chargeInScope(scope, c));
  const ids = new Set(orders.filter((o) => o.kind === scope).map((o) => o.order_no));
  const total = round(charges.reduce((t, c) => t + Number(c.amount), 0));
  const due = round(orders.filter((o) => o.kind === scope && o.paid !== 1).reduce((t, o) => t + Number(o.fee), 0));
  return {
    ...r, scope, chargePaid, charges,
    payments: r.payments.filter((p) => p.reference && ids.has(p.reference)),
    total, due, paid: round(total - due),
  };
}

/** Collects what this desk is owed on a visit and marks each test / scan paid.
 * Returns the amount actually taken. */
export async function collectVisitFees(episodeId: string, scope: FeeScope, method: PaymentMethod): Promise<number> {
  const receipt = await getVisitReceipt(episodeId);
  const orders = (await visitOrders(episodeId)).filter((o) => o.paid !== 1);
  // Money already taken for tests / scans in an earlier lump payment: mark those paid first, without charging again.
  let covered = round(orders.reduce((t, o) => t + Number(o.fee), 0) - Math.max(0, receipt.due));
  let taken = 0;
  let settled = 0;
  for (const o of orders) {
    const repo = o.kind === "lab" ? hospitalLabRepo : hospitalImagingRepo;
    if (covered >= Number(o.fee)) {
      await repo.update(o.id, { paid: 1 });
      covered = round(covered - Number(o.fee));
      settled++;
      continue;
    }
    if (!inScope(scope, o.kind)) continue;
    await payOrderFee(o.kind, o.id, method);
    taken = round(taken + Number(o.fee));
  }
  if (scope === "all") {
    const rest = (await getVisitReceipt(episodeId)).due;
    if (rest > 0) {
      await addPayment({ tenant_id: "", episode_id: episodeId, type: "payment", amount: rest, method, reference: receipt.episode.episode_no, notes: "Balance paid at reception", received_at: localDateTime() });
      taken = round(taken + rest);
    }
  }
  if (!taken && !settled) throw new Error(scope === "all" ? "Nothing is due on this visit." : `No ${scope === "lab" ? "lab" : "radiology"} fee is due on this visit.`);
  return taken;
}
