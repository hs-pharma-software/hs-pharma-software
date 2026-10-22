"use client";

import { useState, useEffect } from "react";
import { Download, CheckCircle } from "lucide-react";
import { motion } from "motion/react";
import { isTauriShell } from "@/lib/platform";

type Status = "idle" | "available" | "downloading" | "done";

export function UpdateChecker() {
  const [status, setStatus] = useState<Status>("idle");
  const [newVersion, setNewVersion] = useState("");

  useEffect(() => {
    if (!isTauriShell()) return;

    const run = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (update?.available) {
          setNewVersion(update.version);
          setStatus("available");
        }
      } catch {
        // silently ignore \u2014 no update or no network
      }
    };

    const t = setTimeout(() => void run(), 4000);
    return () => clearTimeout(t);
  }, []);

  const handleInstall = async () => {
    if (status !== "available") return;
    setStatus("downloading");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update?.available) {
        await update.downloadAndInstall();
        setStatus("done");
      }
    } catch {
      setStatus("available");
    }
  };

  if (status === "idle") return null;

  if (status === "done") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle size={13} />
        Updated {"\u2014"} restart to apply
      </div>
    );
  }

  return (
    <motion.button
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      type="button"
      onClick={() => void handleInstall()}
      disabled={status === "downloading"}
      title={`Update to v${newVersion}`}
      className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 shadow-sm hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Download size={13} className={status === "downloading" ? "animate-bounce" : ""} />
      {status === "downloading" ? "Installing…" : `Update v${newVersion}`}
    </motion.button>
  );
}
