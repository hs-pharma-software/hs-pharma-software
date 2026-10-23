"use client";

import { useEffect, useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { useT } from "@/lib/i18n";
import { electric, errorText, installUrduFont, removeUrduFont, useUrduFont } from "@/lib/electric";
import { DEFAULT_UNITS, ES_SETTINGS } from "@/lib/electric/store";
import { changeLanguage } from "@/components/electric/LanguageSync";
import { Err, EsGuard, Note, PageTitle } from "@/components/electric/ui";

export default function StoreSettingsPage() {
  return (
    <EsGuard>
      <StoreSettings />
    </EsGuard>
  );
}

const KEYS = Object.values(ES_SETTINGS);

function StoreSettings() {
  const t = useT();
  const [v, setV] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const font = useUrduFont();

  useEffect(() => {
    void Promise.all(KEYS.map(async (k) => [k, (await electric.settings.get(k)) ?? ""] as const)).then((pairs) => setV(Object.fromEntries(pairs)));
  }, []);

  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  const save = async (keys: string[]) => {
    setMsg(null);
    try {
      for (const k of keys) await electric.settings.set(k, v[k] ?? "");
      setMsg({ ok: true, text: t("c.saved") });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const card = (title: string, keys: string[], body: React.ReactNode) => (
    <section className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-black/5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {body}
      {keys.length > 0 && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => void save(keys)}>{t("c.save")}</Button>
        </div>
      )}
    </section>
  );

  return (
    <div className="max-w-4xl space-y-4">
      <PageTitle title={t("set.title")} />
      {msg && (msg.ok ? <Note tone="emerald">{msg.text}</Note> : <Err error={msg.text} />)}

      {card(
        t("set.language"),
        [],
        <div className="flex gap-2">
          {(["en", "ur"] as const).map((l) => (
            <Button key={l} variant={t.lang === l ? "primary" : "secondary"} onClick={() => void changeLanguage(l)}>
              {t(`lang.${l}`)}
            </Button>
          ))}
        </div>
      )}

      {card(
        t("set.invoice"),
        [ES_SETTINGS.invoiceLang, ES_SETTINGS.invoicePaper, ES_SETTINGS.businessNameUr, ES_SETTINGS.addressUr, ES_SETTINGS.termsEn, ES_SETTINGS.termsUr, ES_SETTINGS.whatsappCc],
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t("set.invoiceLang")}>
            <Select value={v[ES_SETTINGS.invoiceLang] || "en"} onChange={(e) => set(ES_SETTINGS.invoiceLang, e.target.value)}>
              <option value="en">{t("lang.en")}</option>
              <option value="ur">{t("lang.ur")}</option>
              <option value="bi">{t("set.bilingual")}</option>
            </Select>
          </Field>
          <Field label={t("set.paper")}>
            <Select value={v[ES_SETTINGS.invoicePaper] || "a4"} onChange={(e) => set(ES_SETTINGS.invoicePaper, e.target.value)}>
              <option value="a4">A4</option>
              <option value="thermal">Thermal 80 mm</option>
            </Select>
          </Field>
          <Field label={t("set.nameUr")}>
            <Input className="font-urdu" dir="rtl" value={v[ES_SETTINGS.businessNameUr] ?? ""} onChange={(e) => set(ES_SETTINGS.businessNameUr, e.target.value)} />
          </Field>
          <Field label={t("set.addressUr")}>
            <Input className="font-urdu" dir="rtl" value={v[ES_SETTINGS.addressUr] ?? ""} onChange={(e) => set(ES_SETTINGS.addressUr, e.target.value)} />
          </Field>
          <Field label={t("set.terms")}>
            <Textarea rows={3} value={v[ES_SETTINGS.termsEn] ?? ""} onChange={(e) => set(ES_SETTINGS.termsEn, e.target.value)} />
          </Field>
          <Field label={t("set.termsUr")}>
            <Textarea rows={3} className="font-urdu" dir="rtl" value={v[ES_SETTINGS.termsUr] ?? ""} onChange={(e) => set(ES_SETTINGS.termsUr, e.target.value)} />
          </Field>
          <Field label={t("set.whatsappCc")}>
            <Input dir="ltr" value={v[ES_SETTINGS.whatsappCc] || "92"} onChange={(e) => set(ES_SETTINGS.whatsappCc, e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>
      )}

      {card(
        t("set.stock"),
        [ES_SETTINGS.allowNegative, ES_SETTINGS.qtyDecimals, ES_SETTINGS.defaultTax, ES_SETTINGS.units],
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={v[ES_SETTINGS.allowNegative] === "true"} onChange={(e) => set(ES_SETTINGS.allowNegative, e.target.checked ? "true" : "false")} /> {t("set.negative")}
          </label>
          <Field label={t("set.decimals")}>
            <Select value={v[ES_SETTINGS.qtyDecimals] || "3"} onChange={(e) => set(ES_SETTINGS.qtyDecimals, e.target.value)}>
              {["0", "1", "2", "3"].map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label={t("set.defaultTax")}>
            <Input type="number" min="0" step="any" value={v[ES_SETTINGS.defaultTax] ?? ""} onChange={(e) => set(ES_SETTINGS.defaultTax, e.target.value)} />
          </Field>
          <div className="md:col-span-2">
            <Field label={t("set.units")}>
              <Input dir="ltr" value={v[ES_SETTINGS.units] ?? ""} placeholder={DEFAULT_UNITS.join(", ")} onChange={(e) => set(ES_SETTINGS.units, e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      {card(
        t("set.font"),
        [ES_SETTINGS.requireJameel],
        <div className="space-y-3 text-sm">
          <Note tone={font.status === "loaded" ? "emerald" : "amber"}>
            {font.status === "loaded" ? t("set.fontLoaded") : t("set.fontMissing")}
            {font.detail && <span className="block text-xs opacity-80">{font.detail}</span>}
          </Note>
          <p className="text-xs text-neutral-500">{t("set.fontLicense")}</p>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-medium ring-1 ring-black/10 hover:bg-neutral-50">
              <Upload size={14} /> {t("set.fontUpload")}
              <input
                type="file"
                accept=".ttf,.otf,font/ttf,font/otf"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setMsg(null);
                  try {
                    await installUrduFont(file);
                    setMsg({ ok: true, text: t("set.fontLoaded") });
                  } catch (err) {
                    setMsg({ ok: false, text: errorText(err) });
                  }
                }}
              />
            </label>
            {font.status === "loaded" && (
              <Button onClick={() => void removeUrduFont().then(() => setMsg({ ok: true, text: t("c.saved") }))}>
                <X size={14} /> {t("set.fontRemove")}
              </Button>
            )}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={v[ES_SETTINGS.requireJameel] === "true"} onChange={(e) => set(ES_SETTINGS.requireJameel, e.target.checked ? "true" : "false")} /> {t("set.requireJameel")}
          </label>
          <p className="font-urdu text-2xl leading-loose" dir="rtl">
            سولر انورٹر، بیٹری اور کیبل — اردو نستعلیق کا نمونہ ۱۲۳۴
          </p>
        </div>
      )}
    </div>
  );
}
