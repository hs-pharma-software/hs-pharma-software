import { ButtonHTMLAttributes, forwardRef } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { Loader2 } from "lucide-react";
import { SPRING_PRESS } from "@/lib/motion";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "btn-primary-theme",
  secondary:
    "bg-white text-neutral-700 shadow-[0_1px_3px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.06] hover:bg-neutral-50 hover:shadow-[0_2px_6px_rgba(0,0,0,0.08)] active:bg-neutral-100",
  danger:
    "bg-gradient-to-b from-rose-500 to-rose-600 text-white shadow-sm shadow-rose-600/30 hover:from-rose-400 hover:to-rose-600",
  ghost: "bg-transparent text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200/70",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Work in progress: shows a spinner and blocks a second click. */
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", className = "", disabled, loading = false, children, ...props },
  ref
) {
  const off = disabled || loading;
  return (
    <motion.button
      ref={ref}
      whileHover={off ? undefined : { scale: 1.02, y: -1 }}
      whileTap={off ? undefined : { scale: 0.97, y: 0 }}
      transition={SPRING_PRESS}
      disabled={off}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium sm:min-h-0 transition-[background-color,box-shadow,color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...(props as HTMLMotionProps<"button">)}
    >
      {loading && <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" />}
      {children as React.ReactNode}
    </motion.button>
  );
});
