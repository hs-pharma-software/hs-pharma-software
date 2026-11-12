/** Keyboard help for the long entry forms (invoice, quotation, purchase).
 *
 * - Enter in a field moves to the next EMPTY field, as in the item lines,
 *   skipping locked (disabled / read-only) ones. Item lines keep their own
 *   Enter handling and are skipped over. With no field left after it, Enter
 *   does what it did before (saves the form).
 * - The function keys written on field labels, e.g. "Paid (F8)", put the
 *   cursor in that field. */
import { useEffect, type KeyboardEvent, type RefObject } from "react";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const SKIP_TYPES = new Set(["hidden", "button", "submit", "reset", "file", "image"]);

/** Item-line cells: they have their own Enter handling. */
const inLines = (el: Element) => el.closest("table, [data-row]") !== null;

function usable(el: Control): boolean {
  if (el.disabled || (el as HTMLInputElement).readOnly) return false;
  if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) return false;
  if (el.tabIndex < 0) return false;
  return el.getClientRects().length > 0; // shown on screen
}

function isEmpty(el: Control): boolean {
  const v = el.value.trim();
  if (v === "") return true;
  return el instanceof HTMLInputElement && el.type === "number" && Number(v) === 0;
}

const focusSelect = (el: Control) => {
  el.focus();
  if (el instanceof HTMLInputElement && el.type !== "date" && el.type !== "checkbox") el.select();
};

/** Form onKeyDown: Enter moves to the next empty field. In an item line
 * without its own Enter handling: the next box in that line, then `home`
 * (the product search); never saves from a line. */
export function enterToNextField(e: KeyboardEvent<HTMLElement>, home?: () => void) {
  if (e.key !== "Enter" || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing) return;
  const from = e.target as Element;
  if (!(from instanceof HTMLInputElement || from instanceof HTMLSelectElement)) return;
  if (from instanceof HTMLInputElement && SKIP_TYPES.has(from.type)) return;
  if (inLines(from)) {
    e.preventDefault();
    const row = from.closest("tr, [data-row]")!;
    const cells = Array.from(row.querySelectorAll<Control>("input, select")).filter(usable);
    const next = cells[cells.indexOf(from as Control) + 1];
    if (next) focusSelect(next);
    else home?.();
    return;
  }
  const all = Array.from(e.currentTarget.querySelectorAll<Control>("input, select, textarea")).filter((el) => usable(el) && !inLines(el));
  const after = all.slice(all.indexOf(from as Control) + 1);
  const next = after.find(isEmpty) ?? after[0];
  if (!next) return; // the last field: Enter saves, as before
  e.preventDefault();
  focusSelect(next);
}

/** The field whose label carries this key, e.g. "(F8)" (its first usable control). */
function fieldFor(root: HTMLElement, key: string): HTMLElement | null {
  const tag = `(${key})`;
  for (const label of Array.from(root.querySelectorAll("label"))) {
    const text = label.querySelector("span")?.textContent ?? "";
    if (!text.includes(tag)) continue;
    const el = Array.from(label.querySelectorAll<HTMLElement>("input, select, textarea, button")).find((c) => {
      if (c instanceof HTMLButtonElement) return !c.disabled;
      return usable(c as Control);
    });
    if (el) return el;
  }
  return null;
}

/** F1 to F12 put the cursor in the field labelled with that key, while this form is the one in front. */
export function useFieldHotkeys(root: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!/^F([1-9]|1[0-2])$/.test(e.key) || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const el = root.current && fieldFor(root.current, e.key);
      if (!el) return;
      e.preventDefault();
      el.focus();
      if (el instanceof HTMLInputElement && el.type !== "date") el.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root, active]);
}
