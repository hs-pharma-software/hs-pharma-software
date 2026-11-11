"use client";

import { useState } from "react";
import { LanguageToggle } from "@/components/electric/LanguageSync";
import Image from "next/image";
import { RefreshCw, Wifi, WifiOff, UserCircle, Calculator, Menu } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAppStore } from "@/store/appStore";
import { useAuthStore } from "@/store/authStore";
import { triggerManualSync } from "@/components/sync/SyncProvider";
import { UpdateChecker } from "./UpdateChecker";
import { ProfilePanel } from "./ProfilePanel";
import { InstallAppButton } from "./InstallAppButton";
import { BranchSwitcher } from "@/components/branches/BranchSwitcher";
import { DesktopSyncPill } from "./DesktopSyncPill";
import { useDesktopStatus } from "@/lib/desktopBridge";

export function Topbar() {
  const online = useAppStore((s) => s.online);
  const syncStatus = useAppStore((s) => s.syncStatus);
  const pendingCount = useAppStore((s) => s.pendingCount);
  const lastError = useAppStore((s) => s.lastError);
  const sidebarMobileOpen = useAppStore((s) => s.sidebarMobileOpen);
  const setSidebarMobileOpen = useAppStore((s) => s.setSidebarMobileOpen);
  const [showStatus, setShowStatus] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const logout = useAuthStore((s) => s.logout);
  // MAVIN desktop app: its own connection and sync state in this spot.
  const desktop = useDesktopStatus();

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] bg-white/80 px-2 backdrop-blur-xl sm:px-4 print:hidden" style={{ paddingLeft: "max(0.5rem, env(safe-area-inset-left))", paddingRight: "max(0.5rem, env(safe-area-inset-right))" }}>
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
        {/* Hamburger — mobile only */}
        <button
          type="button"
          onClick={() => setSidebarMobileOpen(!sidebarMobileOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 md:hidden"
          title="Menu"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
          className="flex items-center"
        >
          <Image src="/mavin-mark.png" alt="MAVIN.pk" width={256} height={256} priority className="h-8 w-8 object-contain sm:hidden" />
          <Image src="/mavin-header.png" alt="MAVIN.pk" width={1405} height={361} priority className="hidden h-8 w-auto object-contain sm:block sm:h-10" />
        </motion.div>
      </div>

      {/* Tight on a phone so every control fits in 390px. */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-3">
        <BranchSwitcher />
        <LanguageToggle />
        {desktop ? <DesktopSyncPill status={desktop} /> : <div className="relative">
          <motion.button
            type="button"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setShowStatus((v) => !v);
              void triggerManualSync();
            }}
            title="Sync now"
            className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 sm:px-3"
          >
            {online ? (
              <Wifi size={14} className="text-emerald-600" />
            ) : (
              <WifiOff size={14} className="text-neutral-400" />
            )}
            <RefreshCw
              size={13}
              className={syncStatus === "syncing" ? "animate-spin text-amber-600" : "text-neutral-500"}
            />
            <AnimatePresence mode="wait" initial={false}>
              {pendingCount > 0 ? (
                <motion.span
                  key="count"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 25 }}
                  className="rounded-full bg-amber-100 px-1.5 font-semibold text-amber-800"
                >
                  {pendingCount}
                </motion.span>
              ) : (
                <motion.span
                  key="synced"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="hidden text-neutral-400 sm:inline"
                >
                  synced
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>

          <AnimatePresence>
            {showStatus && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="absolute right-0 top-10 z-20 w-64 rounded-xl border border-neutral-200 bg-white p-3 text-xs shadow-xl ring-1 ring-black/5"
              >
                <p className="font-medium text-neutral-800">
                  {online ? "Online" : "Offline"} &middot; {pendingCount} change
                  {pendingCount === 1 ? "" : "s"} waiting to sync
                </p>
                {lastError && <p className="mt-1 text-rose-600">{lastError}</p>}
                {!online && (
                  <p className="mt-1 text-neutral-500">
                    Working offline {"\u2014"} everything you do is saved locally and will push to Turso
                    automatically once you&apos;re back online.
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>}

        <UpdateChecker />
        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
          type="button"
          onClick={() => useAppStore.getState().setCalculatorOpen(true)}
          className="hidden h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 sm:flex"
          title="Calculator (Ctrl+T)"
          aria-label="Calculator"
        >
          <Calculator size={17} />
        </motion.button>
        <div className="relative">
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.94 }}
            type="button"
            onClick={() => setShowAccount((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 sm:h-8 sm:w-8"
            title="Account"
            aria-label="Account"
            aria-expanded={showAccount}
          >
            <UserCircle size={20} />
          </motion.button>

          <AnimatePresence>
            {showAccount && (
              <>
                {/* Click anywhere outside to close. */}
                <div className="fixed inset-0 z-10" aria-hidden onClick={() => setShowAccount(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  className="absolute right-0 top-11 z-20 max-h-[calc(100dvh-4rem)] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 shadow-xl ring-1 ring-black/5 sm:w-auto"
                >
                  <div className="mb-3 flex flex-wrap gap-2 border-b border-neutral-100 pb-3 sm:hidden">
                    <button type="button" onClick={() => { setShowAccount(false); useAppStore.getState().setCalculatorOpen(true); }} className="flex min-h-10 items-center gap-2 rounded-lg border border-neutral-200 px-3 text-sm text-neutral-700">
                      <Calculator size={16} /> Calculator
                    </button>
                    <InstallAppButton className="flex min-h-10 items-center gap-2 rounded-lg border border-neutral-200 px-3 text-sm text-neutral-700" />
                  </div>
                  <ProfilePanel
                    onClose={() => setShowAccount(false)}
                    onLogout={() => {
                      setShowAccount(false);
                      logout();
                    }}
                  />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
