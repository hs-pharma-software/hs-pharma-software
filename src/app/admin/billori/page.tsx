"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { isTauri, useIsTauri } from "@/lib/platform";
import { getGlobalSetting, setGlobalSetting, getSetting } from "@/lib/repo/settings";
import {
  BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING, BILLORI_ENABLED_SETTING,
  GEMINI_MODELS, DEFAULT_GEMINI_MODEL, testGemini,
  AI_PROVIDER_SETTING, OPENAI_KEY_SETTING, OPENAI_MODEL_SETTING, OPENAI_MODELS, DEFAULT_OPENAI_MODEL,
} from "@/lib/gemini";
import { tenantsRepo } from "@/lib/repo/tenants";

export default function BilloriAdminPage() {
  const [provider, setProvider] = useState<"openai" | "gemini">("openai");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState(DEFAULT_OPENAI_MODEL);
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
      getGlobalSetting(AI_PROVIDER_SETTING),
      getGlobalSetting(OPENAI_KEY_SETTING),
      getGlobalSetting(OPENAI_MODEL_SETTING),
    ]).then(([key, mod, prov, oKey, oMod]) => {
      if (key) setApiKey(key);
      if (mod && GEMINI_MODELS.some((m) => m.id === mod)) setModel(mod);
      if (oKey) setOpenaiKey(oKey);
      if (oMod) setOpenaiModel(oMod);
      setProvider(prov === "gemini" ? "gemini" : prov === "openai" ? "openai" : key && !oKey ? "gemini" : "openai");
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
      setGlobalSetting(AI_PROVIDER_SETTING, provider),
      setGlobalSetting(OPENAI_KEY_SETTING, openaiKey.trim()),
      setGlobalSetting(OPENAI_MODEL_SETTING, openaiModel.trim() || DEFAULT_OPENAI_MODEL),
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
      setStatus({ ok: true, text: `Connected to ${provider === "openai" ? "ChatGPT" : "Gemini"} ✓` });
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

        <Field label="AI service">
          <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm">
            {([["openai", "ChatGPT (OpenAI)"], ["gemini", "Gemini (Google)"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setProvider(k)} className={`flex-1 px-3 py-1.5 ${provider === k ? "bg-violet-600 text-white" : "bg-white text-neutral-600"}`}>{l}</button>
            ))}
          </div>
        </Field>

        {provider === "openai" ? (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="ChatGPT (OpenAI) API Key">
              <div className="flex gap-2">
                <Input type={show ? "text" : "password"} value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} placeholder="sk-..." autoComplete="off" />
                <button type="button" onClick={() => setShow((v) => !v)} className="shrink-0 px-2 text-xs text-neutral-500 hover:text-neutral-800">{show ? "Hide" : "Show"}</button>
              </div>
            </Field>
            <Field label="Model">
              <Input list="openai-models" value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)} placeholder={DEFAULT_OPENAI_MODEL} />
              <datalist id="openai-models">{OPENAI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
            </Field>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Gemini API Key">
              <div className="flex gap-2">
                <Input type={show ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIza..." autoComplete="off" />
                <button type="button" onClick={() => setShow((v) => !v)} className="shrink-0 px-2 text-xs text-neutral-500 hover:text-neutral-800">{show ? "Hide" : "Show"}</button>
              </div>
            </Field>
            <Field label="Model">
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {GEMINI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </Select>
            </Field>
          </div>
        )}

        {(() => {
          const key = provider === "openai" ? openaiKey : apiKey;
          return (
            <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${key.trim() ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              <span className={`h-2 w-2 rounded-full ${key.trim() ? "bg-emerald-500" : "bg-amber-400"}`} />
              {key.trim()
                ? `${provider === "openai" ? "ChatGPT" : "Gemini"} key is set: the assistant and the product autofills of every business with Billori enabled use it.`
                : "No key for this service yet: AI features will not work until a key is saved."}
            </div>
          );
        })()}

        <p className="mt-3 text-xs leading-relaxed text-neutral-400">
          {provider === "openai"
            ? <>Create a key at <span className="font-medium text-neutral-600">platform.openai.com/api-keys</span> and add credit under Billing. ChatGPT powers the assistant, the FBR details and the product categories (it can search the web for a category).</>
            : <>Get a key at <span className="font-medium text-neutral-600">aistudio.google.com/apikey</span>. A business can also save its own Gemini key in its Settings.</>}
        </p>

        <div className="mt-4 flex items-center justify-end gap-3 border-t border-neutral-100 pt-4">
          {status && (
            <span className={`text-xs ${status.ok ? "text-emerald-600" : "text-rose-600"}`}>{status.text}</span>
          )}
          {saved && !status && <span className="text-xs text-emerald-600">Saved ✓</span>}
          <Button disabled={!tauriReady || testing || !(provider === "openai" ? openaiKey : apiKey).trim()} onClick={() => void test()}>
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
