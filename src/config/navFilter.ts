import { NAV, type NavChild, type NavItem } from "./nav";
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

/** Hospital sidebar, top to bottom. Invoices sit under Billing, and Products,
 * Supplier, Cash Register, Banks, Expenses, Other Revenue, Tasks and Utilities
 * under Purchase Cell, Staff under HR Department. */
export const HOSPITAL_NAV_ORDER = [
  "hospital_dashboard",
  "hospital_reception",
  "hospital_doctor_desk",
  "hospital_profile",
  "hospital_patients",
  "hospital_episodes",
  "hospital_departments",
  "hospital_lab",
  "hospital_radiology",
  "hospital_surgery",
  "hospital_services",
  "hospital_purchase_cell",
  "hospital_hr",
];

const FIXED_ORDER: Record<string, string[]> = { clinic: CLINIC_NAV_ORDER, hospital: HOSPITAL_NAV_ORDER };

/** Top-level sidebar entries for a tenant: business-type sections follow the
 * type, shared sections follow the plan, and sub-users only see what they were
 * given. Clinics and hospitals get their own fixed order.
 *
 * Groups (Purchase Cell, HR Department, Billing...) list other sections' pages
 * as children. A child is shown when the user has the child's own key or the
 * group's key (the group key grants all its sub-tabs); the plan still limits
 * shared sections. A group with no visible child is hidden. */
export function visibleNavFor(
  businessTypeValue: string | null | undefined,
  allowedModules: string[] | null,
  userPermissions: string[] | null
): NavItem[] {
  const typeId = businessType(businessTypeValue).id;
  const has = (key: string) => userPermissions === null || userPermissions.includes(key);
  const inPlan = (key: string) => key.startsWith("hospital_") || !allowedModules || allowedModules.length === 0 || allowedModules.includes(key);

  const childVisible = (parentKey: string, child: NavChild): boolean => {
    if (child.onlyFor && !child.onlyFor.includes(typeId)) return false;
    if (!child.moduleKey) return has(parentKey);
    if (!moduleAllowedForType(typeId, child.moduleKey)) return false;
    return inPlan(child.moduleKey) && (has(child.moduleKey) || has(parentKey));
  };

  const items: NavItem[] = [];
  for (const item of NAV) {
    if (item.onlyFor) {
      if (!item.onlyFor.includes(typeId)) continue;
    } else {
      if (!moduleAllowedForType(typeId, item.moduleKey)) continue;
      if (allowedModules && allowedModules.length > 0 && !allowedModules.includes(item.moduleKey)) continue;
    }
    if (item.children?.some((c) => c.moduleKey)) {
      const children = item.children.filter((c) => childVisible(item.moduleKey, c));
      if (children.length) items.push({ ...item, children });
      continue;
    }
    if (!has(item.moduleKey)) continue;
    items.push(item);
  }

  const order = FIXED_ORDER[typeId];
  if (!order) return items;
  return order.flatMap((key) => items.filter((i) => i.moduleKey === key));
}
