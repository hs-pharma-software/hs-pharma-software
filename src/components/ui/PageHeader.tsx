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
      className="mb-4 flex items-center justify-between rounded-xl border border-neutral-200/70 bg-white/90 px-5 py-3 shadow-sm backdrop-blur-sm"
    >
      <h1 className="font-serif text-xl text-neutral-800">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </motion.div>
  );
}
