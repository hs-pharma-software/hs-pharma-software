"use client";

import { useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";

/** A form's error message: a tinted box with an icon, read out by screen
 * readers, with a short shake when it appears or changes. It scrolls into view,
 * so a Save that failed at the bottom of a long form is never silent. */
export function FormError({ message, className = "" }: { message: React.ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!message) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    box.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [message]);
  if (!message) return null;
  return (
    <div
      ref={box}
      key={typeof message === "string" ? message : undefined}
      role="alert"
      className={`field-msg flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200/70 ${className}`}
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 whitespace-pre-line break-words">{message}</span>
    </div>
  );
}
