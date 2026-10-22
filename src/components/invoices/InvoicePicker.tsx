"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Field";
import { searchInvoicesForReturn, type InvoiceListRow } from "@/lib/repo/invoices";

/** Typeahead "search by bill # or customer" used to pick the original
 * invoice a return is against \u2014 the first step of Sale Item Return. */
export function InvoicePicker({
  onSelect,
  autoFocus,
}: {
  onSelect: (invoice: InvoiceListRow) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InvoiceListRow[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void searchInvoicesForReturn(query).then(setResults);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by Bill # or customer name..."
        autoFocus={autoFocus}
      />
      {results.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
          {results.map((inv) => (
            <button
              type="button"
              key={inv.id}
              onClick={() => {
                onSelect(inv);
                setQuery("");
                setResults([]);
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-amber-50"
            >
              <span>
                #{inv.invoice_no} \u2014 {inv.customer_name} <span className="text-neutral-400">({inv.date})</span>
              </span>
              <span className="text-neutral-500">{inv.total.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
