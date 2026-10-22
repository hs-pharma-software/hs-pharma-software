import { forwardRef, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const baseClass =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-black/[0.06]";

export function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-600">
        {required && <span className="text-rose-600">*</span>} {label}
      </span>
      {children}
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
