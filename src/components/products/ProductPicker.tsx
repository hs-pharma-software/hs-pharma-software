"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Input } from "@/components/ui/Field";
import { searchProductsByNameOrBarcode } from "@/lib/repo/products";
import type { Product } from "@/lib/types";

export interface ProductPickerHandle {
  focus: () => void;
}

/** Typeahead "Barcode/Product Name" input used across Stock, Orders,
 * Purchases and Invoices — mirrors the reference app's product search box.
 * Supports arrow-key navigation through suggestions and Enter to select. */
export const ProductPicker = forwardRef<
  ProductPickerHandle,
  {
    onSelect: (product: Product) => void;
    placeholder?: string;
    autoFocus?: boolean;
  }
>(function ProductPicker({ onSelect, placeholder = "Type to search...", autoFocus }, ref) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setActiveIdx(-1);
      return;
    }
    const t = setTimeout(() => {
      void searchProductsByNameOrBarcode(query).then((r) => {
        setResults(r);
        setActiveIdx(-1);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // Scroll highlighted item into view whenever activeIdx changes.
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const child = listRef.current.children[activeIdx] as HTMLElement | undefined;
    child?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      const p = results[activeIdx];
      onSelect(p);
      setQuery("");
      setResults([]);
      setActiveIdx(-1);
    }
  }

  function select(p: Product) {
    onSelect(p);
    setQuery("");
    setResults([]);
    setActiveIdx(-1);
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {results.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg"
        >
          {results.map((p, i) => (
            <button
              type="button"
              key={p.id}
              onClick={() => select(p)}
              className={`block w-full px-3 py-1.5 text-left text-sm ${
                i === activeIdx
                  ? "bg-amber-100 text-amber-900"
                  : "hover:bg-amber-50"
              }`}
            >
              {p.name} {p.barcode ? `(${p.barcode})` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
