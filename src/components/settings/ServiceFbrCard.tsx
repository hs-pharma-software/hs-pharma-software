"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { FbrCombobox } from "@/components/ui/FbrCombobox";
import { isTauri } from "@/lib/platform";
import { FBR_HS_CODES, FBR_SALE_TYPES, FBR_UOM_LIST, findSaleType } from "@/lib/fbrData";
import { loadServiceFbrDefaults, saveServiceFbrDefaults, type ServiceFbrDefaults } from "@/lib/serviceFbr";

const HS_OPTIONS = FBR_HS_CODES.map((h) => ({ value: h.code, label: h.code, sublabel: h.description }));

/** The FBR item details used for every line of a service bill (lab visits,
 * banquet bookings), which have no product to carry them. */
export function ServiceFbrCard({ hint }: { hint: string }) {
  const [d, setD] = useState<ServiceFbrDefaults>({ hsCode: "", saleType: "", rate: 0, uom: "" });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isTauri()) void loadServiceFbrDefaults().then(setD);
  }, []);

  async function save() {
    try {
      await saveServiceFbrDefaults(d);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  const hsValid = !d.hsCode || FBR_HS_CODES.some((h) => h.code === d.hsCode);
  return (
    <section className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <h2 className="text-base font-semibold tracking-tight text-neutral-900">FBR for service bills</h2>
      <p className="mb-3 mt-1 text-sm text-neutral-500">{hint} Ask your tax advisor or PRAL which code, sale type and rate apply to your service.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="HS / service code">
          <FbrCombobox value={d.hsCode} onChange={(v) => setD({ ...d, hsCode: v })} placeholder="e.g. 9801.3000" options={HS_OPTIONS} />
          {!hsValid && <span className="text-[11px] text-rose-600">Not an FBR code</span>}
        </Field>
        <Field label="Sale type">
          <Select id="sfbr-type" value={d.saleType} onChange={(e) => setD({ ...d, saleType: e.target.value, rate: findSaleType(e.target.value)?.defaultRate ?? d.rate })}>
            <option value="">Choose…</option>
            {FBR_SALE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.value}</option>)}
          </Select>
        </Field>
        <Field label="Sales tax rate %">
          <Input id="sfbr-rate" type="number" min="0" step="any" value={d.rate} onChange={(e) => setD({ ...d, rate: Number(e.target.value) })} />
        </Field>
        <Field label="Unit (UOM)">
          <FbrCombobox value={d.uom} onChange={(v) => setD({ ...d, uom: v })} placeholder="e.g. Numbers, pieces, units" options={FBR_UOM_LIST.map((u) => ({ value: u, label: u }))} />
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-emerald-600">Saved ✓</span>}
        <Button variant="primary" onClick={() => void save()} disabled={!hsValid}>Save</Button>
      </div>
    </section>
  );
}
