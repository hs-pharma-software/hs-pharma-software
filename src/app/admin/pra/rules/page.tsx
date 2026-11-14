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
import { PRA_SECTORS, ruleSummary, type MethodMap, type PraRule } from "@/lib/pra/rules";

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

      <PaymentMethods />
    </div>
  );
}

/** MAVIN payment method → PRA (rate class and PaymentMode). Only confirmed entries let a bill through. */
function PaymentMethods() {
  const [m, setM] = useState<MethodMap | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { void call<MethodMap>("methods").then(setM).catch((e) => setMsg(errText(e))); }, []);
  if (!m) return msg ? <p className="text-sm text-rose-800">{msg}</p> : null;
  return (
    <section className="space-y-2 rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-black/[0.05]">
      <h2 className="text-base font-semibold">Payment methods for PRA</h2>
      <p className="text-neutral-600">
        eIMS PaymentMode (manual v1.0 §6.1): 1 Cash, 2 Card, 3 Gift Voucher, 4 Loyalty Card, 5 Mixed, 6 Cheque. There is no code for a mobile wallet / QR or a bank transfer:
        confirm with PRA before marking them confirmed. Mixed payments (more than one method on a bill) are always held for review. The actual method stays on the bill.
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-neutral-500"><tr><th>MAVIN method</th><th>Counts for the rate as</th><th>PRA PaymentMode</th><th>Confirmed with PRA</th><th>Note</th></tr></thead>
        <tbody>
          {Object.entries(m).map(([k, v]) => (
            <tr key={k} className="border-t border-neutral-100">
              <td className="py-1.5 font-medium">{k}</td>
              <td><select className={input} value={v.taxClass} onChange={(e) => setM({ ...m, [k]: { ...v, taxClass: e.target.value as typeof v.taxClass } })}><option value="qualifying_digital">Card / wallet / QR (qualifying)</option><option value="other">Other</option><option value="unknown">Unknown</option></select></td>
              <td><input className={input} value={v.praMode ?? ""} onChange={(e) => setM({ ...m, [k]: { ...v, praMode: e.target.value === "" ? null : Number(e.target.value) } })} /></td>
              <td className="text-center"><input type="checkbox" checked={v.confirmed} onChange={(e) => setM({ ...m, [k]: { ...v, confirmed: e.target.checked } })} /></td>
              <td><input className={input} value={v.note ?? ""} onChange={(e) => setM({ ...m, [k]: { ...v, note: e.target.value } })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button onClick={async () => { try { setM(await call<MethodMap>("save_methods", { map: m })); setMsg("Saved."); } catch (e) { setMsg(errText(e)); } }}>Save mapping</Button>
      {msg && <p className="text-xs">{msg}</p>}
    </section>
  );
}
