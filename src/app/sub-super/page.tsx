"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { appLabel, money, myCall, subSupersAvailable, when } from "@/lib/subSupersClient";
import { ListState, Notice, PaymentPill, StatusPill, errText } from "@/components/subsupers/shared";
import { SalesPerformanceView } from "@/components/subsupers/SalesPerformanceView";

interface Profile {
  distributor: { name: string; business_name: string | null; status: string };
  apps: { id: string; label: string }[];
  plans: { id: string; name: string; price: number; duration_days: number; max_staff_logins: number }[];
}
type Req = Record<string, unknown>;

/** Sub Super (distributor) workspace: their applications, their customer
 * setups and their sales. The server limits every call to their own records. */
export default function SubSuperWorkspace() {
  const [tab, setTab] = useState<"setups" | "sales">("setups");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [requests, setRequests] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Req | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([myCall<Profile>("profile"), myCall<Req[]>("requests")]);
      setProfile(p);
      setRequests(r);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (!subSupersAvailable()) return <Notice kind="warn">The Sub Super workspace works on the web version of MAVIN.pk.</Notice>;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={profile ? `Sub Super: ${profile.distributor.name}` : "Sub Super"}
        actions={
          <div role="tablist" className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
            {(["setups", "sales"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 font-medium ${tab === t ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500"}`}>
                {t === "setups" ? "Customer setups" : "My sales"}
              </button>
            ))}
          </div>
        }
      />
      {tab === "sales" ? <SalesPerformanceView scope="mine" /> : (
        <>
          <ListState loading={loading} error={error} empty={false} emptyText="" onRetry={() => void load()} />
          {profile && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
                <h2 className="text-sm font-semibold text-neutral-800">Applications you can sell</h2>
                {profile.apps.length ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">{profile.apps.map((a) => <li key={a.id} className="rounded-full bg-sky-50 px-2.5 py-1 text-xs text-sky-800 ring-1 ring-sky-200">{a.label}</li>)}</ul>
                ) : <p className="mt-2 text-sm text-neutral-500">None yet. Ask the platform owner to authorize an application.</p>}
              </section>
              <section className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
                <h2 className="text-sm font-semibold text-neutral-800">Plans you can offer</h2>
                <ul className="mt-2 space-y-1 text-sm text-neutral-700">
                  {profile.plans.map((p) => <li key={p.id}>{p.name}: {money(p.price)} per {p.duration_days} days · {p.max_staff_logins} staff login{p.max_staff_logins === 1 ? "" : "s"}</li>)}
                </ul>
              </section>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="primary" disabled={!profile?.apps.length} onClick={() => setEditing("new")}>New customer setup</Button>
          </div>
          <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
            <table className="w-full min-w-max text-sm">
              <thead className="border-b border-neutral-100 bg-neutral-50/80 text-left text-[10px] uppercase tracking-widest text-neutral-400">
                <tr>{["Customer", "Application", "Status", "Payment", "Amount", "Updated"].map((h) => <th key={h} className="px-4 py-2.5">{h}</th>)}</tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={String(r.id)} onClick={() => setEditing(r)} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50">
                    <td className="px-4 py-2.5 font-medium text-neutral-800">{String(r.business_name ?? "(no name yet)")}</td>
                    <td className="px-4 py-2.5">{r.app_id ? appLabel(r.app_id) : "—"}</td>
                    <td className="px-4 py-2.5"><StatusPill status={String(r.status)} /></td>
                    <td className="px-4 py-2.5"><PaymentPill status={String(r.payment_status)} /></td>
                    <td className="px-4 py-2.5 tabular-nums">{money(r.sale_amount ?? r.claimed_amount)}</td>
                    <td className="px-4 py-2.5 text-xs text-neutral-500">{when(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !requests.length && <p className="py-8 text-center text-sm text-neutral-400">No customer setups yet.</p>}
          </div>
        </>
      )}
      {editing && profile && <SetupModal profile={profile} request={editing === "new" ? null : editing} onClose={() => { setEditing(null); void load(); }} />}
    </div>
  );
}

const FIELDS: { k: string; label: string; req?: boolean; type?: string }[] = [
  { k: "businessName", label: "Business name", req: true },
  { k: "ownerName", label: "Owner name", req: true },
  { k: "phone", label: "Owner phone", req: true },
  { k: "email", label: "Owner email", type: "email" },
  { k: "city", label: "City" },
  { k: "address", label: "Address" },
  { k: "ntn", label: "NTN (if registered)" },
  { k: "proposedUsername", label: "Proposed login ID", req: true },
];
const COL: Record<string, string> = {
  businessName: "business_name", ownerName: "owner_name", phone: "phone", email: "email", city: "city", address: "address", ntn: "ntn",
  proposedUsername: "proposed_username", appId: "app_id", planId: "plan_id", claimedAmount: "claimed_amount", paymentReference: "payment_reference",
  paymentDate: "payment_date", notes: "notes",
};

function SetupModal({ profile, request, onClose }: { profile: Profile; request: Req | null; onClose: () => void }) {
  const status = String(request?.status ?? "draft");
  const editable = status === "draft" || status === "returned";
  const [id, setId] = useState<string | null>(request ? String(request.id) : null);
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(COL).map(([k, col]) => [k, request?.[col] == null ? "" : String(request[col])])),
  );
  const [events, setEvents] = useState<Req[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id) void myCall<{ events: Req[] }>("getRequest", { id }).then((r) => setEvents(r.events)).catch(() => undefined);
  }, [id]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  async function save(submit: boolean) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await myCall<{ id: string }>("saveDraft", { id, ...v });
      setId(r.id);
      if (submit) {
        await myCall("submit", { id: r.id });
        setMsg("Submitted to the platform owner for approval.");
        setTimeout(onClose, 900);
      } else setMsg("Draft saved.");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={request ? `Setup: ${String(request.business_name ?? "")}` : "New customer setup"} onClose={onClose} width="max-w-3xl">
      <div className="space-y-4">
        {request && <div className="flex flex-wrap gap-2"><StatusPill status={status} /><PaymentPill status={String(request.payment_status)} /></div>}
        {status === "returned" && <Notice kind="warn">Returned for correction: {String(request?.return_reason)}</Notice>}
        {status === "rejected" && <Notice kind="error">Rejected: {String(request?.reject_reason)}</Notice>}
        {status === "activated" && <Notice kind="ok">Activated on {when(request?.activated_at)}. The platform owner sends the customer their sign-in link.</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        {msg && <Notice kind="ok">{msg}</Notice>}

        <fieldset disabled={!editable || busy} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Application" required>
              <Select id="ss-app" value={v.appId} onChange={set("appId")}>
                <option value="">Choose…</option>
                {profile.apps.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </Select>
            </Field>
            <Field label="Plan" required>
              <Select id="ss-plan" value={v.planId} onChange={set("planId")}>
                <option value="">Choose…</option>
                {profile.plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.price)} / {p.duration_days} days</option>)}
              </Select>
            </Field>
            {FIELDS.map((f) => (
              <Field key={f.k} label={f.label} required={f.req}>
                <Input id={`ss-${f.k}`} type={f.type ?? "text"} value={v[f.k]} onChange={set(f.k)} />
              </Field>
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Payment you received (checked by the platform owner)</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <Field label="Amount"><Input id="ss-amount" inputMode="decimal" value={v.claimedAmount} onChange={set("claimedAmount")} /></Field>
              <Field label="Reference / transaction ID"><Input id="ss-ref" value={v.paymentReference} onChange={set("paymentReference")} /></Field>
              <Field label="Payment date"><Input id="ss-date" type="date" value={v.paymentDate} onChange={set("paymentDate")} /></Field>
            </div>
          </div>
          <Field label="Notes for the platform owner"><Textarea id="ss-notes" rows={2} value={v.notes} onChange={set("notes")} /></Field>
          <p className="text-xs text-neutral-500">The customer gets no access until the platform owner verifies the payment and approves. They then receive a one-time link to choose their own password.</p>
        </fieldset>

        {editable && (
          <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
            <Button disabled={busy} onClick={() => void save(false)}>Save draft</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save(true)}>{status === "returned" ? "Resubmit" : "Submit for approval"}</Button>
          </div>
        )}
        {events.length > 0 && (
          <section>
            <h3 className="mb-1 text-sm font-semibold text-neutral-800">History</h3>
            <ul className="space-y-1 text-xs text-neutral-600">
              {events.map((e, i) => <li key={i}>{when(e.created_at)} · {String(e.actor_role) === "owner" ? "Platform owner" : "You"} · {String(e.action).replace(/_/g, " ")}{e.reason ? `: ${String(e.reason)}` : ""}</li>)}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}
