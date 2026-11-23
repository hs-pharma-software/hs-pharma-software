"use client";

import { useEffect, useState } from "react";
import { Bell, TrendingDown, TrendingUp } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/store/authStore";
import { useCan } from "@/lib/actionPermissions";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { pharmacyDaySummary, rateChanges, type DayFigures, type RateChange } from "@/lib/repo/pharmacyDay";

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const rate = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 2 });
const WEEK_MS = 7 * 24 * 3600 * 1000;

interface Seen { shownOn: string | null; seenAt: string | null }

/** Per login, in this browser only: when the pop-up last showed, and the rate changes already seen. */
function readSeen(key: string): Seen {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Partial<Seen>;
    return { shownOn: v.shownOn ?? null, seenAt: v.seenAt ?? null };
  } catch {
    return { shownOn: null, seenAt: null };
  }
}
function writeSeen(key: string, v: Seen) {
  try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window: shows again next time */ }
}

/** Pharmacy dashboard: a "Today" button (with a count of new rate changes)
 * and a pop-up that opens on the first visit of the day, or when a product's
 * rate changed since it was last seen: today's sale and profit, the last
 * day's sale, and the rate changes of the last 7 days. Profit and purchase
 * rates only for logins that may see purchase rates. */
export function PharmacyDayPopup() {
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const userId = useAuthStore((s) => s.currentUser?.id ?? null);
  const seeCost = useCan("invoice.purchase_rate");
  const key = `mavin.pharmacyDay.${tenantId}.${userId}`;
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState<DayFigures | null>(null);
  const [lastDay, setLastDay] = useState<DayFigures | null>(null);
  const [changes, setChanges] = useState<RateChange[]>([]);
  const [seenAt, setSeenAt] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri() || !tenantId || !userId) return;
    let live = true;
    (async () => {
      const since = new Date(Date.now() - WEEK_MS).toISOString();
      const [day, ch] = await Promise.all([
        pharmacyDaySummary().catch((e) => { console.error("Dashboard: day summary failed", e); return null; }),
        rateChanges(since, seeCost).catch((e) => { console.error("Dashboard: rate changes failed", e); return [] as RateChange[]; }),
      ]);
      if (!live) return;
      setToday(day?.today ?? null);
      setLastDay(day?.lastDay ?? null);
      setChanges(ch);
      const s = readSeen(key);
      setSeenAt(s.seenAt);
      const fresh = ch.some((c) => !s.seenAt || c.at > s.seenAt);
      if (s.shownOn !== localDate() || fresh) setOpen(true);
    })();
    return () => { live = false; };
  }, [tenantId, userId, seeCost, key]);

  const isNew = (c: RateChange) => !seenAt || c.at > seenAt;
  const newCount = changes.filter(isNew).length;

  function close() {
    const now = new Date().toISOString();
    writeSeen(key, { shownOn: localDate(), seenAt: now });
    setSeenAt(now);
    setOpen(false);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Today's sale and rate changes"
        className="relative flex items-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-neutral-700 shadow-sm ring-1 ring-black/[0.06] transition hover:bg-neutral-50">
        <Bell size={15} />Today
        {newCount > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-rose-600 px-1 text-center text-[11px] font-bold leading-5 text-white">{newCount}</span>}
      </button>
      {open && (
        <Modal title="Today at a glance" onClose={close} width="max-w-xl">
          <div className="flex flex-col gap-4">
            <div className={`grid gap-3 ${seeCost ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              <Tile label="Today's sale" value={today ? rs(today.sales) : "…"} sub={today ? `${today.invoices} invoice${today.invoices === 1 ? "" : "s"}` : ""} tone="emerald" />
              {seeCost && <Tile label="Today's profit" value={today ? rs(today.profit) : "…"} sub="sale less cost of goods" tone={today && today.profit < 0 ? "rose" : "sky"} />}
              <Tile label="Last day's sale" value={lastDay ? rs(lastDay.sales) : "—"} sub={lastDay ? `${lastDay.date} · ${lastDay.invoices} invoice${lastDay.invoices === 1 ? "" : "s"}` : "no earlier sale"} tone="neutral" />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-neutral-900">
                Rate changes <span className="font-normal text-neutral-500">· last 7 days{seeCost ? "" : " · sale rates"}</span>
              </p>
              {changes.length === 0 ? <p className="text-sm text-neutral-400">No product&apos;s rate changed this week.</p> : (
                <div className="max-h-72 overflow-y-auto rounded-xl ring-1 ring-black/[0.06]">
                  <table className="w-full text-sm">
                    <tbody>
                      {changes.map((c) => {
                        const up = c.newRate > c.oldRate;
                        return (
                          <tr key={c.key} className={`border-t border-neutral-100 first:border-t-0 ${isNew(c) ? "bg-amber-50/60" : ""}`}>
                            <td className="px-3 py-1.5">
                              <span className="font-medium text-neutral-900">{c.productName}</span>
                              {isNew(c) && <span className="ml-1.5 rounded bg-amber-200 px-1 text-[10px] font-bold uppercase text-amber-900">New</span>}
                              <span className="block text-[11px] text-neutral-500">
                                {c.kind === "sale" ? "Sale rate" : `Purchase rate${c.supplier ? ` · ${c.supplier}` : ""}`} · {c.at.slice(0, 10)}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                              <span className="text-neutral-400 line-through">{rate(c.oldRate)}</span>{" "}
                              <span className={`inline-flex items-center gap-0.5 font-semibold ${up ? "text-rose-700" : "text-emerald-700"}`}>
                                {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{rate(c.newRate)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="flex justify-end border-t border-neutral-200 pt-3"><Button variant="primary" onClick={close}>OK</Button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "emerald" | "sky" | "rose" | "neutral" }) {
  const color = { emerald: "text-emerald-700", sky: "text-sky-700", rose: "text-rose-700", neutral: "text-neutral-900" }[tone];
  return (
    <div className="rounded-xl bg-neutral-50 p-3 ring-1 ring-black/[0.04]">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] text-neutral-500">{sub}</p>
    </div>
  );
}
