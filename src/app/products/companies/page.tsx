"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { listCompanies, companyProducts, renameCompany, type CompanyRow } from "@/lib/repo/companies";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const err = (e: unknown) => window.alert(e instanceof Error ? e.message : String(e));

/** Every company (manufacturer) on the products, with how many products each has. */
export default function CompaniesPage() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<CompanyRow | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setRows(await listCompanies()); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, []);
  const term = search.trim().toLowerCase();
  const shown = term ? rows.filter((r) => r.name.toLowerCase().includes(term)) : rows;
  return (
    <div>
      <PageHeader title="Companies" />
      <div className={card}>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-72"><Field label="Search"><Input id="co-q" value={search} placeholder="Company name" onChange={(e) => setSearch(e.target.value)} /></Field></div>
          <p className="pb-2 text-sm text-neutral-500">{rows.length} companies · {rows.reduce((s, r) => s + r.products, 0)} products</p>
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-neutral-400">{rows.length ? "No company matches." : "No companies yet. A company is added when a product is saved with a Company Name."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-neutral-100 text-left text-xs text-neutral-500"><th className="pb-1.5 pr-2 font-medium">Company</th><th className="pb-1.5 pr-2 text-right font-medium">Products</th><th className="pb-1.5 text-right font-medium">Own products</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.name} className="cursor-pointer border-b border-neutral-50 hover:bg-neutral-50" onClick={() => setOpen(r)}>
                    <td className="py-1.5 pr-2 font-medium">{r.name}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.products}</td>
                    <td className="py-1.5 text-right tabular-nums text-neutral-500">{r.own}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <CompanyModal company={open} onClose={() => setOpen(null)} onRenamed={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}

function CompanyModal({ company, onClose, onRenamed }: { company: CompanyRow; onClose: () => void; onRenamed: () => void }) {
  const [products, setProducts] = useState<{ id: string; name: string; tenant_id: string | null }[]>([]);
  const [name, setName] = useState(company.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void companyProducts(company.name).then(setProducts).catch(err); }, [company.name]);
  const rename = async () => {
    if (!name.trim() || name.trim() === company.name) return;
    if (!window.confirm(`Rename "${company.name}" to "${name.trim()}" on ${company.own} of your products?`)) return;
    setBusy(true);
    try {
      const r = await renameCompany(company.name, name);
      window.alert(`Renamed on ${r.changed} product(s).${r.sharedLeft ? ` ${r.sharedLeft} shared catalog product(s) keep their name.` : ""}`);
      onRenamed();
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={company.name} onClose={onClose} width="max-w-lg">
      <div className="flex flex-col gap-3">
        {company.own > 0 && (
          <div className="flex items-end gap-2">
            <div className="flex-1"><Field label="Correct the spelling or merge into another company"><Input id="co-rename" value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
            <Button variant="primary" disabled={busy || !name.trim() || name.trim() === company.name} onClick={() => void rename()}>Rename</Button>
          </div>
        )}
        <p className="text-xs text-neutral-500">{products.length} products</p>
        <ul className="max-h-80 overflow-y-auto text-sm">
          {products.map((p) => (
            <li key={p.id} className="border-t border-neutral-100 py-1">{p.name}{p.tenant_id === null ? <span className="ml-1 text-xs text-neutral-400">(shared catalog)</span> : null}</li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
