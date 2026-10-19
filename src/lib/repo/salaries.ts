import { createTenantRepo } from "./base";
import type { Salary } from "../types2";

export const salariesRepo = createTenantRepo<Salary>("salaries");
