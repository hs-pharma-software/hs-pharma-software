"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/store/appStore";

const KEYS = [
  ["C", "±", "%", "÷"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "−"],
  ["1", "2", "3", "+"],
  ["0", ".", "="],
];

function compute(a: number, op: string, b: number): number {
  switch (op) {
    case "+":
      return a + b;
    case "−":
      return a - b;
    case "×":
      return a * b;
    case "÷":
      return b === 0 ? NaN : a / b;
    default:
      return b;
  }
}

/** CTRL+T (System Calculator, per Utilities -> System Shortcuts) toggles
 * this — mounted once in AppShell so it works from anywhere in the app. */
export function Calculator() {
  const open = useAppStore((s) => s.calculatorOpen);
  const setOpen = useAppStore((s) => s.setCalculatorOpen);
  const [display, setDisplay] = useState("0");
  const [stored, setStored] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [justEvaluated, setJustEvaluated] = useState(false);

  if (!open) return null;

  function pressDigit(d: string) {
    if (justEvaluated) {
      setDisplay(d === "." ? "0." : d);
      setJustEvaluated(false);
      return;
    }
    if (d === "." && display.includes(".")) return;
    setDisplay((prev) => (prev === "0" && d !== "." ? d : prev + d));
  }

  function pressOp(op: string) {
    const current = Number(display);
    if (stored !== null && pendingOp) {
      const result = compute(stored, pendingOp, current);
      setStored(result);
      setDisplay(String(result));
    } else {
      setStored(current);
    }
    setPendingOp(op);
    setJustEvaluated(true);
  }

  function pressEquals() {
    if (stored === null || !pendingOp) return;
    const result = compute(stored, pendingOp, Number(display));
    setDisplay(String(result));
    setStored(null);
    setPendingOp(null);
    setJustEvaluated(true);
  }

  function pressKey(key: string) {
    if (key === "C") {
      setDisplay("0");
      setStored(null);
      setPendingOp(null);
      setJustEvaluated(false);
    } else if (key === "±") {
      setDisplay((prev) => String(Number(prev) * -1));
    } else if (key === "%") {
      setDisplay((prev) => String(Number(prev) / 100));
    } else if (key === "=") {
      pressEquals();
    } else if (["+", "−", "×", "÷"].includes(key)) {
      pressOp(key);
    } else {
      pressDigit(key);
    }
  }

  return (
    <Modal title="-:System Calculator:-" onClose={() => setOpen(false)} width="max-w-xs">
      <div className="rounded-lg bg-neutral-900 px-4 py-5 text-right font-mono text-3xl text-white">
        {display}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {KEYS.flat().map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => pressKey(key)}
            className={`rounded-md py-3 text-sm font-medium ${
              key === "0" ? "col-span-2" : ""
            } ${
              ["÷", "×", "−", "+", "="].includes(key)
                ? "bg-amber-500 text-white hover:bg-amber-600"
                : key === "C"
                  ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
                  : "bg-neutral-100 text-neutral-800 hover:bg-neutral-200"
            }`}
          >
            {key}
          </button>
        ))}
      </div>
    </Modal>
  );
}
