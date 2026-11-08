"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { serverJson } from "@/lib/serverMode";

type Env = "sandbox" | "live";
interface Merchant {
  id: string; provider: string; providerLabel: string; environment: Env; status: string; enabled: boolean; methods: string[]; approvedDomains: string[];
  hints: Record<string, string>; lastTestAt: string | null; lastTestOk: boolean | null; lastTestNote: string | null; integrationReady: boolean;
}
interface Provider { id: string; label: string; methods: { id: string; label: string }[]; fields: { key: string; label: string; secret: boolean }[]; onboarding: string; integrationReady: boolean; allowed: boolean }
interface Data { merchants: Merchant[]; providers: Provider[]; flags: Record<string, boolean> | null; callbackUrl: string; secretsReady: boolean }
interface Txn { id: string; purpose: string; refId: string; branchId: string | null; provider: string; method: string; amount: number; currency: string; reference: string; status: string; providerRef: string | null; settlement: string; reviewNote: string | null; refunded: number; createdAt: string; paidAt: string | null; manualRefunds: { id: string; amount: number }[] }

export const payApi = <T,>(action: string, body: Record<string, unknown> = {}) => serverJson<{ result: T }>("/api/payments/", { action, ...body }).then((r) => r.result);

const STEPS = ["Allowed by MAVIN.pk", "Merchant account set up", "Sandbox test passed", "Live test passed", "Active"];
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** Online payment connections and transactions: a business's own (tenantId of
 * the signed-in business) or MAVIN.pk's own for subscriptions (Super Admin, tenantId null). */
