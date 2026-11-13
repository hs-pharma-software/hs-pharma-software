/** Which tables the desktop app's local copy holds (Phase 1). Shared by the
 * server (src/server/replica.ts), the migration generator
 * (scripts/gen-data-changes.ts) and the tests. No imports: plain data. */

/** Tables never copied to a computer: credentials and secrets, server-side
 * records (FBR, payments, the offline pilot's own bookkeeping), logs written
 * on every request, the website builder, and the change logs themselves.
 * Whatever is not excluded is still read only through the same rules as
 * /api/db (a login gets only what it may read there). */
export const REPLICA_EXCLUDED = new Set([
  "data_changes", "offline_changes", "sync_outbox", "sync_meta",
  "fbr_credentials", "fbr_submissions", "fbr_test_sessions", "fbr_scenario_tests", "fbr_scenario_attempts",
  "offline_devices", "offline_ops", "offline_exceptions",
  "payment_merchants", "payment_attempts", "payment_audit", "payment_events", "payment_refunds", "payment_access_requests",
  "business_link_tokens", "backups", "server_audit_log", "catalog_ownership_log", "onboarding_requests",
  "dist_loc_points", "dist_loc_sessions",
  "web_audit", "web_requests", "web_revisions", "web_files", "web_media", "web_domains", "web_sites", "web_pages", "web_products",
]);

/** How a table belongs to a business: by its tenant_id column, the tenants
 * table itself (its id), or settings (keys "<tenant id>::name"). Null: not a
 * business's table (platform tables). */
export function replicaTableKind(table: string, columns: string[]): "tenant" | "tenants" | "settings" | null {
  if (table === "tenants") return "tenants";
  if (table === "settings") return "settings";
  return columns.includes("tenant_id") ? "tenant" : null;
}
