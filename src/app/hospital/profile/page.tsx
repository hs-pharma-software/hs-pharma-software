"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { getSetting, setSetting } from "@/lib/repo/settings";

const KEY = "hospital.profile";

interface Profile {
  name: string;
  registration_no: string;
  ntn: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  total_beds: string;
  notes: string;
}

const EMPTY: Profile = { name: "", registration_no: "", ntn: "", phone: "", email: "", address: "", city: "", total_beds: "", notes: "" };

/** The hospital's own configuration, saved in the hospital database. */
export default function HospitalProfilePage() {
  const tenantName = useAuthStore((s) => s.currentTenant?.name ?? "");
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const [p, setP] = useState<Profile>({ ...EMPTY, name: tenantName });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri() || !tenantId) return;
    void getSetting(KEY).then((raw) => {
      if (!raw) return;
      try {
        setP({ ...EMPTY, name: tenantName, ...(JSON.parse(raw) as Partial<Profile>) });
      } catch {
        /* unreadable value: keep the defaults */
      }
    });
  }, [tenantId, tenantName]);

  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP((prev) => ({ ...prev, [k]: e.target.value }));

  async function save() {
    if (!p.name.trim() || saving) return;
    setSaving(true);
    try {
      await setSetting(KEY, JSON.stringify({ ...p, name: p.name.trim() }));
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Hospital"
        actions={<Button variant="primary" onClick={() => void save()} disabled={saving || !p.name.trim()}>{saving ? "Saving…" : "Save"}</Button>}
      />
      <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Hospital Name *"><Input value={p.name} onChange={set("name")} /></Field>
          <Field label="Registration / PHC No"><Input value={p.registration_no} onChange={set("registration_no")} /></Field>
          <Field label="NTN"><Input value={p.ntn} onChange={set("ntn")} /></Field>
          <Field label="Total Beds"><Input type="number" min="0" value={p.total_beds} onChange={set("total_beds")} /></Field>
          <Field label="Phone"><Input value={p.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><Input type="email" value={p.email} onChange={set("email")} /></Field>
          <Field label="City"><Input value={p.city} onChange={set("city")} /></Field>
          <Field label="Address"><Input value={p.address} onChange={set("address")} /></Field>
          <div className="md:col-span-2">
            <Field label="Notes"><Textarea value={p.notes} onChange={set("notes")} rows={3} /></Field>
          </div>
        </div>
        {savedAt && <p className="mt-3 text-xs text-emerald-600">Saved at {savedAt}.</p>}
      </div>
    </div>
  );
}
