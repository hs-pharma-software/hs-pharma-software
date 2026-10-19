import { createTenantRepo } from "./base";
import type { Customer } from "../types";

export const customersRepo = createTenantRepo<Customer>("customers");
