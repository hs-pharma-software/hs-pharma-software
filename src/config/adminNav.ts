import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Building2, Layers, Users } from "lucide-react";

export interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Tenants", href: "/admin/tenants", icon: Building2 },
  { label: "Subscription Plans", href: "/admin/plans", icon: Layers },
  { label: "Users", href: "/admin/users", icon: Users },
];
