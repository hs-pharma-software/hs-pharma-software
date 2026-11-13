"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist, errorText } from "@/lib/dist";
import { downloadClosingPdf } from "@/lib/dist/closingPdf";
import { Badge, DistGuard, Err, Note, PageTitle, money, thisMonth, useLoad, type DistCtx } from "@/components/dist/ui";

export default function SalariesPage() {
  return <DistGuard>{(c) => (c.admin ? <Salaries c={c} /> : <Note tone="amber">Only the distributor administrator manages salaries.</Note>)}</DistGuard>;
}

type Row = Awaited<ReturnType<typeof dist.salaries>>[number];
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function Salaries({ c }: { c: DistCtx }) {
  void c;
  const [month, setMonth] = useState(thisMonth());
  const rows = useLoad(() => dist.salaries(month), [month]);
  const status = useLoad(() => dist.monthStatus(month), [month]);
  const [paying, setPaying] = useState<Row | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const closed = status.data?.closed ?? false;
  const reload = () => { void rows.reload(); void status.reload(); };
  const total = (rows.data ?? []).reduce((a, r) => a + r.amount, 0);
  const unpaid = (rows.data ?? []).filter((r) => r.status !== "paid").reduce((a, r) => a + r.amount, 0);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: errorText(e) }); }
    setBusy(null);
  };
  return (
    <div className="space-y-3">
      <PageTitle title="Salaries" sub="Salesmen's salaries by month: paid or not paid. Closing the month adds them to Expenses." />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Month"><Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
        <div className="flex gap-4 pb-2 text-sm">
          <span>Total <b>{money(total)}</b></span>
          <span>Unpaid <b className={unpaid > 0 ? "text-amber-700" : ""}>{money(unpaid)}</b></span>
          {closed ? <Badge tone="green">Month closed</Badge> : <Badge tone="amber">Open</Badge>}
        </div>
      </div>

      {status.data && (
        <section className={`rounded-xl p-4 ring-1 ${closed ? "bg-emerald-50 ring-emerald-200" : status.data.due ? "bg-amber-50 ring-amber-200" : "bg-white ring-black/5"}`}>
          <h2 className="text-sm font-semibold">Month closing: {monthLabel(month)}</h2>
          <p className="mt-0.5 text-xs text-neutral-600">
            {closed
              ? `Closed on ${status.data.closing?.closed_at.slice(0, 10)} by ${status.data.closing?.closed_by ?? "—"}. Its salaries are in Expenses; payments can still be marked.`
              : status.data.due
                ? "The month has ended (or ends today). Check the draft report, then finalize: every salary below is added to Expenses and the month's salaries are locked."
                : `Can be closed from its last day, ${status.data.lastDay}. A draft report is available any time.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={!!busy} onClick={() => void run("draft", async () => { await downloadClosingPdf(await dist.closeMonth(month, { final: false })); })}>
              {busy === "draft" ? "Preparing…" : closed ? "Download final report (PDF)" : "Download draft report (PDF)"}
            </Button>
            {!closed && (
              <Button variant="primary" disabled={!!busy || !status.data.due} onClick={() => {
                if (!window.confirm(`Close ${monthLabel(month)}? ${rows.data?.length ?? 0} salaries (${money(total)}) will be added to Expenses and can't be changed afterwards.`)) return;
                void run("final", async () => {
                  const r = await dist.closeMonth(month, { final: true });
                  await downloadClosingPdf(r);
                  setMsg({ ok: true, text: `${monthLabel(month)} closed: ${r.salaries.length} salaries (${money(r.salariesTotal)}) added to Expenses. The final report was downloaded.` });
                  reload();
                });
              }}>
                {busy === "final" ? "Closing…" : "Finalize month"}
              </Button>
            )}
          </div>
        </section>
      )}

      {msg && (msg.ok ? <Note tone="emerald">{msg.text}</Note> : <Err error={msg.text} />)}
      <Err error={rows.error ?? status.error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">Salesman</th>
              <th className="px-3 py-2 text-start">Wage</th>
              <th className="px-3 py-2 text-end">Days</th>
              <th className="px-3 py-2 text-end">Salary</th>
              <th className="px-3 py-2 text-start">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(rows.data ?? []).map((r) => (
              <SalaryRow key={`${month}:${r.salesman_id}:${r.amount}:${r.days_worked}:${r.status}`} r={r} month={month} closed={closed} onPay={() => setPaying(r)} onChanged={reload} onError={(t) => setMsg({ ok: false, text: t })} />
            ))}
            {!rows.data?.length && (
              <tr><td colSpan={6} className="py-8 text-center text-neutral-400">{rows.loading ? "Loading…" : "No salaries this month. Set each salesman's wage under Salesmen & Targets."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {paying && <PayModal r={paying} month={month} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload(); }} />}
    </div>
  );
}

