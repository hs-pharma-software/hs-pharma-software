"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { usePraContractor } from "@/lib/praClient";
import { listUomsWithShared } from "@/lib/repo/uoms";
import { deletePraService, listPraServices, praServiceProblem, savePraService, type PraServiceRow } from "@/lib/repo/praServices";

interface Draft { id: string | null; code: string; name: string; unit: string; price: string; pctCode: string; taxPct: string }
const EMPTY: Draft = { id: null, code: "", name: "", unit: "", price: "", pctCode: "", taxPct: "" };

/** Products > Services: what a PRA-integrated contractor bills on a PRA invoice. */
export default function PraServicesPage() {
  const pra = usePraContractor();
  const tauriReady = useIsTauri();
  const [rows, setRows] = useState<PraServiceRow[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listPraServices());
  }

  useEffect(() => {
    void reload();
    if (isTauri()) void listUomsWithShared().then((u) => setUnits(u.map((x) => x.name)));
  }, []);

  function open(d: Draft) {
    setError(null);
    setDraft(d);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const input = { ...draft, price: Number(draft.price), taxPct: Number(draft.taxPct) };
    const problem = draft.price.trim() === "" || draft.taxPct.trim() === "" ? "Enter the price and the sales tax % of this service." : praServiceProblem(input, rows);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await savePraService(input);
      setDraft(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: PraServiceRow) {
    if (!window.confirm(`Delete service "${r.name}"? Invoices already made with it are not changed.`)) return;
    await deletePraService(r.id);
    await reload();
  }

  const columns: Column<PraServiceRow>[] = [
    { header: "Code", render: (r) => r.code ?? "—" },
    { header: "Service", render: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Unit", render: (r) => r.unit ?? "—" },
    { header: "Price", render: (r) => <span className="tabular-nums">Rs {Number(r.price).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
    { header: "PCT Code", render: (r) => <span className="font-mono text-xs">{r.pct_code ?? "—"}</span> },
    { header: "Tax", render: (r) => `${r.tax_pct}%` },
    {
      header: "Actions",
      render: (r) => (
        <div className="flex gap-2">
          <button type="button" onClick={(e) => { e.stopPropagation(); open({ id: r.id, code: r.code ?? "", name: r.name, unit: r.unit ?? "", price: String(r.price), pctCode: r.pct_code ?? "", taxPct: String(r.tax_pct) }); }} className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">Edit</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); void remove(r); }} className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">Delete</button>
        </div>
      ),
    },
  ];

  if (pra.loaded && !pra.integrated) {
    return (
      <div>
        <PageHeader title="Services" />
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">Services are for contractors integrated with PRA. Ask MAVIN.pk to enable PRA for your business.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Services"
        actions={<>
          <Button variant="primary" onClick={() => open(EMPTY)}>Add Service</Button>
          <Button onClick={() => void reload()}>Refresh</Button>
        </>}
      />
      <p className="mb-3 text-sm text-neutral-600">These are billed on a PRA Invoice. Each service&apos;s PCT code and tax must match a tax rule MAVIN.pk approved for your business, or PRA invoices using it are held.</p>
      {tauriReady && <DataTable columns={columns} rows={rows} />}

      {draft && (
        <Modal title={draft.id ? "Edit Service" : "Add Service"} onClose={() => setDraft(null)} width="max-w-lg">
          <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Field label="Service Name" required>
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Electrical wiring work" autoFocus required />
                </Field>
              </div>
              <Field label="Service Code">
                <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="Optional" />
              </Field>
              <Field label="Price (Rs)" required>
                <Input type="number" min="0" step="any" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} required />
              </Field>
              <Field label="Unit" required>
                <Input list="pra-service-units" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="Job, hour, sq ft" required />
                <datalist id="pra-service-units">{units.map((u) => <option key={u} value={u} />)}</datalist>
              </Field>
              <Field label="Tax %" required>
                <Input type="number" min="0" max="100" step="any" value={draft.taxPct} onChange={(e) => setDraft({ ...draft, taxPct: e.target.value })} placeholder="16" required />
              </Field>
              <div className="sm:col-span-3">
                <Field label="PCT Code" required>
                  <Input value={draft.pctCode} onChange={(e) => setDraft({ ...draft, pctCode: e.target.value })} placeholder="9824.0000" inputMode="decimal" required />
                </Field>
              </div>
            </div>
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setDraft(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
