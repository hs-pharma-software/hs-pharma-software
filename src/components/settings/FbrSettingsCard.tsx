"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { isTauri } from "@/lib/platform";
import { getSetting, setSetting } from "@/lib/repo/settings";
import { FBR_PROVINCES } from "@/lib/fbrData";
import { testFbrToken, type FbrServerConfig } from "@/lib/fbr";
import { SERVER_DB, serverJson } from "@/lib/serverMode";
import { FbrSubmissionsPanel } from "./FbrSubmissionsPanel";

const PROVINCES = FBR_PROVINCES.map((p) => p.label);

/** FBR Digital Invoicing: on / off, sandbox or production token, and the
 * seller's details (Settings, and the clinic's profile page). */
export function FbrSettingsCard({ tauriReady, tenantId, embedded = false }: { tauriReady: boolean; tenantId?: string; embedded?: boolean }) {
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
  const [testing, setTesting] = useState<"sandbox" | "production" | null>(null);
  const [tests, setTests] = useState<Partial<Record<"sandbox" | "production", { ok: boolean; message: string }>>>({});
  // Web / desktop through MAVIN's server: tokens are kept there, encrypted; this page sees only a hint.
  const [server, setServer] = useState<FbrServerConfig | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const loadServer = () =>
    serverJson<FbrServerConfig>("/api/fbr/", { action: "config", tenantId }).then((c) => { setServer(c); setServerError(null); }, (e) => setServerError(e instanceof Error ? e.message : String(e)));
  const savedHint = (environment: "sandbox" | "production") => (environment === "sandbox" ? server?.sandboxHint : server?.productionHint) ?? null;

  async function test(environment: "sandbox" | "production") {
    setTesting(environment);
    try {
      const r = await testFbrToken(environment === "sandbox" ? sbToken : prodToken, environment, tenantId);
      setTests((t) => ({ ...t, [environment]: r }));
    } finally {
      setTesting(null);
    }
  }
  const testResult = (environment: "sandbox" | "production") => {
    const r = tests[environment];
    return r ? <p className={`mt-1 text-xs ${r.ok ? "text-emerald-700" : "text-rose-600"}`}>{r.ok ? "✓ " : "✕ "}{r.message}</p> : null;
  };

  useEffect(() => {
    if (!isTauri()) return;
    if (SERVER_DB) void loadServer();
    void Promise.all([
      getSetting("fbr_enabled", tenantId),
      getSetting("fbr_environment", tenantId),
      getSetting("fbr_sandbox_token", tenantId),
      getSetting("fbr_production_token", tenantId),
      getSetting("fbr_seller_ntn", tenantId),
      getSetting("fbr_seller_name", tenantId),
      getSetting("fbr_seller_province", tenantId),
      getSetting("fbr_seller_address", tenantId),
      getSetting("fbr_retailer", tenantId),
    ]).then(([en, ev, sb, prod, n, nm, prov, addr, ret]) => {
      setRetailer(ret === "true");
      if (en) setEnabled(en);
      if (ev) setEnv(ev);
      // Server mode never sends tokens to the page (these come back empty there).
      if (sb && !SERVER_DB) setSbToken(sb);
      if (prod && !SERVER_DB) setProdToken(prod);
      if (n) setNtn(n);
      if (nm) setName(nm);
      if (prov) setProvince(prov);
      if (addr) setAddress(addr);
    });
  }, [tenantId]);

  async function save() {
    if (SERVER_DB) {
      // Typed tokens go to MAVIN's server (encrypted); an empty box keeps the saved one.
      if (sbToken.trim() || prodToken.trim()) {
        try {
          setServer(await serverJson<FbrServerConfig>("/api/fbr/", { action: "tokens", tenantId, sandbox: sbToken.trim() || undefined, production: prodToken.trim() || undefined }));
          setSbToken("");
          setProdToken("");
          setServerError(null);
        } catch (e) {
          setServerError(e instanceof Error ? e.message : String(e));
          return;
        }
      }
    }
    await Promise.all([
      setSetting("fbr_enabled", enabled, tenantId),
      setSetting("fbr_environment", env, tenantId),
      ...(SERVER_DB ? [] : [setSetting("fbr_sandbox_token", sbToken, tenantId), setSetting("fbr_production_token", prodToken, tenantId)]),
      setSetting("fbr_seller_ntn", ntn, tenantId),
      setSetting("fbr_seller_name", name, tenantId),
      setSetting("fbr_seller_province", province, tenantId),
      setSetting("fbr_seller_address", address, tenantId),
      setSetting("fbr_retailer", retailer ? "true" : "false", tenantId),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className={embedded ? "" : "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]"}>
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

      {SERVER_DB && (server || serverError) && (
        <div className="mb-3 space-y-1.5">
          {server && (
            <p className={`rounded-lg px-3 py-2 text-xs ${server.route === "gateway" ? "bg-emerald-50 text-emerald-900" : "bg-sky-50 text-sky-900"}`}>
              {server.route === "gateway"
                ? <>Invoices go to FBR through <b>MAVIN&apos;s FBR gateway</b> (one fixed IP that PRAL whitelists for MAVIN). They can be submitted from any computer or phone.</>
                : <>Invoices go to FBR from <b>this computer&apos;s internet connection</b>: PRAL must whitelist its public IP. Submit from the connection PRAL whitelisted.</>}
              {" "}Tokens are kept encrypted on MAVIN&apos;s server and never shown again.
            </p>
          )}
          {server && !server.storageReady && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Token storage is not set up on MAVIN&apos;s server yet, so new tokens cannot be saved. Ask MAVIN support.</p>}
          {serverError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{serverError}</p>}
        </div>
      )}

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
              placeholder={savedHint("sandbox") ? `Saved (${savedHint("sandbox")}). Paste a new one to replace it` : "Paste PRAL sandbox token…"}
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
          <div className="mt-1.5 flex items-center gap-2">
            <Button onClick={() => void test("sandbox")} disabled={testing !== null || !(sbToken.trim() || savedHint("sandbox"))}>{testing === "sandbox" ? "Testing…" : "Test sandbox token"}</Button>
          </div>
          {testResult("sandbox")}
        </Field>
        <Field label="Production Bearer Token">
          <div className="relative">
            <Input
              type={showProdToken ? "text" : "password"}
              value={prodToken}
              onChange={(e) => setProdToken(e.target.value)}
              placeholder={savedHint("production") ? `Saved (${savedHint("production")}). Paste a new one to replace it` : "Paste PRAL production token…"}
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
          <div className="mt-1.5 flex items-center gap-2">
            <Button onClick={() => void test("production")} disabled={testing !== null || !(prodToken.trim() || savedHint("production"))}>{testing === "production" ? "Testing…" : "Test production token"}</Button>
          </div>
          {testResult("production")}
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

      {/* Attempts that need a person (server mode, the business's own settings). */}
      {SERVER_DB && !tenantId && server && (server.canSubmit || server.canManage) && <FbrSubmissionsPanel />}
    </div>
  );
}
