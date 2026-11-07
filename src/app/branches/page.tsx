"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { SERVER_DB } from "@/lib/serverMode";
import { branchApi, switchBranch, useBranchStore, type Branch, type BranchStatus } from "@/lib/branchClient";

interface UserRow { id: string; username: string; name: string | null; role: string; active: boolean; branches: { branchId: string; manager: boolean }[] }
interface AuditRow { id: string; branchName: string | null; actor: string | null; action: string; detail: unknown; createdAt: string }

const STATUS_STYLE: Record<BranchStatus, string> = {
  active: "bg-emerald-100 text-emerald-800",
  inactive: "bg-amber-100 text-amber-900",
  archived: "bg-neutral-200 text-neutral-700",
};
const ACTION_LABEL: Record<string, string> = {
  "branch.created": "Branch created", "branch.updated": "Branch details changed", "branch.active": "Branch activated", "branch.inactive": "Branch made inactive",
  "branch.archived": "Branch archived", "branch.users_assigned": "Logins assigned", "capacity.requested": "More branches requested",
  "capacity.approved": "Request approved", "capacity.rejected": "Request rejected", "capacity.policy_changed": "Limit changed by the Super Admin",
  "capacity.released": "Archived branch's place released", "transfer.dispatched": "Stock sent", "transfer.received": "Stock received",
  "transfer.received_short": "Stock received (short)", "transfer.cancelled": "Transfer cancelled",
};
const when = (s: string) => new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

