"use client";

import { useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";

/** Animates a number counting up from its previous value whenever `value`
 * changes. Used on the dashboard KPI tiles. */
export function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
  const motionValue = useMotionValue(0);
  const rendered = useTransform(motionValue, (v) =>
    format ? format(v) : Math.round(v).toLocaleString()
  );
  const prevValue = useRef(0);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 0.6,
      ease: "easeOut",
    });
    prevValue.current = value;
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <motion.span>{rendered}</motion.span>;
}
