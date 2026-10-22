"use client";

import { X } from "lucide-react";
import { motion } from "motion/react";

/** Note: callers conditionally render `<Modal />` itself (`{open && <Modal/>}`),
 * so there's no persistent parent for `AnimatePresence` to track an exit
 * transition against — only the entrance animates. That's a deliberate
 * simplification; wiring real exit transitions would mean threading open/close
 * state through every call site instead of this single component. */
export function Modal({
  title,
  onClose,
  children,
  width = "max-w-2xl",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${width} overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5`}
      >
        <div className="flex items-center justify-between bg-gradient-to-r from-neutral-100 to-neutral-50 px-5 py-3.5">
          <h2 className="font-serif text-lg text-neutral-800">{title}</h2>
          <motion.button
            type="button"
            whileHover={{ scale: 1.08, rotate: 90 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700"
          >
            <X size={15} />
          </motion.button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </motion.div>
    </motion.div>
  );
}
