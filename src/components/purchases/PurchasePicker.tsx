"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Field";
import { searchPurchasesForReturn, type PurchaseListRow } from "@/lib/repo/purchases";

/** Typeahead "search by P.ID or supplier" used to pick the original
 * purchase a return is against \u2014 the first step of both Purchase Item
 * Return and the whole-invoice Purchase Return. */
export function PurchasePicker({
  onSelect,
  autoFocus,
}: {
  onSelect: (purchase: PurchaseListRow) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PurchaseListRow[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void searchPurchasesForReturn(query).then(setResults);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by P.ID or supplier name..."
        autoFocus={autoFocus}
      />
      {results.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
          {results.map((pu) => (
            <button
              type="button"
              key={pu.id}
              onClick={() => {
                onSelect(pu);
                setQuery("");
                setResults([]);
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-amber-50"
            >
              <span>
                #{pu.purchase_no} {"\u2014"} {pu.supplier_name} <span className="text-neutral-400">({pu.date})</span>
              </span>
              <span className="text-neutral-500">Bal {pu.balance.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
