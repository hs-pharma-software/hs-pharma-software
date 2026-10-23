"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { restaurant } from "@/lib/restaurant";
import type { KitchenStatus } from "@/lib/restaurant/engine";
import { Badge, KITCHEN_BADGE, Note, ORDER_TYPE_LABEL, RestGuard, useAction, useLoad, usePrinter } from "@/components/restaurant/ui";

export default function KitchenPage() {
  return (
    <RestGuard>
      <Kitchen />
    </RestGuard>
  );
}

/** Kitchen display: tickets with their dishes, per station, oldest first.
 * Shows new and updated orders as separate tickets (one per send). */
function Kitchen() {
  const [station, setStation] = useState<string>("");
  const { data, error, reload } = useLoad(() => restaurant.kitchenQueue(station || null), [station]);
  const all = useLoad(() => restaurant.kitchenQueue(null), []);
  const act = useAction();
  const printer = usePrinter();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => {
      void reload();
      void all.reload();
      setNow(Date.now());
    }, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const stations = useMemo(() => [...new Set((all.data ?? []).map((i) => i.station || "Kitchen"))].sort(), [all.data]);
  const tickets = useMemo(() => {
    const m = new Map<string, NonNullable<typeof data>>();
    for (const i of data ?? []) {
      const key = `${i.order_id}:${i.kot_no}`;
      m.set(key, [...(m.get(key) ?? []), i]);
    }
    return [...m.values()];
  }, [data]);

  const move = async (ids: string[], to: KitchenStatus) => {
    await act.run(() => restaurant.setKitchenStatus(ids, to));
    void reload();
  };

  // Reprints carry a REPRINT / copy-number banner (store.markKotPrinted).
  const reprint = async (orderId: string, kotNo: number | null) => {
    await act.run(async () => {
      if (kotNo == null) return;
      const kotId = await restaurant.findKot(orderId, kotNo);
      if (!kotId) throw new Error("Ticket not found.");
      const mark = await restaurant.markKotPrinted(kotId);
      const full = await restaurant.kotWithItems(kotId);
      printer.print({ kind: "kot", data: { ...full, reprint: mark.reprint, copy: mark.copy } });
    });
  };

  return (
    <div>
      <PageHeader title="Kitchen" actions={<Button onClick={() => void reload()}><RefreshCw size={14} /> Refresh</Button>} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {["", ...stations].map((s) => (
          <button key={s || "all"} type="button" onClick={() => setStation(s)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${station === s ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/[0.06]"}`}>
            {s || "All stations"}
          </button>
        ))}
      </div>
      {(error || act.error) && <div className="mb-3"><Note tone="rose">{error ?? act.error}</Note></div>}
      {tickets.length === 0 && <Note>No dishes waiting. New orders appear here when they are sent to the kitchen.</Note>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tickets.map((list) => {
          const first = list[0];
          const age = first.sent_at ? Math.max(0, Math.round((now - new Date(first.sent_at).getTime()) / 60000)) : 0;
          const late = age >= 20;
          const open = list.filter((i) => i.kitchen_status !== "ready");
          return (
            <div key={`${first.order_id}:${first.kot_no}`} className={`rounded-2xl bg-white p-3 shadow-sm ring-2 ${late ? "ring-rose-300" : "ring-black/[0.05]"}`}>
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <p className="text-lg font-bold">{first.table_name ? `Table ${first.table_name}` : ORDER_TYPE_LABEL[first.order_type]}</p>
                  <p className="text-xs text-neutral-500">Order #{first.order_no} · KOT {first.kot_no} · {first.station || "Kitchen"}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-sm font-semibold ${late ? "text-rose-600" : "text-neutral-600"}`}>{age} min</span>
                  <button type="button" title="Reprint ticket" onClick={() => void reprint(first.order_id, first.kot_no)} className="text-neutral-400 hover:text-neutral-700"><Printer size={14} /></button>
                </div>
              </div>
              {list.map((i) => {
                const mods = JSON.parse(i.modifiers ?? "[]") as string[];
                return (
                  <div key={i.id} className="flex items-start gap-2 border-t border-neutral-50 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{i.qty} x {i.name}</p>
                      {mods.length > 0 && <p className="text-xs text-neutral-500">+ {mods.join(", ")}</p>}
                      {i.notes && <p className="text-xs italic text-amber-700">Note: {i.notes}</p>}
                    </div>
                    <Badge cls={KITCHEN_BADGE[i.kitchen_status]}>{i.kitchen_status}</Badge>
                  </div>
                );
              })}
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <Button disabled={act.busy || !list.some((i) => i.kitchen_status === "sent")} onClick={() => void move(list.filter((i) => i.kitchen_status === "sent").map((i) => i.id), "preparing")} className="justify-center">Start</Button>
                <Button disabled={act.busy || !open.length} onClick={() => void move(open.map((i) => i.id), "ready")} className="justify-center">Ready</Button>
                <Button variant="primary" disabled={act.busy || !list.some((i) => i.kitchen_status === "ready")} onClick={() => void move(list.filter((i) => i.kitchen_status === "ready").map((i) => i.id), "served")} className="justify-center">Served</Button>
              </div>
            </div>
          );
        })}
      </div>
      {printer.view}
    </div>
  );
}
