"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { isTauri, useIsTauri } from "@/lib/platform";
import { getGlobalSetting, setGlobalSetting } from "@/lib/repo/settings";
import { BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING, GEMINI_MODELS, DEFAULT_GEMINI_MODEL, testGemini } from "@/lib/gemini";
import { tenantsRepo } from "@/lib/repo/tenants";
import { getSetting } from "@/lib/repo/settings";
import { BILLORI_ENABLED_SETTING } from "@/lib/gemini";

export default function BilloriAdminPage() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL);
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [enabledCount, setEnabledCount] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const tauriReady = useIsTauri();

  useEffect(() => {
    if (!isTauri()) return;
    void Promise.all([
      getGlobalSetting(BILLORI_KEY_SETTING),
      getGlobalSetting(BILLORI_MODEL_SETTING),
    ]).then(([key, mod]) => {
      if (key) setApiKey(key);
      if (mod && GEMINI_MODELS.some((m) => m.id === mod)) setModel(mod);
    });

    void (async () => {
      const tenants = await tenantsRepo.list();
      setTotalCount(tenants.length);
      let en = 0;
      for (const t of tenants) {
        const v = await getSetting(BILLORI_ENABLED_SETTING, t.id);
        if (v !== "false") en++;
      }
      setEnabledCount(en);
    })();
  }, []);

  async function save() {
    await Promise.all([
      setGlobalSetting(BILLORI_KEY_SETTING, apiKey.trim()),
      setGlobalSetting(BILLORI_MODEL_SETTING, model),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function test() {
    setTesting(true);
    setStatus(null);
    try {
      await save();
      await testGemini();
      setStatus({ ok: true, text: "Connected to Gemini ✓" });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Billori" />

      {/* Header card */}
      <div className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow"
          style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
        >
          B
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight text-neutral-900">Billori AI Assistant</h2>
          <p className="text-sm text-neutral-500">
            Global configuration — this API key is shared by all tenants that have Billori enabled.
          </p>
        </div>
        {enabledCount !== null && totalCount !== null && (
          <div className="ml-auto text-right">
            <p className="text-2xl font-bold text-violet-600">{enabledCount}</p>
            <p className="text-xs text-neutral-400">of {totalCount} stores enabled</p>
          </div>
        )}
      </div>

      {/* Config card */}
      <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <h3 className="mb-4 text-sm font-semibold text-neutral-700">API Configuration</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Gemini API Key">
            <div className="flex gap-2">
              <Input
                type={show ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIza..."
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="shrink-0 px-2 text-xs text-neutral-500 hover:text-neutral-800"
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </Field>

          <Field label="Model">
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              {GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div
          className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
            apiKey.trim()
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${apiKey.trim() ? "bg-emerald-500" : "bg-amber-400"}`} />
          {apiKey.trim()
            ? "API key is set — all tenants with Billori enabled will use this key."
            : "No API key configured — Billori will not work for any tenant until a key is saved."}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-neutral-400">
          Get a key at <span className="font-medium text-neutral-600">aistudio.google.com/apikey</span>. Tenants can
          also supply their own key in their own Settings, which takes priority over this global one. The key powers
          the AI chatbot and auto-fills FBR product details.
        </p>

        <div className="mt-4 flex items-center justify-end gap-3 border-t border-neutral-100 pt-4">
          {status && (
            <span className={`text-xs ${status.ok ? "text-emerald-600" : "text-rose-600"}`}>{status.text}</span>
          )}
          {saved && !status && <span className="text-xs text-emerald-600">Saved ✓</span>}
          <Button disabled={!tauriReady || testing || !apiKey.trim()} onClick={() => void test()}>
            {testing ? "Testing…" : "Test Connection"}
          </Button>
          <Button variant="primary" disabled={!tauriReady} onClick={() => void save()}>
            Save Changes
          </Button>
        </div>
      </div>

      {/* Info card */}
      <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <h3 className="mb-3 text-sm font-semibold text-neutral-700">How Billori works</h3>
        <ul className="space-y-2 text-xs text-neutral-500">
          <li className="flex gap-2"><span className="text-violet-500">→</span> Each tenant controls their own enable/disable toggle in Settings.</li>
          <li className="flex gap-2"><span className="text-violet-500">→</span> If a tenant supplies their own API key in Settings, that key is used instead of this global one.</li>
          <li className="flex gap-2"><span className="text-violet-500">→</span> Tenants that are enabled but have no own key fall back to this global key automatically.</li>
          <li className="flex gap-2"><span className="text-violet-500">→</span> New tenants have Billori enabled by default — they can turn it off if they do not want it.</li>
        </ul>
      </div>
    </div>
  );
}
