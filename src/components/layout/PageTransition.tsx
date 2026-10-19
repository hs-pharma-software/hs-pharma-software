"use client";

import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";

/** Fades/slides each route's content in on navigation. Keyed by pathname so
 * AnimatePresence treats every route change as a mount/unmount pair. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
