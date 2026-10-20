"use client";

import { useState } from "react";
import { Pill, RefreshCw, Wifi, WifiOff, UserCircle, Calculator, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAppStore } from "@/store/appStore";
import { useAuthStore } from "@/store/authStore";
import { triggerManualSync } from "@/components/sync/SyncProvider";
import { UpdateChecker } from "./UpdateChecker";

export function Topbar() {
  const online = useAppStore((s) => s.online);
  const syncStatus = useAppStore((s) => s.syncStatus);
  const pendingCount = useAppStore((s) => s.pendingCount);
  const lastError = useAppStore((s) => s.lastError);
  const [showStatus, setShowStatus] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const currentUser = useAuthStore((s) => s.currentUser);
  const currentTenant = useAuthStore((s) => s.currentTenant);
  const logout = useAuthStore((s) => s.logout);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-neutral-200/70 bg-white/80 px-4 backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <motion.div
          initial={{ scale: 0.8, rotate: -8 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-sm shadow-rose-500/40"
        >
          <Pill size={18} />
        </motion.div>
        <span className="bg-gradient-to-r from-amber-700 to-amber-500 bg-clip-text text-lg font-semibold tracking-tight text-transparent">
          eSales Pharmacy
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative">
          <motion.button
            type="button"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setShowStatus((v) => !v);
              void triggerManualSync();
            }}
            title="Sync now"
            className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
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
                  className="text-neutral-400"
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
                    Working offline — everything you do is saved locally and will push to Turso
                    automatically once you&apos;re back online.
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <UpdateChecker />
        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
          type="button"
          onClick={() => useAppStore.getState().setCalculatorOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
          title="Calculator (Ctrl+T)"
        >
          <Calculator size={17} />
        </motion.button>
        <div className="relative">
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.94 }}
            type="button"
            onClick={() => setShowAccount((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
            title="Account"
          >
            <UserCircle size={20} />
          </motion.button>

          <AnimatePresence>
            {showAccount && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="absolute right-0 top-10 z-20 w-56 rounded-xl border border-neutral-200 bg-white p-3 text-xs shadow-xl ring-1 ring-black/5"
              >
                <p className="font-medium text-neutral-800">{currentUser?.displayName || currentUser?.username}</p>
                <p className="mt-0.5 text-neutral-500">
                  {currentUser?.role === "super_admin" ? "Super Admin" : currentTenant?.name ?? "—"}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowAccount(false);
                    logout();
                  }}
                  className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-medium text-rose-600 hover:bg-rose-50"
                >
                  <LogOut size={14} /> Logout
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
