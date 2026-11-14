"use client";

/** Super Admin › PRA Integration: grant or revoke a business's PRA eIMS access,
 * record onboarding (registration, sandbox test, IP whitelist), map counters
 * to PRA POS IDs with their credentials, approve counters and going live,
 * assign approved tax rules, and follow submissions (src/server/pra/service.ts).
 * Disabled by default; live submission also needs PRA_PRODUCTION_ENABLED on the server. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { serverJson } from "@/lib/serverMode";
import { PRA_SECTORS } from "@/lib/pra/rules";
import { PRA_STATE_LABEL, PraSubmissions } from "@/components/pra/PraSubmissions";

interface Row { tenantId: string; name: string; businessType: string; pntn: string | null; state: string; counters: number; attention: number }
interface Counter { id: string; branchId: string; counter: string; sector: string; environment: string; sandboxPosId: string | null; productionPosId: string | null; status: string; approvedAt: string | null; hasSandboxToken: boolean; hasProductionToken: boolean; sandboxTokenHint: string | null; productionTokenHint: string | null }
interface Setup {
  tenant: { id: string; name: string; businessType: string }; state: string;
  account: { status: string; pntn: string | null; registeredName: string | null; registrationStatus: string; sandboxStatus: string; whitelistStatus: string; whitelistIp: string | null; liveApprovedAt: string | null; suspendedReason: string | null; notes: string | null } | null;
  counters: Counter[]; branches: { id: string; name: string; isMain: boolean }[];
  assignments: { id: string; branchId: string | null; ruleKey: string; contractNote: string | null; assignedAt: string }[];
  submissions: Record<string, number>; storageReady: boolean; productionRoute: string; productionSwitch: boolean;
  audit: { action: string; actor_role: string; detail: string | null; created_at: string }[];
}
interface Rule { id: string; rule_key: string; version: number; sector: string; service: string; status: string; classification_code: string | null }

const call = <T,>(action: string, body: Record<string, unknown> = {}) => serverJson<{ result: T }>("/api/pra/", { action, ...body }).then((r) => r.result);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const input = "w-full rounded-lg px-3 py-2 text-sm ring-1 ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-sky-300";
const STATE_TONE: Record<string, string> = { live: "bg-emerald-100 text-emerald-800", suspended: "bg-rose-100 text-rose-800", disabled: "bg-neutral-100 text-neutral-600" };

export default function PraAdminPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows(await call<Row[]>("accounts", { search: q })); setMsg(null); } catch (e) { setMsg(errText(e)); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-4">
      <PageHeader title="PRA Integration" actions={<Link href="/admin/pra/rules" className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-black/10 hover:bg-neutral-50">PRA Tax Suggestions →</Link>} />
      <p className="max-w-3xl text-sm text-neutral-600">
        Punjab Revenue Authority eIMS (cloud API, PRA / PRAL POS Component and eIMS User Manual v1.0). Off for every business until you enable it here.
        Production needs: POS registration with PRA, a passed sandbox test, PRA whitelisting MAVIN&apos;s outbound IP (email eims@pra.punjab.gov.pk with PNTN, business name, POS ID, server IP and location),
        your live approval, and PRA_PRODUCTION_ENABLED on the server.
      </p>
      {msg && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">{msg}</p>}
      <div className="flex gap-2"><input className={`${input} max-w-sm`} placeholder="Search business" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500"><tr><th className="px-3 py-2">Business</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">PNTN</th><th className="px-3 py-2">Counters</th><th className="px-3 py-2">State</th><th /></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.tenantId} className="cursor-pointer border-t border-neutral-100 hover:bg-sky-50/40" onClick={() => setOpen(r.tenantId)}>
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-xs">{r.businessType}</td>
                <td className="px-3 py-2 text-xs">{r.pntn ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.counters}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_TONE[r.state] ?? "bg-sky-100 text-sky-800"}`}>{PRA_STATE_LABEL[r.state] ?? r.state}</span></td>
                <td className="px-3 py-2 text-xs text-amber-800">{r.attention ? `${r.attention} need attention` : ""}</td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={6} className="py-8 text-center text-neutral-400">No business found.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <TenantPra tenantId={open} onChanged={() => void load()} />}
    </div>
  );
}

function TenantPra({ tenantId, onChanged }: { tenantId: string; onChanged: () => void }) {
  const [s, setS] = useState<Setup | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [acc, setAcc] = useState<Record<string, string>>({});
  const [pos, setPos] = useState<Record<string, string> | null>(null);
  const [assign, setAssign] = useState({ ruleKey: "", branchId: "", contractNote: "" });
  const load = useCallback(async () => {
    try {
      const x = await call<Setup>("setup", { tenantId });
      setS(x);
      const a = x.account;
      setAcc({ pntn: a?.pntn ?? "", registeredName: a?.registeredName ?? "", registrationStatus: a?.registrationStatus ?? "not_started", sandboxStatus: a?.sandboxStatus ?? "not_started", whitelistStatus: a?.whitelistStatus ?? "not_requested", whitelistIp: a?.whitelistIp ?? "", notes: a?.notes ?? "" });
      setRules((await call<Rule[]>("rules", { status: "approved" })));
    } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); await load(); onChanged(); } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  if (!s) return <p className="text-sm text-neutral-500">{msg?.text ?? "Loading…"}</p>;
  const a = s.account;
  const branchName = (id: string | null) => (id ? s.branches.find((b) => b.id === id)?.name ?? id : "All branches");
  const steps: [string, boolean][] = [
    ["Access enabled", a?.status === "enabled"],
    ["PNTN and registration recorded", !!a?.pntn && a.registrationStatus === "registered"],
    ["A counter approved", s.counters.some((c) => c.status === "approved")],
    ["Approved tax rule assigned", s.assignments.length > 0],
    ["Sandbox test passed", a?.sandboxStatus === "passed"],
    ["IP whitelisted by PRA", a?.whitelistStatus === "approved"],
    ["Live approved", !!a?.liveApprovedAt],
  ];
  return (
    <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/[0.05]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{s.tenant.name} <span className="text-sm font-normal text-neutral-500">({s.tenant.businessType})</span></h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATE_TONE[s.state] ?? "bg-sky-100 text-sky-800"}`}>{PRA_STATE_LABEL[s.state] ?? s.state}</span>
      </div>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>{msg.text}</p>}
      {!s.storageReady && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">PRA_TOKEN_KEY is not set on the server: credentials can&apos;t be saved yet.</p>}
      <ol className="grid gap-1 text-sm md:grid-cols-4">
        {steps.map(([label, ok], i) => <li key={label} className={ok ? "text-emerald-700" : "text-neutral-500"}>{ok ? "✓" : `${i + 1}.`} {label}</li>)}
      </ol>
      <p className="text-xs text-neutral-500">Production route: <b>{s.productionRoute}</b> · live switch on server: <b>{s.productionSwitch ? "on" : "off"}</b>. Submissions: {Object.entries(s.submissions).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.</p>

      <div className="flex flex-wrap gap-2">
        {a?.status !== "enabled" && <Button variant="primary" onClick={() => void act(() => call("access", { tenantId, access: "enabled" }), "PRA access enabled (the desktop PRA sender stands down for this business).")}>Enable PRA access</Button>}
        {a?.status === "enabled" && <Button onClick={() => { const r = prompt("Suspend PRA for this business. Reason:"); if (r) void act(() => call("access", { tenantId, access: "suspended", reason: r }), "Suspended."); }}>Suspend</Button>}
        {a && a.status !== "disabled" && <Button variant="danger" onClick={() => { const r = prompt("Revoke PRA access. Reason:"); if (r) void act(() => call("access", { tenantId, access: "disabled", reason: r }), "Access revoked."); }}>Revoke access</Button>}
        {a?.status === "enabled" && !a.liveApprovedAt && <Button variant="primary" onClick={() => void act(() => call("live", { tenantId, approve: true }), "Live approved.")}>Approve going live</Button>}
        {a?.liveApprovedAt && <Button onClick={() => void act(() => call("live", { tenantId, approve: false }), "Live approval withdrawn.")}>Withdraw live approval</Button>}
      </div>

      <section className="space-y-2">
        <h3 className="font-semibold">1 · Registration and onboarding</h3>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="text-xs">PNTN<input className={input} value={acc.pntn ?? ""} onChange={(e) => setAcc({ ...acc, pntn: e.target.value })} /></label>
          <label className="text-xs">Registered business name<input className={input} value={acc.registeredName ?? ""} onChange={(e) => setAcc({ ...acc, registeredName: e.target.value })} /></label>
          <label className="text-xs">POS registration (PRA portal)<select className={input} value={acc.registrationStatus} onChange={(e) => setAcc({ ...acc, registrationStatus: e.target.value })}>{["not_started", "submitted", "registered"].map((v) => <option key={v}>{v}</option>)}</select></label>
          <label className="text-xs">Sandbox test<select className={input} value={acc.sandboxStatus} onChange={(e) => setAcc({ ...acc, sandboxStatus: e.target.value })}>{["not_started", "in_progress", "passed", "failed"].map((v) => <option key={v}>{v}</option>)}</select></label>
          <label className="text-xs">IP whitelist<select className={input} value={acc.whitelistStatus} onChange={(e) => setAcc({ ...acc, whitelistStatus: e.target.value })}>{["not_requested", "requested", "approved", "rejected"].map((v) => <option key={v}>{v}</option>)}</select></label>
          <label className="text-xs">Whitelisted server IP<input className={input} value={acc.whitelistIp ?? ""} placeholder="95.111.192.41" onChange={(e) => setAcc({ ...acc, whitelistIp: e.target.value })} /></label>
          <label className="text-xs md:col-span-3">Notes (internal)<textarea className={input} rows={2} value={acc.notes ?? ""} onChange={(e) => setAcc({ ...acc, notes: e.target.value })} /></label>
        </div>
        <Button onClick={() => void act(() => call("save_account", { tenantId, ...acc }), "Saved.")}>Save onboarding</Button>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">2 · Counters (POS IDs from PRA)</h3>
          <Button onClick={() => setPos({ branchId: s.branches[0]?.id ?? "", counter: "", sector: "restaurant", environment: "sandbox", sandboxPosId: "", productionPosId: "", sandboxToken: "", productionToken: "" })}>Add counter</Button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500"><tr><th>Branch / counter</th><th>Sector</th><th>Env</th><th>Sandbox POS / token</th><th>Production POS / token</th><th>Status</th><th /></tr></thead>
          <tbody>
            {s.counters.map((c) => (
              <tr key={c.id} className="border-t border-neutral-100">
                <td className="py-1.5">{branchName(c.branchId)} · <b>{c.counter}</b></td>
                <td className="text-xs">{c.sector}</td>
                <td className="text-xs">{c.environment}</td>
                <td className="text-xs">{c.sandboxPosId ?? "—"} · {c.hasSandboxToken ? c.sandboxTokenHint : "no token"}</td>
                <td className="text-xs">{c.productionPosId ?? "—"} · {c.hasProductionToken ? c.productionTokenHint : "no token"}</td>
                <td className="text-xs">{c.status}</td>
                <td className="space-x-1 whitespace-nowrap text-end">
                  <Button variant="ghost" onClick={() => setPos({ id: c.id, branchId: c.branchId, counter: c.counter, sector: c.sector, environment: c.environment, sandboxPosId: c.sandboxPosId ?? "", productionPosId: c.productionPosId ?? "", sandboxToken: "", productionToken: "" })}>Edit</Button>
                  {c.status !== "approved" && <Button onClick={() => void act(() => call("decide_pos", { tenantId, id: c.id, approve: true }), "Counter approved.")}>Approve</Button>}
                  {c.status === "approved" && <Button onClick={() => { const r = prompt("Revoke this counter. Reason:"); if (r) void act(() => call("decide_pos", { tenantId, id: c.id, approve: false, reason: r }), "Counter revoked."); }}>Revoke</Button>}
                </td>
              </tr>
            ))}
            {!s.counters.length && <tr><td colSpan={7} className="py-3 text-center text-xs text-neutral-400">No counter yet.</td></tr>}
          </tbody>
        </table>
        {pos && (
          <div className="grid gap-2 rounded-xl bg-neutral-50 p-3 md:grid-cols-4">
            <label className="text-xs">Branch<select className={input} value={pos.branchId} onChange={(e) => setPos({ ...pos, branchId: e.target.value })}>{s.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="text-xs">Counter (as registered)<input className={input} value={pos.counter} onChange={(e) => setPos({ ...pos, counter: e.target.value })} /></label>
            <label className="text-xs">PRA sector<select className={input} value={pos.sector} onChange={(e) => setPos({ ...pos, sector: e.target.value })}>{PRA_SECTORS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
            <label className="text-xs">Environment<select className={input} value={pos.environment} onChange={(e) => setPos({ ...pos, environment: e.target.value })}><option value="sandbox">sandbox</option><option value="production">production</option></select></label>
            <label className="text-xs">Sandbox (test) POS ID<input className={input} value={pos.sandboxPosId} onChange={(e) => setPos({ ...pos, sandboxPosId: e.target.value })} /></label>
            <label className="text-xs">Sandbox token (blank = keep)<input className={input} type="password" autoComplete="off" value={pos.sandboxToken} onChange={(e) => setPos({ ...pos, sandboxToken: e.target.value })} /></label>
            <label className="text-xs">Production POS ID<input className={input} value={pos.productionPosId} onChange={(e) => setPos({ ...pos, productionPosId: e.target.value })} /></label>
            <label className="text-xs">Production token (blank = keep)<input className={input} type="password" autoComplete="off" value={pos.productionToken} onChange={(e) => setPos({ ...pos, productionToken: e.target.value })} /></label>
            <div className="flex gap-2 md:col-span-4">
              <Button variant="primary" onClick={() => void act(async () => {
                const body: Record<string, unknown> = { tenantId, ...pos };
                if (!pos.sandboxToken) delete body.sandboxToken;
                if (!pos.productionToken) delete body.productionToken;
                await call("save_pos", body);
                setPos(null);
              }, "Counter saved. A changed counter needs approval again.")}>Save counter</Button>
              <Button onClick={() => setPos(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">3 · Tax rules assigned</h3>
        <ul className="text-sm">
          {s.assignments.map((x) => (
            <li key={x.id} className="flex items-center gap-2 border-t border-neutral-100 py-1">
              <span className="flex-1"><b>{x.ruleKey}</b> · {branchName(x.branchId)}{x.contractNote ? ` · ${x.contractNote}` : ""}</span>
              <Button variant="ghost" onClick={() => void act(() => call("assign_rule", { tenantId, revokeId: x.id }), "Unassigned.")}>Unassign</Button>
            </li>
          ))}
          {!s.assignments.length && <li className="text-xs text-neutral-400">None: bills are blocked until an approved rule is assigned.</li>}
        </ul>
        <div className="grid gap-2 md:grid-cols-4">
          <select className={input} value={assign.ruleKey} onChange={(e) => setAssign({ ...assign, ruleKey: e.target.value })}>
            <option value="">Approved rule…</option>
            {[...new Map(rules.map((r) => [r.rule_key, r])).values()].map((r) => <option key={r.rule_key} value={r.rule_key}>{r.rule_key} · {r.classification_code}</option>)}
          </select>
          <select className={input} value={assign.branchId} onChange={(e) => setAssign({ ...assign, branchId: e.target.value })}>
            <option value="">All branches</option>
            {s.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input className={input} placeholder="Contract / scope note (contractors)" value={assign.contractNote} onChange={(e) => setAssign({ ...assign, contractNote: e.target.value })} />
          <Button disabled={!assign.ruleKey} onClick={() => void act(() => call("assign_rule", { tenantId, ruleKey: assign.ruleKey, branchId: assign.branchId || null, contractNote: assign.contractNote || null }), "Rule assigned.")}>Assign</Button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">4 · Submissions</h3>
        <PraSubmissions tenantId={tenantId} canReconcile />
      </section>

      <details>
        <summary className="cursor-pointer text-sm font-semibold">Audit trail</summary>
        <ul className="mt-2 max-h-64 overflow-y-auto text-xs">
          {s.audit.map((x, i) => <li key={i} className="border-t border-neutral-100 py-1">{x.created_at.slice(0, 16).replace("T", " ")} · {x.actor_role} · <b>{x.action}</b> {x.detail ? <span className="text-neutral-500">{x.detail.slice(0, 200)}</span> : null}</li>)}
        </ul>
      </details>
    </div>
  );
}
