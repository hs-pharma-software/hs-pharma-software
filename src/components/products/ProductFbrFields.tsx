"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui/Field";
import { FbrCombobox } from "@/components/ui/FbrCombobox";
import {
  activeToken,
  fetchFbrHsUoms,
  fetchFbrRates,
  fetchFbrSroItems,
  fetchFbrSroSchedules,
  loadFbrSettings,
  type FbrRate,
  type FbrSroSchedule,
} from "@/lib/fbr";
import { FBR_HS_CODES, FBR_SALE_TYPES, FBR_UOM_LIST, fbrProvinceCode, findSaleType } from "@/lib/fbrData";
import { COUNT_UOMS } from "@/lib/fbrPayload";

const HS_OPTIONS = FBR_HS_CODES.map((h) => ({ value: h.code, label: h.code, sublabel: h.description }));
const VALID_HS = new Set(FBR_HS_CODES.map((h) => h.code));

interface Props {
  hsCode: string;
  setHsCode: (v: string) => void;
  saleType: string;
  setSaleType: (v: string) => void;
  saleRate: string;
  setSaleRate: (v: string) => void;
  uom: string;
  setUom: (v: string) => void;
  sroNo: string;
  setSroNo: (v: string) => void;
  sroItem: string;
  setSroItem: (v: string) => void;
  qtyFactor: string;
  setQtyFactor: (v: string) => void;
  /** Name of the product's base unit, for the quantity-factor label. */
  baseUnitName: string;
}

/** Product FBR fields backed by FBR's live reference APIs, so only values
 * FBR accepts can be picked (rate per sale type, UOM per HS code, SRO
 * schedules per rate, item serials per schedule). */
