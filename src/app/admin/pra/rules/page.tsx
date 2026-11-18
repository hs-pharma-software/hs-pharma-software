"use client";

/** Super Admin › PRA Tax Suggestions: the rule catalogue (sector, service,
 * classification, rate or fixed amount, payment condition, input adjustment,
 * exemptions, dates, source and clause, last verified, status). Starting
 * entries are drafts read from a consolidated copy of the Second Schedule:
 * verify each against the official Gazette before approving. A change is a
 * new version (dates decide which applies); approved versions are never edited.
 * Assign an approved rule to a business under PRA Integration. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { serverJson } from "@/lib/serverMode";
import { PRA_SECTORS, ruleSummary, type PraRule } from "@/lib/pra/rules";

type Rule = PraRule & { problems: string[]; approved_at?: string | null };
const call = <T,>(action: string, body: Record<string, unknown> = {}) => serverJson<{ result: T }>("/api/pra/", { action, ...body }).then((r) => r.result);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const input = "w-full rounded-lg px-3 py-2 text-sm ring-1 ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-sky-300";
const TONE: Record<string, string> = { approved: "bg-emerald-100 text-emerald-800", draft: "bg-amber-100 text-amber-900", retired: "bg-neutral-100 text-neutral-500" };

export default function PraRulesPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<Rule | null>(null);
  const [edit, setEdit] = useState<Record<string, string | boolean> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setRules(await call<Rule[]>("rules", { search: q, sector, status })); } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  }, [q, sector, status]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); setOpen(null); setEdit(null); await load(); } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  const fromRule = (r: Rule | null): Record<string, string | boolean> => ({
    ruleKey: r?.rule_key ?? "", sector: r?.sector ?? "restaurant", service: r?.service ?? "", classificationCode: r?.classification_code ?? "", rateType: r?.rate_type ?? "percent",
    rate: r?.rate == null ? "" : String(r.rate), altRate: r?.alt_rate == null ? "" : String(r.alt_rate), fixedAmount: r?.fixed_amount == null ? "" : String(r.fixed_amount), fixedUnit: r?.fixed_unit ?? "",
    paymentCondition: r?.payment_condition ?? "any", inputAdjustment: r?.input_adjustment ?? "", exemptions: r?.exemptions ?? "", effectiveFrom: r?.effective_from ?? "", effectiveTo: r?.effective_to ?? "",
    source: r?.source ?? "", clause: r?.clause ?? "", sourceUrl: r?.source_url ?? "", lastVerifiedAt: r?.last_verified_at ?? "", reviewNotes: r?.review_notes ?? "",
    needsScopeReview: !!r?.needs_scope_review, eimsApplicable: r?.eims_applicable ?? "unconfirmed",
  });
  return (
    <div className="space-y-4">
      <PageHeader title="PRA Tax Suggestions" actions={<><Link href="/admin/pra" className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-black/10 hover:bg-neutral-50">← PRA Integration</Link><Button variant="primary" onClick={() => setEdit(fromRule(null))}>New rule</Button></>} />
      <p className="max-w-3xl rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Suggestions only. Starting entries were read from a consolidated copy of the Punjab Sales Tax on Services Act 2012, Second Schedule (2026-27), whose notes cite the Punjab Finance Act 2026.
        Verify each against the official Gazette and PRA notifications, record the date, then approve. A rule applies to a business only after you assign it. Nothing is inferred from a payment method or a business&apos;s name.
      </p>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>{msg.text}</p>}
      <VendorTemplates onChanged={() => void load()} />
      <div className="flex flex-wrap gap-2">
        <input className={`${input} max-w-xs`} placeholder="Search service, code, source" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${input} max-w-xs`} value={sector} onChange={(e) => setSector(e.target.value)}><option value="">All sectors</option>{PRA_SECTORS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <select className={`${input} max-w-[10rem]`} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option><option value="draft">Draft</option><option value="approved">Approved</option><option value="retired">Retired</option></select>
      </div>
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500"><tr><th className="px-3 py-2">Service</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Rate</th><th className="px-3 py-2">Effective</th><th className="px-3 py-2">eIMS</th><th className="px-3 py-2">Verified</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody>
            {(rules ?? []).map((r) => (
              <tr key={r.id} className="cursor-pointer border-t border-neutral-100 align-top hover:bg-sky-50/40" onClick={() => setOpen(r)}>
                <td className="px-3 py-2"><b>{r.service.slice(0, 80)}</b><span className="block text-[11px] text-neutral-500">{r.rule_key} v{r.version} · {r.sector}{r.needs_scope_review ? " · needs contract review" : ""}</span></td>
                <td className="px-3 py-2 text-xs">{r.classification_code ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{ruleSummary(r)}</td>
                <td className="px-3 py-2 text-xs">{r.effective_from}{r.effective_to ? ` → ${r.effective_to}` : ""}</td>
                <td className="px-3 py-2 text-xs">{r.eims_applicable}</td>
                <td className="px-3 py-2 text-xs">{r.last_verified_at ?? "—"}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[r.status]}`}>{r.status}</span></td>
              </tr>
            ))}
            {rules && !rules.length && <tr><td colSpan={7} className="py-8 text-center text-neutral-400">No rule matches.</td></tr>}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="space-y-2 rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-black/[0.05]">
          <h2 className="text-base font-semibold">{open.service}</h2>
          <dl className="grid gap-x-4 gap-y-1 md:grid-cols-2">
            {([
              ["Rule", `${open.rule_key} v${open.version} (${open.status})`], ["Sector", open.sector], ["Classification", open.classification_code ?? "—"], ["Rate", ruleSummary(open)],
              ["Input adjustment", open.input_adjustment], ["Exemptions", open.exemptions ?? "—"], ["Effective", `${open.effective_from}${open.effective_to ? ` to ${open.effective_to}` : " onwards"}`],
              ["eIMS applies", open.eims_applicable], ["Last verified", open.last_verified_at ?? "not yet"],
            ] as [string, string][]).map(([k, v]) => <div key={k}><dt className="text-xs text-neutral-500">{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <p><span className="text-xs text-neutral-500">Source: </span>{open.source}</p>
          {open.clause && <blockquote className="border-s-4 border-neutral-200 ps-3 text-neutral-700">{open.clause}</blockquote>}
          {open.source_url && <a className="text-sky-700 underline" href={open.source_url} target="_blank" rel="noreferrer">Open the source</a>}
          {open.review_notes && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Review: {open.review_notes}</p>}
          {open.status === "draft" && open.problems.length > 0 && <ul className="list-disc ps-5 text-rose-800">{open.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            {open.status === "draft" && <Button variant="primary" onClick={() => { const d = prompt("Verified against the official Gazette / PRA notification on (yyyy-mm-dd):", open.last_verified_at ?? new Date().toISOString().slice(0, 10)); if (d) void act(() => call("decide_rule", { id: open.id, decision: "approve", lastVerifiedAt: d }), "Approved."); }}>Approve</Button>}
            <Button onClick={() => setEdit(fromRule(open))}>{open.status === "draft" ? "Save as a new draft version" : "New version"}</Button>
            {open.status !== "retired" && <Button variant="danger" onClick={() => confirm("Retire this version?") && void act(() => call("decide_rule", { id: open.id, decision: "retire" }), "Retired.")}>Retire</Button>}
            <Button variant="ghost" onClick={() => setOpen(null)}>Close</Button>
          </div>
        </div>
      )}

      {edit && (
        <div className="grid gap-2 rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-black/[0.05] md:grid-cols-3">
          <h2 className="text-base font-semibold md:col-span-3">{edit.ruleKey ? `New version of ${edit.ruleKey}` : "New rule"} (saved as a draft)</h2>
          {([
            ["ruleKey", "Rule key (blank = new)"], ["service", "Actual service"], ["classificationCode", "Classification code (e.g. 9801.2000)"],
            ["rate", "Rate % (digital when split)"], ["altRate", "Rate % for other payments (split)"], ["fixedAmount", "Fixed amount (Rs)"], ["fixedUnit", "Fixed per (e.g. per bill of lading)"],
            ["inputAdjustment", "Input adjustment"], ["exemptions", "Exemptions"], ["effectiveFrom", "Effective from (yyyy-mm-dd)"], ["effectiveTo", "Effective to (optional)"],
            ["source", "Source (Act, schedule, notification)"], ["clause", "Clause text"], ["sourceUrl", "Source link (https)"], ["lastVerifiedAt", "Last verified (yyyy-mm-dd)"], ["reviewNotes", "Review notes"],
          ] as [string, string][]).map(([k, label]) => (
            <label key={k} className="text-xs">{label}<input className={input} value={String(edit[k] ?? "")} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>
          ))}
          <label className="text-xs">Sector<select className={input} value={String(edit.sector)} onChange={(e) => setEdit({ ...edit, sector: e.target.value })}>{PRA_SECTORS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className="text-xs">Rate type<select className={input} value={String(edit.rateType)} onChange={(e) => setEdit({ ...edit, rateType: e.target.value })}><option value="percent">Percent</option><option value="fixed">Fixed amount</option></select></label>
          <label className="text-xs">Payment condition<select className={input} value={String(edit.paymentCondition)} onChange={(e) => setEdit({ ...edit, paymentCondition: e.target.value })}><option value="any">Any payment</option><option value="digital_split">Card / wallet / QR vs other</option></select></label>
          <label className="text-xs">eIMS applies<select className={input} value={String(edit.eimsApplicable)} onChange={(e) => setEdit({ ...edit, eimsApplicable: e.target.value })}><option value="unconfirmed">Unconfirmed</option><option value="yes">Yes (confirmed)</option><option value="no">No</option></select></label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!edit.needsScopeReview} onChange={(e) => setEdit({ ...edit, needsScopeReview: e.target.checked })} /> Needs the contract / scope of work reviewed before assigning</label>
          <div className="flex gap-2 md:col-span-3">
            <Button variant="primary" onClick={() => void act(() => call("save_rule", edit), "Saved as a draft.")}>Save draft</Button>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <PraCases />
    </div>
  );
}

interface VendorTemplate { id: string; label: string; code: string; rate: number; inputAdjustment: string; source: string; approved: boolean }

/** The ready-made vendor services used by Quick setup: their tax rules, approved here or when a vendor is set up. */
function VendorTemplates({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<VendorTemplate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void call<VendorTemplate[]>("templates").then(setRows).catch((e) => setError(errText(e))); }, []);
  const approve = async (templateId?: string) => {
    setBusy(true);
    setError(null);
    try { setRows(await call<VendorTemplate[]>("approve_templates", { templateId })); onChanged(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const pending = (rows ?? []).filter((r) => !r.approved).length;
  return (
    <section className="space-y-2 rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-black/[0.05]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Vendor services for Quick setup</h2>
        {pending > 0 && <Button variant="primary" disabled={busy} onClick={() => { if (confirm(`Approve the tax rules of ${pending} vendor service${pending === 1 ? "" : "s"}, as listed here?`)) void approve(); }}>Approve all</Button>}
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-900">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="text-left text-xs text-neutral-500"><tr><th className="py-1">Service</th><th>PCT code</th><th>Rate</th><th>Source</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-t border-neutral-100 align-top">
                <td className="py-1.5 font-medium">{r.label}</td>
                <td className="font-mono text-xs">{r.code}</td>
                <td className="text-xs">{r.rate}%<span className="block text-neutral-500">{r.inputAdjustment}</span></td>
                <td className="max-w-xs text-xs text-neutral-600">{r.source}</td>
                <td><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.approved ? TONE.approved : TONE.draft}`}>{r.approved ? "approved" : "not approved"}</span></td>
                <td className="text-end">{!r.approved && <Button variant="ghost" disabled={busy} onClick={() => void approve(r.id)}>Approve</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface CaseRow {
  key: string; title: string; documented: string; pending: string; needsSample: boolean;
  implemented: boolean; sandboxAllowed: boolean; sandboxPassed: boolean; productionReady: boolean;
  state: { sandbox?: boolean; sandboxPassedAt?: string | null; confirmedAt?: string | null; reference?: string | null; sampleAccepted?: boolean; note?: string | null; ratePolicy?: string | null; praMode?: number | null; text?: string | null };
}

/** What PRA's documents settle, what still needs PRA's written answer, and where each case stands:
 * implemented → Sandbox passed → PRA confirmed (production opens only then). */
function PraCases() {
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setRows(await call<CaseRow[]>("cases")); } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const edit = (r: CaseRow) => {
    setOpen(r.key);
    setF({
      sandbox: r.state.sandbox !== false, sandboxPassedAt: r.state.sandboxPassedAt ?? "", confirmedAt: r.state.confirmedAt ?? "", reference: r.state.reference ?? "",
      sampleAccepted: !!r.state.sampleAccepted, note: r.state.note ?? "", ratePolicy: r.state.ratePolicy ?? "", praMode: r.state.praMode == null ? "" : String(r.state.praMode), text: r.state.text ?? "",
    });
  };
  const mark = (ok: boolean) => (ok ? <span className="text-emerald-700">✓</span> : <span className="text-neutral-400">—</span>);
  return (
    <section className="space-y-2 rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-black/[0.05]">
      <h2 className="text-base font-semibold">PRA cases: implemented, Sandbox, PRA confirmation</h2>
      <p className="text-neutral-600">
        Each case is built. Production opens for a case only with PRA&apos;s written confirmation (reference and date) and, where marked, a sample payload PRA accepted.
        The actual payment methods and references always stay on the bill; PaymentMode is only what is sent.
      </p>
      {msg && <p className={`rounded-lg px-3 py-2 ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>{msg.text}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="text-left text-xs text-neutral-500"><tr><th className="py-1">Case</th><th>Implemented</th><th>Sandbox</th><th>Sandbox passed</th><th>PRA confirmed</th><th>Production</th><th /></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.key} className="border-t border-neutral-100 align-top">
                <td className="py-1.5"><b>{r.title}</b><span className="block text-[11px] text-neutral-500">Documented: {r.documented}</span><span className="block text-[11px] text-amber-800">Pending: {r.pending}</span></td>
                <td className="text-center">{mark(r.implemented)}</td>
                <td className="text-center text-xs">{r.sandboxAllowed ? "on" : "off"}</td>
                <td className="text-center text-xs">{r.state.sandboxPassedAt ?? "—"}</td>
                <td className="text-center text-xs">{r.state.confirmedAt ? `${r.state.confirmedAt}${r.state.reference ? ` · ${r.state.reference}` : ""}` : "—"}</td>
                <td className="text-center text-xs">{r.productionReady ? <span className="text-emerald-700">open</span> : <span className="text-rose-700">closed</span>}</td>
                <td><Button variant="ghost" onClick={() => edit(r)}>Record</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <div className="grid gap-2 rounded-xl bg-neutral-50 p-3 md:grid-cols-3">
          <h3 className="font-semibold md:col-span-3">{rows?.find((r) => r.key === open)?.title}</h3>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!f.sandbox} onChange={(e) => setF({ ...f, sandbox: e.target.checked })} /> Allowed in the Sandbox</label>
          <label className="text-xs">Sandbox passed on (yyyy-mm-dd)<input className={input} value={String(f.sandboxPassedAt)} onChange={(e) => setF({ ...f, sandboxPassedAt: e.target.value })} /></label>
          <label className="text-xs">PRA confirmed on (yyyy-mm-dd)<input className={input} value={String(f.confirmedAt)} onChange={(e) => setF({ ...f, confirmedAt: e.target.value })} /></label>
          <label className="text-xs">PRA reference (email / letter)<input className={input} value={String(f.reference)} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!f.sampleAccepted} onChange={(e) => setF({ ...f, sampleAccepted: e.target.checked })} /> Sample payload accepted by PRA</label>
          {open === "mixed_payment" && (
            <label className="text-xs">Rate for a mixed bill<select className={input} value={String(f.ratePolicy)} onChange={(e) => setF({ ...f, ratePolicy: e.target.value })}>
              <option value="">Pending (bills blocked)</option><option value="whole_other">Whole bill at the other-payments rate (16 %)</option><option value="whole_qualifying">Whole bill at the qualifying rate (8 %)</option>
            </select></label>
          )}
          {(open === "wallet_qr" || open === "bank_transfer") && (
            <label className="text-xs">PaymentMode to send (1-6)<input className={input} value={String(f.praMode)} onChange={(e) => setF({ ...f, praMode: e.target.value })} placeholder="as PRA confirms" /></label>
          )}
          {(open === "outage_receipt" || open === "qr_verifier") && (
            <label className="text-xs md:col-span-3">{open === "qr_verifier" ? "PRA's current QR link, with {fiscal} (blank = the documented v1.2 link)" : "Customer-facing wording PRA approved (printed only once confirmed)"}
              <input className={input} value={String(f.text)} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
          )}
          <label className="text-xs md:col-span-3">Note<input className={input} value={String(f.note)} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <div className="flex gap-2 md:col-span-3">
            <Button variant="primary" onClick={async () => {
              setMsg(null);
              try { setRows(await call<CaseRow[]>("save_case", { key: open, ...f, praMode: f.praMode === "" ? null : Number(f.praMode), ratePolicy: f.ratePolicy || null })); setOpen(null); setMsg({ ok: true, text: "Saved." }); }
              catch (e) { setMsg({ ok: false, text: errText(e) }); }
            }}>Save</Button>
            <Button onClick={() => setOpen(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
