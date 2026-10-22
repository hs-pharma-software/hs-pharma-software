"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { isTauri, useIsTauri } from "@/lib/platform";
import { isTursoConfigured } from "@/lib/sync/engine";
import { isCloudinaryConfigured } from "@/lib/cloudinary";
import { getSetting, setSetting } from "@/lib/repo/settings";
import { applyTheme, DEFAULT_THEME, GOOGLE_FONTS, type AppTheme } from "@/lib/theme";
import { FBR_PROVINCES } from "@/lib/fbrData";

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-600" : "bg-rose-600"}`} />
      {label}: {ok ? "Configured" : "Not configured"}
    </span>
  );
}

function ColorSwatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-neutral-300 p-0.5"
          title={label}
        />
        <span className="font-mono text-xs text-neutral-500">{value}</span>
      </div>
    </div>
  );
}

const PRESET_ACCENTS = [
  { label: "Amber",   value: "#f59e0b" },
  { label: "Blue",    value: "#3b82f6" },
  { label: "Emerald", value: "#10b981" },
  { label: "Rose",    value: "#f43f5e" },
  { label: "Violet",  value: "#8b5cf6" },
  { label: "Cyan",    value: "#06b6d4" },
  { label: "Orange",  value: "#f97316" },
  { label: "Teal",    value: "#14b8a6" },
];

const PRESET_SIDEBARS = [
  { label: "Midnight", from: "#0a0a0a", to: "#171717" },
  { label: "Navy",     from: "#0f172a", to: "#1e293b" },
  { label: "Forest",   from: "#052e16", to: "#14532d" },
  { label: "Plum",     from: "#1e1b2e", to: "#2d2446" },
  { label: "Maroon",   from: "#1c0a0a", to: "#3b0d0d" },
  { label: "Steel",    from: "#0f1923", to: "#1e2d3d" },
];