export function PaymentsManager({ tenantId, canRefund = false }: { tenantId: string | null; canRefund?: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setD(await payApi<Data>("merchants", { tenantId }));
      setTxns(await payApi<Txn[]>("transactions", { tenantId }).catch(() => []));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <p className="text-sm text-neutral-500">{error ?? "Loading…"}</p>;

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {!d.secretsReady && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">The server&apos;s payment secret key (PAYMENTS_SECRET_KEY) is not set yet, so credentials cannot be saved. MAVIN.pk sets it up once for everyone.</p>}
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Steps to take online payments">
        {STEPS.map((s, i) => <li key={s} className="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-700">{i + 1}. {s}</li>)}
      </ol>
      {d.providers.map((p) => <ProviderCard key={p.id} p={p} d={d} tenantId={tenantId} onChanged={load} />)}
      <Transactions txns={txns} tenantId={tenantId} canRefund={canRefund} onChanged={load} />
    </div>
  );
}

function ProviderCard({ p, d, tenantId, onChanged }: { p: Provider; d: Data; tenantId: string | null; onChanged: () => void }) {
  const [env, setEnv] = useState<Env>("sandbox");
  const m = d.merchants.find((x) => x.provider === p.id && x.environment === env) ?? null;
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [methods, setMethods] = useState<string[]>(m?.methods ?? []);
  const [domains, setDomains] = useState((m?.approvedDomains ?? []).join("\n"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setMethods(m?.methods ?? []); setDomains((m?.approvedDomains ?? []).join("\n")); setCreds({}); setMsg(null); }, [m?.id, env]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (what: string, fn: () => Promise<string>) => {
    setBusy(what);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  if (!p.allowed) {
    return (
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">{p.label}</h2>
        <p className="mt-1 text-sm text-neutral-600">Not enabled for your business. Use &quot;Request online payments&quot; above to ask MAVIN.pk.</p>
      </section>
    );
  }
  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">{p.label}</h2>
        <div className="inline-flex rounded-full border border-neutral-200 p-0.5 text-xs" role="group" aria-label="Environment">
          {(["sandbox", "live"] as Env[]).map((e) => <button key={e} type="button" onClick={() => setEnv(e)} className={`rounded-full px-3 py-1 ${env === e ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>{e === "sandbox" ? "Sandbox (test)" : "Live"}</button>)}
        </div>
      </div>
      {!p.integrationReady && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
          The {p.label} connection will be completed from {p.label}&apos;s official merchant integration kit (issued to approved merchants). You can save your details now; it cannot be tested or turned on until then.
        </p>
      )}
      <details className="text-xs text-neutral-600"><summary className="cursor-pointer font-medium text-neutral-800">How to get a {p.label} merchant account</summary><p className="mt-1">{p.onboarding}</p></details>
      <p className="text-xs text-neutral-600">Status: <b>{m ? (m.enabled ? "Active" : m.status) : "Not set up"}</b>{m?.lastTestAt ? ` · last test ${when(m.lastTestAt)}: ${m.lastTestOk ? "passed" : "not passed"}` : ""}</p>
      {m?.lastTestNote && <p className="text-xs text-neutral-500">{m.lastTestNote}</p>}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {p.fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
            {f.label}
            <input
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              value={creds[f.key] ?? ""}
              onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
              placeholder={m?.hints[f.key] ? (f.secret ? `${m.hints[f.key]} (leave empty to keep)` : m.hints[f.key]) : ""}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
            />
          </label>
        ))}
      </div>
      <fieldset className="text-sm">
        <legend className="mb-1 text-xs font-medium text-neutral-600">Methods approved on this merchant account</legend>
        {p.methods.map((x) => (
          <label key={x.id} className="mr-4 inline-flex items-center gap-1.5">
            <input type="checkbox" checked={methods.includes(x.id)} disabled={x.id === "card" && d.flags !== null && !d.flags.card} onChange={() => setMethods(methods.includes(x.id) ? methods.filter((y) => y !== x.id) : [...methods, x.id])} /> {x.label}
          </label>
        ))}
      </fieldset>
      {tenantId !== null && (
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          Website addresses approved on the merchant account (one per line)
          <textarea rows={2} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="yourshop.mavin.pk" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
        </label>
      )}
      <p className="text-xs text-neutral-500">Give {p.label} this callback / return address: <code className="break-all rounded bg-neutral-100 px-1">{d.callbackUrl}?p={p.id}</code></p>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!!busy} onClick={() => void run("save", async () => {
          await payApi("save", { tenantId, provider: p.id, environment: env, credentials: creds, methods, approvedDomains: domains.split(/\s+/).filter(Boolean) });
          setCreds({});
          return "Saved. Test it before turning it on.";
        })}>{busy === "save" ? "Saving…" : "Save"}</Button>
        {m && <Button disabled={!!busy} onClick={() => void run("test", async () => (await payApi<{ ok: boolean; note: string }>("test", { id: m.id })).note)}>{busy === "test" ? "Testing…" : "Test connection"}</Button>}
        {m && env === "live" && (
          <Button disabled={!!busy} onClick={() => void run("enable", async () => { await payApi("enable", { id: m.id, enabled: !m.enabled }); return m.enabled ? "Turned off: no new payments. Payments already started are still checked." : "Turned on."; })}>
            {m.enabled ? "Turn off" : "Turn on"}
          </Button>
        )}
      </div>
    </section>
  );
}

function Transactions({ txns, tenantId, canRefund, onChanged }: { txns: Txn[]; tenantId: string | null; canRefund: boolean; onChanged: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  if (!txns.length) return <section className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">No online payments yet.</section>;
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-neutral-900">Online payments</h2>
      {msg && <p className="mb-2 text-sm text-neutral-700">{msg}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs uppercase text-neutral-500"><tr><th className="py-1">Date</th><th>For</th><th>Provider</th><th className="text-right">Amount</th><th>Status</th><th>Reference</th><th /></tr></thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id} className="border-t border-neutral-100 align-top">
                <td className="py-1.5">{when(t.createdAt)}</td>
                <td>{t.purpose === "subscription" ? "Subscription" : "Online order"}</td>
                <td>{t.provider} · {t.method}</td>
                <td className="text-right tabular-nums">{t.currency} {t.amount.toFixed(2)}{t.refunded ? <span className="block text-xs text-neutral-500">refunded {t.refunded.toFixed(2)}</span> : null}</td>
                <td>{t.status}{t.reviewNote && <span className="block text-xs text-amber-700">{t.reviewNote}</span>}<span className="block text-xs text-neutral-400">settlement: {t.settlement}</span></td>
                <td className="font-mono text-xs">{t.reference}{t.providerRef && <span className="block text-neutral-400">{t.providerRef}</span>}</td>
                <td className="whitespace-nowrap text-right text-xs">
                  {["redirected", "pending"].includes(t.status) && <button type="button" className="text-[var(--accent)] hover:underline" onClick={async () => { try { const r = await payApi<{ status: string }>("recheck", { id: t.id, tenantId }); setMsg(`Checked: ${r.status}`); onChanged(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } }}>Check again</button>}
                  {canRefund && t.manualRefunds.map((r) => (
                    <button key={r.id} type="button" className="ml-2 text-emerald-700 hover:underline" onClick={async () => {
                      const ref = prompt(`Refund of ${r.amount.toFixed(2)} made in the merchant portal? Enter its reference (optional).`);
                      if (ref === null) return;
                      try { await payApi("completeRefund", { id: r.id, providerRef: ref }); setMsg("Refund marked as done."); onChanged(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
                    }}>Mark refund {r.amount.toFixed(2)} done</button>
                  ))}
                  {canRefund && ["paid", "review"].includes(t.status) && t.refunded < t.amount && (
                    <button type="button" className="ml-2 text-rose-700 hover:underline" onClick={async () => {
                      const amount = prompt(`Refund how much? (up to ${(t.amount - t.refunded).toFixed(2)})`, (t.amount - t.refunded).toFixed(2));
                      if (!amount) return;
                      const reason = prompt("Reason for the refund?") ?? "";
                      try { const r = await payApi<{ status: string; note?: string }>("refund", { id: t.id, amount: Number(amount), reason, idempotencyKey: `${t.id}-${amount}-${Date.now()}` }); setMsg(r.note ?? `Refund ${r.status}.`); onChanged(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
                    }}>Refund</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
