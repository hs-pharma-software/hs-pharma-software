import { createRepo } from "./base";
import type { SubscriptionPlan } from "../types2";

/** Plans a Super Admin can assign to a tenant \u2014 global/system table. */
export const subscriptionPlansRepo = createRepo<SubscriptionPlan>("subscription_plans");

export function parseAllowedModules(plan: Pick<SubscriptionPlan, "allowed_modules">): string[] {
  try {
    const parsed = JSON.parse(plan.allowed_modules);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
