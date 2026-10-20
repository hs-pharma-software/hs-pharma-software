// Reset passwords for admin and owner — reads credentials from .env.local
import { createClient } from "@libsql/client/web";
import { readFileSync } from "fs";
import { createHash, randomBytes } from "crypto";

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

function salt()        { return randomBytes(16).toString("hex"); }
function hashPwd(s, p) { return createHash("sha256").update(`${s}:${p}`).digest("hex"); }
function now()         { return new Date().toISOString(); }

const users = [
  { username: "admin", newPassword: "Admin@1234" },
  { username: "owner", newPassword: "Owner@1234" },
];

for (const u of users) {
  const s = salt();
  const h = hashPwd(s, u.newPassword);
  await db.execute({
    sql: `UPDATE users SET password_hash=?, password_salt=?, updated_at=? WHERE username=?`,
    args: [h, s, now(), u.username],
  });
  console.log(`✅ ${u.username} → new password: ${u.newPassword}`);
}

console.log("\n🎉 Done! New credentials:");
console.log("   admin  →  Admin@1234");
console.log("   owner  →  Owner@1234");
