"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { SERVER_DB } from "@/lib/serverMode";
import { useAuthStore } from "@/store/authStore";
import { inAndroidApp } from "@/lib/inAndroidApp";
import { PaymentsManager, payApi } from "@/components/payments/PaymentsManager";

interface Req { id: string; methods: string[]; note: string | null; status: string; decisionNote: string | null; createdAt: string }
interface Flags { online: boolean; jazzcash: boolean; easypaisa: boolean; card: boolean; customMerchant: boolean; refund: boolean }

const WANTS: { id: string; label: string }[] = [
  { id: "jazzcash", label: "JazzCash" },
  { id: "easypaisa", label: "Easypaisa" },
  { id: "card", label: "Visa / Mastercard (on the provider's card page)" },
  { id: "custom_merchant", label: "Use my own merchant account" },
  { id: "refund", label: "Refunds from MAVIN.pk" },
];

/** Settings > Online Payments: the owner asks MAVIN.pk for online payments,
 * connects the business's own merchant accounts, sees payments and refunds,
 * and can pay the MAVIN.pk subscription online when MAVIN.pk offers it. */
export default function PaymentsSettingsPage() {
  const role = useAuthStore((s) => s.currentUser?.role);
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  if (!SERVER_DB) return <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">Online payments are managed in the web version of MAVIN.pk.</p>;
  if (role !== "owner" || !tenantId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Online Payments" />
        <p className="text-sm text-neutral-600">Only the business owner manages online payments.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Online Payments" />
      <SubscriptionPay />
      <Access tenantId={tenantId} />
    </div>
  );
}

function Access({ tenantId }: { tenantId: string }) {
  const [flags, setFlags] = useState<Flags | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [want, setWant] = useState<string[]>(["jazzcash", "easypaisa", "custom_merchant"]);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([payApi<{ flags: Flags }>("merchants", { tenantId }), payApi<Req[]>("requests")]);
      setFlags(m.flags);
      setReqs(r);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  const pending = reqs.find((r) => r.status === "pending");
  const lastDone = reqs.find((r) => r.status !== "pending");
  return (
    <>
      {flags && !flags.online && (
        <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900">Take payments online</h2>
          <p className="text-sm text-neutral-600">Customers pay on your website with JazzCash, Easypaisa or a Visa / Mastercard card, on the provider&apos;s own secure page, into your own merchant account. MAVIN.pk switches this on for your business first.</p>
          {pending ? (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">Request sent {new Date(pending.createdAt).toLocaleDateString("en-PK")} for {pending.methods.join(", ")}. MAVIN.pk will reply.</p>
          ) : (
            <>
              {lastDone?.status === "rejected" && <p className="text-sm text-rose-700">Your last request was not approved{lastDone.decisionNote ? `: ${lastDone.decisionNote}` : "."}</p>}
              <fieldset className="grid gap-1.5 text-sm sm:grid-cols-2">
                {WANTS.map((w) => (
                  <label key={w.id} className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={want.includes(w.id)} onChange={() => setWant(want.includes(w.id) ? want.filter((x) => x !== w.id) : [...want, w.id])} /> {w.label}
                  </label>
                ))}
              </fieldset>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything MAVIN.pk should know (optional)" className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
              <Button variant="primary" onClick={async () => {
                setMsg(null);
                try { await payApi("requestAccess", { methods: want, note }); setMsg({ ok: true, text: "Request sent to MAVIN.pk." }); void load(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
              }}>Request online payments</Button>
            </>
          )}
        </section>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{msg.text}</p>}
      {flags?.online && <PaymentsManager tenantId={tenantId} canRefund={flags.refund} />}
    </>
  );
}

/** Pay the MAVIN.pk subscription online: shown only when MAVIN.pk has an active payment account. */
function SubscriptionPay() {
  const [opts, setOpts] = useState<{ provider: string; method: string; label: string }[]>([]);
  const [choice, setChoice] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-sub`);
  const [back] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("payment")));
  // Not inside the Android app: subscription purchases there need Google Play's payments policy checked first.
  useEffect(() => { if (!inAndroidApp()) payApi<typeof opts>("subscriptionOptions").then(setOpts).catch(() => setOpts([])); }, []);
  if (!opts.length && !back) return null;
  return (
    <section className="space-y-2 rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Pay your MAVIN.pk subscription</h2>
      {back && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">Back from the payment page (reference {back}). Your subscription is extended as soon as the provider confirms the payment; this can take a few minutes.</p>}
      {opts.map((o, i) => <label key={`${o.provider}-${o.method}`} className="flex items-center gap-2 text-sm"><input type="radio" name="subpay" checked={choice === i} onChange={() => setChoice(i)} /> {o.label}</label>)}
      {err && <p role="alert" className="text-sm text-rose-700">{err}</p>}
      {opts.length > 0 && (
        <Button variant="primary" disabled={busy} onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await payApi<{ form: { action: string; method: "POST" | "GET"; fields: Record<string, string> } }>("subscriptionPay", { provider: opts[choice].provider, method: opts[choice].method, idempotencyKey: key });
            const form = document.createElement("form");
            form.method = r.form.method;
            form.action = r.form.action;
            for (const [k, v] of Object.entries(r.form.fields)) {
              const i = document.createElement("input");
              i.type = "hidden"; i.name = k; i.value = v;
              form.appendChild(i);
            }
            document.body.appendChild(form);
            form.submit();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
            setBusy(false);
          }
        }}>{busy ? "Opening…" : "Pay now"}</Button>
      )}
    </section>
  );
}
