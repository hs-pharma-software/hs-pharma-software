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
      className="mb-5 flex items-center justify-between"
    >
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </motion.div>
  );
}
