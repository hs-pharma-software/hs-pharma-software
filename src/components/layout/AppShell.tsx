"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { refreshSessionAccess } from "@/lib/auth";
import { isTauri } from "@/lib/platform";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { PageTransition } from "./PageTransition";
import { GlobalShortcuts } from "./GlobalShortcuts";
import { Calculator } from "./Calculator";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { FormTabsHost } from "./FormTabsHost";
import { useAuthStore } from "@/store/authStore";
import { moduleKeyForPath, hasModuleAccess } from "@/lib/moduleAccess";
import { PraBackground } from "@/components/restaurant/PraBackground";
import { LanguageSync } from "@/components/electric/LanguageSync";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentTenant = useAuthStore((s) => s.currentTenant);
  const moduleKey = moduleKeyForPath(pathname);
  const allowed = hasModuleAccess(moduleKey);
  const subscriptionLocked = Boolean(currentTenant) && currentTenant?.subscriptionStatus !== "active";

  // Pick up permission changes an owner made while this staff user is logged in.
  useEffect(() => {
    if (isTauri()) void refreshSessionAccess().catch(() => undefined);
  }, [pathname]);

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f7]">
      <GlobalShortcuts />
      <Calculator />
      {currentTenant && !subscriptionLocked && <AssistantChat />}
      {currentTenant && !subscriptionLocked && <FormTabsHost />}
      {currentTenant && !subscriptionLocked && <PraBackground />}
      <LanguageSync />
      <Topbar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          {subscriptionLocked ? (
            <div className="mx-auto mt-10 max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-6 text-center">
              <p className="font-serif text-lg text-amber-900">Subscription {currentTenant?.subscriptionStatus}</p>
              <p className="mt-2 text-sm text-amber-800">
                Your pharmacy&apos;s subscription is currently {currentTenant?.subscriptionStatus}. Contact the
                administrator to restore access.
              </p>
            </div>
          ) : !allowed ? (
            <div className="mx-auto mt-10 max-w-md rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
              <p className="font-serif text-lg text-neutral-800">Not included in your plan</p>
              <p className="mt-2 text-sm text-neutral-500">
                This section isn&apos;t part of your current subscription plan. Contact the administrator to upgrade.
              </p>
            </div>
          ) : (
            <PageTransition>{children}</PageTransition>
          )}
        </main>
      </div>
    </div>
  );
}
