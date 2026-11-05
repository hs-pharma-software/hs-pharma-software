"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { BUSINESS_TYPES, FAMILY_LABELS } from "@/config/businessTypes";
import { appLabel, money, ownerCall, when } from "@/lib/subSupersClient";
import { ListState, Notice, PaymentPill, SetupLink, StatusPill, errText } from "./shared";
import { RequestReviewModal } from "./RequestReviewModal";

interface DistributorRow {
  id: string; name: string; business_name: string | null; phone: string | null; email: string | null; city: string | null;
  status: string; status_reason: string | null; username: string; apps: string[]; pending: number; activated: number;
}

export function DistributorsView() {
  const [rows, setRows] = useState<DistributorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await ownerCall<DistributorRow[]>("listDistributors"));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button onClick={() => void load()}>Refresh</Button>
        <Button variant="primary" onClick={() => setAdding(true)}>Add Distributor</Button>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <table className="w-full min-w-max text-sm">
          <thead className="border-b border-neutral-100 bg-neutral-50/80 text-left text-[10px] uppercase tracking-widest text-neutral-400">
            <tr>{["Distributor", "Login ID", "Can sell", "Pending", "Activated", "Status"].map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} onClick={() => setOpenId(d.id)} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50">
                <td className="px-4 py-2.5"><p className="font-medium text-neutral-800">{d.name}</p><p className="text-xs text-neutral-500">{d.business_name ?? "—"} · {d.phone ?? "—"}</p></td>
                <td className="px-4 py-2.5 font-mono text-xs">{d.username}</td>
                <td className="px-4 py-2.5 text-xs text-neutral-600">{d.apps.length ? d.apps.map(appLabel).join(", ") : "Nothing yet"}</td>
                <td className="px-4 py-2.5 tabular-nums">{d.pending}</td>
                <td className="px-4 py-2.5 tabular-nums">{d.activated}</td>
                <td className="px-4 py-2.5">
                  {d.status === "active"
                    ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">Active</span>
                    : <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700">Suspended</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ListState loading={loading} error={error} empty={!rows.length} emptyText="No distributors yet. Add one to let them sell selected applications." onRetry={() => void load()} />
      </div>
      {adding && <AddDistributorModal onClose={() => setAdding(false)} onSaved={() => void load()} />}
      {openId && <DistributorDetail id={openId} onClose={() => { setOpenId(null); void load(); }} />}
    </div>
  );
}

function AppPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
      {(Object.keys(FAMILY_LABELS) as (keyof typeof FAMILY_LABELS)[]).flatMap((fam) =>
        BUSINESS_TYPES.filter((t) => t.family === fam).map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={value.includes(t.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, t.id] : value.filter((x) => x !== t.id))}
            />
            {t.label}
          </label>
        )),
      )}
    </div>
  );
}

function AddDistributorModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", businessName: "", phone: "", email: "", city: "", username: "" });
  const [apps, setApps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await ownerCall<{ setupLink: string }>("createDistributor", { ...f, appIds: apps });
      setLink(r.setupLink);
      onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add Distributor" onClose={onClose} width="max-w-2xl">
      {link ? (
        <div className="space-y-3">
          <SetupLink url={link} who={f.name} />
          <div className="flex justify-end"><Button variant="primary" onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required><Input id="sd-name" value={f.name} onChange={set("name")} required /></Field>
            <Field label="Business name"><Input id="sd-business" value={f.businessName} onChange={set("businessName")} /></Field>
            <Field label="Phone"><Input id="sd-phone" value={f.phone} onChange={set("phone")} /></Field>
            <Field label="Email"><Input id="sd-email" type="email" value={f.email} onChange={set("email")} /></Field>
            <Field label="City"><Input id="sd-city" value={f.city} onChange={set("city")} /></Field>
            <Field label="Login ID" required><Input id="sd-username" value={f.username} onChange={set("username")} required /></Field>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Applications this distributor may sell</p>
            <AppPicker value={apps} onChange={setApps} />
          </div>
          <p className="text-xs text-neutral-500">No password is set here. You get a one-time link for the distributor to choose their own.</p>
          {error && <Notice kind="error">{error}</Notice>}
          <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
            <Button type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Add and create link"}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

interface Detail {
  distributor: DistributorRow;
  grants: { app_id: string; granted_at: string; revoked_at: string | null }[];
  requests: Record<string, unknown>[];
  events: { id: string; action: string; reason: string | null; actor_role: string; created_at: string }[];
}

function DistributorDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", businessName: "", phone: "", email: "", city: "" });
  const [apps, setApps] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await ownerCall<Detail>("getDistributor", { id });
      setD(r);
      setF({ name: r.distributor.name, businessName: r.distributor.business_name ?? "", phone: r.distributor.phone ?? "", email: r.distributor.email ?? "", city: r.distributor.city ?? "" });
      setApps(r.grants.filter((g) => !g.revoked_at).map((g) => g.app_id));
    } catch (e) {
      setError(errText(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(label);
      await load();
    } catch (e) {
      setError(errText(e));
    }
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const suspended = d?.distributor.status === "suspended";

  return (
    <Modal title={d ? d.distributor.name : "Distributor"} onClose={onClose} width="max-w-4xl">
      {!d ? (
        error ? <Notice kind="error">{error}</Notice> : <p className="py-6 text-center text-sm text-neutral-400">Loading…</p>
      ) : (
        <div className="space-y-5">
          {error && <Notice kind="error">{error}</Notice>}
          {msg && <Notice kind="ok">{msg}</Notice>}
          {link && <SetupLink url={link} who={d.distributor.name} />}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-800">Details</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><Input id="dd-name" value={f.name} onChange={set("name")} /></Field>
              <Field label="Business name"><Input id="dd-business" value={f.businessName} onChange={set("businessName")} /></Field>
              <Field label="Phone"><Input id="dd-phone" value={f.phone} onChange={set("phone")} /></Field>
              <Field label="Email"><Input id="dd-email" value={f.email} onChange={set("email")} /></Field>
              <Field label="City"><Input id="dd-city" value={f.city} onChange={set("city")} /></Field>
              <Field label="Login ID"><Input id="dd-login" value={d.distributor.username} disabled /></Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => void run("Details saved.", () => ownerCall("updateDistributor", { id, ...f }))}>Save details</Button>
              <Button onClick={() => void ownerCall<{ setupLink: string }>("distributorLink", { id }).then((r) => setLink(r.setupLink)).catch((e) => setError(errText(e)))}>
                New sign-in link
              </Button>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-800">Applications they may sell</h3>
            <AppPicker value={apps} onChange={setApps} />
            <p className="mt-2 text-xs text-neutral-500">Removing an application blocks new setups for it. Pending setups for it are flagged for your review; activated customers are not affected.</p>
            <Button className="mt-2" onClick={() => void run("Applications saved.", () => ownerCall("setApps", { id, appIds: apps }))}>Save applications</Button>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-800">Access</h3>
            {suspended && <p className="mb-2 text-sm text-rose-700">Suspended: {d.distributor.status_reason}</p>}
            <div className="flex flex-wrap items-end gap-2">
              {!suspended && (
                <label htmlFor="dd-reason" className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-neutral-600">
                  Reason for suspending
                  <Input id="dd-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
              )}
              {suspended
                ? <Button onClick={() => void run("Access enabled.", () => ownerCall("setStatus", { id, status: "active" }))}>Enable access</Button>
                : <Button variant="danger" onClick={() => void run("Distributor suspended.", () => ownerCall("setStatus", { id, status: "suspended", reason }))}>Suspend</Button>}
            </div>
            <p className="mt-1 text-xs text-neutral-500">Suspending blocks their sign-in and new submissions. Their sales history stays in the reports.</p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-800">Customer setups and sales</h3>
            {!d.requests.length ? <p className="text-sm text-neutral-400">No submitted setups yet.</p> : (
              <div className="overflow-x-auto rounded-xl ring-1 ring-neutral-200">
                <table className="w-full min-w-max text-sm">
                  <thead className="bg-neutral-50 text-left text-[10px] uppercase tracking-widest text-neutral-400">
                    <tr>{["Customer", "Application", "Status", "Payment", "Amount", "Updated"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {d.requests.map((r) => (
                      <tr key={String(r.id)} onClick={() => setReviewId(String(r.id))} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50">
                        <td className="px-3 py-2">{String(r.business_name ?? "—")}</td>
                        <td className="px-3 py-2">{appLabel(r.app_id)}</td>
                        <td className="px-3 py-2"><StatusPill status={String(r.status)} /></td>
                        <td className="px-3 py-2"><PaymentPill status={String(r.payment_status)} /></td>
                        <td className="px-3 py-2 tabular-nums">{money(r.sale_amount ?? r.expected_amount)}</td>
                        <td className="px-3 py-2 text-xs text-neutral-500">{when(r.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-800">History</h3>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-neutral-600">
              {d.events.map((e) => <li key={e.id}>{when(e.created_at)} · {e.actor_role} · {e.action.replace(/_/g, " ")}{e.reason ? `: ${e.reason}` : ""}</li>)}
            </ul>
          </section>
        </div>
      )}
      {reviewId && <RequestReviewModal id={reviewId} onClose={() => { setReviewId(null); void load(); }} />}
    </Modal>
  );
}
