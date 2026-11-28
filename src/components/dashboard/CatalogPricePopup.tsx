"use client";

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/store/authStore";
import { answerPrice, priceNotices, type CatalogNotice } from "@/lib/repo/catalogPrices";
import { localDate } from "@/lib/localDate";
import { notify } from "@/lib/notify";

const rate = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 2 });

function detail(n: CatalogNotice): string {
  if (n.kind === "increase") {
    const by = n.accepted ? "Confirmed by other businesses" : n.confirmations ? `Confirmed by ${n.confirmations} other business${n.confirmations === 1 ? "" : "es"}` : "Reported by one business";
    return `Price increased? ${by} · until ${n.endsAt.slice(0, 10)}`;
  }
  if (n.kind === "packing") return `Pack size changed ${n.oldPacking} → ${n.newPacking}. Your stock and records were converted (same number of units).`;
  return "Retail price reduced (approved by MAVIN.pk).";
}

/** "Catalogue changes": retail prices other businesses of the shared catalogue
 * say have gone up, and changes MAVIN.pk approved (a lower price, a new pack
 * size), for this business. Yes changes this business's own price; No leaves
 * it. Opens once a day while there is something to answer, and from its
 * dashboard button. */
export function CatalogPricePopup() {
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const userId = useAuthStore((s) => s.currentUser?.id ?? null);
  const key = `mavin.catalogPrices.${tenantId}.${userId}`;
  const [notices, setNotices] = useState<CatalogNotice[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !userId) return;
    let live = true;
    void priceNotices().then((list) => {
      if (!live) return;
      setNotices(list);
      let shown: string | null = null;
      try { shown = window.localStorage.getItem(key); } catch { /* private window */ }
      if (list.length && shown !== localDate()) setOpen(true);
    });
    return () => { live = false; };
  }, [tenantId, userId, key]);

  function close() {
    try { window.localStorage.setItem(key, localDate()); } catch { /* shows again next time */ }
    setOpen(false);
  }

  async function answer(n: CatalogNotice, yes: boolean) {
    setBusy(n.id);
    try {
      await answerPrice(n.id, yes ? "yes" : "no");
      const left = notices.filter((x) => x.id !== n.id);
      setNotices(left);
      if (yes && n.newPrice > 0) notify(`${n.name}: your retail price is now Rs ${rate(n.newPrice)}.`, "success");
      if (!left.length) close();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!notices.length) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Retail price and pack size changes"
        className="relative flex items-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-neutral-700 shadow-sm ring-1 ring-black/[0.06] transition hover:bg-neutral-50">
        <TrendingUp size={15} />Price changes
        <span className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-rose-600 px-1 text-center text-[11px] font-bold leading-5 text-white">{notices.length}</span>
      </button>
      {open && (
        <Modal title="Price and packing changes" onClose={close} width="max-w-2xl">
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-neutral-600">Yes (or Apply) changes your retail price. No keeps yours.</p>
            <ul className="max-h-[60vh] divide-y divide-neutral-100 overflow-y-auto rounded-xl ring-1 ring-black/[0.06]">
              {notices.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                  <span className="min-w-[12rem] flex-1">
                    <span className="block break-words font-medium text-neutral-900">{n.name}</span>
                    <span className="block text-[11px] text-neutral-500">{detail(n)}</span>
                  </span>
                  {n.newPrice > 0 && (
                    <span className="whitespace-nowrap tabular-nums">
                      {n.myPrice > 0 && <span className="text-neutral-400 line-through">{rate(n.myPrice)}</span>}{" "}
                      <b className={n.newPrice > n.myPrice ? "text-rose-700" : "text-emerald-700"}>Rs {rate(n.newPrice)}</b>{n.unit ? <span className="text-neutral-500"> / {n.unit}</span> : null}
                    </span>
                  )}
                  <span className="flex gap-1.5">
                    {n.newPrice > 0 ? (
                      <>
                        <Button type="button" variant="primary" disabled={busy !== null} loading={busy === n.id} onClick={() => void answer(n, true)}>{n.kind === "increase" ? "Yes" : "Apply"}</Button>
                        <Button type="button" disabled={busy !== null} onClick={() => void answer(n, false)}>{n.kind === "increase" ? "No" : "Keep mine"}</Button>
                      </>
                    ) : (
                      <Button type="button" disabled={busy !== null} loading={busy === n.id} onClick={() => void answer(n, false)}>OK</Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end"><Button type="button" onClick={close}>Later</Button></div>
          </div>
        </Modal>
      )}
    </>
  );
}
