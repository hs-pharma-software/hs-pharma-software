"use client";

import { useEffect, useState } from "react";
import { Repeat } from "lucide-react";
import { lastPurchases, type LastPurchase } from "@/lib/repo/stockLedger";
import { dayMonthYear } from "@/lib/stockLedger";

/** While a purchase is entered: the products last bought from another
 * distributor, so the change is seen before saving (the Stock Register shows it). */
export function DistributorChangeNote({ products, supplierId, supplierName }: {
  products: { id: string; name: string }[];
  supplierId: string;
  supplierName: string;
}) {
  const [last, setLast] = useState<Map<string, LastPurchase>>(new Map());
  const key = products.map((p) => p.id).join(",");

  useEffect(() => {
    let current = true;
    // A reminder only: if it can't be read, the purchase is entered as usual.
    void lastPurchases(key ? key.split(",") : []).then((m) => { if (current) setLast(m); }).catch(() => undefined);
    return () => { current = false; };
  }, [key]);

  const changed = supplierId ? products.flatMap((p) => { const l = last.get(p.id); return l && l.supplierId !== supplierId ? [{ ...p, last: l }] : []; }) : [];
  if (!changed.length) return null;
  return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="flex items-center gap-1.5 font-semibold"><Repeat size={13} aria-hidden="true" />Distributor changed: now {supplierName}</p>
      <ul className="mt-1 space-y-0.5">
        {changed.slice(0, 5).map((c) => <li key={c.id}><b>{c.name}</b> was last bought from {c.last.supplier} on {dayMonthYear(c.last.date)}.</li>)}
        {changed.length > 5 && <li>and {changed.length - 5} more.</li>}
      </ul>
    </div>
  );
}
