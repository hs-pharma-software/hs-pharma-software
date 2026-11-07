"use client";

import { useEffect, useRef, useState } from "react";

/** Text cut to a few lines with "Read more" when it is longer (the full text
 * stays in the page for search engines; only its display is shortened). */
export function ReadMore({ text, className = "", lines = 5 }: { text: string; className?: string; lines?: 3 | 4 | 5 | 6 | 8 }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setLong(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  const clamp = { 3: "line-clamp-3", 4: "line-clamp-4", 5: "line-clamp-5", 6: "line-clamp-6", 8: "line-clamp-8" }[lines];
  return (
    <div>
      <p ref={ref} className={`whitespace-pre-line ${open ? "" : clamp} ${className}`}>{text}</p>
      {(long || open) && (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-1 text-sm font-semibold text-[#1565c0] hover:underline">
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
