"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { serverJson } from "@/lib/serverMode";
import { PRA_GATEWAY_IP, PRA_TEMPLATES, praTemplate } from "@/lib/pra/templates";

const call = <T,>(action: string, body: Record<string, unknown> = {}) => serverJson<{ result: T }>("/api/pra/", { action, ...body }).then((r) => r.result);
const input = "w-full rounded-lg px-3 py-2 text-sm ring-1 ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-sky-300";
const secret = { type: "password", autoComplete: "new-password", "data-1p-ignore": true, "data-lpignore": "true" } as const;

export interface QuickSetupState {
  tenantId: string;
  businessType: string;
  pntn: string | null;
  registeredName: string | null;
  sandboxStatus: string | null;
  liveApprovedAt: string | null;
  productionSwitch: boolean;
  counter: { counter: string; sandboxPosId: string | null; productionPosId: string | null; hasSandboxToken: boolean; hasProductionToken: boolean; environment: string; status: string } | null;
  hasRule: boolean;
}

/** Super Admin: set up a vendor on one screen. 1 Choose the service and enter its details, 2 test on the Sandbox, 3 go live. */
export function PraQuickSetup({ s, onDone }: { s: QuickSetupState; onDone: () => void }) {
  const [f, setF] = useState({ templateId: "laundry", pntn: s.pntn ?? "", registeredName: s.registeredName ?? "", counter: s.counter?.counter ?? "", sandboxPosId: s.counter?.sandboxPosId ?? "", sandboxToken: "", productionPosId: s.counter?.productionPosId ?? "", productionToken: "", scopeNote: "", whitelistReference: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setMsg(null), [s.tenantId]);
  const t = praTemplate(f.templateId)!;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function run(fn: () => Promise<string>, passed = true) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: passed, text: await fn() });
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(s.counter && s.counter.status === "approved" && s.hasRule);
  const tested = s.sandboxStatus === "passed";
  const live = Boolean(s.liveApprovedAt);
  const stepTone = (done: boolean) => `flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-600 text-white" : "bg-sky-100 text-sky-800"}`;

  return (
    <section className="space-y-4 rounded-2xl bg-sky-50/60 p-4 ring-1 ring-sky-200">
      <div>
        <h3 className="text-base font-semibold">Quick setup</h3>
        <p className="text-sm text-neutral-600">Choose the vendor&apos;s service and enter its PRA details. MAVIN sets the tax rule, sector, counter and services.</p>
      </div>
      {s.businessType !== "contractor" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Quick setup is for Contractor businesses. This business is &quot;{s.businessType}&quot;.</p>}
      {msg && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>{msg.text}</p>}

      <div className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><span className={stepTone(ready)}>{ready ? "✓" : "1"}</span> Vendor details</h4>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="text-xs md:col-span-3">Vendor&apos;s service
            <select className={input} value={f.templateId} onChange={set("templateId")}>{PRA_TEMPLATES.map((x) => <option key={x.id} value={x.id}>{x.label} · PCT {x.code} · {x.rate}%</option>)}</select>
          </label>
          <p className="rounded-lg bg-white px-3 py-2 text-xs text-neutral-700 ring-1 ring-black/5 md:col-span-3">
            <b>{t.rate}% PST</b>, PCT {t.code}. {t.inputAdjustment} Adds services: {t.starters.map((x) => x.name).join(", ")}.
          </p>
          <label className="text-xs">PNTN<input className={input} value={f.pntn} onChange={set("pntn")} /></label>
          <label className="text-xs">Registered business name<input className={input} value={f.registeredName} onChange={set("registeredName")} /></label>
          <label className="text-xs">Counter name (as registered)<input className={input} value={f.counter} onChange={set("counter")} /></label>
          <label className="text-xs">Sandbox POS ID<input className={input} inputMode="numeric" value={f.sandboxPosId} onChange={set("sandboxPosId")} /></label>
          <label className="text-xs md:col-span-2">Sandbox API token{s.counter?.hasSandboxToken ? " (blank = keep)" : ""}<input className={input} {...secret} value={f.sandboxToken} onChange={set("sandboxToken")} /></label>
          {t.needsScope && <label className="text-xs md:col-span-3">Contract work covered (required for this rate)<input className={input} value={f.scopeNote} onChange={set("scopeNote")} /></label>}
        </div>
        <p className="text-xs text-neutral-500">Use PRA&apos;s API token here. The POS access code is not the token.</p>
        <Button loading={busy} variant="primary" disabled={busy || live || s.businessType !== "contractor"} onClick={() => void run(async () => {
          const r = await call<{ services: number }>("quick_setup", { tenantId: s.tenantId, ...f });
          setF((x) => ({ ...x, sandboxToken: "", productionToken: "" }));
          return `Set up on the Sandbox. ${r.services} service${r.services === 1 ? "" : "s"} added. Next: run the Sandbox test.`;
        })}>{busy ? "Working…" : "Set up vendor"}</Button>
      </div>

      <div className="space-y-2 border-t border-sky-200 pt-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><span className={stepTone(tested)}>{tested ? "✓" : "2"}</span> Test on PRA&apos;s Sandbox</h4>
        <p className="text-xs text-neutral-600">Sends one sample invoice to the Sandbox. It is not added to the vendor&apos;s books.</p>
        <Button disabled={busy || !ready || live} onClick={() => {
          setBusy(true);
          setMsg(null);
          void call<{ passed: boolean; message: string }>("sandbox_test", { tenantId: s.tenantId })
            .then((r) => { setMsg({ ok: r.passed, text: r.message }); onDone(); })
            .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }))
            .finally(() => setBusy(false));
        }}>Run Sandbox test</Button>
      </div>

      <div className="space-y-2 border-t border-sky-200 pt-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><span className={stepTone(live)}>{live ? "✓" : "3"}</span> Go live</h4>
        {live ? <p className="text-sm text-emerald-800">This vendor is live. PRA Invoices now go to PRA as real tax invoices.</p> : (
          <>
            <p className="text-xs text-neutral-600">PRA must first whitelist IP <b>{PRA_GATEWAY_IP}</b> for this PNTN and production POS ID. Invoices made before going live are not sent.</p>
            {!s.productionSwitch && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Live sending is off on the server. Set PRA_PRODUCTION_ENABLED=1 in Vercel and redeploy before going live.</p>}
            <div className="grid gap-2 md:grid-cols-3">
              <label className="text-xs">Production POS ID<input className={input} inputMode="numeric" value={f.productionPosId} onChange={set("productionPosId")} /></label>
              <label className="text-xs">Production API token{s.counter?.hasProductionToken ? " (blank = keep)" : ""}<input className={input} {...secret} value={f.productionToken} onChange={set("productionToken")} /></label>
              <label className="text-xs">PRA whitelist reference (email / ticket)<input className={input} value={f.whitelistReference} onChange={set("whitelistReference")} /></label>
            </div>
            <Button variant="primary" disabled={busy || !tested || !s.productionSwitch} onClick={() => {
              if (!window.confirm("Go live? From now on this vendor's PRA Invoices are sent to PRA as real tax invoices and can't be deleted there.")) return;
              void run(async () => {
                await call("go_live", { tenantId: s.tenantId, productionPosId: f.productionPosId, productionToken: f.productionToken, whitelistReference: f.whitelistReference });
                setF((x) => ({ ...x, productionToken: "" }));
                return "Live. Make one small real invoice and confirm it on PRA's IRIS portal.";
              });
            }}>Go live</Button>
          </>
        )}
      </div>
    </section>
  );
}
