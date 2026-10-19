import { createTenantRepo } from "./base";
import type { Salesman } from "../types2";

export const salesmenRepo = createTenantRepo<Salesman>("salesmen");
