/** Print templates: a section's own words replace the defaults (blank keeps
 * the default), and text and style settings survive saving and loading. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { blockText, loadTemplate, saveTemplate, BLOCK_TEXTS, type BlockConfig } from "@/lib/printTemplates";

const tenant: SessionTenant = {
  id: "pharm-a", name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};

beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: tenant.id, permissions: null }, currentTenant: tenant });
});

test("a section prints the user's words, or the default when left blank", () => {
  const meta: BlockConfig = { id: "meta", visible: true, align: "left", size: "md" };
  assert.equal(blockText(meta, "date"), "Date:");
  assert.equal(blockText({ ...meta, labels: { date: "Bill date:" } }, "date"), "Bill date:");
  assert.equal(blockText({ ...meta, labels: { date: "   " } }, "date"), "Date:");
  assert.equal(blockText({ id: "title", visible: true, align: "left", size: "md" }, "title"), "", "blank title = the bill's own title");
  for (const [id, texts] of Object.entries(BLOCK_TEXTS)) {
    assert.equal(new Set(texts!.map((t) => t.key)).size, texts!.length, `${id}: unique keys`);
  }
});

test("text and style settings are saved with the template", async () => {
  const t = await loadTemplate("a4");
  t.blocks = t.blocks.map((b) => (b.id === "meta" ? { ...b, bold: true, italic: true, underline: true, uppercase: true, color: "#123456", labels: { salesman: "Sold by:" } } : b));
  await saveTemplate(t);
  const back = (await loadTemplate("a4")).blocks.find((b) => b.id === "meta")!;
  assert.deepEqual([back.bold, back.italic, back.underline, back.uppercase, back.color], [true, true, true, true, "#123456"]);
  assert.equal(blockText(back, "salesman"), "Sold by:");
  assert.equal(blockText(back, "date"), "Date:");
});
