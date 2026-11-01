"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { MeasurementForm } from "@/components/cloth/MeasurementForm";
import { isTauri } from "@/lib/platform";
import { printDirect } from "@/lib/print";
import { measurementCategory, measurementsRepo, measurementSummary, parseMeasurements, searchMeasurements, type ClothMeasurement } from "@/lib/cloth";

const catLabel = (m: ClothMeasurement) => ({ male: "Male", female: "Female" } as const)[measurementCategory(m) ?? "male"] ?? "";

/** Cloth store: customers' custom sizes, kept for next time and found by
 * name or mobile. */
export default function MeasurementsPage() {
  const [rows, setRows] = useState<ClothMeasurement[]>([]);
  const [term, setTerm] = useState("");
  const [editing, setEditing] = useState<ClothMeasurement | "new" | null>(null);
  const [printing, setPrinting] = useState<ClothMeasurement | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      setRows(await searchMeasurements(term));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    const t = setTimeout(() => void reload(), 250);
    return () => clearTimeout(t);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(m: ClothMeasurement) {
    if (!window.confirm(`Delete ${m.customer_name}'s ${m.garment} measurements?`)) return;
    await measurementsRepo.remove(m.id, "Deleted from Measurements", "Measurements");
    await reload();
  }

  const columns: Column<ClothMeasurement>[] = [
    { header: "Customer", render: (m) => <span><span className="font-medium">{m.customer_name}</span>{m.mobile && <span className="block text-xs text-neutral-500">{m.mobile}</span>}</span> },
    { header: "Garment", render: (m) => <span>{m.garment}{measurementCategory(m) && <span className="block text-xs text-neutral-500">{catLabel(m)}</span>}</span> },
    { header: "Measurements", render: (m) => <span title={measurementSummary(m)} className="inline-block max-w-[28rem] truncate align-bottom text-xs text-neutral-700">{measurementSummary(m) || "—"}</span> },
    { header: "Last used", render: (m) => (m.last_used_at ?? m.updated_at).slice(0, 10) },
    {
      header: "",
      render: (m) => (
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button type="button" title="Print" aria-label="Print" onClick={() => setPrinting(m)} className="rounded-full p-1.5 text-neutral-600 hover:bg-neutral-100"><Printer size={15} /></button>
          <button type="button" title="Edit" aria-label="Edit" onClick={() => setEditing(m)} className="rounded-full p-1.5 text-neutral-600 hover:bg-neutral-100"><Pencil size={15} /></button>
          <button type="button" title="Delete" aria-label="Delete" onClick={() => void remove(m)} className="rounded-full p-1.5 text-rose-600 hover:bg-rose-50"><Trash2 size={15} /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Measurements" actions={<Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} />New measurements</Button>} />
      <Input id="ms-search" className="mb-3 max-w-sm" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name or mobile…" autoFocus />
      {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
      <DataTable columns={columns} rows={rows} onRowClick={(m) => setEditing(m)} emptyMessage={term ? "No saved measurements match." : "No measurements saved yet. Save a customer's custom size to use it next time."} />
      {editing && (
        <Modal title={editing === "new" ? "New measurements" : `${editing.customer_name}: ${editing.garment}`} onClose={() => setEditing(null)} width="max-w-2xl">
          <MeasurementForm initial={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
        </Modal>
      )}
      {printing && <MeasurementSlip m={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

/** A measurement slip for the tailor (thermal width). */
function MeasurementSlip({ m, onClose }: { m: ClothMeasurement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const values = Object.entries(parseMeasurements(m.measurements)).filter(([, v]) => v);
  return (
    <Modal title="Measurement slip" onClose={onClose} width="max-w-sm">
      <div ref={ref} className="print-area mx-auto w-full max-w-[74mm] bg-white text-[12px] text-neutral-900">
        <style>{"@media print { @page { size: 80mm auto; margin: 3mm; } }"}</style>
        <p className="text-center text-sm font-bold uppercase tracking-wide">Measurements</p>
        <p className="mt-1"><b>{m.customer_name}</b>{m.mobile ? ` · ${m.mobile}` : ""}</p>
        <p>{m.garment}{measurementCategory(m) ? ` (${catLabel(m)})` : ""} · {(m.last_used_at ?? m.updated_at).slice(0, 10)}</p>
        <table className="mt-2 w-full border-collapse">
          <tbody>
            {values.map(([k, v]) => (
              <tr key={k} className="border-b border-neutral-200"><td className="py-0.5">{k}</td><td className="py-0.5 text-right font-semibold tabular-nums">{v}</td></tr>
            ))}
          </tbody>
        </table>
        {m.notes && <p className="mt-2 whitespace-pre-line">{m.notes}</p>}
      </div>
      <div className="mt-3 flex justify-end print:hidden">
        <Button variant="primary" onClick={() => void printDirect("thermal", ref.current)}><Printer size={14} />Print</Button>
      </div>
    </Modal>
  );
}
