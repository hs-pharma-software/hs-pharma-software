"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { addInsuranceCompany, COMMON_INSURERS, listInsuranceCompanies, type InsuranceCompany } from "@/lib/repo/insurance";

/** A searchable list of the business's insurance companies, with "Add" for a
 * new one (Pakistan's insurers suggested while typing). */
export function InsuranceCompanySelect({ value, onChange, id, allowAll = false }: {
  value: string;
  onChange: (id: string, company: InsuranceCompany | null) => void;
  id?: string;
  /** Offer "All companies" (value "") first. */
  allowAll?: boolean;
}) {
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listInsuranceCompanies().then(setCompanies).catch((e) => {
      const m = e instanceof Error ? e.message : String(e);
      setError(/no such table/i.test(m) ? "Insurance needs the database update (v96)." : m);
    });
  }, []);

  async function add() {
    setError(null);
    try {
      const c = await addInsuranceCompany(name);
      setCompanies((xs) => (xs.some((x) => x.id === c.id) ? xs : [...xs, c].sort((a, b) => a.name.localeCompare(b.name))));
      onChange(c.id, c);
      setAdding(false);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const options = [{ value: "", label: allowAll ? "All companies" : "No insurance" }, ...companies.map((c) => ({ value: c.id, label: c.name }))];
  return (
    <div className="flex flex-col gap-1">
      {adding ? (
        <div className="flex gap-1.5">
          <input list="insurers-pk" autoFocus value={name} placeholder="Company name" aria-label="New insurance company"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } if (e.key === "Escape") setAdding(false); }}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-400" />
          <datalist id="insurers-pk">{COMMON_INSURERS.map((n) => <option key={n} value={n} />)}</datalist>
          <button type="button" onClick={() => void add()} className="rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white">Add</button>
          <button type="button" onClick={() => setAdding(false)} className="rounded-lg px-2 text-sm text-neutral-500 hover:text-neutral-900">Cancel</button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <div className="min-w-0 flex-1">
            <SearchSelect id={id} value={value} options={options} placeholder={allowAll ? "All companies" : "Choose the company"} emptyText="No company yet: press + to add one"
              onChange={(v) => onChange(v, companies.find((c) => c.id === v) ?? null)} />
          </div>
          <button type="button" title="Add an insurance company" onClick={() => { setAdding(true); setError(null); }}
            className="rounded-lg px-2 text-neutral-500 ring-1 ring-neutral-200 hover:bg-neutral-50 hover:text-neutral-900"><Plus size={15} /></button>
        </div>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
