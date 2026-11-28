"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { proposePrices, type PriceQuestion } from "@/lib/repo/catalogPrices";
import { notify } from "@/lib/notify";

const rate = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 2 });

/** After a purchase that changed a shared product's retail price: has the
 * retail price itself changed (a rise is put to other businesses, a fall to
 * MAVIN.pk), or only this business's own price? The purchase is already saved
 * either way. */
export function RetailPriceQuestion({ questions, onDone }: { questions: PriceQuestion[]; onDone: () => void }) {
  const [chosen, setChosen] = useState(() => new Set(questions.map((q) => q.productId)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setChosen((s) => {
    const n = new Set(s);
    if (!n.delete(id)) n.add(id);
    return n;
  });

  async function yes() {
    setBusy(true);
    try {
      await proposePrices(questions.filter((q) => chosen.has(q.productId)).map((q) => ({ productId: q.productId, price: q.newPrice, previousPrice: q.oldPrice })));
    } catch (e) {
      notify(`The purchase is saved, but the price change was not shared: ${e instanceof Error ? e.message : String(e)}`);
    }
    onDone();
  }

  return (
    <Modal title="Has the retail price changed?" onClose={onDone} width="max-w-lg">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-neutral-600">
          The purchase is saved. If the company has changed the retail price, tick the products and choose Yes: a higher price is put to other businesses to confirm, a lower one goes to MAVIN.pk to approve. If it is only your own selling price, choose No.
        </p>
        <ul className="divide-y divide-neutral-100 rounded-lg ring-1 ring-neutral-200">
          {questions.map((q) => (
            <li key={q.productId}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                <input type="checkbox" checked={chosen.has(q.productId)} onChange={() => toggle(q.productId)} />
                <span className="min-w-0 flex-1 break-words font-medium text-neutral-800">{q.name}</span>
                <span className="whitespace-nowrap text-neutral-500">
                  Rs {rate(q.oldPrice)} &rarr; <b className={q.direction === "up" ? "text-rose-700" : "text-emerald-700"}>Rs {rate(q.newPrice)}</b>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={onDone} disabled={busy}>No, only my price</Button>
          <Button type="button" variant="primary" onClick={() => void yes()} disabled={busy || chosen.size === 0}>Yes, retail price changed</Button>
        </div>
      </div>
    </Modal>
  );
}
