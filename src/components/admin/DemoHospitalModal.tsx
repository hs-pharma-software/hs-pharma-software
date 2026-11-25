"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { serverJson } from "@/lib/serverMode";
import type { SubscriptionPlan } from "@/lib/types2";
import { FormError } from "@/components/ui/FormError";

interface DemoLogin { group: string; name: string; designation: string; department: string; employeeId: string | null; username: string }
interface DemoResult { tenantId: string; hospitalName: string; password: string; logins: DemoLogin[]; departments: string[]; trainees: number; rosterDays: string[] }

const SITE = "app.mavin.pk";

/** Super Admin > Tenants: a complete demo hospital for a client presentation,
 * then its logins sheet (Print, or Save as PDF). */
export function DemoHospitalModal({ plans, onClose, onCreated }: { plans: SubscriptionPlan[]; onClose: () => void; onCreated: () => void }) {
  const best = plans.slice().sort((a, b) => (b.max_staff_logins ?? 0) - (a.max_staff_logins ?? 0))[0];
  const [name, setName] = useState("MAVIN Demo Hospital");
  const [prefix, setPrefix] = useState("demo");
  const [password, setPassword] = useState("");
  const [city, setCity] = useState("Lahore");
  const [planId, setPlanId] = useState(best?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await serverJson<{ result: DemoResult }>("/api/demo-hospital/", { hospitalName: name, prefix, password, planId, city });
      setResult(r.result);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (result) return <LoginsSheet r={result} onClose={onClose} />;

  return (
    <Modal title="Create demo hospital" onClose={onClose} width="max-w-lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-600">
          Creates a complete hospital for a presentation: 10 departments, Heads of Department, consultants, 5 doctors, 5 nurses, a head nurse,
          paramedical staff, computer operators and a security guard, each with a login, this week&apos;s duty roster and trainees in the Lab and Radiology.
          All names and numbers are made up.
        </p>
        <Field label="Hospital name" required><Input id="dh-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username prefix" required><Input id="dh-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))} /></Field>
          <Field label="City"><Input id="dh-city" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        </div>
        <p className="-mt-1 text-xs text-neutral-500">Logins will be {prefix || "prefix"}.admin, {prefix || "prefix"}.mo1, {prefix || "prefix"}.nurse1 and so on.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password for every demo login" required><Input id="dh-pass" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="off" /></Field>
          <Field label="Plan" required>
            <Select id="dh-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.max_staff_logins} staff logins)</option>)}
            </Select>
          </Field>
        </div>
        <FormError message={error} />
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button loading={busy} variant="primary" disabled={busy || !name.trim() || prefix.length < 2 || password.length < 6 || !planId} onClick={() => void create()}>
            {busy ? "Creating…" : "Create demo hospital"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The logins sheet: one A4 page per screen, grouped as staff work. */
function LoginsSheet({ r, onClose }: { r: DemoResult; onClose: () => void }) {
  const groups = [...new Set(r.logins.map((l) => l.group))];
  const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <Modal title={`${r.hospitalName}: demo logins`} onClose={onClose} width="max-w-4xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-emerald-700">Created: {r.logins.length} logins, {r.departments.length} departments, {r.trainees} trainees, roster {day(r.rosterDays[0])} to {day(r.rosterDays[6])}.</p>
        <Button variant="primary" onClick={() => window.print()}><Printer size={14} className="mr-1" />Print or save as PDF</Button>
      </div>
      <div className="print-area mx-auto w-full max-w-[190mm] bg-white text-[12px] text-neutral-900">
        <div className="flex items-end justify-between border-b-2 border-neutral-800 pb-2">
          <div>
            <p className="text-xl font-bold">{r.hospitalName}</p>
            <p className="text-xs text-neutral-600">Demo logins · MAVIN Hospital Management System</p>
          </div>
          <div className="text-right text-xs">
            <p>Sign in at <b>{SITE}</b></p>
            <p>Password for every login: <b className="font-mono text-sm">{r.password}</b></p>
          </div>
        </div>
        {groups.map((g) => (
          <div key={g} className="mt-3 break-inside-avoid">
            <p className="border-b border-neutral-300 pb-0.5 text-[11px] font-bold uppercase tracking-wide text-neutral-700">{g}</p>
            <table className="mt-1 w-full border-collapse">
              <thead>
                <tr className="text-left text-[10.5px] text-neutral-500">
                  <th className="py-0.5 pr-2 font-medium">Name</th><th className="py-0.5 pr-2 font-medium">Designation</th><th className="py-0.5 pr-2 font-medium">Department</th>
                  <th className="py-0.5 pr-2 font-medium">Employee ID</th><th className="py-0.5 font-medium">Username</th>
                </tr>
              </thead>
              <tbody>
                {r.logins.filter((l) => l.group === g).map((l) => (
                  <tr key={l.username} className="border-t border-neutral-100">
                    <td className="py-1 pr-2 font-medium">{l.name}</td>
                    <td className="py-1 pr-2">{l.designation}</td>
                    <td className="py-1 pr-2">{l.department}</td>
                    <td className="py-1 pr-2 font-mono">{l.employeeId ?? "—"}</td>
                    <td className="py-1 font-mono font-semibold">{l.username}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p className="mt-4 border-t border-neutral-300 pt-2 text-[10.5px] text-neutral-500">
          Demo data only: names, phone and licence numbers are made up. Each login opens the sections of its designation. Change or remove these logins after the presentation.
        </p>
      </div>
    </Modal>
  );
}
