"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable } from "@/components/ui/DataTable";
import { restaurant, pra, praToken } from "@/lib/restaurant";
import { REST_SETTINGS } from "@/lib/restaurant/store";
import { useCan } from "@/lib/actionPermissions";
import { Badge, Note, PRA_BADGE, RestGuard, money, useAction, useLoad } from "@/components/restaurant/ui";

export default function PraPage() {
  return (
    <RestGuard>
      <Pra />
    </RestGuard>
  );
}

const KEYS = [REST_SETTINGS.praEnabled, REST_SETTINGS.praMode, REST_SETTINGS.praEnv, REST_SETTINGS.praPosId, REST_SETTINGS.pctCode] as const;

function Pra() {
  const canEdit = useCan("rest.settings");
  const cfg = useLoad(async () => Object.fromEntries(await Promise.all(KEYS.map(async (k) => [k, (await restaurant.settings.get(k)) ?? ""] as const))));
  const masked = useLoad(() => praToken.masked());
  const queue = useLoad(() => restaurant.praSubmissions());
  const [f, setF] = useState<Record<string, string>>({});
  const [newToken, setNewToken] = useState("");
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [filter, setFilter] = useState("");
  const act = useAction();
  useEffect(() => {
    if (cfg.data) setF(cfg.data);
  }, [cfg.data]);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const mode = f[REST_SETTINGS.praMode] || "local";
  const rows = (queue.data ?? []).filter((r) => !filter || r.status === filter);
  const counts = (queue.data ?? []).reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  const lastOk = (queue.data ?? []).find((r) => r.status === "accepted");

  return (
    <div className="space-y-4">
      <PageHeader title="PRA e-Invoicing" actions={<Button onClick={() => { void queue.reload(); void cfg.reload(); }}>Refresh</Button>} />
      <Note>
        Punjab Revenue Authority e-IMS integration, built to PRAL&apos;s official &quot;Technical Specification for Data Sharing through Software Fiscal Device with PRA&quot;, <b>version 1.2</b>. Each paid bill is sent to PRA; the fiscal invoice number PRA returns is printed on the receipt with a verification QR code. Refunds are sent as Credit invoices referencing the original.
      </Note>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/[0.05]">
          <h2 className="text-base font-semibold">Connection</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f[REST_SETTINGS.praEnabled] === "true"} disabled={!canEdit} onChange={(e) => set(REST_SETTINGS.praEnabled, e.target.checked ? "true" : "false")} /> Send invoices to PRA</label>
          <Field label="Connection method">
            <Select value={mode} disabled={!canEdit} onChange={(e) => set(REST_SETTINGS.praMode, e.target.value)}>
              <option value="local">PRA Software Fiscal Device on this computer (recommended for desktop POS)</option>
              <option value="cloud">PRA cloud API (token)</option>
            </Select>
          </Field>
          {mode === "cloud" && (
            <Field label="Environment">
              <Select value={f[REST_SETTINGS.praEnv] || "sandbox"} disabled={!canEdit} onChange={(e) => set(REST_SETTINGS.praEnv, e.target.value)}>
                <option value="sandbox">Sandbox (testing)</option>
                <option value="production">Production (live)</option>
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="PRA POS ID (from POS registration)" required><Input value={f[REST_SETTINGS.praPosId] ?? ""} disabled={!canEdit} onChange={(e) => set(REST_SETTINGS.praPosId, e.target.value.replace(/\D/g, ""))} /></Field>
            <Field label="PCT code (PST Act 2012, 2nd Schedule)" required><Input value={f[REST_SETTINGS.pctCode] ?? ""} disabled={!canEdit} onChange={(e) => set(REST_SETTINGS.pctCode, e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="8 digits" /></Field>
          </div>
          {mode === "cloud" && (
            <Field label={`Bearer token ${masked.data ? `(saved: ${masked.data})` : "(not saved)"}`}>
              <div className="flex gap-2">
                <Input type="password" autoComplete="off" value={newToken} disabled={!canEdit} onChange={(e) => setNewToken(e.target.value)} placeholder={masked.data ? "Enter a new token to replace it" : "Paste token"} />
                {masked.data && canEdit && <Button onClick={async () => { await act.run(() => praToken.set(null)); void masked.reload(); }}>Remove</Button>}
              </div>
            </Field>
          )}
          {mode === "cloud" && <p className="text-[11px] text-neutral-500">The token is stored only on this computer (never synced or shown again). Production use also needs your public IP whitelisted by PRA (email eims@pra.punjab.gov.pk with PNTN, business name, POS ID, server IP).</p>}
          {act.error && <Note tone="rose">{act.error}</Note>}
          {test && <Note tone={test.ok ? "emerald" : "rose"}>{test.message}</Note>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button disabled={act.busy} onClick={async () => { const r = await act.run(() => pra.testConnection()); if (r) setTest(r); }}>Test connection</Button>
            <Button
              variant="primary"
              disabled={!canEdit || act.busy}
              onClick={async () => {
                const ok = await act.run(async () => {
                  for (const k of KEYS) if ((f[k] ?? "") !== (cfg.data?.[k] ?? "")) await restaurant.settings.set(k, f[k] ?? "");
                  if (newToken.trim()) await praToken.set(newToken.trim());
                });
                if (ok) {
                  setNewToken("");
                  void cfg.reload();
                  void masked.reload();
                }
              }}
            >
              Save
            </Button>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-black/[0.05]">
          <h2 className="text-base font-semibold">Setup (from the official PRA spec)</h2>
          <ol className="list-decimal space-y-1 pl-5 text-neutral-700">
            <li>Log in at reg.pra.punjab.gov.pk → Registration → <b>POS Client Registration</b>; register this counter (branch, MAC and IP address). PRA issues a <b>POS ID</b>. For testing, generate a <b>Test POS ID</b>.</li>
            <li><b>Local method:</b> download PRA&apos;s Software Fiscal Device (IMSSetup.zip) from PRA, run Setup.exe as administrator, choose Sandbox or Production and enter the POS registration number and access code. It runs as a Windows service on http://localhost:8524 (needs Windows 10+, .NET 4.5+).</li>
            <li><b>Cloud method:</b> use the token from the POS Registration screen (POS Details tab); production also needs IP whitelisting.</li>
            <li>Enter the POS ID and your service&apos;s PCT code above, tick &quot;Send invoices to PRA&quot;, Save, then Test connection.</li>
            <li>Check posted invoices on PRA IRIS (e.pra.punjab.gov.pk) → IMS Fiscal Report. Support: eims@pra.punjab.gov.pk, 042-99205710.</li>
          </ol>
          <div className="grid grid-cols-2 gap-2 pt-2">
            {["pending", "retry_pending", "manual_review", "rejected", "accepted"].map((k) => (
              <div key={k} className="rounded-lg bg-neutral-50 px-3 py-2">
                <p className="text-[11px] capitalize text-neutral-500">{k.replace("_", " ")}</p>
                <p className="text-lg font-bold">{counts[k] ?? 0}</p>
              </div>
            ))}
            <div className="rounded-lg bg-neutral-50 px-3 py-2">
              <p className="text-[11px] text-neutral-500">Last accepted</p>
              <p className="text-xs font-semibold">{lastOk?.submitted_at ? new Date(lastOk.submitted_at).toLocaleString("en-PK") : "-"}</p>
            </div>
          </div>
          <Button disabled={act.busy} onClick={async () => { await act.run(() => pra.processQueue()); void queue.reload(); }}>Send pending now</Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-base font-semibold">Submissions &amp; log</h2>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="!w-48">
          <option value="">All</option>
          {Object.keys(PRA_BADGE).filter((k) => k !== "not_required").map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
        </Select>
      </div>
      <DataTable
        rows={rows}
        columns={[
          { header: "Invoice (USIN)", render: (r) => <span className="font-medium">#{r.usin}{r.invoice_type === 3 ? ` (credit of #${r.ref_usin})` : ""}</span> },
          { header: "Amount", render: (r) => money(r.total) },
          { header: "Status", render: (r) => <Badge cls={PRA_BADGE[r.status]}>{r.status.replace("_", " ")}</Badge> },
          { header: "PRA invoice no", render: (r) => r.pra_invoice_no ?? "-" },
          { header: "Tries", render: (r) => r.attempts },
          { header: "PRA answer / error", render: (r) => <span className="block max-w-md truncate text-xs" title={r.last_error ?? r.response_text ?? ""}>{r.response_code ? `[${r.response_code}] ` : ""}{r.last_error ?? r.response_text ?? ""}</span> },
          {
            header: "Actions",
            render: (r) =>
              ["manual_review", "rejected", "retry_pending"].includes(r.status) && canEdit ? (
                <div className="flex gap-2 text-xs">
                  <button type="button" className="text-amber-700 hover:underline" onClick={async () => { await act.run(async () => { await restaurant.resolvePra(r.id, "retry"); await pra.submit(r.id); }); void queue.reload(); }}>Retry</button>
                  <button type="button" className="text-emerald-700 hover:underline" onClick={async () => { const no = window.prompt("PRA invoice number shown on the IMS Fiscal Report for this invoice:"); if (no) { await act.run(() => restaurant.resolvePra(r.id, "accepted", no)); void queue.reload(); } }}>Record PRA no.</button>
                </div>
              ) : null,
          },
        ]}
      />
    </div>
  );
}
