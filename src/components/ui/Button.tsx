import { ButtonHTMLAttributes, forwardRef } from "react";
import { motion, type HTMLMotionProps } from "motion/react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-amber-500 to-amber-600 text-white shadow-sm shadow-amber-600/30 hover:from-amber-400 hover:to-amber-600",
  secondary:
    "bg-white text-neutral-700 border border-neutral-200 shadow-sm hover:bg-neutral-50 hover:border-neutral-300",
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
