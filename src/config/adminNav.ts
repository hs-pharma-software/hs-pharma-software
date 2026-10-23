import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Building2, Layers, Users, Pill, Shapes, Sparkles } from "lucide-react";

export interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Tenants", href: "/admin/tenants", icon: Building2 },
  { label: "Types", href: "/admin/types", icon: Shapes },
  { label: "Subscription Plans", href: "/admin/plans", icon: Layers },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Catalog Review", href: "/admin/products", icon: Pill },
  { label: "Billori", href: "/admin/billori", icon: Sparkles },
];
