"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { isTauri } from "@/lib/platform";
import { getSetting, setSetting } from "@/lib/repo/settings";
import { FBR_PROVINCES } from "@/lib/fbrData";

const PROVINCES = FBR_PROVINCES.map((p) => p.label);

/** FBR Digital Invoicing: on / off, sandbox or production token, and the
 * seller's details (Settings, and the clinic's profile page). */
export function FbrSettingsCard({ tauriReady }: { tauriReady: boolean }) {
  const [enabled, setEnabled] = useState("false");
  const [env, setEnv] = useState("sandbox");
  const [sbToken, setSbToken] = useState("");
  const [prodToken, setProdToken] = useState("");
  const [ntn, setNtn] = useState("");
  const [name, setName] = useState("");
  const [province, setProvince] = useState("Punjab");
  const [address, setAddress] = useState("");
  const [retailer, setRetailer] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showSbToken, setShowSbToken] = useState(false);
  const [showProdToken, setShowProdToken] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void Promise.all([
      getSetting("fbr_enabled"),
      getSetting("fbr_environment"),
      getSetting("fbr_sandbox_token"),
      getSetting("fbr_production_token"),
      getSetting("fbr_seller_ntn"),
      getSetting("fbr_seller_name"),
      getSetting("fbr_seller_province"),
      getSetting("fbr_seller_address"),
      getSetting("fbr_retailer"),
    ]).then(([en, ev, sb, prod, n, nm, prov, addr, ret]) => {
      setRetailer(ret === "true");
      if (en) setEnabled(en);
      if (ev) setEnv(ev);
      if (sb) setSbToken(sb);
      if (prod) setProdToken(prod);
      if (n) setNtn(n);
      if (nm) setName(nm);
      if (prov) setProvince(prov);
      if (addr) setAddress(addr);
    });
  }, []);

  async function save() {
    await Promise.all([
      setSetting("fbr_enabled", enabled),
      setSetting("fbr_environment", env),
      setSetting("fbr_sandbox_token", sbToken),
      setSetting("fbr_production_token", prodToken),
      setSetting("fbr_seller_ntn", ntn),
      setSetting("fbr_seller_name", name),
      setSetting("fbr_seller_province", province),
      setSetting("fbr_seller_address", address),
      setSetting("fbr_retailer", retailer ? "true" : "false"),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        {/* FBR Badge */}
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#006633] text-[10px] font-bold tracking-tight text-white shadow-sm">
          FBR
        </div>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-neutral-900">FBR Digital Invoicing</h2>
          <p className="text-xs text-neutral-400">DI API v1.12 · PRAL Integration</p>
        </div>
        <div className="ml-auto">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${enabled === "true" ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-500"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${enabled === "true" ? "bg-emerald-500" : "bg-neutral-400"}`} />
            {enabled === "true" ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Enable / Environment row */}
        <Field label="Integration">
          <Select value={enabled} onChange={(e) => setEnabled(e.target.value)}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </Select>
        </Field>
        <Field label="Environment">
          <Select value={env} onChange={(e) => setEnv(e.target.value)}>
            <option value="sandbox">Sandbox (Testing)</option>
            <option value="production">Production (Live)</option>
          </Select>
        </Field>

        {/* Tokens */}
        <Field label="Sandbox Bearer Token">
          <div className="relative">
            <Input
              type={showSbToken ? "text" : "password"}
              value={sbToken}
              onChange={(e) => setSbToken(e.target.value)}
              placeholder="Paste PRAL sandbox token…"
              className="pr-8"
            />
            <button
              type="button"
              onClick={() => setShowSbToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400 hover:text-neutral-700"
            >
              {showSbToken ? "Hide" : "Show"}
            </button>
          </div>
        </Field>
        <Field label="Production Bearer Token">
          <div className="relative">
            <Input
              type={showProdToken ? "text" : "password"}
              value={prodToken}
              onChange={(e) => setProdToken(e.target.value)}
              placeholder="Paste PRAL production token…"
              className="pr-8"
            />
            <button
              type="button"
              onClick={() => setShowProdToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400 hover:text-neutral-700"
            >
              {showProdToken ? "Hide" : "Show"}
            </button>
          </div>
        </Field>

        {/* Seller info */}
        <Field label="Seller NTN / CNIC" required>
          <Input
            value={ntn}
            onChange={(e) => setNtn(e.target.value)}
            placeholder="7-digit NTN or 13-digit CNIC"
            maxLength={13}
          />
        </Field>
        <Field label="Seller Business Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Registered business name" />
        </Field>
        <Field label="Seller Province" required>
          <Select value={province} onChange={(e) => setProvince(e.target.value)}>
            {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Seller Address" required>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Business address" />
        </Field>
      </div>

      <label className="mt-3 flex items-start gap-2.5 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={retailer}
          onChange={(e) => setRetailer(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#006633]"
        />
        <span>
          Registered as <span className="font-medium">retailer</span> in sales tax profile
          <span className="block text-xs text-neutral-400">
            Sandbox then uses retail scenarios SN026 / SN027 / SN028 for sales to end consumers instead of SN002 / SN008 / SN005.
          </span>
        </span>
      </label>

      {/* Info note */}
      <p className="mt-3 text-xs text-neutral-400">
        Tokens are issued by PRAL and valid for 5 years. Both sandbox and production use{" "}
        <code className="rounded bg-neutral-100 px-1">gw.fbr.gov.pk</code> {"\u2014"} routing is determined by the token.
      </p>

      <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
        {saved && <span className="text-xs text-emerald-600">Saved ✓</span>}
        {!saved && <span />}
        <Button variant="primary" disabled={!tauriReady} onClick={() => void save()}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
