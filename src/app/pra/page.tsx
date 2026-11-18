"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { PraServerStatus, PraSubmissions } from "@/components/pra/PraSubmissions";
import { serverJson } from "@/lib/serverMode";
import { setPraSending, usePraContractor } from "@/lib/praClient";
import { useAuthStore } from "@/store/authStore";

/** A contractor's PRA section: switch sending on or off, and see what PRA received. */
export default function ContractorPraPage() {
  const pra = usePraContractor();
  const isOwner = useAuthStore((s) => s.currentUser?.role === "owner");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  async function toggle() {
    const next = !pra.sending;
    if (!next && !window.confirm("Stop sending PRA invoices? New PRA invoices are held and sent when you switch this on again.")) return;
    setBusy(true);
    setError(null);
    try {
      await setPraSending(next);
      // Back on: what was held goes now.
      if (next) await serverJson("/api/pra/", { action: "process" });
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!pra.loaded) return null;
  if (!pra.integrated) {
    return (
      <div>
        <PageHeader title="PRA e-Invoicing" />
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">PRA is not enabled for your business. Ask MAVIN.pk to set it up.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="PRA e-Invoicing" />
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/[0.05]">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Send invoices to PRA</h2>
          <p className="mt-1 text-sm text-neutral-600">
            {pra.sending
              ? "On. Every PRA Invoice you save goes to PRA. General and Medicine invoices stay with FBR."
              : "Off. The PRA Invoice option is hidden, and invoices already made are held until you switch this on."}
          </p>
          {!isOwner && <p className="mt-1 text-xs text-neutral-500">Only the business owner can change this.</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={pra.sending}
          aria-label="Send invoices to PRA"
          disabled={!isOwner || busy}
          onClick={() => void toggle()}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${pra.sending ? "bg-blue-700" : "bg-neutral-300"}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${pra.sending ? "left-7" : "left-1"}`} />
        </button>
        {error && <p role="alert" className="basis-full text-sm text-rose-600">{error}</p>}
      </section>
      <PraServerStatus />
      <p className="text-sm text-neutral-600">
        Add what you bill under <Link href="/products/services" className="font-medium text-blue-700 hover:underline">Products &gt; Services</Link>, then choose <b>PRA Invoice</b> as the invoice type.
      </p>
      <PraSubmissions key={refresh} canReconcile={isOwner} />
    </div>
  );
}
