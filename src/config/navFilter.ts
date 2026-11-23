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
  "clinic_lab",
  "clinic_radiology",
  "clinic_services",
  "invoices",
  "staff",
  "cash_register",
  "banks",
  "expenses",
  "reports",
  "utilities",
  "clinic_settings",
];

/** Hospital sidebar, top to bottom. Invoices sit under Billing, and Products,
 * Supplier, Cash Register, Banks, Expenses, Other Revenue, Tasks and Utilities
 * under Purchase Cell, Staff under HR Department. */
export const HOSPITAL_NAV_ORDER = [
  "hospital_dashboard",
  "hospital_reception",
  "hospital_my_cash",
  "hospital_doctor_desk",
  "hospital_profile",
  "hospital_patients",
  "hospital_episodes",
  "hospital_departments",
  "hospital_lab",
  "hospital_blood_bank",
  "hospital_radiology",
  "hospital_surgery",
  "hospital_medicines",
  "hospital_infection",
  "hospital_quality",
  "hospital_facility",
  "hospital_services",
  "hospital_finance",
  "hospital_purchase_cell",
  "hospital_hr",
  "hospital_logins",
];

/** Diagnostic lab sidebar, top to bottom: the desks in the order a sample moves. */
export const LAB_NAV_ORDER = [
  "lab_dashboard", "lab_reception", "lab_patients", "lab_samples", "lab_verify", "lab_reports", "lab_bills", "lab_tests", "lab_profile",
  "staff", "cash_register", "banks", "expenses", "utilities", "settings",
];

/** Marquee / banquet hall sidebar, top to bottom. */
export const BANQUET_NAV_ORDER = [
  "banquet_dashboard", "banquet_bookings", "banquet_calendar", "banquet_menu", "banquet_halls", "banquet_reports",
  "staff", "cash_register", "banks", "expenses", "other_revenue", "utilities", "settings",
];

/** Distributor sidebar, top to bottom: the day's work first (selling, booking,
 * customers, stock, buying), then the business set-up, then money and admin. */
export const DISTRIBUTOR_NAV_ORDER = [
  "dashboard", "dist_sales", "dist_bookings", "dist_customers", "dist_catalog", "dist_purchases",
  "dist_companies", "dist_salesmen", "dist_field", "dist_reports",
  "cash_register", "banks", "expenses", "other_revenue",
  "staff", "tasks", "dist_settings", "utilities", "settings",
];

/** Radiology Centre sidebar, top to bottom: the patient's path through the centre, then the money and set-up. */
export const RADIOLOGY_CENTER_NAV_ORDER = [
  "hospital_radiology_orders", "hospital_radiology_tech", "hospital_radiology_reporting", "hospital_radiology_reports", "hospital_patients", "hospital_finance",
  "hospital_radiology", "staff", "cash_register", "banks", "expenses", "other_revenue", "utilities", "settings",
];

const FIXED_ORDER: Record<string, string[]> = { clinic: CLINIC_NAV_ORDER, hospital: HOSPITAL_NAV_ORDER, lab: LAB_NAV_ORDER, banquet_hall: BANQUET_NAV_ORDER, distributor: DISTRIBUTOR_NAV_ORDER, radiology_center: RADIOLOGY_CENTER_NAV_ORDER };

/** Top-level sidebar entries for a tenant: business-type sections follow the
 * type, shared sections follow the plan, and sub-users only see what they were
 * given. Clinics and hospitals get their own fixed order.
 *
 * Groups (Purchase Cell, HR Department, Billing...) list other sections' pages
 * as children. A child is shown when the user has the child's own key or the
 * group's key (the group key grants all its sub-tabs); the plan still limits
 * shared sections. A group with no visible child is hidden. */
/** A Radiology Centre's own sections follow its Accessible Sections once that
 * list names any of them (lists saved before they could be ticked show them all). */
export function ownSectionsGated(typeId: string, allowedModules: string[] | null): boolean {
  if (typeId !== "radiology_center" || !allowedModules?.length) return false;
  return NAV.some((n) => n.onlyFor?.includes(typeId) && allowedModules.includes(n.moduleKey));
}

export function visibleNavFor(
  businessTypeValue: string | null | undefined,
  allowedModules: string[] | null,
  userPermissions: string[] | null,
  /** Integrations this business has: entries that require one stay hidden without it. */
  integrations: { pra?: boolean } = {}
): NavItem[] {
  const typeId = businessType(businessTypeValue).id;
  const integrated = (x: { requires?: "pra" }) => !x.requires || integrations[x.requires] === true;
  const has = (key: string) => userPermissions === null || userPermissions.includes(key);
  const inPlan = (key: string) => key.startsWith("hospital_") || !allowedModules || allowedModules.length === 0 || allowedModules.includes(key);

  const childVisible = (parentKey: string, child: NavChild): boolean => {
    if (child.onlyFor && !child.onlyFor.includes(typeId)) return false;
    if (!child.moduleKey) return has(parentKey);
    if (!moduleAllowedForType(typeId, child.moduleKey)) return false;
    return inPlan(child.moduleKey) && (has(child.moduleKey) || has(parentKey));
  };

  // Pages only for some business types (onlyFor) or integrations, at every level (e.g. Billing > Invoices pages).
  const forThisType = (cs: NavChild[]): NavChild[] => cs
    .filter((c) => integrated(c) && (!c.onlyFor || c.onlyFor.includes(typeId)))
    .map((c) => (c.children ? { ...c, children: forThisType(c.children) } : c));
  const items: NavItem[] = [];
  for (const entry of NAV) {
    if (!integrated(entry)) continue;
    const item = entry.children ? { ...entry, children: forThisType(entry.children) } : entry;
    if (item.onlyFor) {
      if (!item.onlyFor.includes(typeId)) continue;
      if (ownSectionsGated(typeId, allowedModules) && !allowedModules!.includes(item.moduleKey)) continue;
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