function SalaryRow({ r, month, closed, onPay, onChanged, onError }: { r: Row; month: string; closed: boolean; onPay: () => void; onChanged: () => void; onError: (t: string) => void }) {
  const [days, setDays] = useState(r.days_worked == null ? "" : String(r.days_worked));
  const [amount, setAmount] = useState(String(r.amount));
  const dirty = (r.wage_type === "daily" && days !== String(r.days_worked ?? "")) || amount !== String(r.amount);
  const save = async () => {
    try {
      await dist.saveSalary(r.salesman_id, month, { daysWorked: r.wage_type === "daily" ? Number(days) : null, amount: amount !== String(r.amount) ? Number(amount) : null });
      onChanged();
    } catch (e) { onError(errorText(e)); }
  };
  return (
    <tr className="border-t border-neutral-100">
      <td className="px-3 py-2">
        <span className="font-medium">{r.name}</span> <span className="text-xs text-neutral-400">{r.code}</span>
        {r.closed_on && <span className="block text-[11px] text-neutral-500">left on {r.closed_on}</span>}
      </td>
      <td className="px-3 py-2 text-xs">{r.wage_type === "daily" ? `${money(r.rate)} / day` : `${money(r.rate)} / month`}{r.wage_type === "monthly" && r.days_employed < r.days_in_month ? ` · ${r.days_employed} of ${r.days_in_month} days` : ""}</td>
      <td className="px-3 py-2 text-end">
        {r.wage_type === "daily" && !closed
          ? <Input className="!w-16 !py-1 text-end" type="number" min="0" max="31" step="0.5" value={days} onChange={(e) => { setDays(e.target.value); setAmount(String(Math.round(r.rate * (Number(e.target.value) || 0) * 100) / 100)); }} />
          : <span className="text-xs">{r.wage_type === "daily" ? r.days_worked : r.days_employed}</span>}
      </td>
      <td className="px-3 py-2 text-end">
        {closed ? money(r.amount) : <Input className="!w-28 !py-1 text-end" type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </td>
      <td className="px-3 py-2 text-xs">
        {r.status === "paid" ? <Badge tone="green">Paid {r.paid_on} · {r.paid_method}</Badge> : <Badge tone="amber">Not paid</Badge>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-end">
        {dirty && !closed && <Button variant="primary" onClick={() => void save()}>Save</Button>}{" "}
        {r.status === "paid"
          ? <Button variant="ghost" onClick={async () => { try { await dist.setSalaryPaid(r.salesman_id, month, null); onChanged(); } catch (e) { onError(errorText(e)); } }}>Mark unpaid</Button>
          : <Button onClick={onPay}>Mark paid</Button>}
      </td>
    </tr>
  );
}

function PayModal({ r, month, onClose, onDone }: { r: Row; month: string; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<"cash" | "bank" | "cheque" | "digital">("cash");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`Pay ${r.name}: ${money(r.amount)} for ${monthLabel(month)}`} onClose={onClose} width="max-w-sm">
      <div className="space-y-3">
        <Field label="Paid on"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {["cash", "bank", "cheque", "digital"].map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={async () => { try { await dist.setSalaryPaid(r.salesman_id, month, { method, date }); onDone(); } catch (e) { setError(errorText(e)); } }}>Mark paid</Button>
        </div>
      </div>
    </Modal>
  );
}
