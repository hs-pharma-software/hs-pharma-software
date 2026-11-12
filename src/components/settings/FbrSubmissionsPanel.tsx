"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { serverJson } from "@/lib/serverMode";

interface Row {
  id: string;
  doc_type: "invoice" | "es_doc";
  doc_id: string;
  environment: "sandbox" | "production";
  route: "gateway" | "direct";
  status: "pending" | "accepted" | "rejected" | "uncertain" | "not_received";
  fbr_invoice_no: string | null;
  error: string | null;
  created_at: string;
  invoice_no: number | null;
  customer_name: string | null;
  payable: number | null;
}

const LABEL: Record<Row["status"], { text: string; cls: string }> = {
  accepted: { text: "Accepted", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { text: "Rejected by FBR", cls: "bg-rose-100 text-rose-700" },
  uncertain: { text: "Unclear: check FBR", cls: "bg-amber-100 text-amber-900" },
  pending: { text: "Sending…", cls: "bg-sky-100 text-sky-800" },
  not_received: { text: "Not received", cls: "bg-neutral-100 text-neutral-600" },
};
const when = (s: string) => new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

/** FBR submissions that need a person: unclear ones are resolved here after
 * checking IRIS / the PRAL portal (MAVIN never re-sends them by itself). */
export function FbrSubmissionsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [numberFor, setNumberFor] = useState<string | null>(null);
  const [fbrNo, setFbrNo] = useState("");

  const load = useCallback(() => {
    serverJson<Row[]>("/api/fbr/", { action: "list", problemsOnly: !all }).then(setRows, (e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, [all]);
  useEffect(() => { load(); }, [load]);

  async function resolve(r: Row, resolution: "not_received" | "accepted") {
    setBusy(r.id);
    setMsg(null);
    try {
      await serverJson("/api/fbr/", { action: "resolve", submissionId: r.id, resolution, fbrInvoiceNo: resolution === "accepted" ? fbrNo : undefined });
      setMsg(resolution === "accepted" ? `Saved FBR number ${fbrNo.trim()} on the invoice.` : "Marked as not received: the invoice can be submitted again from Invoices.");
      setNumberFor(null);
      setFbrNo("");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  const open = (rows ?? []).filter((r) => r.status === "uncertain" || r.status === "pending");
  return (
    <div className="mt-5 border-t border-neutral-100 pt-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-neutral-900">FBR submissions</h3>
        {open.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{open.length} need checking</span>}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-3.5 w-3.5" /> Show all recent
        </label>
        <Button onClick={load}>Refresh</Button>
      </div>
      <p className="mb-2 text-xs text-neutral-500">
        &ldquo;Unclear&rdquo; means FBR did not answer clearly, so it may already have the invoice. Look it up in IRIS / the PRAL portal, then choose below. MAVIN never sends it again by itself.
      </p>
      {msg && <p className="mb-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-700">{msg}</p>}
      {rows === null ? (
        <p className="text-xs text-neutral-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-neutral-400">{all ? "No submissions yet." : "Nothing needs attention."}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-xl ring-1 ring-neutral-200">
          {rows.map((r) => (
            <li key={r.id} className="space-y-1.5 px-3 py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-neutral-900">{r.doc_type === "invoice" ? `Invoice #${r.invoice_no ?? "—"}` : "Store invoice"}</span>
                {r.customer_name && <span className="text-neutral-500">· {r.customer_name}</span>}
                {r.payable != null && <span className="text-neutral-500">· Rs {Number(r.payable).toLocaleString("en-PK")}</span>}
                <span className={`rounded-full px-2 py-0.5 font-medium ${LABEL[r.status].cls}`}>{LABEL[r.status].text}</span>
                <span className="text-neutral-400">{r.environment === "production" ? "Production" : "Sandbox"} · {when(r.created_at)}</span>
                {r.fbr_invoice_no && <span className="font-mono text-emerald-800">{r.fbr_invoice_no}</span>}
              </div>
              {r.error && r.status !== "accepted" && <p className="whitespace-pre-line text-neutral-600">{r.error}</p>}
              {(r.status === "uncertain" || r.status === "pending") && (
                numberFor === r.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={fbrNo} onChange={(e) => setFbrNo(e.target.value)} placeholder="FBR invoice number as shown in IRIS" className="w-64 rounded-lg border border-neutral-300 px-2 py-1 font-mono" />
                    <Button variant="primary" disabled={busy === r.id || !fbrNo.trim()} onClick={() => void resolve(r, "accepted")}>Save number</Button>
                    <Button onClick={() => { setNumberFor(null); setFbrNo(""); }}>Cancel</Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy === r.id} onClick={() => { setNumberFor(r.id); setFbrNo(""); }}>FBR has it: enter its number</Button>
                    <Button disabled={busy === r.id} onClick={() => { if (window.confirm("Checked in IRIS / the PRAL portal that FBR does NOT have this invoice? It can then be submitted again.")) void resolve(r, "not_received"); }}>FBR does not have it</Button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
