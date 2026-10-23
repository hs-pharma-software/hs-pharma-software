/** Distributor tests: full app schema (v1..v30) in memory, switchable sessions. */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { createDistStore, type DistContext, type DistDb } from "../../src/lib/dist/store.ts";

export function makeDist() {
  const sql: DatabaseSync = fullSchemaDb(30);
  const db: DistDb = {
    async select(q, p = []) {
      return sql.prepare(q).all(...(p as never[])) as never[];
    },
    async execute(q, p = []) {
      return { changes: Number(sql.prepare(q).run(...(p as never[])).changes) };
    },
    async outbox() {},
    newId: () => randomUUID(),
    now: () => new Date(),
  };
  const session: { current: DistContext } = { current: ctx(null) };
  const store = createDistStore(db, () => session.current);
  /** A store bound to one fixed session (handles never change identity). */
  const as = (c: DistContext) => createDistStore(db, () => c);
  /** A tenant with an owner login; returns helpers to add staff logins. */
  function tenant(id: string, type = "distributor") {
    const now = new Date().toISOString();
    sql.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, id, type, now, now);
    const user = (role: "owner" | "staff", name: string) => {
      const uid = `${id}-${name}`;
      sql.prepare(`INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, display_name, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x', ?, ?, ?, ?)`).run(uid, id, uid, role, name, now, now);
      return ctx(id, { userId: uid, userName: name, role, businessType: type });
    };
    return { owner: user("owner", "admin"), staff: (name: string) => user("staff", name) };
  }
  return { sql, db, store, as, tenant, session };
}

export const ctx = (tenantId: string | null, extra: Partial<DistContext> = {}): DistContext => ({
  tenantId,
  businessType: "distributor",
  userId: tenantId ? `${tenantId}-admin` : null,
  userName: "Admin",
  role: "owner",
  deniedActions: [],
  ...extra,
});

/** Sets a salesman's latest point age (seconds) by rewriting recorded_at on the DB clock. */
export function agePoints(sql: DatabaseSync, salesmanId: string, seconds: number) {
  sql.prepare(`UPDATE dist_loc_points SET recorded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) WHERE salesman_id = ?`).run(`-${seconds} seconds`, salesmanId);
}