function CustomizationModal({ onClose, tauriReady }: { onClose: () => void; tauriReady: boolean }) {
  const [theme, setTheme] = useState<AppTheme>(DEFAULT_THEME);
  const [saved, setSaved] = useState(false);
  const [fontPreview, setFontPreview] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void getSetting("app_theme").then((v) => {
      if (v) {
        try { setTheme({ ...DEFAULT_THEME, ...JSON.parse(v) as AppTheme }); } catch {}
      }
    });
  }, []);

  function updateColor(key: keyof AppTheme, value: string) {
    const next = { ...theme, [key]: value };
    setTheme(next);
    applyTheme(next);
  }

  function updateFont(font: string) {
    const next = { ...theme, font };
    setTheme(next);
    applyTheme(next);
  }

  function resetTheme() {
    setTheme(DEFAULT_THEME);
    applyTheme(DEFAULT_THEME);
  }

  async function saveTheme() {
    const json = JSON.stringify(theme);
    await setSetting("app_theme", json);
    localStorage.setItem("app-theme", json);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <Modal title="-:Customization:-" onClose={onClose} width="max-w-2xl">
      <div className="space-y-5">

        {/* Accent color */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Accent Color</p>
          <div className="flex flex-wrap items-center gap-3">
            {PRESET_ACCENTS.map((p) => (
              <button
                key={p.value}
                type="button"
                title={p.label}
                onClick={() => updateColor("accent", p.value)}
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  background: p.value,
                  borderColor: theme.accent === p.value ? "#000" : "transparent",
                  boxShadow: theme.accent === p.value ? "0 0 0 1px #000" : "none",
                }}
              />
            ))}
            <ColorSwatch label="Custom" value={theme.accent} onChange={(v) => updateColor("accent", v)} />
          </div>
        </div>

        {/* Sidebar */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Sidebar Color</p>
          <div className="flex flex-wrap items-center gap-3">
            {PRESET_SIDEBARS.map((p) => (
              <button
                key={p.label}
                type="button"
                title={p.label}
                onClick={() => {
                  const next = { ...theme, sidebarFrom: p.from, sidebarTo: p.to };
                  setTheme(next);
                  applyTheme(next);
                }}
                className="flex h-8 w-16 items-center justify-center rounded border-2 text-xs font-medium text-white transition-transform hover:scale-105"
                style={{
                  background: `linear-gradient(to right, ${p.from}, ${p.to})`,
                  borderColor: theme.sidebarFrom === p.from ? "var(--accent)" : "transparent",
                }}
              >
                {p.label}
              </button>
            ))}
            <div className="flex gap-3">
              <ColorSwatch label="Top" value={theme.sidebarFrom} onChange={(v) => updateColor("sidebarFrom", v)} />
              <ColorSwatch label="Bottom" value={theme.sidebarTo} onChange={(v) => updateColor("sidebarTo", v)} />
            </div>
          </div>
        </div>

        {/* App background + modal overlay */}
        <div className="flex flex-wrap gap-6">
          <ColorSwatch label="App Background" value={theme.appBg} onChange={(v) => updateColor("appBg", v)} />
          <ColorSwatch label="Modal Overlay" value={theme.modalOverlay} onChange={(v) => updateColor("modalOverlay", v)} />
        </div>

        {/* Font */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Application Font</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-64">
              <select
                value={theme.font}
                onChange={(e) => updateFont(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none focus:border-neutral-500"
              >
                <option value="System Default">System Default (Geist)</option>
                <optgroup label="Sans-Serif">
                  {GOOGLE_FONTS.slice(0, 40).map((f) => <option key={f} value={f}>{f}</option>)}
                </optgroup>
                <optgroup label="Serif">
                  {GOOGLE_FONTS.slice(40, 60).map((f) => <option key={f} value={f}>{f}</option>)}
                </optgroup>
                <optgroup label="Display / Decorative">
                  {GOOGLE_FONTS.slice(60, 80).map((f) => <option key={f} value={f}>{f}</option>)}
                </optgroup>
                <optgroup label="Monospace">
                  {GOOGLE_FONTS.slice(80, 90).map((f) => <option key={f} value={f}>{f}</option>)}
                </optgroup>
                <optgroup label="Handwriting">
                  {GOOGLE_FONTS.slice(90).map((f) => <option key={f} value={f}>{f}</option>)}
                </optgroup>
              </select>
            </div>
            <button
              type="button"
              onClick={() => setFontPreview((v) => !v)}
              className="text-xs text-neutral-400 hover:text-neutral-700 hover:underline"
            >
              {fontPreview ? "Hide preview" : "Preview"}
            </button>
          </div>
          {fontPreview && (
            <div
              className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-neutral-800"
              style={{ fontFamily: theme.font !== "System Default" ? `"${theme.font}", sans-serif` : undefined }}
            >
              <p className="text-lg font-semibold">The quick brown fox jumps over the lazy dog</p>
              <p className="mt-1 text-sm text-neutral-500">0123456789 - Invoice #1042 | Rs 2,500.00</p>
            </div>
          )}
          {theme.font !== "System Default" && (
            <p className="mt-1 text-xs text-neutral-400">
              Fonts load from Google Fonts - requires an internet connection.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
          <button type="button" onClick={resetTheme} className="text-xs text-neutral-400 hover:text-neutral-600 hover:underline">
            Reset to defaults
          </button>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-emerald-600">Saved {"\u2713"}</span>}
            <Button type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!tauriReady} onClick={() => void saveTheme()}>
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

const PROVINCES = FBR_PROVINCES.map((p) => p.label);

function FbrSettingsCard({ tauriReady }: { tauriReady: boolean }) {
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

export default function GeneralSettingsPage() {
  const [gstRate, setGstRate] = useState("0");
  const [gstSaved, setGstSaved] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void getSetting("gst_rate_pct").then((v) => v && setGstRate(v));
  }, []);

  const tauriReady = useIsTauri();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        actions={
          <Button variant="primary" onClick={() => setCustomizeOpen(true)}>
            Customization
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2 rounded-2xl bg-white px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <StatusPill ok={isTursoConfigured()} label="Turso sync" />
        <StatusPill ok={isCloudinaryConfigured()} label="Cloudinary images" />
        <StatusPill ok={tauriReady} label="Desktop shell" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <h2 className="mb-3 font-serif text-lg text-neutral-800">Tax Rate Info</h2>
          <div className="flex items-end gap-2">
            <div className="w-40">
              <Field label="GST Rate %">
                <Input type="number" min="0" step="any" value={gstRate} onChange={(e) => setGstRate(e.target.value)} />
              </Field>
            </div>
            <Button
              variant="primary"
              disabled={!tauriReady}
              onClick={async () => {
                await setSetting("gst_rate_pct", gstRate);
                setGstSaved(true);
                setTimeout(() => setGstSaved(false), 1500);
              }}
            >
              Save Changes
            </Button>
            {gstSaved && <span className="text-xs text-emerald-600">Saved</span>}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] text-sm text-neutral-600">
          <h2 className="mb-2 font-serif text-lg text-neutral-800">Connecting Turso &amp; Cloudinary</h2>
          <p>
            Set <code>NEXT_PUBLIC_TURSO_DATABASE_URL</code>, <code>NEXT_PUBLIC_TURSO_AUTH_TOKEN</code>,{" "}
            <code>NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME</code> and{" "}
            <code>NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET</code> in <code>.env.local</code>, then restart{" "}
            <code>npm run tauri dev</code>. See the README for step-by-step setup.
          </p>
        </div>
      </div>

      {/* FBR Digital Invoicing */}
      <FbrSettingsCard tauriReady={tauriReady} />

      {customizeOpen && (
        <CustomizationModal
          onClose={() => setCustomizeOpen(false)}
          tauriReady={tauriReady}
        />
      )}
    </div>
  );
}


