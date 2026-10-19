"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Field";
import { searchProductsByNameOrBarcode } from "@/lib/repo/products";
import type { Product } from "@/lib/types";

/** Typeahead "Barcode/Product Name" input used across Stock, Orders,
 * Purchases and Invoices — mirrors the reference app's product search box. */
export function ProductPicker({
  onSelect,
  placeholder = "Type to search...",
  autoFocus,
}: {
  onSelect: (product: Product) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void searchProductsByNameOrBarcode(query).then(setResults);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {results.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
          {results.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => {
                onSelect(p);
                setQuery("");
                setResults([]);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-amber-50"
            >
              {p.name} {p.barcode ? `(${p.barcode})` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
