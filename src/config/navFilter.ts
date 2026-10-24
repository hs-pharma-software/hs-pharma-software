import { NAV, type NavItem } from "./nav";
import { businessType, moduleAllowedForType } from "./businessTypes";

/** Clinic sidebar, top to bottom. Anything not listed (Products, Customers,
 * Stock, Purchase...) is not part of the clinic's navigation. */
export const CLINIC_NAV_ORDER = [
  "clinic_dashboard",
  "clinic_patients",
  "clinic_doctors",
  "clinic_appointments",
  "clinic_consultations",
  "invoices",
  "staff",
  "cash_register",
  "banks",
  "expenses",
  "reports",
  "utilities",
];

/** Top-level sidebar entries for a tenant: business-type sections follow the
 * type, shared sections follow the plan, and sub-users only see what they were
 * given. Clinics get their own fixed order. */
export function visibleNavFor(
  businessTypeValue: string | null | undefined,
  allowedModules: string[] | null,
  userPermissions: string[] | null
): NavItem[] {
  const typeId = businessType(businessTypeValue).id;
  const items = NAV.filter((item) => {
    if (item.onlyFor) {
      if (!item.onlyFor.includes(typeId)) return false;
    } else {
      if (!moduleAllowedForType(typeId, item.moduleKey)) return false;
      if (allowedModules && allowedModules.length > 0 && !allowedModules.includes(item.moduleKey)) return false;
    }
    if (userPermissions !== null && !userPermissions.includes(item.moduleKey)) return false;
    return true;
  });
  if (typeId !== "clinic") return items;
  return CLINIC_NAV_ORDER.flatMap((key) => items.filter((i) => i.moduleKey === key));
}
