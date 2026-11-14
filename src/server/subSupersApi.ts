/** The shared database as src/server/subSupers.ts uses it, and the two
 * action endpoints (owner and distributor). Each action is a named function;
 * anything else is refused. */
import { serverDb, HttpError, type ClientStatement } from "./db";
import * as ss from "./subSupers";
import type { Actor, Sql } from "./subSupers";

export function sqlForServer(): Sql {
  const db = serverDb();
  const plain = (v: unknown) => (typeof v === "bigint" ? Number(v) : v);
  return {
    async execute(sql, args = []) {
      const r = await db.execute({ sql, args: args as never[] });
      return { rows: r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, plain(row[i])]))), rowsAffected: r.rowsAffected };
    },
    async batch(statements: ClientStatement[]) {
      const rs = await db.batch(statements.map((s) => ({ sql: s.sql, args: (s.args ?? []) as never[] })), "write");
      return rs.map((r) => r.rowsAffected);
    },
    async transaction(fn) {
      const tx = await db.transaction("write");
      try {
        const out = await fn({
          async execute(sql, args = []) {
            const r = await tx.execute({ sql, args: args as never[] });
            return { rows: r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, plain(row[i])]))), rowsAffected: r.rowsAffected };
          },
        });
        await tx.commit();
        return out;
      } catch (e) {
        await tx.rollback().catch(() => undefined);
        throw e;
      } finally {
        tx.close();
      }
    },
  };
}

type Body = Record<string, unknown> & { action?: unknown };
const id = (b: Body) => {
  if (typeof b.id !== "string" || !b.id) throw new HttpError(400, "Missing id.");
  return b.id;
};

/** Platform owner (Super Admin) actions. */
export async function ownerAction(sql: Sql, a: Actor, b: Body, origin: string): Promise<unknown> {
  const link = (token: string) => `${origin}/set-password/?token=${encodeURIComponent(token)}`;
  switch (b.action) {
    case "listDistributors": return ss.listDistributors(sql, a);
    case "getDistributor": return ss.getDistributor(sql, a, id(b));
    case "createDistributor": {
      const r = await ss.createDistributor(sql, a, b as ss.DistributorInput);
      return { id: r.id, setupLink: link(r.setupToken) };
    }
    case "updateDistributor": return ss.updateDistributor(sql, a, id(b), b as ss.DistributorInput);
    case "setStatus": return ss.setDistributorStatus(sql, a, id(b), b.status === "active" ? "active" : "suspended", b.reason);
    case "setApps": return ss.setDistributorApps(sql, a, id(b), b.appIds);
    case "distributorLink": return { setupLink: link(await ss.issueDistributorSetupLink(sql, a, id(b))) };
    case "pending": return ss.pendingApprovals(sql, a);
    case "getRequest": return ss.getRequest(sql, a, id(b));
    case "startReview": return ss.startReview(sql, a, id(b));
    case "return": return ss.returnForCorrection(sql, a, id(b), b.reason);
    case "reject": return ss.rejectSetup(sql, a, id(b), b.reason);
    case "verifyPayment": return ss.verifyPayment(sql, a, id(b), b as { amount?: unknown; reference?: unknown; note?: unknown });
    case "activate": {
      const r = await ss.activate(sql, a, id(b));
      return { tenantId: r.tenantId, alreadyActivated: r.alreadyActivated, setupLink: r.setupToken ? link(r.setupToken) : null };
    }
    case "customerLink": return { setupLink: link(await ss.reissueCustomerLink(sql, a, id(b))) };
    case "report": return ss.salesReport(sql, a, { year: Number(b.year), appId: b.appId as string, subSuperId: b.subSuperId as string, rankBy: b.rankBy === "count" ? "count" : "amount" });
    default: throw new HttpError(400, "Unknown action.");
  }
}

/** Distributor actions: only their own records, whatever ids are sent. */
export async function distributorAction(sql: Sql, a: Actor, b: Body): Promise<unknown> {
  switch (b.action) {
    case "profile": return ss.myProfile(sql, a);
    case "requests": return ss.myRequests(sql, a);
    case "getRequest": return ss.myRequest(sql, a, id(b));
    case "saveDraft": return ss.saveDraft(sql, a, typeof b.id === "string" && b.id ? b.id : null, b as ss.SetupInput);
    case "submit": return ss.submitSetup(sql, a, id(b));
    case "report": return ss.salesReport(sql, a, { year: Number(b.year), appId: b.appId as string, rankBy: "amount" });
    default: throw new HttpError(400, "Unknown action.");
  }
}
