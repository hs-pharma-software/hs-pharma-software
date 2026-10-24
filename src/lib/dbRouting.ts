/** Which database a query belongs to. Pure rules, no connections.
 *
 *  platform  pharmacy.db                  login/tenants/plans, the pharmacy Rx mailbox,
 *                                         and every business type other than the two below
 *  hospital  hospital_management_db.db    everything a Hospital tenant stores
 *  clinic    clinic_management_db.db      everything a Clinic tenant stores
 *
 * A tenant's queries go to the database of its business type. Queries with no
 * tenant (login, Super Admin) and queries on a platform table go to platform. */

export type DbSystem = "platform" | "hospital" | "clinic";

export const ALL_SYSTEMS: DbSystem[] = ["platform", "hospital", "clinic"];

/** Logical database names. */
export const SYSTEM_DB_NAME: Record<DbSystem, string> = {
  platform: "pharmacy",
  hospital: "hospital_management_db",
  clinic: "clinic_management_db",
};

/** Local (desktop) SQLite file names. The platform file keeps its old name so
 * existing installs keep their data. */
export const SYSTEM_DB_FILE: Record<DbSystem, string> = {
  platform: "pharmacy.db",
  hospital: "hospital_management_db.db",
  clinic: "clinic_management_db.db",
};

/** Tables that always live in the platform database: sign-in data and the
 * mailbox through which a clinic hands a prescription to a pharmacy (the
 * pharmacy lives in another database than the clinic). */
export const PLATFORM_TABLES: string[] = ["tenants", "users", "subscription_plans", "pharmacy_rx_notifications", "pharmacy_rx_items"];

/** Business type id -> database. Unknown / pharmacy / retail types stay on platform. */
export function systemForBusinessType(typeId: string | null | undefined): DbSystem {
  const t = (typeId ?? "").trim().toLowerCase();
  if (t === "hospital") return "hospital";
  if (t === "clinic") return "clinic";
  return "platform";
}

/** Table names a statement reads or writes (FROM / JOIN / INTO / UPDATE). */
export function tablesIn(sql: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:from|join|into|update)\s+["`]?([a-z_][a-z0-9_]*)["`]?/gi;
  for (let m = re.exec(sql); m; m = re.exec(sql)) out.add(m[1].toLowerCase());
  return [...out];
}

export function isPlatformTable(table: string): boolean {
  return PLATFORM_TABLES.includes(table.toLowerCase());
}

/** The database a statement runs on. `businessTypeId` is the logged-in
 * tenant's type (null when nobody is signed in or for the Super Admin). */
export function resolveSystem(sql: string, businessTypeId: string | null | undefined, explicit?: DbSystem): DbSystem {
  if (explicit) return explicit;
  if (!businessTypeId) return "platform";
  if (tablesIn(sql).some(isPlatformTable)) return "platform";
  return systemForBusinessType(businessTypeId);
}
