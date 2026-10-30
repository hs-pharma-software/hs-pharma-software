"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/Field";
import PatientFormModal from "@/app/clinic/patients/PatientFormModal";
import type { ClinicPatient } from "@/lib/types-clinic";

const digitsOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Choose a clinic patient by typing their name, MRN or mobile number; when
 * nobody matches, register them (name or number already filled in) and they
 * are selected straight away. Arrow keys and Enter pick from the list. */
export function ClinicPatientPicker({
  patients,
  value,
  onChange,
  onRegistered,
}: {
  patients: ClinicPatient[];
  value: string;
  onChange: (id: string) => void;
  /** A newly registered patient, so the parent can add it to its list. */
  onRegistered?: (p: ClinicPatient) => void;
}) {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [added, setAdded] = useState<ClinicPatient[]>([]);
  const all = [...added.filter((a) => !patients.some((p) => p.id === a.id)), ...patients];
  const selected = all.find((p) => p.id === value) ?? null;
  const term = search.trim().toLowerCase();
  const digits = digitsOf(term);
  const matches = term
    ? all.filter((p) =>
        p.name.toLowerCase().includes(term)
        || (p.mrn ?? "").toLowerCase().includes(term)
        || (digits.length >= 3 && digitsOf(p.phone).includes(digits))).slice(0, 8)
    : [];
  const looksLikePhone = digits.length >= 4 && digits.length === term.replace(/[\s+-]/g, "").length;

  const choose = (id: string) => {
    onChange(id);
    setSearch("");
    setActive(0);
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!term) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[active]) choose(matches[active].id);
      else setRegistering(true);
    } else if (e.key === "Escape") setSearch("");
  }

  return (
    <>
      {selected ? (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm">
          <span>
            <span className="font-medium">{selected.name}</span>{" "}
            <span className="text-xs text-neutral-500">{selected.mrn ?? ""}{selected.phone ? ` · ${selected.phone}` : ""}</span>
          </span>
          <button type="button" onClick={() => onChange("")} className="text-xs font-medium text-emerald-700 hover:underline">Change</button>
        </div>
      ) : (
        <div className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActive(0); }}
                onKeyDown={onKeyDown}
                placeholder="Type name, MRN or mobile…"
                aria-label="Search patient"
                autoComplete="off"
                className="pl-8"
              />
            </div>
            <button
              type="button"
              title="Register a new patient"
              aria-label="Register a new patient"
              onClick={() => setRegistering(true)}
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white hover:bg-neutral-700"
            >
              <Plus size={16} />
            </button>
          </div>
          {term && (
            <div role="listbox" className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
              {matches.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p.id)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${i === active ? "bg-amber-50" : ""}`}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-neutral-500">{p.mrn ?? ""}{p.phone ? ` · ${p.phone}` : ""}</span>
                </button>
              ))}
              <div className={`flex items-center justify-between gap-2 px-3 py-2 ${matches.length ? "border-t border-neutral-100" : ""}`}>
                <span className="text-xs text-neutral-500">{matches.length ? "Not in the list?" : "No patient found."}</span>
                <button type="button" onClick={() => setRegistering(true)} className="inline-flex items-center gap-1 rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white">
                  <Plus size={12} /> Register &ldquo;{search.trim()}&rdquo;
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Outside the parent's form in the page, and its submit stops here so it never submits the parent. */}
      {registering && createPortal(
        <div onSubmit={(e) => e.stopPropagation()}>
        <PatientFormModal
          patient={null}
          initialName={looksLikePhone ? "" : search.trim()}
          initialPhone={looksLikePhone ? search.trim() : ""}
          onClose={() => setRegistering(false)}
          onSaved={(p) => {
            setRegistering(false);
            if (p) {
              setAdded((x) => [p, ...x]);
              onRegistered?.(p);
              choose(p.id);
            }
          }}
        />
        </div>,
        document.body
      )}
    </>
  );
}
