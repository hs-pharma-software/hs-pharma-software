"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "./AdminSidebar";
import { Topbar } from "./Topbar";
import { PageTransition } from "./PageTransition";
import { MobileBottomNav } from "./MobileBottomNav";
import { ADMIN_NAV } from "@/config/adminNav";
import { useAppStore } from "@/store/appStore";
import { useAuthStore } from "@/store/authStore";
import { useUnreadQueries } from "@/lib/queriesClient";

const BOTTOM = ["/admin", "/admin/tenants", "/admin/plans", "/admin/queries"];
const SHORT: Record<string, string> = { "/admin": "Overview", "/admin/plans": "Plans" };

/** Shown instead of the normal pharmacy `AppShell` when the logged-in user
 * is the Super Admin \u2014 a different nav (Tenants / Subscription Plans /
 * Users), and deliberately no `GlobalShortcuts`/`Calculator` (those are
 * cashier/POS shortcuts for the pharmacy screens, not relevant here).
 * Phones: the menu is a drawer and the main sections sit in a bottom bar. */
export function SuperAdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const open = useAppStore((s) => s.sidebarMobileOpen);
  const setOpen = useAppStore((s) => s.setSidebarMobileOpen);
  const unread = useUnreadQueries(useAuthStore((s) => s.currentUser?.role === "super_admin"));
  useEffect(() => { setOpen(false); }, [pathname, setOpen]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  const items = BOTTOM.map((href) => ADMIN_NAV.find((n) => n.href === href)!).filter(Boolean)
    .map((n) => ({ href: n.href, label: SHORT[n.href] ?? n.label, icon: n.icon }));

  return (
    <div className="app-h flex flex-col bg-gradient-to-br from-neutral-100 via-neutral-100 to-sky-50/40">
      <Topbar />
      <div className="relative flex min-h-0 flex-1">
        {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" aria-hidden onClick={() => setOpen(false)} />}
        <AdminSidebar />
        <main className="min-w-0 flex-1 overflow-y-auto p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:p-4 sm:pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-5">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <MobileBottomNav items={items} moreOpen={open} onMore={() => setOpen(!open)} badges={unread ? { "/admin/queries": unread } : {}} />
    </div>
  );
}
