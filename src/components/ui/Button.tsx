import { ButtonHTMLAttributes, forwardRef } from "react";
import { motion, type HTMLMotionProps } from "motion/react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "btn-primary-theme",
  secondary:
    "bg-white text-neutral-700 shadow-[0_1px_3px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.06] hover:bg-neutral-50",
  danger:
    "bg-gradient-to-b from-rose-500 to-rose-600 text-white shadow-sm shadow-rose-600/30 hover:from-rose-400 hover:to-rose-600",
  ghost: "bg-transparent text-neutral-600 hover:bg-neutral-100",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", className = "", disabled, ...props },
  ref
) {
  return (
    <motion.button
      ref={ref}
      whileHover={disabled ? undefined : { scale: 1.03 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...(props as HTMLMotionProps<"button">)}
    />
  );
});
