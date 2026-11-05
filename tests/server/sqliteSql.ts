/** The server modules' database (Sql) over an in-memory node:sqlite database, for tests. */
import type { DatabaseSync } from "node:sqlite";
import type { Sql } from "@/server/subSupers";

export function sqliteSql(d: DatabaseSync): Sql {
  const norm = (a: unknown[]) => a.map((v) => (v === undefined ? null : v)) as never[];
  return {
    async execute(q, args = []) {
      const st = d.prepare(q);
      if (/^\s*(SELECT|WITH)/i.test(q)) return { rows: (st.all(...norm(args)) as Record<string, unknown>[]).map((r) => ({ ...r })), rowsAffected: 0 };
      return { rows: [], rowsAffected: Number(st.run(...norm(args)).changes) };
    },
    async batch(stmts) {
      d.exec("BEGIN");
      try {
        const out = stmts.map((s) => Number(d.prepare(s.sql).run(...norm(s.args ?? [])).changes));
        d.exec("COMMIT");
        return out;
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
