"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { motion } from "motion/react";

/** Open dialogs, newest last: Escape closes only the top one. */
const stack: string[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** How many dialogs are open (floating buttons hide while a form is open). */
export function useOpenDialogCount(): number {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => stack.length,
    () => 0,
  );
}

/** Note: callers conditionally render `<Modal />` itself (`{open && <Modal/>}`),
 * so there's no persistent parent for `AnimatePresence` to track an exit
 * transition against — only the entrance animates. That's a deliberate
 * simplification; wiring real exit transitions would mean threading open/close
 * state through every call site instead of this single component.
 *
 * Phones: a bottom sheet as tall as needed (up to the screen), title and close
 * button always visible, the body scrolls. Escape closes the top dialog when the
 * cursor is not in a field (`closeOnEscape={false}` for forms that must not be
 * lost, such as an unfinished sale). */
export function Modal({
  title,
  onClose,
  children,
  width = "max-w-2xl",
  closeOnEscape = true,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
  closeOnEscape?: boolean;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    stack.push(id);
    changed();
    // Keep the page behind still while the dialog is open.
    const body = document.body;
    const before = body.style.overflow;
    body.style.overflow = "hidden";
    // Focus moves into the dialog (unless a field inside already took it, e.g. autoFocus).
    const prev = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
    return () => {
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
      changed();
      if (!stack.length) body.style.overflow = before;
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [id]);

  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || stack[stack.length - 1] !== id) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOnEscape, id]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-end justify-center backdrop-blur-sm sm:items-center sm:p-4"
      style={{ background: "color-mix(in srgb, var(--modal-overlay) 40%, transparent)" }}
    >
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.97, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[94dvh] w-full ${width} flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-black/5 outline-none sm:max-h-[90vh] sm:rounded-2xl`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-100 px-3 py-2 sm:px-5 sm:py-3.5">
          <h2 id={`${id}-title`} className="min-w-0 truncate text-base font-semibold tracking-tight text-neutral-900">{title}</h2>
          <motion.button
            type="button"
            aria-label="Close"
            whileHover={{ scale: 1.08, rotate: 90 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700 sm:h-7 sm:w-7"
          >
            <X size={15} />
          </motion.button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-5">{children}</div>
      </motion.div>
    </motion.div>
  );
}
