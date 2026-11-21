/** Super Admin: empties a business after testing, so it starts fresh.
 *
 * Kept always: the business itself, its logins, branches, settings (profile,
 * print templates, numbering), FBR / PRA credentials, offline devices,
 * payment gateway records, the website and every audit log (the reset is
 * written to one). Kept when asked: the setup (staff, tests and rates,
 * machines, templates, products, categories...), with stock set to zero.
 * Everything else of this business (patients, orders, invoices, payments,
 * cash, expenses...) is deleted, all in one transaction. */
import { randomUUID } from "node:crypto";
import { HttpError } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";

/** Never removed by a reset. */
export const RESET_KEEP = new Set([
  "users", "branches", "branch_users", "branch_audit", "branch_capacity_requests", "data_changes", "server_audit_log", "delete_history",
  "offline_changes", "offline_devices", "offline_exceptions", "offline_ops", "fbr_credentials", "fbr_scenario_attempts", "fbr_scenario_tests", "fbr_test_sessions",
  "pra_accounts", "pra_audit", "pra_pos", "pra_rule_assignments", "payment_access_requests", "payment_attempts", "payment_audit", "payment_events", "payment_merchants", "payment_refunds",
  "business_link_tokens", "backups", "catalog_ownership_log", "onboarding_requests", "dist_config", "dist_user_perms", "dist_audit", "es_audit", "rest_audit",
  "web_audit", "web_domains", "web_files", "web_media", "web_pages", "web_products", "web_requests", "web_revisions", "web_sites", "web_order_events", "web_order_items", "web_orders",
]);

/** The business's setup: removed too, unless "keep setup" is ticked. */
export const RESET_SETUP = new Set([
  "staff", "categories", "sub_categories", "uoms", "generic_names", "products", "price_list", "product_suppliers", "expense_categories", "revenue_categories", "banks", "salesmen",
  "hospital_services", "hospital_departments", "hospital_collection_centers", "hospital_formulary", "hospital_equipment", "hospital_steril_equipment", "hospital_licences",
  "hospital_staff_credentials", "hospital_documents", "radiology_machines", "radiology_modalities", "radiology_pacs", "radiology_templates",
  "clinic_doctors", "clinic_services", "banquet_halls", "banquet_packages", "banquet_dishes",
  "rest_categories", "rest_menu_items", "rest_ingredients", "rest_recipe_lines", "rest_tables", "rest_deals", "rest_offers",
  "dist_categories", "dist_companies", "dist_products", "dist_product_schemes", "dist_salesmen", "dist_targets", "es_categories", "es_products",
]);

/** Stock kept on a setup row: zero after the stock movements are gone. */
const STOCK_COLUMNS: [string, string][] = [["dist_products", "stock"], ["es_products", "stock"]];

/** Lines and events before their documents, so nothing is left pointing at a deleted row. */
const order = (t: string) => (/_(items|lines|events|moves|entries|logs|issues|reactions|crossmatches|usage|alerts|observations)$/.test(t) ? 0 : 1);

export async function tenantTables(sql: Pick<Sql, "execute">): Promise<string[]> {
  const rows = (await sql.execute(
    `SELECT m.name FROM sqlite_master m WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) c WHERE c.name = 'tenant_id') ORDER BY m.name`,
  )).rows;
  return rows.map((r) => String(r.name));
}

export interface ResetResult { tables: number; rows: number; keptSetup: boolean }

export async function resetTenant(sql: Sql, caller: Caller, input: { tenantId?: unknown; confirmName?: unknown; keepSetup?: unknown }): Promise<ResetResult> {
  if (caller.role !== "super_admin" || caller.platformRole) throw new HttpError(403, "Only the Super Admin resets a business.");
  const tenantId = typeof input.tenantId === "string" ? input.tenantId : "";
  const t = (await sql.execute(`SELECT id, name FROM tenants WHERE id = ?`, [tenantId])).rows[0];
  if (!t) throw new HttpError(404, "Business not found.");
  if (String(input.confirmName ?? "").trim() !== String(t.name).trim()) throw new HttpError(400, "Type the business name exactly to confirm the reset.");
  const keepSetup = input.keepSetup === true;
  const tables = (await tenantTables(sql))
    .filter((n) => !RESET_KEEP.has(n) && !(keepSetup && RESET_SETUP.has(n)))
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const run = async (x: Pick<Sql, "execute">) => {
    let rows = 0;
    for (const n of tables) rows += (await x.execute(`DELETE FROM ${n} WHERE tenant_id = ?`, [tenantId])).rowsAffected;
    if (keepSetup) {
      for (const [n, c] of STOCK_COLUMNS) {
        if (!tables.includes(n)) await x.execute(`UPDATE ${n} SET ${c} = 0 WHERE tenant_id = ?`, [tenantId]).catch(() => undefined);
      }
    }
    await x.execute(
      `INSERT INTO server_audit_log (id, user_id, tenant_id, role, verb, tables, statement, ip, created_at) VALUES (?, ?, ?, 'super_admin', 'RESET', ?, ?, NULL, ?)`,
      [randomUUID(), caller.userId, tenantId, `${tables.length} tables`, `Business reset${keepSetup ? " (setup kept)" : ""}: ${rows} rows removed`, new Date().toISOString()],
    );
    return rows;
  };
  const rows = sql.transaction ? await sql.transaction(run) : await run(sql);
  return { tables: tables.length, rows, keptSetup: keepSetup };
}
