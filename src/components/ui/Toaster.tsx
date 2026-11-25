"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { currentNotices, dismissNotice, subscribeNotices, type Notice } from "@/lib/notify";
import { DUR, EASE_IN, SPRING_PANEL } from "@/lib/motion";

const EMPTY: Notice[] = [];

/** Shows notify() messages: bottom right on a computer, above the bottom bar
 * on a phone. Errors stay until read (or 10 s), others go after 5 s; hovering
 * keeps a message open. Screen readers hear them without losing their place. */
export function Toaster() {
  const notices = useSyncExternalStore(subscribeNotices, currentNotices, () => EMPTY);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:items-end print:hidden"
    >
      <AnimatePresence initial={false}>
        {notices.map((n) => <Toast key={n.id} notice={n} />)}
      </AnimatePresence>
    </div>
  );
}

const TONE = {
  error: { icon: AlertCircle, cls: "bg-white text-neutral-800 ring-rose-200", iconCls: "text-rose-600", bar: "bg-rose-500" },
  success: { icon: CheckCircle2, cls: "bg-white text-neutral-800 ring-emerald-200", iconCls: "text-emerald-600", bar: "bg-emerald-500" },
  info: { icon: Info, cls: "bg-white text-neutral-800 ring-black/10", iconCls: "text-[var(--accent)]", bar: "bg-[var(--accent)]" },
} as const;

function Toast({ notice }: { notice: Notice }) {
  const [hover, setHover] = useState(false);
  const t = TONE[notice.tone];
  const Icon = t.icon;
  useEffect(() => {
    if (hover) return;
    const ms = notice.tone === "error" ? 10_000 : 5_000;
    const timer = setTimeout(() => dismissNotice(notice.id), ms);
    return () => clearTimeout(timer);
  }, [hover, notice.id, notice.tone]);
  return (
    <motion.div
      layout
      role={notice.tone === "error" ? "alert" : "status"}
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: SPRING_PANEL }}
      exit={{ opacity: 0, x: 24, transition: { duration: DUR.fast, ease: EASE_IN } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`pointer-events-auto relative flex w-full max-w-sm items-start gap-2.5 overflow-hidden rounded-xl py-3 pl-4 pr-2 text-sm shadow-[0_10px_30px_-8px_rgba(0,0,0,0.25)] ring-1 ${t.cls}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${t.bar}`} aria-hidden="true" />
      <Icon size={18} className={`mt-px shrink-0 ${t.iconCls}`} aria-hidden="true" />
      <p className="min-w-0 flex-1 whitespace-pre-line break-words leading-snug">{notice.message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissNotice(notice.id)}
        className="-my-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
      >
        <X size={15} />
      </button>
    </motion.div>
  );
}
