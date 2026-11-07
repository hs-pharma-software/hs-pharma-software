/** Features the Super Admin switches on per business: off until the business's
 * action list holds "+key" (Tenants > Tenant Detail > Permissions). Every other
 * action is on unless the list holds "key". Shared by the app and the server. */
export const TENANT_OPT_IN_ACTIONS: readonly string[] = ["invoice.pdf", "invoice.whatsapp"];

/** Whether the business's list (set by the Super Admin) allows an action. */
export function tenantAllows(list: readonly string[] | null | undefined, key: string): boolean {
  const l = list ?? [];
  return TENANT_OPT_IN_ACTIONS.includes(key) ? l.includes(`+${key}`) : !l.includes(key);
}

/** Ticks or unticks an action in the business's list (Super Admin). */
export function toggleTenantAction(list: readonly string[], key: string): string[] {
  const stored = TENANT_OPT_IN_ACTIONS.includes(key) ? `+${key}` : key;
  return list.includes(stored) ? list.filter((k) => k !== stored) : [...list, stored];
}
