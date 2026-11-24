"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { staffRepo } from "@/lib/repo/staff";
import { listIndentBooks, requestIndentBook, type IndentBook } from "@/lib/repo/storeIndents";
import { designation } from "@/config/hospitalStaff";
import type { Staff } from "@/lib/types";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Listed first: those who usually hold indent books. */
const HOLDERS = ["head_nurse", "nursing_superintendent", "hod"];
const STATUS: Record<IndentBook["status"], string> = { requested: "Waiting for the store", issued: "Issued", closed: "Closed" };

/** Purchase Cell > Indent Books: the purchase officer orders indent books for head nurses and department in-charges; a store keeper issues them. */
export default function IndentBooksPage() {
  const [books, setBooks] = useState<IndentBook[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [holder, setHolder] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    if (!isTauri()) return;
    try { const [b, s] = await Promise.all([listIndentBooks(), staffRepo.list({ orderBy: "name ASC" })]); setBooks(b); setStaff(s); setError(null); }
    catch (e) { setError(/no such (table|column)/i.test(msg(e)) ? "Indent books need the database update (v104)." : msg(e)); }
  }
  useEffect(() => { void reload(); }, []);
  async function order() {
    try { await requestIndentBook(holder, note); setHolder(""); setNote(""); await reload(); } catch (e) { setError(msg(e)); }
  }
  const sorted = [...staff].sort((a, b) => Number(!HOLDERS.includes(a.staff_category ?? "")) - Number(!HOLDERS.includes(b.staff_category ?? "")) || a.name.localeCompare(b.name));
  return (
    <div>
      <PageHeader title="Indent Books" />
      <div className={card}>
        <h2 className="mb-2 text-sm font-semibold">Order an indent book</h2>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="For (head nurse / department in-charge)">
            <Select value={holder} onChange={(e) => setHolder(e.target.value)}>
              <option value="">— Choose —</option>
              {sorted.map((s) => <option key={s.id} value={s.id}>{s.name} · {designation(s.staff_category)?.label ?? s.designation ?? ""}{s.department ? ` · ${s.department}` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Note to the store keeper"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button variant="primary" disabled={!holder} onClick={() => void order()}>Order book</Button>
        </div>
        {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>
      <div className={`${card} mt-4`}>
        {books.length === 0 ? <p className="text-sm text-neutral-400">No indent books yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1.5 pr-3 font-medium">Book</th><th className="pb-1.5 pr-3 font-medium">Holder</th><th className="pb-1.5 pr-3 font-medium">Department</th><th className="pb-1.5 pr-3 font-medium">Status</th><th className="pb-1.5 font-medium">Issued by</th></tr></thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.id} className="border-t border-neutral-100">
                  <td className="py-1.5 pr-3 font-mono text-xs">{b.book_no}</td><td className="py-1.5 pr-3">{b.holder_name}</td><td className="py-1.5 pr-3">{b.department ?? "—"}</td>
                  <td className="py-1.5 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${b.status === "issued" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{STATUS[b.status]}</span></td>
                  <td className="py-1.5 text-xs text-neutral-500">{b.issued_by_name ?? "—"}{b.issued_at ? ` · ${b.issued_at.slice(0, 10)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
