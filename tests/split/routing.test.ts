import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSystem, tablesIn, systemForBusinessType, SYSTEM_DB_FILE, SYSTEM_DB_NAME, PLATFORM_TABLES } from "@/lib/dbRouting";

test("two separate, named databases for Hospital and Clinic; platform keeps its old file", () => {
  assert.equal(SYSTEM_DB_NAME.hospital, "hospital_management_db");
  assert.equal(SYSTEM_DB_NAME.clinic, "clinic_management_db");
  assert.equal(SYSTEM_DB_FILE.hospital, "hospital_management_db.db");
  assert.equal(SYSTEM_DB_FILE.clinic, "clinic_management_db.db");
  assert.equal(SYSTEM_DB_FILE.platform, "pharmacy.db");
  assert.equal(new Set(Object.values(SYSTEM_DB_FILE)).size, 3);
});

test("a tenant's business type picks its database", () => {
  assert.equal(systemForBusinessType("hospital"), "hospital");
  assert.equal(systemForBusinessType("clinic"), "clinic");
  for (const t of ["retail_pharmacy", "medical_store", "hospital_pharmacy", "general_store", "restaurant", "electronics_solar", "distributor", "contractor", "", null, undefined]) {
    assert.equal(systemForBusinessType(t), "platform", String(t));
  }
});

test("hospital and clinic queries (incl. shared tables like invoices, banks, staff) go to their own database", () => {
  const sqls = [
    "SELECT * FROM hospital_patients WHERE tenant_id = ?",
    "INSERT INTO invoices (id) VALUES (?)",
    "SELECT * FROM products p JOIN product_batches b ON b.product_id = p.id",
    "UPDATE cash_register_entries SET amount = 1",
    "SELECT * FROM staff",
    "INSERT INTO sync_outbox (id) VALUES (?)",
    "SELECT value FROM sync_meta WHERE key = ?",
  ];
  for (const sql of sqls) {
    assert.equal(resolveSystem(sql, "hospital"), "hospital", sql);
    assert.equal(resolveSystem(sql, "clinic"), "clinic", sql);
    assert.equal(resolveSystem(sql, "retail_pharmacy"), "platform", sql);
  }
});

test("sign-in tables and the pharmacy mailbox are always platform, for every tenant type", () => {
  for (const table of PLATFORM_TABLES) {
    for (const type of ["hospital", "clinic", "retail_pharmacy"]) {
      assert.equal(resolveSystem(`SELECT * FROM ${table} WHERE id = ?`, type), "platform", `${table} / ${type}`);
    }
  }
  assert.equal(resolveSystem("INSERT OR REPLACE INTO pharmacy_rx_notifications (id) VALUES (?)", "clinic"), "platform");
  assert.equal(resolveSystem("DELETE FROM pharmacy_rx_items WHERE prescription_id = ?", "clinic"), "platform");
  assert.equal(resolveSystem("UPDATE clinic_prescriptions SET status = 'sent' WHERE id = ?", "clinic"), "clinic");
});

test("no signed-in tenant (login, Super Admin) means platform; an explicit system wins", () => {
  assert.equal(resolveSystem("SELECT * FROM hospital_patients", null), "platform");
  assert.equal(resolveSystem("SELECT * FROM users WHERE username = ?", null), "platform");
  assert.equal(resolveSystem("SELECT * FROM products", "clinic", "platform"), "platform");
  assert.equal(resolveSystem("SELECT * FROM products", "retail_pharmacy", "hospital"), "hospital");
});

test("table detection handles joins, quoting and case", () => {
  assert.deepEqual(tablesIn("SELECT * FROM Products p JOIN tenants t ON t.id = p.tenant_id").sort(), ["products", "tenants"]);
  assert.deepEqual(tablesIn('INSERT OR IGNORE INTO "settings" (key) VALUES (?)'), ["settings"]);
  assert.deepEqual(tablesIn("UPDATE users SET x = 1"), ["users"]);
  // A mixed statement is sent to platform (only the Super Admin runs those).
  assert.equal(resolveSystem("SELECT * FROM products p JOIN tenants t ON t.id = p.tenant_id", "hospital"), "platform");
});
