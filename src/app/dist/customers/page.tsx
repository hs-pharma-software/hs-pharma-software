"use client";

import { useState } from "react";
import { Crosshair, MapPin, Pencil, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist, errorText, getFix } from "@/lib/dist";
import { cdslState } from "@/lib/dist/engine";
import type { DistCustomer } from "@/lib/dist/store";
import { Badge, DistGuard, Err, MapView, Note, PageTitle, todayYmd, useLoad, type DistCtx } from "@/components/dist/ui";

export default function CustomersPage() {
  return <DistGuard need="customers.view">{(c) => <Customers c={c} />}</DistGuard>;
}

const ATL_TONE = { active: "green", inactive: "red", unverified: "amber" } as const;

function Customers({ c }: { c: DistCtx }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [missingGeo, setMissingGeo] = useState(false);
  const [editing, setEditing] = useState<Partial<DistCustomer> | null>(null);
  const [viewing, setViewing] = useState<DistCustomer | null>(null);
  const list = useLoad(() => dist.listCustomers({ search, status: status || undefined, missingGeo }), [search, status, missingGeo]);
  const pharma = c.mode === "pharma";
  return (
    <div className="space-y-3">
      <PageTitle title="Customers" sub={pharma ? "Pharma customers (CDSL required)" : "General distribution customers"} actions={c.can("customers.add") && <Button variant="primary" onClick={() => setEditing({ tax_class: "retailer" })}><Plus size={14} /> Add customer</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <Input className="!w-72" placeholder="Search name, owner, code, mobile, NTN" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="!w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="">All</option>
        </Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={missingGeo} onChange={(e) => setMissingGeo(e.target.checked)} /> Missing geotag</label>
      </div>
      <Err error={list.error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">ID</th>
              <th className="px-3 py-2 text-start">Business / owner</th>
              <th className="px-3 py-2 text-start">Mobile</th>
              <th className="px-3 py-2 text-start">NTN / ATL</th>
              {pharma && <th className="px-3 py-2 text-start">CDSL</th>}
              <th className="px-3 py-2 text-start">Geotag</th>
              <th className="px-3 py-2 text-start">Salesman</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((x) => {
              const cd = cdslState(x.cdsl_no, x.cdsl_expiry, todayYmd(), c.settings.cdsl.alertDays);
              return (
                <tr key={x.id} className="border-t border-neutral-100">
                  <td className="px-3 py-2 text-xs">{x.code}</td>
                  <td className="px-3 py-2">
                    <button type="button" className="font-medium hover:underline" onClick={() => setViewing(x)}>{x.business_name}</button>
                    <span className="block text-[11px] text-neutral-500">{x.owner_name}{x.status === "inactive" ? " · inactive" : ""}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{x.mobile}</td>
                  <td className="px-3 py-2 text-xs">
                    {x.ntn ?? "—"} <Badge tone={ATL_TONE[x.atl_status]}>{x.atl_status}</Badge>
                    <span className="block text-[10px] text-neutral-400">{x.tax_class}</span>
                  </td>
                  {pharma && (
                    <td className="px-3 py-2 text-xs">
                      {x.cdsl_no ?? "—"} {x.cdsl_expiry && <span className="text-neutral-500">exp {x.cdsl_expiry}</span>}{" "}
                      <Badge tone={cd === "valid" ? "green" : cd === "expiring" ? "amber" : "red"}>{cd}</Badge>
                    </td>
                  )}
                  <td className="px-3 py-2 text-xs">{x.lat != null ? <Badge tone="green">{x.location_source === "manual_pin" ? "pin" : "GPS"}{x.location_accuracy ? ` ±${Math.round(x.location_accuracy)} m` : ""}</Badge> : <Badge tone="amber">missing</Badge>}</td>
                  <td className="px-3 py-2 text-xs">{x.salesman_name ?? "—"}</td>
                  <td className="px-3 py-2 text-end">{c.can("customers.edit") && <Button variant="ghost" onClick={() => setEditing(x)}><Pencil size={14} /></Button>}</td>
                </tr>
              );
            })}
            {!list.data?.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">{list.loading ? "Loading…" : "No content in table"}</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <CustomerForm c={c} value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />}
      {viewing && <CustomerView c={c} customer={viewing} onClose={() => setViewing(null)} onChanged={() => { setViewing(null); void list.reload(); }} />}
    </div>
  );
}

/** Captures the business location from this device on request, or a pin. */
function LocationPicker({ value, onChange, allowPin }: { value: { lat: number; lng: number; accuracy?: number | null; source: "device" | "manual_pin" } | null; onChange: (v: { lat: number; lng: number; accuracy?: number | null; source: "device" | "manual_pin" } | null) => void; allowPin: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState({ lat: "", lng: "" });
  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500">Capture while standing at the customer&apos;s business. This is the customer&apos;s location, saved only when you press the button — not your tracking location.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const f = await getFix();
              onChange({ lat: f.lat, lng: f.lng, accuracy: f.accuracy, source: "device" });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Crosshair size={14} /> {busy ? "Getting location…" : "Capture business location"}
        </Button>
        {value && (
          <span className="text-xs">
            {value.lat.toFixed(6)}, {value.lng.toFixed(6)} {value.accuracy ? `±${Math.round(value.accuracy)} m` : ""} ({value.source === "device" ? "device GPS" : "map pin"})
            <button type="button" className="ms-2 underline" onClick={() => onChange(null)}>clear</button>
          </span>
        )}
      </div>
      <Err error={error} />
      <MapView markers={[]} pin={value} onPin={allowPin ? (p) => onChange({ ...p, accuracy: null, source: "manual_pin" }) : undefined} height={260} />
      {allowPin && (
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <span className="text-neutral-500">{value ? "Drag the pin or click the map to adjust." : "Or click the map / enter coordinates to place the pin manually:"}</span>
          <Input className="!w-32" placeholder="Latitude" value={manual.lat} onChange={(e) => setManual({ ...manual, lat: e.target.value })} />
          <Input className="!w-32" placeholder="Longitude" value={manual.lng} onChange={(e) => setManual({ ...manual, lng: e.target.value })} />
          <Button onClick={() => manual.lat && manual.lng && onChange({ lat: Number(manual.lat), lng: Number(manual.lng), accuracy: null, source: "manual_pin" })}>Place pin</Button>
        </div>
      )}
    </div>
  );
}

function CustomerForm({ c, value, onClose, onSaved }: { c: DistCtx; value: Partial<DistCustomer>; onClose: () => void; onSaved: () => void }) {
  const isNew = !value.id;
  const [v, setV] = useState<Partial<DistCustomer>>(value);
  const [loc, setLoc] = useState<{ lat: number; lng: number; accuracy?: number | null; source: "device" | "manual_pin" } | null>(value.lat != null && value.lng != null ? { lat: value.lat, lng: value.lng, accuracy: value.location_accuracy, source: (value.location_source as "device" | "manual_pin") ?? "device" } : null);
  const [error, setError] = useState<string | null>(null);
  const salesmen = useLoad(() => (c.admin ? dist.listSalesmen() : Promise.resolve([])), [c.admin]);
  const editable = (f: string) => isNew || c.admin || c.fields.includes(f);
  const t = (k: keyof DistCustomer, label: string, opts: { required?: boolean; type?: string; placeholder?: string } = {}) => (
    <Field label={label} required={opts.required}>
      <Input type={opts.type ?? "text"} placeholder={opts.placeholder} disabled={!editable(k)} value={v[k] == null ? "" : String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </Field>
  );
  const pharma = c.mode === "pharma";
  const save = async () => {
    setError(null);
    try {
      if (isNew) await dist.createCustomer({ ...v, location: loc });
      else {
        const patch: Partial<DistCustomer> = {};
        for (const k of Object.keys(v) as (keyof DistCustomer)[]) if (v[k] !== value[k] && editable(k)) (patch as Record<string, unknown>)[k] = v[k];
        await dist.updateCustomer(value.id!, patch);
        const moved = loc && (loc.lat !== value.lat || loc.lng !== value.lng);
        if (moved) await dist.setCustomerLocation(value.id!, loc!);
      }
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal title={isNew ? "Add customer" : `Edit ${value.business_name}`} onClose={onClose} width="max-w-4xl">
      <div className="max-h-[75vh] space-y-3 overflow-y-auto pe-1">
        {!isNew && !c.admin && <Note>You can change only the fields the administrator allowed you; others are read-only.</Note>}
        <div className="grid gap-3 md:grid-cols-3">
          {t("business_name", "Business name", { required: true })}
          {t("owner_name", "Owner name")}
          {t("mobile", "Mobile number", { required: true, placeholder: "03XXXXXXXXX" })}
          {t("ntn", "NTN", { placeholder: "1234567 or 1234567-8" })}
          {t("cnic", "CNIC", { placeholder: "35202-1234567-1" })}
          {t("phone2", "Other contact")}
          {t("email", "Email")}
          {t("territory", "Territory / area")}
          <Field label="Withholding tax class">
            <Select disabled={!editable("tax_class")} value={v.tax_class ?? "retailer"} onChange={(e) => setV({ ...v, tax_class: e.target.value })}>
              {Object.entries(c.settings.wht.classes).map(([k, r]) => <option key={k} value={k}>{k} ({r.section})</option>)}
            </Select>
          </Field>
          {pharma && (
            <>
              {t("cdsl_no", "CDSL number", { required: c.settings.cdsl.required })}
              {t("cdsl_expiry", "CDSL expiry date", { required: c.settings.cdsl.required, type: "date" })}
            </>
          )}
          {isNew && t("code", "Customer ID (blank = automatic)")}
          {c.admin && (
            <Field label="Salesman">
              <Select value={v.salesman_id ?? ""} onChange={(e) => setV({ ...v, salesman_id: e.target.value || null })}>
                <option value="">—</option>
                {(salesmen.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Address"><Textarea rows={2} disabled={!editable("address")} value={v.address ?? ""} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
        {editable("location") ? <LocationPicker value={loc} onChange={setLoc} allowPin={c.admin || c.fields.includes("location") || isNew} /> : <Note>Location can only be changed by users allowed to edit it.</Note>}
        <Err error={error} />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()}>Save</Button>
      </div>
    </Modal>
  );
}

function CustomerView({ c, customer, onClose, onChanged }: { c: DistCtx; customer: DistCustomer; onClose: () => void; onChanged: () => void }) {
  const checks = useLoad(() => dist.taxChecks(customer.id), [customer.id]);
  const [atl, setAtl] = useState({ result: "active" as "active" | "inactive", source: "FBR ATL portal (e.fbr.gov.pk)", reference: "", checkedAt: "" });
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string, close = false) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      if (close) onChanged();
      else void checks.reload();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };
  return (
    <Modal title={`${customer.business_name} (${customer.code})`} onClose={onClose} width="max-w-4xl">
      <div className="max-h-[75vh] space-y-3 overflow-y-auto">
        <div className="grid gap-2 text-sm md:grid-cols-3">
          <p><span className="text-neutral-500">Owner:</span> {customer.owner_name ?? "—"}</p>
          <p><span className="text-neutral-500">Mobile:</span> {customer.mobile}</p>
          <p><span className="text-neutral-500">NTN / CNIC:</span> {customer.ntn ?? "—"} / {customer.cnic ?? "—"}</p>
          <p><span className="text-neutral-500">ATL:</span> {customer.atl_status} {customer.atl_checked_at && `(${customer.atl_checked_at.slice(0, 10)}, ${customer.atl_source})`}</p>
          {c.mode === "pharma" && <p><span className="text-neutral-500">CDSL:</span> {customer.cdsl_no ?? "—"} exp {customer.cdsl_expiry ?? "—"} · {customer.cdsl_status ?? "—"}</p>}
          <p><span className="text-neutral-500">Created:</span> {customer.created_at.slice(0, 10)}</p>
          <p className="md:col-span-3"><span className="text-neutral-500">Address:</span> {customer.address ?? "—"}</p>
        </div>
        {customer.lat != null && customer.lng != null ? (
          <>
            <p className="text-xs text-neutral-500"><MapPin size={12} className="inline" /> Captured {customer.located_at?.slice(0, 16).replace("T", " ")} ({customer.location_source === "manual_pin" ? "map pin" : "device GPS"}{customer.location_accuracy ? `, ±${Math.round(customer.location_accuracy)} m` : ""})</p>
            <MapView markers={[{ id: customer.id, lat: customer.lat, lng: customer.lng, title: customer.business_name, glyph: "C", color: "#0891b2" }]} height={260} />
          </>
        ) : (
          <Note tone="amber">No geotag yet.</Note>
        )}
        {c.can("customers.verify") && (
          <section className="space-y-2 rounded-xl border border-neutral-200 p-3">
            <h3 className="flex items-center gap-1 text-sm font-semibold"><ShieldCheck size={14} /> Record Active Taxpayers List (ATL) check</h3>
            <p className="text-xs text-neutral-500">Check {customer.ntn ? `NTN ${customer.ntn}` : customer.cnic ? `CNIC ${customer.cnic}` : "(no NTN / CNIC)"} on FBR&apos;s ATL portal or by SMS &quot;ATL &lt;NTN/CNIC&gt;&quot; to 9966, then record exactly what FBR showed.</p>
            <div className="grid gap-2 md:grid-cols-4">
              <Select value={atl.result} onChange={(e) => setAtl({ ...atl, result: e.target.value as "active" | "inactive" })}>
                <option value="active">Active (on ATL)</option>
                <option value="inactive">Inactive (not on ATL)</option>
              </Select>
              <Input placeholder="Source" value={atl.source} onChange={(e) => setAtl({ ...atl, source: e.target.value })} />
              <Input placeholder="Reference (screenshot / SMS text)" value={atl.reference} onChange={(e) => setAtl({ ...atl, reference: e.target.value })} />
              <Input type="date" value={atl.checkedAt} onChange={(e) => setAtl({ ...atl, checkedAt: e.target.value })} />
            </div>
            <Button onClick={() => void run(() => dist.recordAtlCheck(customer.id, { ...atl, checkedAt: atl.checkedAt || null }), "ATL check recorded.")}>Record check</Button>
            {c.mode === "pharma" && customer.cdsl_no && (
              <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-2">
                <span className="self-center text-xs text-neutral-500">CDSL manually verified against the licence document:</span>
                <Button onClick={() => void run(() => dist.verifyCdsl(customer.id, "verified", reason), "CDSL marked verified.")}>Verified</Button>
                <Button onClick={() => void run(() => dist.verifyCdsl(customer.id, "rejected", reason), "CDSL marked rejected.")}>Rejected</Button>
              </div>
            )}
          </section>
        )}
        <section>
          <h3 className="mb-1 text-sm font-semibold">ATL check history</h3>
          <ul className="text-xs">
            {((checks.data ?? []) as { id: string; checked_at: string; result: string; source: string; reference: string | null; identifier: string }[]).map((k) => (
              <li key={k.id} className="border-t border-neutral-100 py-1">{k.checked_at.slice(0, 16).replace("T", " ")} · {k.identifier} · <b>{k.result}</b> · {k.source}{k.reference ? ` · ${k.reference}` : ""}</li>
            ))}
            {!checks.data?.length && <li className="text-neutral-400">No checks recorded.</li>}
          </ul>
        </section>
        {c.admin && (
          <section className="space-y-2 rounded-xl border border-rose-200 p-3">
            <h3 className="text-sm font-semibold text-rose-700">Administrator</h3>
            <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void run(() => dist.setCustomerStatus(customer.id, customer.status === "active" ? "inactive" : "active", reason), "Status changed.", true)}>{customer.status === "active" ? "Deactivate" : "Reactivate"}</Button>
              <Button variant="danger" onClick={() => confirm(`Delete ${customer.business_name}? Invoices stay available.`) && void run(() => dist.deleteCustomer(customer.id, reason), "Customer deleted.", true)}>Delete customer</Button>
            </div>
          </section>
        )}
        {msg && (msg.ok ? <Note tone="emerald">{msg.text}</Note> : <Err error={msg.text} />)}
      </div>
    </Modal>
  );
}
