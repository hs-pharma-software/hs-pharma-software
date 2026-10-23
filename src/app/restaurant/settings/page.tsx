"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { restaurant } from "@/lib/restaurant";
import { REST_SETTINGS } from "@/lib/restaurant/store";
import { useCan } from "@/lib/actionPermissions";
import { Note, RestGuard, useAction, useLoad } from "@/components/restaurant/ui";

export default function RestaurantSettingsPage() {
  return (
    <RestGuard>
      <Settings />
    </RestGuard>
  );
}

const KEYS = [REST_SETTINGS.cashRate, REST_SETTINGS.cardRate, REST_SETTINGS.serviceChargePct, REST_SETTINGS.serviceChargeTaxable, REST_SETTINGS.dailyTarget, REST_SETTINGS.stations] as const;

function Settings() {
  const canEdit = useCan("rest.settings");
  const loaded = useLoad(async () => Object.fromEntries(await Promise.all(KEYS.map(async (k) => [k, (await restaurant.settings.get(k)) ?? ""] as const))));
  const [f, setF] = useState<Record<string, string>>({});
  const act = useAction();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (loaded.data) setF(loaded.data);
  }, [loaded.data]);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Billing & Tax" />
      {!canEdit && <Note tone="amber">You can view these settings; changing them needs the &quot;Tax and PRA settings&quot; permission.</Note>}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/[0.05]">
        <h2 className="mb-1 text-base font-semibold">Sales tax</h2>
        <p className="mb-3 text-xs text-neutral-500">
          No rate is assumed. Enter the rates that apply to your restaurant from the current PRA notifications (Punjab Sales Tax on Services Act 2012
          and PRA rate notifications); restaurants may have a different rate for card / digital payments. Confirm with your tax adviser.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tax % when paid in cash" required><Input type="number" min="0" max="100" step="any" value={f[REST_SETTINGS.cashRate] ?? ""} onChange={(e) => set(REST_SETTINGS.cashRate, e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Tax % when paid by card / bank / wallet"><Input type="number" min="0" max="100" step="any" value={f[REST_SETTINGS.cardRate] ?? ""} onChange={(e) => set(REST_SETTINGS.cardRate, e.target.value)} disabled={!canEdit} placeholder="same as cash if empty" /></Field>
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">A bill paid partly in cash uses the cash rate.</p>
      </div>
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/[0.05]">
        <h2 className="mb-3 text-base font-semibold">Service charge (dine-in only)</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Service charge %"><Input type="number" min="0" max="100" step="any" value={f[REST_SETTINGS.serviceChargePct] ?? ""} onChange={(e) => set(REST_SETTINGS.serviceChargePct, e.target.value)} disabled={!canEdit} placeholder="0 = none" /></Field>
          <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={f[REST_SETTINGS.serviceChargeTaxable] !== "false"} onChange={(e) => set(REST_SETTINGS.serviceChargeTaxable, e.target.checked ? "true" : "false")} disabled={!canEdit} /> Service charge is taxable</label>
        </div>
      </div>
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/[0.05]">
        <h2 className="mb-3 text-base font-semibold">Kitchen &amp; dashboard</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kitchen stations (comma separated)"><Input value={f[REST_SETTINGS.stations] ?? ""} onChange={(e) => set(REST_SETTINGS.stations, e.target.value)} disabled={!canEdit} placeholder="Kitchen, Grill, BBQ, Fryer, Pizza, Drinks" /></Field>
          <Field label="Daily sales target (Rs, optional)"><Input type="number" min="0" value={f[REST_SETTINGS.dailyTarget] ?? ""} onChange={(e) => set(REST_SETTINGS.dailyTarget, e.target.value)} disabled={!canEdit} /></Field>
        </div>
      </div>
      {act.error && <Note tone="rose">{act.error}</Note>}
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-emerald-600">Saved ✓</span>}
        <Button
          variant="primary"
          disabled={!canEdit || act.busy}
          onClick={async () => {
            const cash = f[REST_SETTINGS.cashRate];
            if (cash === "" || cash == null) return act.setError("Enter the cash tax rate (0 if your restaurant is not charged sales tax).");
            const ok = await act.run(async () => {
              for (const k of KEYS) if ((f[k] ?? "") !== (loaded.data?.[k] ?? "")) await restaurant.settings.set(k, f[k] ?? "");
            });
            if (ok) {
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
              void loaded.reload();
            }
          }}
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}
