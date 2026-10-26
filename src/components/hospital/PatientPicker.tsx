"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/Field";
import PatientFormModal from "@/app/hospital/patients/PatientFormModal";
import type { HospitalPatient } from "@/lib/types-hospital";

/** Choose a patient by name, MR number or phone; register a new one when they
 * are not found. A newly registered patient is selected straight away. */
export function PatientPicker({ patients, value, onChange }: { patients: HospitalPatient[]; value: string; onChange: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [registering, setRegistering] = useState(false);
  const [added, setAdded] = useState<HospitalPatient[]>([]);
  const all = [...added.filter((a) => !patients.some((p) => p.id === a.id)), ...patients];
  const selected = all.find((p) => p.id === value) ?? null;
  const term = search.trim().toLowerCase();
  const matches = term
    ? all.filter((p) => p.name.toLowerCase().includes(term) || p.mr_no.toLowerCase().includes(term) || (p.phone ?? "").includes(term)).slice(0, 8)
    : [];

  const choose = (id: string) => { onChange(id); setSearch(""); };

  return (
    <>
      {selected ? (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm">
          <span><span className="font-medium">{selected.name}</span> <span className="text-xs text-neutral-500">{selected.mr_no}{selected.phone ? ` · ${selected.phone}` : ""}</span></span>
          <button type="button" onClick={() => onChange("")} className="text-xs font-medium text-emerald-700 hover:underline">Change</button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, MR or phone…" aria-label="Search patient" />
            <button type="button" title="Register a new patient" aria-label="Register a new patient" onClick={() => setRegistering(true)}
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white hover:bg-neutral-700">
              <Plus size={16} />
            </button>
          </div>
          {term && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-neutral-200">
              {matches.length === 0 ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-xs text-neutral-400">No patients found.</span>
                  <button type="button" onClick={() => setRegistering(true)} className="inline-flex items-center gap-1 rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white">
                    <Plus size={12} /> Register &ldquo;{search.trim()}&rdquo;
                  </button>
                </div>
              ) : matches.map((p) => (
                <button key={p.id} type="button" onClick={() => choose(p.id)} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-amber-50">
                  <span className="font-medium">{p.name}</span> <span className="text-xs text-neutral-400">{p.mr_no}{p.phone ? ` · ${p.phone}` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {registering && (
        <PatientFormModal
          patient={null}
          initialName={search.trim()}
          onClose={() => setRegistering(false)}
          onSaved={(p) => {
            setRegistering(false);
            if (p) { setAdded((x) => [p, ...x]); choose(p.id); }
          }}
        />
      )}
    </>
  );
}
