"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { ClinicSlipHeader } from "@/components/clinic/ClinicSlipHeader";
import { ClinicPrintTemplatesCard } from "@/components/clinic/ClinicPrintTemplatesCard";
import { isTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { EMPTY_CLINIC_PROFILE, loadClinicProfile, saveClinicProfile, type ClinicProfile } from "@/lib/clinicProfile";

/** The lab's details on its reports (name, address, contact, PHC
 * registration, NTN) and the report's paper and layout. Bills, FBR and the
 * app's theme are in General Settings. */
export default function LabProfilePage() {
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const templatesEditable = useAuthStore((s) => s.currentTenant?.printTemplatesEditable !== false);
  const [p, setP] = useState<ClinicProfile>(EMPTY_CLINIC_PROFILE);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (isTauri() && tenantId) void loadClinicProfile().then(setP);
  }, [tenantId]);

  const set = (k: keyof ClinicProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setP((prev) => ({ ...prev, [k]: e.target.value }));
    setSavedAt(null);
  };

  async function save() {
    setSaving(true);
    try {
      setP(await saveClinicProfile(p));
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
        title="Lab Profile"
        actions={<>
          {savedAt && <span className="text-sm text-emerald-700">Saved {savedAt}</span>}
          <Button variant="primary" onClick={() => void save()} disabled={saving || !p.name.trim()}>{saving ? "Saving…" : "Save"}</Button>
        </>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <section className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <p className="mb-4 text-sm text-neutral-500">These details print at the top of the lab&apos;s reports. Bills use General Settings (company profile, print templates, FBR).</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="Lab name" required><Input id="lp-name" value={p.name} onChange={set("name")} placeholder="e.g. City Diagnostic Lab" /></Field></div>
            <div className="md:col-span-2"><Field label="Address"><Textarea id="lp-address" rows={2} value={p.address} onChange={set("address")} /></Field></div>
            <Field label="Contact"><Input id="lp-contact" value={p.contact} onChange={set("contact")} placeholder="e.g. 0300-1234567" /></Field>
            <Field label="PHC Reg No"><Input id="lp-phc" value={p.phc_reg_no} onChange={set("phc_reg_no")} /></Field>
            <Field label="NTN No"><Input id="lp-ntn" value={p.ntn} onChange={set("ntn")} /></Field>
          </div>
        </section>
        <section className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <h2 className="mb-3 text-sm font-semibold text-neutral-600">How the report header prints</h2>
          <div className="rounded-lg border border-dashed border-neutral-300 p-3 text-sm text-neutral-900">
            <ClinicSlipHeader profile={p} compact />
            <p className="mt-2 text-center text-xs text-neutral-400">Report follows here</p>
          </div>
        </section>
      </div>
      <div className="mt-4">
        <ClinicPrintTemplatesCard editable={templatesEditable} docs={["lab"]} />
      </div>
    </div>
  );
}
