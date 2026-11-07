"use client";

import { motion } from "motion/react";

export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:mb-5"
    >
      <h1 className="min-w-0 text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">{title}</h1>
      {/* On a phone the buttons wrap under the title instead of off the screen. */}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </motion.div>
  );
}
