"use client";

import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { DUR, EASE_OUT } from "@/lib/motion";

/** Each page glides in when it opens. The old page is not kept for an exit
 * animation: waiting for it would make every click feel slower. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.slow, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
