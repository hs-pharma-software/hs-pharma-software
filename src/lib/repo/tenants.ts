import { createRepo } from "./base";
import type { Tenant } from "../types2";

/** Pharmacy accounts created by the Super Admin. Global/system table — not
 * itself scoped by tenant_id (a row here IS a tenant). */
export const tenantsRepo = createRepo<Tenant>("tenants");
