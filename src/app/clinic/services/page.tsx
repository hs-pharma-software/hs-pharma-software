"use client";

import { useEffect, useState } from "react";
import { Download, Pencil, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import {
  listClinicServices, saveClinicService, loadStandardClinicServices, categoryLabel, SERVICE_CATEGORIES,
  type ClinicService, type ClinicServiceCategory, type ClinicServiceInput,
} from "@/lib/repo/clinicServices";

/** The clinic's services and their fees: doctor fees, lab tests, radiology,
 * procedures, room, nursing / staff and indoor medicine. Consultations order
 * from this list and the visit bill uses these fees. */
export default function ClinicServicesPage() {
  const [rows, setRows] = useState<ClinicService[]>([]);
  const [category, setCategory] = useState<ClinicServiceCategory | "">("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ClinicService | "new" | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  async function reload() {
    if (isTauri()) setRows(await listClinicServices({ includeInactive: true }));
  }
  useEffect(() => { void reload().catch((e) => window.alert(e instanceof Error ? e.message : String(e))); }, []);

  async function loadStandard(kind: "lab" | "radiology") {
    setLoading(kind);
    try {
      const r = await loadStandardClinicServices(kind);
      window.alert(`${r.added} ${kind === "lab" ? "lab tests" : "radiology studies"} added${r.skipped ? `, ${r.skipped} already in the list` : ""}. Set a fee on each one you offer; it is offered once its fee is set and it is active.`);
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  const term = search.trim().toLowerCase();
  const shown = rows.filter((r) => (!category || r.category === category) && (!term || r.name.toLowerCase().includes(term)));

  const columns: Column<ClinicService>[] = [
    { header: "Service", render: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Category", render: (r) => categoryLabel(r.category) },
    { header: "Details", render: (r) => <span className="text-xs text-neutral-500">{r.category === "lab" ? [r.sample_type, r.unit, r.ref_range].filter(Boolean).join(" · ") : r.category === "radiology" ? r.modality ?? "" : r.billing_unit ?? ""}</span> },
    { header: "Fee (Rs)", render: (r) => <span className={`tabular-nums ${Number(r.rate) > 0 ? "" : "text-amber-700"}`}>{Number(r.rate) > 0 ? Number(r.rate).toFixed(2) : "Set fee"}</span> },
    {
      header: "Status",
      render: (r) => r.is_active
        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Offered</span>
        : <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">Not offered</span>,
    },
    {
      header: "",
      render: (r) => (
        <button type="button" aria-label={`Edit ${r.name}`} title="Edit" onClick={(e) => { e.stopPropagation(); setEditing(r); }} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-amber-700">
          <Pencil size={15} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Services"
        actions={<>
          <Button onClick={() => void loadStandard("lab")} disabled={Boolean(loading)}><Download size={14} />{loading === "lab" ? "Loading…" : "Load lab tests"}</Button>
          <Button onClick={() => void loadStandard("radiology")} disabled={Boolean(loading)}><Download size={14} />{loading === "radiology" ? "Loading…" : "Load radiology"}</Button>
          <Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} />Add service</Button>
        </>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <Input id="cs-search" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search services…" />
        </div>
        <Select id="cs-category" className="w-auto" value={category} onChange={(e) => setCategory(e.target.value as ClinicServiceCategory | "")} aria-label="Category">
          <option value="">All categories</option>
          {SERVICE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </Select>
      </div>
      <DataTable columns={columns} rows={shown} onRowClick={(r) => setEditing(r)}
        emptyMessage="No services yet. Add the clinic's fees: room charges, nursing / staff fees, procedures, indoor medicine; and load the standard lab tests and radiology studies." />
      {editing && <ServiceForm service={editing === "new" ? null : editing} defaultCategory={category || "procedure"} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

function ServiceForm({ service: s, defaultCategory, onClose, onSaved }: {
  service: ClinicService | null; defaultCategory: ClinicServiceCategory; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<ClinicServiceInput>({
    name: s?.name ?? "", category: s?.category ?? defaultCategory, rate: s?.rate ?? 0, code: s?.code ?? "", billing_unit: s?.billing_unit ?? "",
    sample_type: s?.sample_type ?? "", unit: s?.unit ?? "", ref_range: s?.ref_range ?? "", section: s?.section ?? "", modality: s?.modality ?? "",
    is_active: s ? Boolean(s.is_active) : true, notes: s?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof ClinicServiceInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setSaving(true);
    try {
      await saveClinicService(s?.id ?? null, { ...f, rate: Number(f.rate) || 0 });
      onSaved();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={s ? `Edit ${s.name}` : "Add service"} onClose={onClose} width="max-w-lg">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><Field label="Service name" required><Input id="sf-name" value={f.name} onChange={set("name")} placeholder="e.g. Room charges (General ward)" autoFocus /></Field></div>
        <Field label="Category" required>
          <Select id="sf-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ClinicServiceCategory })}>
            {SERVICE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Fee (Rs)" required><Input id="sf-rate" type="number" min="0" step="any" value={f.rate} onChange={(e) => {
          const rate = Number(e.target.value);
          // Setting a fee on a loaded test offers it.
          setF({ ...f, rate, ...(rate > 0 && Number(f.rate) <= 0 ? { is_active: true } : {}) });
        }} /></Field>
        <Field label="Charged"><Input id="sf-unit" value={f.billing_unit ?? ""} onChange={set("billing_unit")} placeholder={SERVICE_CATEGORIES.find((c) => c.key === f.category)?.unit} /></Field>
        <Field label="Code"><Input id="sf-code" value={f.code ?? ""} onChange={set("code")} /></Field>
        {f.category === "lab" && (
          <>
            <Field label="Sample"><Input id="sf-sample" value={f.sample_type ?? ""} onChange={set("sample_type")} placeholder="e.g. Serum" /></Field>
            <Field label="Unit"><Input id="sf-u" value={f.unit ?? ""} onChange={set("unit")} placeholder="e.g. mg/dL" /></Field>
            <div className="md:col-span-2"><Field label="Normal range"><Input id="sf-range" value={f.ref_range ?? ""} onChange={set("ref_range")} placeholder="e.g. 70-110 or M 13.0-17.0; F 12.0-15.0" /></Field></div>
          </>
        )}
        {f.category === "radiology" && <Field label="Modality"><Input id="sf-mod" value={f.modality ?? ""} onChange={set("modality")} placeholder="e.g. X-Ray, Ultrasound" /></Field>}
        <label htmlFor="sf-active" className="flex items-center gap-2 text-sm md:col-span-2">
          <input id="sf-active" type="checkbox" checked={f.is_active !== false} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />
          Offered (can be ordered and billed)
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !f.name.trim()}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}
