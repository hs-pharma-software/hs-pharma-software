import type { NavItem } from "./nav";

/** Phone bottom bar: the four most used sections of each kind of business
 * (by the section's moduleKey) and a short label; "More" opens the full menu.
 * Sections the business or login does not have are skipped and the bar is
 * filled from the menu in order, so it never links to a closed section. */
const PREFERRED: Record<string, [string, string][]> = {
  default: [["dashboard", "Home"], ["invoices", "Sale"], ["products", "Products"], ["reports", "Reports"]],
  restaurant: [["restaurant_pos", "POS"], ["restaurant_kitchen", "Kitchen"], ["restaurant_menu", "Menu"], ["restaurant_reports", "Reports"]],
  clinic: [["clinic_dashboard", "Clinic"], ["clinic_appointments", "Appointments"], ["clinic_patients", "Patients"], ["clinic_consultations", "Consult"]],
  lab: [["lab_dashboard", "Home"], ["lab_reception", "Reception"], ["lab_samples", "Samples"], ["lab_reports", "Reports"]],
  hospital: [["hospital_dashboard", "Home"], ["hospital_reception", "Reception"], ["hospital_patients", "Patients"], ["hospital_doctor_desk", "Doctor"]],
  banquet_hall: [["banquet_dashboard", "Home"], ["banquet_bookings", "Bookings"], ["banquet_calendar", "Calendar"], ["banquet_reports", "Reports"]],
  electronics_solar: [["dashboard", "Home"], ["es_sales", "Sales"], ["es_products", "Products"], ["es_reports", "Reports"]],
  distributor: [["dashboard", "Home"], ["dist_bookings", "Bookings"], ["dist_sales", "Sales"], ["dist_reports", "Reports"]],
};

export interface BottomItem { href: string; label: string; icon: NavItem["icon"] }

/** The bar for a business type, from the sections this login can open (Sidebar's visible menu). */
export function bottomNavFor(typeId: string, visible: NavItem[]): BottomItem[] {
  const out: BottomItem[] = [];
  const used = new Set<string>();
  for (const [key, label] of PREFERRED[typeId] ?? PREFERRED.default) {
    const item = visible.find((n) => n.moduleKey === key);
    if (item && !used.has(item.href)) {
      out.push({ href: item.href, label, icon: item.icon });
      used.add(item.href);
    }
  }
  for (const item of visible) {
    if (out.length >= 4) break;
    if (!used.has(item.href)) {
      out.push({ href: item.href, label: item.label.length > 11 ? item.label.split(" ")[0] : item.label, icon: item.icon });
      used.add(item.href);
    }
  }
  return out.slice(0, 4);
}
