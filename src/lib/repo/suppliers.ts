import { createTenantRepo } from "./base";
import type { Supplier } from "../types";

export const suppliersRepo = createTenantRepo<Supplier>("suppliers");
