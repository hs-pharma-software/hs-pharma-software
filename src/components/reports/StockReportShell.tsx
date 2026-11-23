"use client";

import { Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { STOCK_GROUPS, type StockGroup } from "@/lib/repo/stockReports";

export const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
export const money = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 0 });
/** Packs with up to two decimals (loose units show as part of a pack). */
export const packs = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-PK", { maximumFractionDigits: 2 });

/** The four ways the stock reports are cut, as tabs, with Print. */
export function StockReportShell({ title, group, setGroup, controls, children }: {
  title: string;
  group: StockGroup;
  setGroup: (g: StockGroup) => void;
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader title={title} actions={<Button variant="secondary" onClick={() => window.print()} className="print:hidden"><Printer size={14} />Print</Button>} />
      <div className={`${card} print:hidden`}>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Report by">
          {(Object.keys(STOCK_GROUPS) as StockGroup[]).map((g) => (
            <button key={g} type="button" role="tab" aria-selected={group === g} onClick={() => setGroup(g)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${group === g ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}>
              {STOCK_GROUPS[g]}
            </button>
          ))}
        </div>
        {controls && <div className="mt-3 flex flex-wrap items-end gap-2">{controls}</div>}
      </div>
      <div className={`${card} print-area mt-4`}>
        <p className="mb-2 hidden text-lg font-bold print:block">{title} · {STOCK_GROUPS[group]}</p>
        {children}
      </div>
    </div>
  );
}
