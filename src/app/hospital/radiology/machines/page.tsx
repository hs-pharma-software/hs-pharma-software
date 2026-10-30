"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Copy, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { publicSiteUrl } from "@/lib/publicUrl";
import {
  listMachinesWithQueue, listModalities, listTechnologists, saveMachine, deleteMachine, assignMachine, createMachineKey, revokeMachineKey, recentDicomEvents,
  type MachineWithQueue, type RadiologyModality, type Technologist, type MachineInput, type MachineStatus, type DicomEvent,
} from "@/lib/repo/radiologyPortal";
import { Panel, errMsg } from "@/components/hospital/radiology/common";

const CONNECTION = {
  online: { label: "Online", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  offline: { label: "Offline", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  never: { label: "Not connected", cls: "bg-neutral-50 text-neutral-500 ring-neutral-200" },
};

/** Machine setup: the hospital's imaging machines, which technologist works
 * each one, and each machine's key for the DICOM API. */
export default function MachinesPage() {
  const [machines, setMachines] = useState<MachineWithQueue[]>([]);
  const [modalities, setModalities] = useState<RadiologyModality[]>([]);
  const [techs, setTechs] = useState<Technologist[]>([]);
  const [editing, setEditing] = useState<MachineWithQueue | "new" | null>(null);
  const [assignM, setAssignM] = useState("");
  const [assignT, setAssignT] = useState("");
  const [newKey, setNewKey] = useState<{ machine: MachineWithQueue; key: string } | null>(null);
  const [events, setEvents] = useState<{ machine: MachineWithQueue; rows: DicomEvent[] } | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      setMachines(await listMachinesWithQueue());
      setModalities(await listModalities());
      setTechs(await listTechnologists());
    } catch (e) {
      window.alert(errMsg(e));
    }
  }
  useEffect(() => { void reload(); }, []);

  async function run(fn: () => Promise<unknown>) {
    try { await fn(); await reload(); } catch (e) { window.alert(errMsg(e)); }
  }
  async function issueKey(m: MachineWithQueue) {
    if (m.api_key_hint && !window.confirm(`Create a new key for ${m.name}? The current key (${m.api_key_hint}) stops working at once.`)) return;
    try { setNewKey({ machine: m, key: await createMachineKey(m.id) }); await reload(); } catch (e) { window.alert(errMsg(e)); }
  }

  return (
    <div>
      <PageHeader title="Machine Setup" actions={<Button variant="primary" onClick={() => setEditing("new")} disabled={!modalities.length}><Plus size={14} />Add machine</Button>} />
      {!modalities.length && <Panel className="mb-4"><p className="text-sm">Add modalities first on <Link className="underline" href="/hospital/radiology/modalities">Radiology › Modalities</Link>. Each machine belongs to one modality.</p></Panel>}

      <Panel title="Assign machine to technologist" className="mb-4">
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Field label="Machine">
            <Select id="as-machine" value={assignM} onChange={(e) => { setAssignM(e.target.value); setAssignT(machines.find((m) => m.id === e.target.value)?.assigned_user_id ?? ""); }}>
              <option value="">Select a machine</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.machine_code} · {m.name}{m.assigned_user_name ? ` (${m.assigned_user_name})` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Technologist">
            <Select id="as-tech" value={assignT} onChange={(e) => setAssignT(e.target.value)}>
              <option value="">{techs.length ? "Select a technologist" : "No technologist logins (HR: designation Radiology Technologist)"}</option>
              {techs.map((t) => <option key={t.user_id} value={t.user_id}>{t.name}</option>)}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" disabled={!assignM || !assignT} onClick={() => void run(() => assignMachine(assignM, assignT))}>Assign</Button>
            <Button variant="secondary" disabled={!assignM} onClick={() => void run(() => assignMachine(assignM, null))}>Unassign</Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-neutral-500">A technologist&apos;s own machine opens first on their Technologist screen. Any technologist can still work on any active machine.</p>
      </Panel>

      {machines.length === 0 && modalities.length > 0 && <Panel><p className="text-sm text-neutral-500">No machines yet. Add each X-Ray, CT, ultrasound or other machine to give it a patient queue.</p></Panel>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {machines.map((m) => {
          const c = m.status === "active" ? CONNECTION[m.connection] : { label: m.status === "maintenance" ? "Maintenance" : "Retired", cls: "bg-amber-50 text-amber-800 ring-amber-200" };
          return (
            <Panel key={m.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs">{m.machine_code}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${c.cls}`}>{c.label}</span>
              </div>
              <h3 className="mt-2 text-lg font-semibold">{m.name}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
                <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-neutral-300">{m.modality_code}</span>
                {[m.manufacturer, m.model].filter(Boolean).join(" ") || "—"}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-neutral-500">Serial</dt><dd className="font-mono">{m.serial_no ?? "—"}</dd></div>
                <div><dt className="text-neutral-500">Queue</dt><dd className="flex items-center gap-1 font-semibold tabular-nums"><Activity size={13} />{m.queue}</dd></div>
                <div><dt className="text-neutral-500">AE Title</dt><dd className="font-mono">{m.ae_title ?? "—"}</dd></div>
                <div><dt className="text-neutral-500">Technologist</dt><dd>{m.assigned_user_name ?? "—"}</dd></div>
                <div className="col-span-2"><dt className="text-neutral-500">DICOM API key</dt><dd className="font-mono">{m.api_key_hint ?? "None"}{m.last_seen_at ? <span className="ml-2 font-sans text-xs text-neutral-500">last call {new Date(m.last_seen_at).toLocaleString()}</span> : null}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setEditing(m)}><Pencil size={14} />Edit</Button>
                <Button variant="secondary" onClick={() => void issueKey(m)}><KeyRound size={14} />{m.api_key_hint ? "New key" : "Create key"}</Button>
                {m.api_key_hint && <Button variant="ghost" onClick={() => { if (window.confirm(`Revoke the key of ${m.name}? The machine can no longer reach the API.`)) void run(() => revokeMachineKey(m.id)); }}>Revoke key</Button>}
                <Button variant="ghost" onClick={() => void recentDicomEvents(m.id).then((rows) => setEvents({ machine: m, rows }))}>Messages</Button>
                <Button variant="danger" onClick={() => { if (window.confirm(`Delete machine ${m.name}?`)) void run(() => deleteMachine(m.id)); }}><Trash2 size={14} />Delete</Button>
              </div>
            </Panel>
          );
        })}
      </div>

      {editing && <MachineForm machine={editing === "new" ? null : editing} modalities={modalities} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      {newKey && <KeyModal machine={newKey.machine} keyValue={newKey.key} onClose={() => setNewKey(null)} />}
      {events && (
        <Modal title={`Machine messages · ${events.machine.name}`} onClose={() => setEvents(null)}>
          {events.rows.length === 0 ? <p className="text-sm text-neutral-500">No messages from this machine yet. Worklist requests are not logged; examination steps and received studies are.</p> : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {events.rows.map((e) => <li key={e.id} className="py-2"><span className="text-neutral-500">{new Date(e.created_at).toLocaleString()}</span> · <span className="font-medium">{e.kind}</span> · {e.detail}</li>)}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}

function MachineForm({ machine, modalities, onClose, onSaved }: { machine: MachineWithQueue | null; modalities: RadiologyModality[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<MachineInput>({
    name: machine?.name ?? "", modality_code: machine?.modality_code ?? modalities[0]?.code ?? "", machine_code: machine?.machine_code ?? "",
    manufacturer: machine?.manufacturer ?? "", model: machine?.model ?? "", serial_no: machine?.serial_no ?? "", location: machine?.location ?? "",
    status: machine?.status ?? "active", ae_title: machine?.ae_title ?? "", notes: machine?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const s = (k: keyof MachineInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setSaving(true);
    try { await saveMachine(machine?.id ?? null, f); onSaved(); } catch (e) { window.alert(errMsg(e)); } finally { setSaving(false); }
  }
  return (
    <Modal title={machine ? `Edit ${machine.name}` : "Add machine"} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Machine name" required><Input id="mf-name" value={f.name} onChange={s("name")} placeholder="e.g. X-Ray Room 1" /></Field>
        <Field label="Modality" required>
          <Select id="mf-modality" value={f.modality_code} onChange={s("modality_code")}>
            {modalities.map((m) => <option key={m.id} value={m.code}>{m.code} · {m.name}</option>)}
          </Select>
        </Field>
        <Field label="Machine code"><Input id="mf-code" value={f.machine_code ?? ""} onChange={s("machine_code")} placeholder="Blank = next MACH-nnn" /></Field>
        <Field label="Status">
          <Select id="mf-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as MachineStatus })}>
            <option value="active">Active</option><option value="maintenance">Under maintenance</option><option value="retired">Retired</option>
          </Select>
        </Field>
        <Field label="Manufacturer"><Input id="mf-make" value={f.manufacturer ?? ""} onChange={s("manufacturer")} placeholder="e.g. GE, Siemens, Shimadzu" /></Field>
        <Field label="Model"><Input id="mf-model" value={f.model ?? ""} onChange={s("model")} placeholder="e.g. 400 mA" /></Field>
        <Field label="Serial number"><Input id="mf-serial" value={f.serial_no ?? ""} onChange={s("serial_no")} /></Field>
        <Field label="Location"><Input id="mf-location" value={f.location ?? ""} onChange={s("location")} placeholder="e.g. Ground floor, Room 3" /></Field>
        <Field label="AE Title (from the machine's DICOM settings)"><Input id="mf-ae" value={f.ae_title ?? ""} onChange={s("ae_title")} placeholder="e.g. XRAY01" maxLength={16} /></Field>
        <div className="md:col-span-2"><Field label="Notes"><Textarea id="mf-notes" rows={2} value={f.notes ?? ""} onChange={s("notes")} /></Field></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving || !f.name.trim() || !f.modality_code} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

function KeyModal({ machine, keyValue, onClose }: { machine: MachineWithQueue; keyValue: string; onClose: () => void }) {
  const base = publicSiteUrl() ?? "https://<your-hospital-website>";
  const copy = (t: string) => void navigator.clipboard?.writeText(t).then(() => window.alert("Copied."), () => window.alert("Copy it by hand."));
  return (
    <Modal title={`DICOM API key · ${machine.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-amber-200">This key is shown only now. Copy it into the machine&apos;s gateway (Orthanc bridge) settings. If it is lost, create a new key.</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded-lg bg-neutral-100 px-3 py-2 font-mono text-xs">{keyValue}</code>
          <Button variant="secondary" onClick={() => copy(keyValue)}><Copy size={14} />Copy</Button>
        </div>
        <div>
          <h3 className="mb-1 font-semibold">API addresses</h3>
          <ul className="flex flex-col gap-1 font-mono text-xs">
            <li>GET  {base}/api/dicom/ping</li>
            <li>GET  {base}/api/dicom/worklist</li>
            <li>POST {base}/api/dicom/mpps</li>
            <li>POST {base}/api/dicom/studies</li>
          </ul>
          <p className="mt-1 text-xs text-neutral-500">Send the key in the header <code>Authorization: Bearer {keyValue.slice(0, 9)}…</code>. Test it with:</p>
          <code className="mt-1 block break-all rounded-lg bg-neutral-100 px-3 py-2 font-mono text-xs">curl -H &quot;Authorization: Bearer {keyValue}&quot; {base}/api/dicom/ping</code>
        </div>
      </div>
      <div className="mt-4 flex justify-end"><Button variant="primary" onClick={onClose}>I have copied the key</Button></div>
    </Modal>
  );
}
