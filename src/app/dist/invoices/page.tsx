"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DistGuard, PageTitle } from "@/components/dist/ui";
import { DocTable } from "@/components/dist/DocTable";
import { SaleForm } from "@/components/dist/DocForm";
import { DocView } from "@/components/dist/DocView";

export default function InvoicesPage() {
  return (
    <DistGuard need="invoices.view">
      {(c) => <Invoices c={c} />}
    </DistGuard>
  );
}

function Invoices({ c }: { c: Parameters<typeof SaleForm>[0]["c"] }) {
  const [type, setType] = useState<"sale" | "sale_return">("sale");
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-3">
      <PageTitle title="Sales Invoices" sub="Finalized invoices are never edited; corrections are credit notes." actions={c.can("invoices.create") && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> New invoice</Button>} />
      <div className="flex gap-1">
        {(["sale", "sale_return"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setType(t)} className={`rounded-full px-4 py-1.5 text-sm ${type === t ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/10"}`}>{t === "sale" ? "Invoices" : "Credit notes / returns"}</button>
        ))}
      </div>
      <DocTable type={type} reloadKey={key} />
      {creating && <SaleForm c={c} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setSaved(id); setKey((k) => k + 1); }} />}
      {saved && <DocView id={saved} onClose={() => setSaved(null)} />}
    </div>
  );
}