export function ProductFbrFields(p: Props) {
  const [token, setToken] = useState("");
  const [provinceCode, setProvinceCode] = useState(7);
  const [rates, setRates] = useState<FbrRate[]>([]);
  const [uoms, setUoms] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<FbrSroSchedule[]>([]);
  const [sroItems, setSroItems] = useState<string[]>([]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    void loadFbrSettings().then((s) => {
      setToken(activeToken(s));
      setProvinceCode(fbrProvinceCode(s.sellerProvince));
    });
  }, []);

  const saleTypeEntry = findSaleType(p.saleType);
  const rateNum = Number(p.saleRate) || 0;
  const rateId = rates.find((r) => r.value === rateNum)?.rateId;
  const needsSro = Boolean(saleTypeEntry) && saleTypeEntry!.value !== "3rd Schedule Goods" &&
    !(saleTypeEntry!.value.startsWith("Goods at standard") && rateNum === 18);
  const sroId = schedules.find((s) => s.label === p.sroNo)?.sroId;
  const hsValid = VALID_HS.has(p.hsCode);

  const note = (e: unknown) => {
    console.warn("FBR reference API:", e);
    setOffline(true);
  };

  useEffect(() => {
    if (!token || !saleTypeEntry) return setRates([]);
    fetchFbrRates(token, saleTypeEntry.transTypeId, provinceCode).then(setRates, note);
  }, [token, saleTypeEntry?.transTypeId, provinceCode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token || !hsValid) return setUoms([]);
    fetchFbrHsUoms(token, p.hsCode).then((list) => {
      setUoms(list);
      if (list.length > 0 && !list.includes(p.uom)) p.setUom(list[0]);
    }, note);
  }, [token, p.hsCode, hsValid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token || !needsSro || !rateId) return setSchedules([]);
    fetchFbrSroSchedules(token, rateId, provinceCode).then(setSchedules, note);
  }, [token, needsSro, rateId, provinceCode]);

  useEffect(() => {
    if (!token || !sroId) return setSroItems([]);
    fetchFbrSroItems(token, sroId).then(setSroItems, note);
  }, [token, sroId]);

  const uomOptions = uoms.length > 0 ? uoms : FBR_UOM_LIST;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="HS Code">
          <FbrCombobox value={p.hsCode} onChange={p.setHsCode} placeholder="e.g. 3004.9099" options={HS_OPTIONS} />
          {p.hsCode && !hsValid && <span className="text-[11px] text-rose-600">Not a valid FBR HS code</span>}
        </Field>
        <Field label="FBR Sale Type">
          <Select
            value={saleTypeEntry?.value ?? ""}
            onChange={(e) => {
              const t = findSaleType(e.target.value);
              p.setSaleType(e.target.value);
              p.setSaleRate(String(t?.defaultRate ?? 0));
              p.setSroNo("");
              p.setSroItem("");
            }}
          >
            <option value="">Select...</option>
            {FBR_SALE_TYPES.map((t) => (
              <option key={t.value} value={t.value} title={t.description}>
                {t.value}
              </option>
            ))}
          </Select>
          {p.saleType && !saleTypeEntry && (
            <span className="text-[11px] text-rose-600">&quot;{p.saleType}&quot; is not an FBR sale type</span>
          )}
        </Field>
        <Field label="FBR Sale Rate">
          {rates.length > 0 ? (
            <Select
              value={rates.some((r) => r.value === rateNum) ? String(rateNum) : ""}
              onChange={(e) => {
                p.setSaleRate(e.target.value);
                p.setSroNo("");
                p.setSroItem("");
              }}
            >
              <option value="">Select...</option>
              {rates.map((r) => (
                <option key={r.rateId} value={String(r.value)}>
                  {r.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input type="number" min="0" step="any" value={p.saleRate} onChange={(e) => p.setSaleRate(e.target.value)} />
          )}
        </Field>
        <Field label="FBR UOM">
          <Select value={uomOptions.includes(p.uom) ? p.uom : ""} onChange={(e) => p.setUom(e.target.value)}>
            <option value="">Select...</option>
            {uomOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
          {uoms.length > 0 && <span className="text-[11px] text-neutral-400">Allowed by FBR for {p.hsCode}</span>}
        </Field>
        {p.uom && !COUNT_UOMS.has(p.uom) && (
          <Field label={`${p.uom} per 1 ${p.baseUnitName || "unit"}`} required>
            <Input
              type="number"
              min="0"
              step="any"
              value={p.qtyFactor}
              onChange={(e) => p.setQtyFactor(e.target.value)}
              className={Number(p.qtyFactor) === 1 ? "!border-amber-400" : ""}
            />
            <span className="text-[11px] leading-snug text-neutral-500">
              FBR counts this item in {p.uom}. Enter how much one {p.baseUnitName || "unit"} weighs/holds, e.g. a 500 g
              pack = 0.5 KG. Invoice quantities are converted with it.
            </span>
          </Field>
        )}
        <Field label="SRO Schedule No" required={needsSro}>
          {schedules.length > 0 ? (
            <Select
              value={p.sroNo}
              onChange={(e) => {
                p.setSroNo(e.target.value);
                p.setSroItem("");
              }}
            >
              <option value="">Select...</option>
              {schedules.map((s) => (
                <option key={s.sroId} value={s.label}>
                  {s.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={p.sroNo}
              onChange={(e) => p.setSroNo(e.target.value)}
              placeholder={needsSro ? "e.g. 6th Schd Table I" : "Not needed at 18%"}
              disabled={!needsSro && !p.sroNo}
            />
          )}
        </Field>
        <Field label="SRO Item Serial No" required={needsSro}>
          <FbrCombobox
            value={p.sroItem}
            onChange={p.setSroItem}
            placeholder={sroItems.length > 0 ? `${sroItems.length} serials - type to search` : "e.g. 100"}
            options={sroItems.map((s) => ({ value: s, label: s }))}
            disabled={!needsSro && !p.sroItem}
          />
        </Field>
      </div>
      {!token && (
        <p className="text-[11px] text-neutral-400">
          Add an FBR token in Settings to load FBR&apos;s official rate, UOM and SRO lists here.
        </p>
      )}
      {offline && token && (
        <p className="text-[11px] text-amber-600">Could not reach FBR reference APIs; showing manual entry.</p>
      )}
    </>
  );
}