/** Enterprise Admin > Branches (business owner). */
export default function BranchesPage() {
  const { ctx, load } = useBranchStore();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [assigning, setAssigning] = useState<UserRow | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await load(true);
      const [u, a] = await Promise.all([branchApi<UserRow[]>("users"), branchApi<AuditRow[]>("audit")]);
      setUsers(u);
      setAudit(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [load]);
  useEffect(() => { if (SERVER_DB) void refresh(); }, [refresh]);

  if (!SERVER_DB) return <p className="text-sm text-neutral-600">Branches are managed in the web version (app.mavin.pk).</p>;
  if (ctx && !ctx.isOwner) return <p className="text-sm text-neutral-600">Only the business owner manages branches.</p>;
  if (!ctx) return <p className="text-sm text-neutral-500">{error ?? "Loading branches…"}</p>;
  const a = ctx.allowance;

  async function setStatus(b: Branch, status: BranchStatus) {
    const reason = status === "active" ? "" : prompt(`Reason for making ${b.name} ${status}?`) ?? null;
    if (reason === null) return;
    if (status === "archived" && !confirm(`Archive ${b.name}? Its records stay for reports and history; no new entries can be made there. It still counts toward your branch limit.`)) return;
    try {
      await branchApi("status", { id: b.id, status, reason });
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const managerName = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? users.find((u) => u.id === id)?.username ?? "—" : "—");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Branches"
        actions={
          <>
            <Link href="/branches/reports" className="rounded-full px-3 py-1.5 text-sm font-medium text-[var(--accent)] hover:underline">Dashboard &amp; reports</Link>
            <Link href="/branches/transfers" className="rounded-full px-3 py-1.5 text-sm font-medium text-[var(--accent)] hover:underline">Stock transfers</Link>
            <Button variant="primary" disabled={a.disabled || (a.remaining !== null && a.remaining <= 0)} onClick={() => setEditing("new")}>Add Branch</Button>
          </>
        }
      />
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <section aria-label="Branch allowance" className="grid gap-3 sm:grid-cols-4">
        <Stat label="Branches" value={String(a.used)} hint={`${ctx.branches.filter((b) => b.status === "active").length} active`} />
        <Stat label="Approved limit" value={a.limit == null ? "Unlimited" : String(a.limit)} hint={a.override != null || a.unlimited ? "Set by MAVIN.pk" : `${a.planName ?? "Plan"} default`} />
        <Stat label="Remaining" value={a.remaining == null ? "—" : String(a.remaining)} hint={a.overLimit ? "Over the limit: no new branches" : "Branches you can still add"} tone={a.remaining === 0 || a.overLimit ? "warn" : undefined} />
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">More branches</p>
          {ctx.pendingRequest ? (
            <div className="mt-1 text-sm">
              <p><b>{ctx.pendingRequest.extra}</b> more requested · waiting for approval</p>
              <button type="button" className="mt-1 text-xs text-rose-700 hover:underline" onClick={async () => { await branchApi("cancelRequest", { id: ctx.pendingRequest!.id }); await refresh(); }}>Cancel request</button>
            </div>
          ) : (
            <Button className="mt-2" disabled={a.disabled || a.limit == null} onClick={() => setAsking(true)}>Request more branches</Button>
          )}
        </div>
      </section>
      {a.disabled && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">Multi-branch is turned off for this business by MAVIN.pk. Every branch and its records are kept; only the main branch is in use.</p>}
      {!a.entitled && !a.disabled && <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">Your plan includes {a.planLimit} branch. Enterprise plans include 5 branches; request more branches or contact MAVIN.pk to upgrade.</p>}

      <section aria-label="Branch list" className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr><th className="px-3 py-2">Branch</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Manager</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {ctx.branches.map((b) => (
              <tr key={b.id} className="border-t border-neutral-100 align-top">
                <td className="px-3 py-2">
                  <p className="font-medium text-neutral-900">{b.name} <span className="text-xs text-neutral-500">{b.code}</span></p>
                  <p className="mt-0.5 flex flex-wrap gap-1 text-[10px] uppercase">
                    {b.isMain && <span className="rounded bg-sky-100 px-1 text-sky-800">Main / head office</span>}
                    {b.onlineFulfillment && <span className="rounded bg-violet-100 px-1 text-violet-800">Fills online orders</span>}
                    {b.capacityReleased && <span className="rounded bg-neutral-100 px-1 text-neutral-600">Place released</span>}
                  </p>
                </td>
                <td className="px-3 py-2 text-neutral-600">{[b.address, b.phone, b.email].filter(Boolean).join(" · ") || "—"}{b.hours && <span className="block text-xs text-neutral-400">{b.hours}</span>}</td>
                <td className="px-3 py-2 text-neutral-600">{managerName(b.managerUserId)}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[b.status]}`}>{b.status}</span></td>
                <td className="px-3 py-2 text-right">
                  <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs">
                    {b.id !== ctx.active && <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => switchBranch(b.id)}>Open</button>}
                    <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => setEditing(b)}>Edit</button>
                    {!b.isMain && b.status === "active" && <button type="button" className="text-amber-700 hover:underline" onClick={() => void setStatus(b, "inactive")}>Make inactive</button>}
                    {!b.isMain && b.status !== "active" && !b.capacityReleased && <button type="button" className="text-emerald-700 hover:underline" onClick={() => void setStatus(b, "active")}>Activate</button>}
                    {!b.isMain && b.status !== "archived" && <button type="button" className="text-neutral-600 hover:underline" onClick={() => void setStatus(b, "archived")}>Archive</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Logins and branches" className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">Logins and their branches</h2>
        <p className="mt-0.5 text-xs text-neutral-500">The owner opens every branch. Other logins open the branches ticked here (the main branch when none is ticked). A branch manager can send and receive stock and see that branch&apos;s reports.</p>
        <ul className="mt-3 divide-y divide-neutral-100 text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><b>{u.name ?? u.username}</b> <span className="text-xs text-neutral-500">{u.username} · {u.role}{u.active ? "" : " · inactive"}</span></span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                {u.role === "owner" ? "All branches" : u.branches.length
                  ? u.branches.map((x) => `${ctx.branches.find((b) => b.id === x.branchId)?.name ?? "?"}${x.manager ? " (manager)" : ""}`).join(", ")
                  : "Main branch"}
                {u.role !== "owner" && <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => setAssigning(u)}>Change</button>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Branch history" className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">History</h2>
        {audit.length ? (
          <ul className="mt-2 divide-y divide-neutral-100 text-sm">
            {audit.map((x) => (
              <li key={x.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>{ACTION_LABEL[x.action] ?? x.action}{x.branchName ? ` · ${x.branchName}` : ""}</span>
                <span className="text-xs text-neutral-500">{x.actor ?? "—"} · {when(x.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-neutral-500">No branch changes yet.</p>}
      </section>

      {editing && <BranchForm branch={editing === "new" ? null : editing} users={users} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(); }} />}
      {assigning && <AssignForm user={assigning} branches={ctx.branches} onClose={() => setAssigning(null)} onSaved={async () => { setAssigning(null); await refresh(); }} />}
      {asking && <RequestForm used={a.used} limit={a.limit ?? 0} onClose={() => setAsking(false)} onSaved={async () => { setAsking(false); await refresh(); }} />}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "warn" }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "warn" ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{value}</p>
      <p className="text-xs text-neutral-500">{hint}</p>
    </div>
  );
}

function BranchForm({ branch, users, onClose, onSaved }: { branch: Branch | null; users: UserRow[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: branch?.code ?? "", name: branch?.name ?? "", address: branch?.address ?? "", phone: branch?.phone ?? "", email: branch?.email ?? "",
    hours: branch?.hours ?? "", managerUserId: branch?.managerUserId ?? "", onlineFulfillment: branch?.onlineFulfillment ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (branch) await branchApi("update", { id: branch.id, branch: f });
      else await branchApi("create", { branch: f });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={branch ? `Edit ${branch.name}` : "Add Branch"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
          <Field label="Code" required><Input value={f.code} onChange={set("code")} disabled={Boolean(branch)} required maxLength={12} placeholder="LHR-2" /></Field>
          <Field label="Branch name" required><Input value={f.name} onChange={set("name")} required maxLength={80} /></Field>
        </div>
        <Field label="Address"><Input value={f.address} onChange={set("address")} maxLength={300} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone"><Input value={f.phone} onChange={set("phone")} maxLength={40} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} maxLength={120} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business hours"><Input value={f.hours} onChange={set("hours")} maxLength={200} placeholder="Mon–Sat 9am–10pm" /></Field>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">Branch manager</span>
            <select value={f.managerUserId} onChange={set("managerUserId")} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm">
              <option value="">None</option>
              {users.filter((u) => u.role !== "owner" && u.active).map((u) => <option key={u.id} value={u.id}>{u.name ?? u.username}</option>)}
            </select>
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={f.onlineFulfillment} onChange={(e) => setF({ ...f, onlineFulfillment: e.target.checked })} />
          <span>Fills online orders<span className="block text-xs text-neutral-500">The website store shows this branch&apos;s stock and its orders are billed here. One branch at a time; the main branch by default.</span></span>
        </label>
        {!branch && <p className="text-xs text-neutral-500">The branch uses this business&apos;s type, products, customers and suppliers. Its stock, sales, purchases, expenses and cash are its own.</p>}
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function AssignForm({ user, branches, onClose, onSaved }: { user: UserRow; branches: Branch[]; onClose: () => void; onSaved: () => void }) {
  const [sel, setSel] = useState(new Map(user.branches.map((b) => [b.branchId, b.manager])));
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setSel((m) => { const n = new Map(m); if (n.has(id)) n.delete(id); else n.set(id, false); return n; });
  const manager = (id: string) => setSel((m) => new Map(m).set(id, !m.get(id)));
  async function save() {
    try {
      await branchApi("assign", { userId: user.id, branches: [...sel].map(([branchId, m]) => ({ branchId, manager: m })) });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Modal title={`Branches for ${user.name ?? user.username}`} onClose={onClose} width="max-w-lg">
      <ul className="divide-y divide-neutral-100 text-sm">
        {branches.filter((b) => b.status !== "archived").map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 py-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} />{b.name} <span className="text-xs text-neutral-400">{b.code}</span></label>
            {sel.has(b.id) && <label className="flex items-center gap-1.5 text-xs text-neutral-600"><input type="checkbox" checked={Boolean(sel.get(b.id))} onChange={() => manager(b.id)} />Manager</label>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-neutral-500">With nothing ticked this login works in the main branch. Changes apply on the login&apos;s next action.</p>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-3 flex justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={() => void save()}>Save</Button>
      </div>
    </Modal>
  );
}

function RequestForm({ used, limit, onClose, onSaved }: { used: number; limit: number; onClose: () => void; onSaved: () => void }) {
  const [extra, setExtra] = useState("1");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    try {
      await branchApi("requestCapacity", { extra: Number(extra), reason });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <Modal title="Request more branches" onClose={onClose} width="max-w-md">
      <form onSubmit={send} className="flex flex-col gap-3">
        <p className="text-sm text-neutral-600">You have {used} of {limit} branches. MAVIN.pk reviews the request and sets your new limit; you then add the branches yourself.</p>
        <Field label="How many more branches" required><Input type="number" min={1} max={100} value={extra} onChange={(e) => setExtra(e.target.value)} required /></Field>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">Reason (optional)</span>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Opening in Faisalabad and Multan" />
        </label>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Send request</Button>
        </div>
      </form>
    </Modal>
  );
}
