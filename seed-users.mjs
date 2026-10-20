// Seed script: creates admin + owner accounts in Turso
// Run: node seed-users.mjs

import { createClient } from "@libsql/client/web";
import { createHash, randomBytes } from "crypto";

const TURSO_URL   = "libsql://pharmacy-usamaali.aws-ap-northeast-1.turso.io";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODk5MTUxNzgsImlkIjoiMDFhMGJmNDAtMTUwMS03NDY2LWE4MWItYjg2YWU1NWNkNThiIiwia2lkIjoiR2kzUld1ZXRFeUVOOFc3LXdwYm5vVXhXci1pTi1pcUpFUVJ6Q0FYS2ctRSIsInJpZCI6ImEwMDQ0Y2Q4LTRhNWEtNDY1OC04ZjE4LWUwZDUwYmU3OGE2NiJ9.7Pt5P6pdva4Vd4Eh0hq6hHedpzIX-yyVhOgOTbGwHqA1OooVGJ3vRfXtV1XnyLaGdlvfLnGPj7J6ElWda37KBQ";

// ── credentials you want ─────────────────────────────────────────────
const ADMIN_USERNAME  = "admin";
const ADMIN_PASSWORD  = "admin@1234";
const OWNER_USERNAME  = "owner";
const OWNER_PASSWORD  = "owner@1234";
const PHARMACY_NAME   = "HS Pharma";
// ─────────────────────────────────────────────────────────────────────

const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

function nowIso() { return new Date().toISOString(); }
function uuid()   { return randomBytes(16).toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"); }
function salt()   { return randomBytes(16).toString("hex"); }
function hash(s, p) { return createHash("sha256").update(`${s}:${p}`).digest("hex"); }

async function run() {
  const now = nowIso();

  // 1. Check if users already exist
  const existing = await db.execute("SELECT COUNT(*) as n FROM users WHERE deleted_at IS NULL");
  if (Number(existing.rows[0][0]) > 0) {
    console.log("⚠️  Users already exist in the database. Aborting to avoid duplicates.");
    console.log("   Delete existing users from Turso first if you want to re-seed.");
    process.exit(1);
  }

  // 2. Create default tenant
  const tenantId = "tenant-default";
  await db.execute({
    sql: `INSERT OR IGNORE INTO tenants
          (id, name, subscription_status, is_active, created_at, updated_at)
          VALUES (?, ?, 'active', 1, ?, ?)`,
    args: [tenantId, PHARMACY_NAME, now, now],
  });
  console.log(`✅ Tenant created: "${PHARMACY_NAME}" (id: ${tenantId})`);

  // 3. Create Super Admin (no tenant)
  const adminId   = uuid();
  const adminSalt = salt();
  const adminHash = hash(adminSalt, ADMIN_PASSWORD);
  await db.execute({
    sql: `INSERT INTO users
          (id, tenant_id, username, password_hash, password_salt, role, display_name, is_active, created_at, updated_at)
          VALUES (?, NULL, ?, ?, ?, 'super_admin', 'Super Admin', 1, ?, ?)`,
    args: [adminId, ADMIN_USERNAME, adminHash, adminSalt, now, now],
  });
  console.log(`✅ Super Admin created: username="${ADMIN_USERNAME}" password="${ADMIN_PASSWORD}"`);

  // 4. Create Owner (linked to tenant)
  const ownerId   = uuid();
  const ownerSalt = salt();
  const ownerHash = hash(ownerSalt, OWNER_PASSWORD);
  await db.execute({
    sql: `INSERT INTO users
          (id, tenant_id, username, password_hash, password_salt, role, display_name, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'owner', ?, 1, ?, ?)`,
    args: [ownerId, tenantId, OWNER_USERNAME, ownerHash, ownerSalt, PHARMACY_NAME, now, now],
  });
  console.log(`✅ Owner created:      username="${OWNER_USERNAME}" password="${OWNER_PASSWORD}"`);

  console.log("\n🎉 Done! Use these credentials to log in:");
  console.log(`   Admin  → ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  console.log(`   Owner  → ${OWNER_USERNAME} / ${OWNER_PASSWORD}`);
}

run().catch((err) => { console.error("❌ Error:", err.message); process.exit(1); });
