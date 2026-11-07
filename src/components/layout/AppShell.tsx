"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { refreshSessionAccess } from "@/lib/auth";
import { isTauri } from "@/lib/platform";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { SchemaBanner } from "./SchemaBanner";
import { PageTransition } from "./PageTransition";
import { GlobalShortcuts } from "./GlobalShortcuts";
import { Calculator } from "./Calculator";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { FormTabsHost } from "./FormTabsHost";
import { MobileBottomNav } from "./MobileBottomNav";
import { bottomNavFor } from "@/config/bottomNav";
import { visibleNavFor } from "@/config/navFilter";
import { businessType } from "@/config/businessTypes";
import { useAuthStore } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { moduleKeyForPath, hasModuleAccess } from "@/lib/moduleAccess";
import { PraBackground } from "@/components/restaurant/PraBackground";
import { LanguageSync } from "@/components/electric/LanguageSync";
import { subscriptionPhase, trialState } from "@/lib/subscription";
import { TrialNotice } from "./TrialNotice";
import { BranchModeNotice } from "@/components/branches/BranchSwitcher";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentTenant = useAuthStore((s) => s.currentTenant);
  const userPermissions = useAuthStore((s) => s.currentUser?.permissions ?? null);
  const typeId = businessType(currentTenant?.businessType).id;
  // Phone bottom bar: this business type's main sections this login can open.
  const bottomItems = bottomNavFor(typeId, visibleNavFor(typeId, currentTenant?.allowedModules ?? null, userPermissions));
  const sidebarMobileOpen = useAppStore((s) => s.sidebarMobileOpen);
  const setSidebarMobileOpen = useAppStore((s) => s.setSidebarMobileOpen);
  const moduleKey = moduleKeyForPath(pathname);
  const allowed = hasModuleAccess(moduleKey);
  // Ended plans: a reminder during the grace period; locked after it only when the platform enforces expiry.
  const phase = currentTenant ? subscriptionPhase(currentTenant.subscriptionExpiresAt, currentTenant.graceDays) : { phase: "none" as const };
  const expiredLock = phase.phase === "ended" && Boolean(currentTenant?.enforceExpiry);
  // Free trial: full plan access until it ends, then paused until the owner confirms.
  const trial = trialState(currentTenant?.subscriptionStatus, currentTenant?.subscriptionExpiresAt);
  const trialEnded = trial.trial && trial.ended;
  const subscriptionLocked = Boolean(currentTenant) && ((currentTenant?.subscriptionStatus !== "active" && !trial.trial) || expiredLock || trialEnded);

  // Close mobile sidebar on navigation.
  useEffect(() => {
    setSidebarMobileOpen(false);
  }, [pathname, setSidebarMobileOpen]);
  // Escape closes the menu drawer.
  useEffect(() => {
    if (!sidebarMobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarMobileOpen, setSidebarMobileOpen]);

  // Pick up permission changes an owner made while this staff user is logged in.
  useEffect(() => {
    if (isTauri()) void refreshSessionAccess().catch(() => undefined);
  }, [pathname]);

  return (
    <div className="app-h flex flex-col bg-[#f5f5f7]">
      <GlobalShortcuts />
      <Calculator />
      {currentTenant && !subscriptionLocked && <AssistantChat />}
      {currentTenant && !subscriptionLocked && <FormTabsHost />}
      {currentTenant && !subscriptionLocked && <PraBackground />}
      <LanguageSync />
      <Topbar />
      <SchemaBanner />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Mobile overlay — closes sidebar when tapped outside */}
        {sidebarMobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setSidebarMobileOpen(false)}
          />
        )}
        <Sidebar />
        {/* Phones: room under the content for the bottom bar (and the home indicator). */}
        <main className="min-w-0 flex-1 overflow-y-auto p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:p-4 sm:pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-5">
          {!subscriptionLocked && trial.trial && <TrialNotice state={trial} />}
          {!subscriptionLocked && <BranchModeNotice />}
          {!subscriptionLocked && !trial.trial && (phase.phase === "grace" || phase.phase === "ended") && (
            <div role="status" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              {phase.phase === "grace"
                ? `Your plan ended on ${phase.endedOn}. Renew within ${phase.daysLeft} day${phase.daysLeft === 1 ? "" : "s"} (by ${phase.graceUntil}) to keep using MAVIN.pk without interruption.`
                : `Your plan ended on ${phase.endedOn}. Please renew to keep using MAVIN.pk.`}
            </div>
          )}
          {trialEnded && trial.trial ? (
            <TrialNotice state={trial} />
          ) : subscriptionLocked ? (
            <div className="mx-auto mt-10 max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-6 text-center">
              <p className="font-serif text-lg text-amber-900">{expiredLock ? "Subscription ended" : `Subscription ${currentTenant?.subscriptionStatus}`}</p>
              <p className="mt-2 text-sm text-amber-800">
                {expiredLock && phase.phase === "ended"
                  ? `Your plan ended on ${phase.endedOn} and its grace period ended on ${phase.graceUntil}. Renew to continue; your records are kept.`
                  : `Your business's subscription is currently ${currentTenant?.subscriptionStatus}.`}{" "}
                Contact MAVIN.pk (0316-0585858) to restore access.
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
      {currentTenant && bottomItems.length > 0 && (
        <MobileBottomNav items={bottomItems} moreOpen={sidebarMobileOpen} onMore={() => setSidebarMobileOpen(!sidebarMobileOpen)} />
      )}
    </div>
  );
}
