"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { useAuthStore } from "@/store/authStore";
import { businessType } from "@/config/businessTypes";
import { dist, DIST_TYPE, errorText } from "@/lib/dist";
import { mergeSettings, type DistMode, type DistSettings } from "@/lib/dist/engine";
import { Err, Note, PageTitle, useLoad } from "@/components/dist/ui";

export default function DistSettingsPage() {
  const type = useAuthStore((s) => businessType(s.currentTenant?.businessType).id);
  const role = useAuthStore((s) => s.currentUser?.role);
  const cfg = useLoad(() => (type === DIST_TYPE ? dist.config() : Promise.resolve(null)), [type]);
  const [s, setS] = useState<DistSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (cfg.data) setS(cfg.data.settings);
  }, [cfg.data]);

  if (type !== DIST_TYPE) return <Note tone="amber">These screens are for Wholesaler / Distributor accounts.</Note>;
  if (role !== "owner") return <Note tone="amber">Only the distributor administrator can change these settings.</Note>;

  const choose = async (mode: DistMode) => {
    setMsg(null);
    try {
      await dist.setup(mode);
      await cfg.reload();
      setMsg({ ok: true, text: `Set up as ${mode === "pharma" ? "Pharma" : "General"} Distributor.` });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const save = async () => {
    if (!s) return;
    setMsg(null);
    try {
      setS(await dist.saveSettings(mergeSettings(s), reason || undefined));
      setReason("");
      setMsg({ ok: true, text: "Saved. The change is recorded in the audit log." });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const num = (v: string) => (v === "" ? 0 : Number(v));
  const setW = (patch: Partial<DistSettings["wht"]>) => setS((x) => (x ? { ...x, wht: { ...x.wht, ...patch } } : x));
  const setL = (patch: Partial<DistSettings["location"]>) => setS((x) => (x ? { ...x, location: { ...x.location, ...patch } } : x));

  return (
    <div className="max-w-5xl space-y-4">
      <PageTitle title="Distributor Settings" sub={cfg.data ? `Mode: ${cfg.data.mode === "pharma" ? "Pharma Distributor" : "General Distributor"}` : "Not set up yet"} />
      <Err error={cfg.error} />
      {msg && (msg.ok ? <Note tone="emerald">{msg.text}</Note> : <Err error={msg.text} />)}

      <section className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-black/5">
        <h2 className="text-sm font-semibold">Distributor type</h2>
        <p className="text-sm text-neutral-600">
          The type decides the catalog fields, customer requirements (CDSL for pharma) and starter categories. It can only be changed while no products or customers exist.
        </p>
        <div className="flex gap-2">
          {(["pharma", "general"] as const).map((m) => (
            <Button key={m} variant={cfg.data?.mode === m ? "primary" : "secondary"} onClick={() => void choose(m)}>
              {m === "pharma" ? "Pharma Distributor" : "General Distributor"}
            </Button>
          ))}
        </div>
      </section>

      {s && (
        <>
          <section className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-black/5">
            <h2 className="text-sm font-semibold">Withholding income tax at sale</h2>
            <Note tone="sky">
              Checked against FBR&apos;s Withholding Tax Rate Card (updated up to 30 June 2025, Finance Act 2025): <b>236H</b> sales to retailers 0.5 % (ATL) / 2.5 % (non-ATL);{" "}
              <b>236G</b> sales to distributors, dealers &amp; wholesalers (other than fertilizers) 0.1 % / 2.0 % (fertilizers 0.25 % / 0.7 %). Your requested 0.5 % / 2.5 % therefore apply to
              retailer customers only — set each customer&apos;s tax class. ATL status comes from FBR&apos;s ATL portal (e.fbr.gov.pk) or SMS 9966; FBR publishes no API, so checks are recorded
              by an authorised user with their source and date. Exemptions, rate changes after the card and the exact taxable base are legal questions: confirm with your tax advisor. The
              statute prevails over these settings.
            </Note>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.wht.enabled} onChange={(e) => setW({ enabled: e.target.checked })} /> Collect withholding tax on sales invoices
            </label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-neutral-500">
                  <tr>
                    <th className="px-2 py-1 text-start">Customer class</th>
                    <th className="px-2 py-1 text-start">Section</th>
                    <th className="px-2 py-1 text-start">ATL (active) %</th>
                    <th className="px-2 py-1 text-start">Non-ATL / no NTN %</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(s.wht.classes).map(([k, r]) => (
                    <tr key={k} className="border-t border-neutral-100">
                      <td className="px-2 py-1 font-medium">{k}</td>
                      <td className="px-2 py-1"><Input className="!w-28" value={r.section} onChange={(e) => setW({ classes: { ...s.wht.classes, [k]: { ...r, section: e.target.value } } })} /></td>
                      <td className="px-2 py-1"><Input className="!w-24" type="number" step="any" min="0" value={r.activeRate} onChange={(e) => setW({ classes: { ...s.wht.classes, [k]: { ...r, activeRate: num(e.target.value) } } })} /></td>
                      <td className="px-2 py-1"><Input className="!w-24" type="number" step="any" min="0" value={r.inactiveRate} onChange={(e) => setW({ classes: { ...s.wht.classes, [k]: { ...r, inactiveRate: num(e.target.value) } } })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="When ATL status is unverified / too old">
                <Select value={s.wht.unverifiedPolicy} onChange={(e) => setW({ unverifiedPolicy: e.target.value as DistSettings["wht"]["unverifiedPolicy"] })}>
                  <option value="inactive_rate">Apply non-ATL rate (flagged unverified)</option>
                  <option value="block">Block the invoice until verified</option>
                </Select>
              </Field>
              <Field label="ATL check valid for (days)">
                <Input type="number" min="1" value={s.wht.maxCheckAgeDays} onChange={(e) => setW({ maxCheckAgeDays: num(e.target.value) })} />
              </Field>
              <Field label="Taxable base">
                <Select value={s.wht.base} onChange={(e) => setW({ base: e.target.value as DistSettings["wht"]["base"] })}>
                  <option value="net_incl_sales_tax">After discounts, including sales tax</option>
                  <option value="net_excl_sales_tax">After discounts, excluding sales tax</option>
                </Select>
              </Field>
              <Field label="Rounding">
                <Select value={s.wht.rounding} onChange={(e) => setW({ rounding: e.target.value as DistSettings["wht"]["rounding"] })}>
                  <option value="paisa">To paisa</option>
                  <option value="rupee">To whole rupee</option>
                </Select>
              </Field>
            </div>
          </section>

          <section className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-black/5">
            <h2 className="text-sm font-semibold">Salesman location</h2>
            <div className="grid gap-3 md:grid-cols-5">
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={s.location.requiredForBooking} onChange={(e) => setL({ requiredForBooking: e.target.checked })} /> Required to submit bookings
              </label>
              <Field label="Fresh if newer than (seconds)">
                <Input type="number" min="10" value={s.location.maxAgeSeconds} onChange={(e) => setL({ maxAgeSeconds: num(e.target.value) })} />
              </Field>
              <Field label="Max accuracy (metres)">
                <Input type="number" min="5" value={s.location.maxAccuracyMeters} onChange={(e) => setL({ maxAccuracyMeters: num(e.target.value) })} />
              </Field>
              <Field label="Flag jumps faster than (km/h)">
                <Input type="number" min="20" value={s.location.maxSpeedKmh} onChange={(e) => setL({ maxSpeedKmh: num(e.target.value) })} />
              </Field>
              <Field label="Keep tracking points (days)">
                <Input type="number" min="1" value={s.location.retentionDays} onChange={(e) => setL({ retentionDays: num(e.target.value) })} />
              </Field>
            </div>
            <Button
              onClick={async () => {
                try {
                  const n = await dist.purgeOldLocations();
                  setMsg({ ok: true, text: `${n} tracking point(s) older than ${s.location.retentionDays} days deleted.` });
                } catch (e) {
                  setMsg({ ok: false, text: errorText(e) });
                }
              }}
            >
              Delete points older than the retention period
            </Button>
          </section>

          <section className="grid gap-3 rounded-xl bg-white p-4 ring-1 ring-black/5 md:grid-cols-4">
            <h2 className="text-sm font-semibold md:col-span-4">Targets, CDSL, stock, bookings</h2>
            <Field label="Target achievement measured by">
              <Select value={s.target.metric} onChange={(e) => setS({ ...s, target: { ...s.target, metric: e.target.value as DistSettings["target"]["metric"] } })}>
                <option value="bookings">Submitted bookings (value)</option>
                <option value="approved">Approved orders (value)</option>
                <option value="invoiced">Invoiced sales</option>
                <option value="net_sales">Net sales after returns</option>
              </Select>
            </Field>
            <Field label="On track when achieved ≥ (× pro-rata)">
              <Input type="number" step="0.05" min="0" max="1" value={s.target.onTrackRatio} onChange={(e) => setS({ ...s, target: { ...s.target, onTrackRatio: num(e.target.value) } })} />
            </Field>
            <Field label="CDSL expiry alert (days before)">
              <Input type="number" min="0" value={s.cdsl.alertDays} onChange={(e) => setS({ ...s, cdsl: { ...s.cdsl, alertDays: num(e.target.value) } })} />
            </Field>
            <div className="space-y-1 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={s.cdsl.required} onChange={(e) => setS({ ...s, cdsl: { ...s.cdsl, required: e.target.checked } })} /> CDSL required (pharma)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={s.cdsl.blockSaleWhenExpired} onChange={(e) => setS({ ...s, cdsl: { ...s.cdsl, blockSaleWhenExpired: e.target.checked } })} /> Block sales on expired CDSL</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={s.stock.allowNegative} onChange={(e) => setS({ ...s, stock: { allowNegative: e.target.checked } })} /> Allow negative stock</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={s.booking.requireApproval} onChange={(e) => setS({ ...s, booking: { requireApproval: e.target.checked } })} /> Bookings need approval</label>
            </div>
          </section>

          <div className="flex flex-wrap items-end justify-end gap-2">
            <div className="min-w-72">
              <Field label="Reason for this change (audit log)">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
            <Button variant="primary" onClick={() => void save()}>
              Save settings
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
