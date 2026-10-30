"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Server } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { publicSiteUrl } from "@/lib/publicUrl";
import { getPacs, savePacs, type PacsInput, type RadiologyPacs } from "@/lib/repo/radiologyPortal";
import { Panel, errMsg } from "@/components/hospital/radiology/common";

/** The hospital's PACS (an Orthanc server): where machines store images, and
 * the viewer address the portal opens for a study. */
export default function PacsPage() {
  const [pacs, setPacs] = useState<RadiologyPacs | null>(null);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<PacsInput>({ name: "Orthanc PACS" });
  const [saving, setSaving] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    const p = await getPacs();
    setPacs(p);
    setF({
      name: p?.name ?? "Orthanc PACS", orthanc_url: p?.orthanc_url ?? "", viewer_url: p?.viewer_url ?? "", ae_title: p?.ae_title ?? "ORTHANC",
      dicom_host: p?.dicom_host ?? "", dicom_port: p?.dicom_port ?? 4242, notes: p?.notes ?? "",
    });
  }
  useEffect(() => { void reload().catch((e) => window.alert(errMsg(e))); }, []);

  async function save() {
    setSaving(true);
    try { await savePacs(f); setEditing(false); await reload(); } catch (e) { window.alert(errMsg(e)); } finally { setSaving(false); }
  }
  const s = (k: keyof PacsInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const site = publicSiteUrl() ?? "https://<your-hospital-website>";

  return (
    <div>
      <PageHeader title="PACS / Orthanc Configuration" actions={!editing && <Button variant="primary" onClick={() => setEditing(true)}>{pacs ? "Edit configuration" : "Add configuration"}</Button>} />
      <p className="-mt-3 mb-4 text-sm text-neutral-500">The Orthanc PACS server of this hospital. Machines receive their worklist through it and store their images in it.</p>

      {!pacs && !editing && (
        <Panel><p className="flex items-center gap-2 text-sm text-neutral-600"><AlertCircle size={16} />No PACS configuration for this hospital. Add one to enable the DICOM worklist and image viewing.</p></Panel>
      )}

      {pacs && !editing && (
        <Panel title={pacs.name} icon={<Server size={18} />}>
          <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div><dt className="text-neutral-500">Orthanc address</dt><dd className="break-all font-mono">{pacs.orthanc_url ?? "—"}</dd></div>
            <div><dt className="text-neutral-500">Viewer address</dt><dd className="break-all font-mono">{pacs.viewer_url ?? (pacs.orthanc_url ? `${pacs.orthanc_url}/stone-webviewer/…` : "—")}</dd></div>
            <div><dt className="text-neutral-500">PACS AE Title</dt><dd className="font-mono">{pacs.ae_title ?? "—"}</dd></div>
            <div><dt className="text-neutral-500">DICOM host : port (for the machines)</dt><dd className="font-mono">{pacs.dicom_host ?? "—"}:{pacs.dicom_port ?? "—"}</dd></div>
          </dl>
          {pacs.notes && <p className="mt-3 text-sm text-neutral-600">{pacs.notes}</p>}
        </Panel>
      )}

      {editing && (
        <Panel title={pacs ? "Edit configuration" : "Add configuration"}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Name" required><Input id="pc-name" value={f.name} onChange={s("name")} /></Field>
            <Field label="Orthanc web address"><Input id="pc-url" value={f.orthanc_url ?? ""} onChange={s("orthanc_url")} placeholder="https://pacs.myhospital.pk" /></Field>
            <div className="md:col-span-2">
              <Field label="Viewer address for one study"><Input id="pc-viewer" value={f.viewer_url ?? ""} onChange={s("viewer_url")} placeholder="https://pacs.myhospital.pk/stone-webviewer/index.html?study={StudyInstanceUID}" /></Field>
              <p className="mt-1 text-xs text-neutral-500">Use {"{StudyInstanceUID}"}, {"{AccessionNumber}"} or {"{PatientID}"} where the study goes. Blank = Orthanc&apos;s Stone viewer.</p>
            </div>
            <Field label="PACS AE Title"><Input id="pc-ae" value={f.ae_title ?? ""} onChange={s("ae_title")} maxLength={16} /></Field>
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <Field label="DICOM host (LAN address)"><Input id="pc-host" value={f.dicom_host ?? ""} onChange={s("dicom_host")} placeholder="192.168.1.20" /></Field>
              <Field label="Port"><Input id="pc-port" type="number" value={f.dicom_port ?? ""} onChange={(e) => setF({ ...f, dicom_port: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            </div>
            <div className="md:col-span-2"><Field label="Notes"><Textarea id="pc-notes" rows={2} value={f.notes ?? ""} onChange={s("notes")} /></Field></div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setEditing(false); void reload(); }}>Cancel</Button>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </Panel>
      )}

      <Panel title="How the machines connect" className="mt-4">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-neutral-700">
          <li>Install Orthanc on a computer in the radiology department, with its Python plugin and the bridge script <code className="rounded bg-neutral-100 px-1">integrations/orthanc/hms_bridge.py</code> from this software.</li>
          <li>On Radiology › Machines, add each machine with the AE Title set on the machine, and create its key. Put the AE Title and key in the bridge settings.</li>
          <li>On each machine, set the worklist server and the storage (PACS) server to the Orthanc computer: host {pacs?.dicom_host ?? "<host>"}, port {pacs?.dicom_port ?? 4242}, AE Title {pacs?.ae_title ?? "ORTHANC"}.</li>
          <li>The machine&apos;s worklist then lists its waiting patients from {site}/api/dicom/worklist. Images it sends to Orthanc are linked to the order, and View images opens them.</li>
        </ol>
      </Panel>
    </div>
  );
}
