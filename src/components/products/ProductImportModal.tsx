"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { parseCsv, planImport, readImportRows, runImport, type ImportPlan } from "@/lib/productImport";

/** Products > Import CSV: read the file, show what will be added or skipped,
 * then add the products to this business. */
export function ProductImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [openingStock, setOpeningStock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; failed: { name: string; error: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function readFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setPlan(null);
    setResult(null);
    setError(null);
    try {
      const { rows, problems } = readImportRows(parseCsv(await file.text()));
      setProblems(problems);
      if (rows.length === 0) return setError(problems[0] ?? "No products found in the file.");
      setPlan(await planImport(rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function start() {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await runImport(plan, { openingStock, onProgress: (done, total) => setProgress({ done, total }) });
      setResult(r);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const withQty = plan?.add.filter((r) => r.openingQty > 0).length ?? 0;

  return (
    <Modal title="Import Products (CSV)" onClose={busy ? () => undefined : onClose} width="max-w-2xl">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void readFile(e.target.files?.[0])} />
          <Button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
            Choose CSV file
          </Button>
          <span className="text-neutral-500">{fileName || "Use the Sample File columns. Name and UOM are required."}</span>
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700 ring-1 ring-rose-200">{error}</p>}

        {plan && !result && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Will be added" value={plan.add.length} tone="text-emerald-700" />
              <Stat label="Skipped" value={plan.skip.length} tone="text-amber-700" />
              <Stat label="New categories" value={plan.newCategories.length} />
              <Stat label="New units" value={plan.newUoms.length} />
            </div>
            {plan.newCategories.length > 0 && <p className="text-xs text-neutral-600"><b>New categories:</b> {plan.newCategories.join(", ")}</p>}
            {plan.newUoms.length > 0 && <p className="text-xs text-neutral-600"><b>New units:</b> {plan.newUoms.join(", ")}</p>}
            {plan.skip.length > 0 && (
              <details className="text-xs text-neutral-600">
                <summary className="cursor-pointer">Skipped products ({plan.skip.length})</summary>
                <ul className="mt-1 max-h-32 overflow-y-auto pl-4">
                  {plan.skip.map((s) => <li key={s.row.line}>{s.row.name}: {s.reason}</li>)}
                </ul>
              </details>
            )}
            {problems.length > 0 && (
              <details className="text-xs text-amber-700">
                <summary className="cursor-pointer">Notes ({problems.length})</summary>
                <ul className="mt-1 max-h-32 overflow-y-auto pl-4">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </details>
            )}
            <div className="max-h-56 overflow-auto rounded-lg ring-1 ring-neutral-200">
              <table className="w-full min-w-max text-xs">
                <thead className="bg-neutral-50 text-left text-neutral-500">
                  <tr>{["Name", "Company", "Category", "UOM", "Purchase", "Sale", "Qty"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {plan.add.slice(0, 100).map((r) => (
                    <tr key={r.line} className="border-t border-neutral-100">
                      <td className="px-2 py-1">{r.name}</td>
                      <td className="px-2 py-1">{r.company}</td>
                      <td className="px-2 py-1">{r.category}</td>
                      <td className="px-2 py-1">{r.uom}</td>
                      <td className="px-2 py-1 tabular-nums">{r.purchasePrice.toFixed(2)}</td>
                      <td className="px-2 py-1 tabular-nums">{r.salePrice.toFixed(2)}</td>
                      <td className="px-2 py-1 tabular-nums">{r.openingQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.add.length > 100 && <p className="px-2 py-1 text-[11px] text-neutral-400">and {plan.add.length - 100} more</p>}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={openingStock} onChange={(e) => setOpeningStock(e.target.checked)} disabled={busy} />
              Also add the file&apos;s quantity as opening stock ({withQty} products have a quantity)
            </label>
            {progress && <p className="text-xs text-neutral-500">Adding {progress.done} of {progress.total}...</p>}
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="button" variant="primary" onClick={() => void start()} disabled={busy || plan.add.length === 0}>
                {busy ? "Importing..." : `Import ${plan.add.length} products`}
              </Button>
            </div>
          </>
        )}

        {result && (
          <>
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800 ring-1 ring-emerald-200">
              {result.created} products added.{result.failed.length > 0 ? ` ${result.failed.length} could not be added:` : ""}
            </p>
            {result.failed.length > 0 && (
              <ul className="max-h-40 overflow-y-auto pl-4 text-xs text-rose-700">{result.failed.map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}</ul>
            )}
            <div className="flex justify-end border-t border-neutral-200 pt-3">
              <Button type="button" variant="primary" onClick={onClose}>Done</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone = "text-neutral-800" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2 ring-1 ring-neutral-200">
      <p className="text-[11px] text-neutral-500">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
