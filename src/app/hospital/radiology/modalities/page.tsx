"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { listModalities, saveModality, deleteModality, loadStandardModalities, type RadiologyModality, type ModalityInput } from "@/lib/repo/radiologyPortal";
import { DICOM_MODALITY_CODES } from "@/config/radiologyPortal";
import { Panel, errMsg } from "@/components/hospital/radiology/common";

/** The imaging modalities this hospital offers (X-Ray, Ultrasound, CT...). */
export default function ModalitiesPage() {
  const [rows, setRows] = useState<RadiologyModality[]>([]);
  const [editing, setEditing] = useState<RadiologyModality | "new" | null>(null);

  async function reload() {
    if (isTauri()) setRows(await listModalities({ includeInactive: true }));
  }
  useEffect(() => { void reload().catch((e) => window.alert(errMsg(e))); }, []);

  async function loadStandard() {
    try { const n = await loadStandardModalities(); window.alert(n ? `${n} modalities added.` : "All standard modalities are already here."); await reload(); } catch (e) { window.alert(errMsg(e)); }
  }

  return (
    <div>
      <PageHeader title="Hospital Modality Setup" actions={<>
        <Button variant="secondary" onClick={() => void loadStandard()}><Download size={14} />Load standard list</Button>
        <Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} />Add modality</Button>
      </>} />
      {rows.length === 0 && <Panel><p className="text-sm text-neutral-500">No modalities yet. Load the standard list (X-Ray, Ultrasound, CT, MRI…) and remove what this hospital does not have, or add them one by one.</p></Panel>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((m) => (
          <Panel key={m.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs">{m.code}</span>
              {m.is_active
                ? <span className="flex items-center gap-1 rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white"><CheckCircle2 size={12} />Active</span>
                : <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">Inactive</span>}
            </div>
            <h3 className="mt-2 text-lg font-semibold">{m.name}</h3>
            <p className="text-sm text-neutral-500">Universal: {m.universal_name ?? m.name} · DICOM {m.dicom_code ?? "—"}</p>
            {m.outsourced ? <p className="text-sm text-neutral-500">Outsourced</p> : null}
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" className="flex-1 justify-center" onClick={() => setEditing(m)}><Pencil size={14} />Edit</Button>
              <Button variant="danger" onClick={() => { if (window.confirm(`Delete ${m.name}?`)) void deleteModality(m.id).then(reload).catch((e) => window.alert(errMsg(e))); }}><Trash2 size={14} />Delete</Button>
            </div>
          </Panel>
        ))}
      </div>
      {editing && <ModalityForm modality={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

function ModalityForm({ modality: m, onClose, onSaved }: { modality: RadiologyModality | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<ModalityInput>({
    code: m?.code ?? "", name: m?.name ?? "", dicom_code: m?.dicom_code ?? "", universal_name: m?.universal_name ?? "",
    outsourced: Boolean(m?.outsourced), is_active: m ? Boolean(m.is_active) : true, notes: m?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await saveModality(m?.id ?? null, f); onSaved(); } catch (e) { window.alert(errMsg(e)); } finally { setSaving(false); }
  }
  return (
    <Modal title={m ? `Edit ${m.name}` : "Add modality"} onClose={onClose} width="max-w-lg">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Code" required><Input id="mo-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="e.g. CT" maxLength={16} /></Field>
        <Field label="Name" required><Input id="mo-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. CT-Scan" /></Field>
        <Field label="Universal name"><Input id="mo-universal" value={f.universal_name ?? ""} onChange={(e) => setF({ ...f, universal_name: e.target.value })} placeholder="e.g. CT Scan" /></Field>
        <Field label="DICOM modality">
          <Select id="mo-dicom" value={f.dicom_code ?? ""} onChange={(e) => setF({ ...f, dicom_code: e.target.value })}>
            <option value="">—</option>{DICOM_MODALITY_CODES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <label htmlFor="mo-out" className="flex items-center gap-2 text-sm"><input id="mo-out" type="checkbox" checked={Boolean(f.outsourced)} onChange={(e) => setF({ ...f, outsourced: e.target.checked })} />Outsourced (done by another centre)</label>
        <label htmlFor="mo-active" className="flex items-center gap-2 text-sm"><input id="mo-active" type="checkbox" checked={f.is_active !== false} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />Active</label>
        <div className="md:col-span-2"><Field label="Notes"><Textarea id="mo-notes" rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
      </div>
      <p className="mt-2 text-xs text-neutral-500">Tests in Performing Images join this modality&apos;s machine queues when their modality matches the code, name or universal name.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving || !f.code.trim() || !f.name.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}
