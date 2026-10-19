"use client";

import { AdminSidebar } from "./AdminSidebar";
import { Topbar } from "./Topbar";
import { PageTransition } from "./PageTransition";

/** Shown instead of the normal pharmacy `AppShell` when the logged-in user
 * is the Super Admin — a different nav (Tenants / Subscription Plans /
 * Users), and deliberately no `GlobalShortcuts`/`Calculator` (those are
 * cashier/POS shortcuts for the pharmacy screens, not relevant here). */
export function SuperAdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-neutral-100 via-neutral-100 to-amber-50/40">
      <Topbar />
      <div className="flex min-h-0 flex-1">
        <AdminSidebar />
        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
