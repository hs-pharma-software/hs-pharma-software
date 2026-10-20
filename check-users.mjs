// Check + seed users — reads credentials from .env.local
import { createClient } from "@libsql/client/web";
import { readFileSync } from "fs";
import { createHash, randomBytes } from "crypto";

// Read .env.local
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const db = createClient({
  url: env.NEXT_PUBLIC_TURSO_DATABASE_URL,
  authToken: env.NEXT_PUBLIC_TURSO_AUTH_TOKEN,
});

const r = await db.execute("SELECT id, username, role, tenant_id, is_active FROM users WHERE deleted_at IS NULL");
console.log("Existing users in Turso:");
if (r.rows.length === 0) {
  console.log("  (none)");
} else {
  r.rows.forEach(row =>
    console.log(`  username="${row[1]}"  role=${row[2]}  tenant=${row[3] ?? "NULL"}  active=${row[4]}`)
  );
}
