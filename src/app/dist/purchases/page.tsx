"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DistGuard, PageTitle } from "@/components/dist/ui";
import { DocTable } from "@/components/dist/DocTable";
import { PurchaseForm } from "@/components/dist/DocForm";
import { DocView } from "@/components/dist/DocView";

export default function PurchasesPage() {
  return <DistGuard need="purchases.view">{(c) => <Purchases c={c} />}</DistGuard>;
}

function Purchases({ c }: { c: Parameters<typeof PurchaseForm>[0]["c"] }) {
  const [type, setType] = useState<"purchase" | "purchase_return">("purchase");
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-3">
      <PageTitle title="Purchases" sub="Goods received from suppliers (principals) add stock." actions={c.can("purchases.create") && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> New purchase</Button>} />
      <div className="flex gap-1">
        {(["purchase", "purchase_return"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setType(t)} className={`rounded-full px-4 py-1.5 text-sm ${type === t ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/10"}`}>{t === "purchase" ? "Purchases" : "Purchase returns"}</button>
        ))}
      </div>
      <DocTable type={type} reloadKey={key} />
      {creating && <PurchaseForm c={c} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setSaved(id); setKey((k) => k + 1); }} />}
      {saved && <DocView id={saved} onClose={() => setSaved(null)} />}
    </div>
  );
}
