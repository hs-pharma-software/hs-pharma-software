"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { listImagingStudies } from "@/lib/repo/radiology";
import { listTemplates, saveTemplate, deleteTemplate, listModalities, type RadiologyTemplate, type RadiologyModality, type TemplateInput } from "@/lib/repo/radiologyPortal";
import type { HospitalService } from "@/lib/types-hospital";
import { Panel, errMsg } from "@/components/hospital/radiology/common";

/** Report templates: the usual findings and impression for a study or modality,
 * which the radiologist fills in and edits while reporting. */
export default function TemplatesPage() {
  const [rows, setRows] = useState<RadiologyTemplate[]>([]);
  const [modalities, setModalities] = useState<RadiologyModality[]>([]);
  const [studies, setStudies] = useState<HospitalService[]>([]);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<RadiologyTemplate | "new" | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listTemplates({ includeInactive: true }));
    setModalities(await listModalities());
    setStudies(await listImagingStudies({ includeInactive: true }));
  }
  useEffect(() => { void reload().catch((e) => window.alert(errMsg(e))); }, []);

  const studyName = (id: string | null) => studies.find((s) => s.id === id)?.name;
  const shown = rows.filter((t) => !filter || t.modality_code === filter);
  return (
    <div>
      <PageHeader title="Report Templates" actions={<>
        <Select id="tp-filter" className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Modality">
          <option value="">All modalities</option>{modalities.map((m) => <option key={m.id} value={m.code}>{m.name}</option>)}
        </Select>
        <Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} />Add template</Button>
      </>} />
      {shown.length === 0 && <Panel><p className="text-sm text-neutral-500">No templates yet. A template holds the usual findings and impression of a study (for example a normal chest X-ray); the radiologist picks it and edits the text for each patient.</p></Panel>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {shown.map((t) => (
          <Panel key={t.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{t.name}</h3>
                <p className="text-xs text-neutral-500">{studyName(t.service_id) ?? (t.modality_code ? `All ${t.modality_code} studies` : "Any study")}{t.is_active ? "" : " · inactive"}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" aria-label="Edit" onClick={() => setEditing(t)}><Pencil size={14} /></Button>
                <Button variant="ghost" aria-label="Delete" onClick={() => { if (window.confirm(`Delete template ${t.name}?`)) void deleteTemplate(t.id).then(reload).catch((e) => window.alert(errMsg(e))); }}><Trash2 size={14} /></Button>
              </div>
            </div>
            {t.findings && <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-neutral-700">{t.findings}</p>}
            {t.impression && <p className="mt-2 text-sm"><span className="font-medium">Impression: </span>{t.impression}</p>}
          </Panel>
        ))}
      </div>
      {editing && <TemplateForm template={editing === "new" ? null : editing} modalities={modalities} studies={studies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

function TemplateForm({ template: t, modalities, studies, onClose, onSaved }: {
  template: RadiologyTemplate | null; modalities: RadiologyModality[]; studies: HospitalService[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<TemplateInput>({
    name: t?.name ?? "", modality_code: t?.modality_code ?? "", service_id: t?.service_id ?? "", findings: t?.findings ?? "", impression: t?.impression ?? "",
    is_active: t ? Boolean(t.is_active) : true,
  });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await saveTemplate(t?.id ?? null, f); onSaved(); } catch (e) { window.alert(errMsg(e)); } finally { setSaving(false); }
  }
  return (
    <Modal title={t ? `Edit ${t.name}` : "Add template"} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><Field label="Template name" required><Input id="tf-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Normal chest X-ray PA" /></Field></div>
        <Field label="Modality">
          <Select id="tf-modality" value={f.modality_code ?? ""} onChange={(e) => setF({ ...f, modality_code: e.target.value })}>
            <option value="">Any</option>{modalities.map((m) => <option key={m.id} value={m.code}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Study (optional)">
          <Select id="tf-study" value={f.service_id ?? ""} onChange={(e) => setF({ ...f, service_id: e.target.value })}>
            <option value="">Every study of the modality</option>{studies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <div className="md:col-span-2"><Field label="Findings"><Textarea id="tf-findings" rows={8} value={f.findings ?? ""} onChange={(e) => setF({ ...f, findings: e.target.value })} /></Field></div>
        <div className="md:col-span-2"><Field label="Impression"><Textarea id="tf-impression" rows={2} value={f.impression ?? ""} onChange={(e) => setF({ ...f, impression: e.target.value })} /></Field></div>
        <label htmlFor="tf-active" className="flex items-center gap-2 text-sm"><input id="tf-active" type="checkbox" checked={f.is_active !== false} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />Active</label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving || !f.name.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}
