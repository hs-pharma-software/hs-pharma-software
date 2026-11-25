import { forwardRef, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/** Fields: the focus ring is in the business's accent colour; a field marked
 * aria-invalid turns red; disabled and read-only fields look inactive. */
const baseClass =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition-[border-color,box-shadow,background-color] duration-150 " +
  "placeholder:text-neutral-400 hover:border-neutral-300 " +
  "focus:border-[var(--accent)] focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)] " +
  "aria-[invalid=true]:border-rose-400 aria-[invalid=true]:focus:ring-rose-500/15 " +
  "disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500 [&[readonly]]:bg-neutral-50/60";

export function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  /** A short help line under the field. */
  hint?: React.ReactNode;
  /** What is wrong with the value, shown in red under the field. */
  error?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-600">
        {required && <span className="text-rose-600" aria-hidden="true">*</span>} {label}
      </span>
      {children}
      {error ? (
        <span role="alert" className="field-msg text-xs text-rose-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-neutral-500">{hint}</span>
      ) : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input ref={ref} {...props} className={`${baseClass} ${props.className ?? ""}`} />;
  }
);

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${baseClass} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${baseClass} ${props.className ?? ""}`} />;
}
