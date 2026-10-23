"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { InvoiceViewModal } from "@/components/invoices/InvoiceViewModal";
import { listNarcoticInvoices, invoicesRepo, type NarcoticInvoiceRow } from "@/lib/repo/invoices";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Invoice } from "@/lib/types2";

export default function NarcoticsPage() {
  const tauriReady = useIsTauri();
  const [rows, setRows] = useState<NarcoticInvoiceRow[]>([]);
  const [search, setSearch] = useState("");
  const [committed, setCommitted] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [viewing, setViewing] = useState<{ invoice: Invoice; customerName: string; salesmanName: string | null } | null>(
    null
  );

  async function reload() {
    if (!isTauri()) return;
    setRows(await listNarcoticInvoices());
  }

  useEffect(() => {
    void reload();
  }, []);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function buildSuggestions(term: string) {
    if (!term.trim()) { setSuggestions([]); return; }
    const t = term.toLowerCase();
    const seen = new Set<string>();
    const result: string[] = [];
    for (const r of rows) {
      for (const candidate of [
        r.customer_name,
        r.customer_phone ?? "",
        String(r.invoice_no ?? ""),
        ...r.narcotic_items.split(",").map((s) => s.trim()),
      ]) {
        if (candidate && candidate.toLowerCase().includes(t) && !seen.has(candidate)) {
          seen.add(candidate);
          result.push(candidate);
          if (result.length >= 8) break;
        }
      }
      if (result.length >= 8) break;
    }
    setSuggestions(result);
  }

  function handleSearchInput(value: string) {
    setSearch(value);
    buildSuggestions(value);
    setShowSuggestions(true);
  }

  function applySearch(value: string) {
    setSearch(value);
    setCommitted(value);
    setShowSuggestions(false);
  }

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") applySearch(search);
    if (e.key === "Escape") setShowSuggestions(false);
  }

  async function openView(r: NarcoticInvoiceRow) {
    const invoice = await invoicesRepo.get(r.id);
    if (invoice) setViewing({ invoice, customerName: r.customer_name, salesmanName: r.salesman_name });
  }

  const term = committed.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (!term) return true;
    return (
      r.customer_name.toLowerCase().includes(term) ||
      (r.customer_phone ?? "").includes(term) ||
      String(r.invoice_no ?? "").includes(term) ||
      r.narcotic_items.toLowerCase().includes(term)
    );
  });

  const missingContact = filtered.filter((r) => !r.customer_phone || r.customer_name === "Walk-in").length;

  const columns: Column<NarcoticInvoiceRow>[] = [
    { header: "Bill #", render: (r) => r.invoice_no ?? "—" },
    { header: "Date", render: (r) => r.date },
    { header: "Customer", render: (r) => <span className="font-medium">{r.customer_name}</span> },
    {
      header: "Mobile",
      render: (r) => r.customer_phone ?? <span className="text-rose-500">Missing</span>,
    },
    { header: "CNIC / NTN", render: (r) => r.buyer_ntn_cnic ?? "—" },
    { header: "Salesman", render: (r) => r.salesman_name ?? "—" },
    {
      header: "Narcotic Products",
      render: (r) => <span className="whitespace-normal text-rose-700">{r.narcotic_items}</span>,
    },
    { header: "Total Bill", render: (r) => r.total.toFixed(2) },
  ];

  return (
    <div>
      <PageHeader title="Narcotics" actions={<Button onClick={() => void reload()}>Refresh</Button>} />

      {/* ── Filters ── */}
      <div className="mb-3 grid grid-cols-1 gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:grid-cols-4">
        {/* Search with suggestions */}
        <div className="sm:col-span-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">Search</span>
            <div className="flex gap-2" ref={searchRef}>
              <div className="relative flex-1">
                <input
                  placeholder="Customer, mobile, bill # or product..."
                  value={search}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  onKeyDown={handleSearchKey}
                  onFocus={() => { buildSuggestions(search); setShowSuggestions(true); }}
                  className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-black/[0.06]"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg">
                    {suggestions.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applySearch(s); }}
                          className="w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => applySearch(search)}
                className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition active:scale-95"
                style={{ background: "linear-gradient(135deg,#1a1a6e,#2d2da0)" }}
              >
                Search
              </button>
            </div>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-black/[0.06]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-black/[0.06]"
          />
        </label>
      </div>

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to see narcotic sales.
        </p>
      ) : (
        <>
          <DataTable columns={columns} rows={filtered} onRowClick={(r) => void openView(r)} />
          <div className="mt-3 flex flex-wrap gap-6 rounded-2xl bg-white px-4 py-2.5 text-sm shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
            <span>
              Invoices: <span className="font-semibold">{filtered.length}</span>
            </span>
            <span>
              Total: <span className="font-semibold">{filtered.reduce((s, r) => s + r.total, 0).toFixed(2)}</span>
            </span>
            {missingContact > 0 && (
              <span className="text-rose-600">
                {missingContact} older invoice(s) missing customer name or mobile
              </span>
            )}
          </div>
        </>
      )}

      {viewing && <InvoiceViewModal row={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
