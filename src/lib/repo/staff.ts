import { createTenantRepo } from "./base";
import type { Staff } from "../types";

export const staffRepo = createTenantRepo<Staff>("staff");
