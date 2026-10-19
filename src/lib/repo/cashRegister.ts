import { createTenantRepo } from "./base";
import type { CashRegisterEntry } from "../types2";

export const cashRegisterRepo = createTenantRepo<CashRegisterEntry>("cash_register_entries");
