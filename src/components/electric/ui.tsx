"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, FolderOpen, Mail, MessageCircle, Printer, RotateCcw, Send, Wallet, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { businessType } from "@/config/businessTypes";
import { pick, useT } from "@/lib/i18n";
import { ELECTRIC_TYPE, electric, errorText, exportPdf, openPdf, shareEmail, shareWhatsApp, showInFolder, useUrduFont } from "@/lib/electric";
import { ES_SETTINGS, type EsDoc, type EsDocItem, type EsProduct } from "@/lib/electric/store";
import { submitSaleToFbr } from "@/lib/electric/fbr";
import { loadLogo } from "@/lib/printTemplates";
import { tenantsRepo } from "@/lib/repo/tenants";
import { loadFbrSettings } from "@/lib/fbr";
import { printDirect } from "@/lib/print";
import { EsInvoice, type EsBusiness, type InvoiceLang } from "./EsInvoice";

export { useLoad, useAction } from "@/components/restaurant/ui";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayYmd = () => ymd(new Date());
export const monthStart = () => `${todayYmd().slice(0, 7)}-01`;

export const money = (n: number | null | undefined) => `Rs ${(Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** User text: Urdu script in the Nastaleeq font, anything else natural. */
export function Txt({ children, className = "" }: { children: string | null | undefined; className?: string }) {
  if (!children) return null;
  return /[؀-ۿ]/.test(children) ? (
    <span className={`font-urdu ${className}`} dir="auto">
      {children}
    </span>
  ) : (
    <bdi className={className} dir="auto">
      {children}
    </bdi>
  );
}

/** Codes, serials, phones: always left-to-right. */
export const Id = ({ children }: { children: React.ReactNode }) => (
  <bdi className="ltr-id" dir="ltr">
    {children}
  </bdi>
);

export function Note({ tone = "neutral", children }: { tone?: "neutral" | "amber" | "rose" | "emerald"; children: React.ReactNode }) {
  const cls = {
    neutral: "border-neutral-200 bg-neutral-50 text-neutral-700",
    amber: "border-amber-300 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  }[tone];
  return <div className={`rounded-xl border px-4 py-2.5 text-sm ${cls}`}>{children}</div>;
}

/** Error text in the user's language. */
export function Err({ error }: { error: string | null | undefined }) {
  const t = useT();
  return error ? <Note tone="rose">{t.err(error)}</Note> : null;
}

export function EsGuard({ children }: { children: React.ReactNode }) {
  const tauri = useIsTauri();
  const t = useT();
  const type = useAuthStore((s) => businessType(s.currentTenant?.businessType).id);
  if (!tauri) return <Note tone="amber">{t("c.desktopOnly")}</Note>;
  if (type !== ELECTRIC_TYPE) return <Note tone="amber">{t("c.wrongType")}</Note>;
  return <>{children}</>;
}

export function PageTitle({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{title}</h1>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Product search / barcode scan for this store's catalog only. */
export function ProductSearch({ onPick, autoFocus }: { onPick: (p: EsProduct) => void; autoFocus?: boolean }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<(EsProduct & { category_name: string | null })[]>([]);
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const h = setTimeout(() => void electric.listProducts({ search: q }).then((r) => setHits(r.slice(0, 12))), 150);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <div className="relative">
      <Input
        autoFocus={autoFocus}
        value={q}
        placeholder={t("c.searchProducts")}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          // Barcode scanners type the code and press Enter.
          const exact = await electric.findByCode(q);
          const p = exact ?? hits[0];
          if (p) {
            onPick(p);
            setQ("");
          }
        }}
      />
      {hits.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl bg-white shadow-lg ring-1 ring-black/10">
          {hits.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onPick(p);
                setQ("");
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-amber-50"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  <Txt>{pick(t.lang, p.name, p.name_ur)}</Txt>
                </span>
                <span className="text-[11px] text-neutral-500">
                  <Id>{p.sku}</Id> {p.model ? <>· <Id>{p.model}</Id></> : null}
                </span>
              </span>
              <span className="shrink-0 text-end text-xs">
                <span className="block font-semibold">{money(p.price)}</span>
                <span className={p.stock <= 0 ? "text-rose-600" : "text-neutral-500"}>
                  {t("p.stock")}: <Id>{p.stock}</Id> {p.unit}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Picks in-stock serial numbers of one product. */
export function SerialPicker({ productId, count, value, onChange }: { productId: string; count: number; value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    void electric.serials({ productId, status: "in_stock" }).then((r) => setList(r.map((s) => s.serial)));
  }, [productId]);
  if (!list.length) return <p className="text-[11px] text-rose-600">{t("s.noSerials")}</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((s) => {
        const on = value.includes(s);
        return (
          <button
            key={s}
            type="button"
            disabled={!on && value.length >= count}
            onClick={() => onChange(on ? value.filter((x) => x !== s) : [...value, s])}
            className={`rounded-md px-2 py-0.5 text-[11px] ring-1 disabled:opacity-40 ${on ? "bg-neutral-900 text-white ring-neutral-900" : "ring-neutral-300"}`}
          >
            <Id>{s}</Id>
          </button>
        );
      })}
      <span className="self-center text-[11px] text-neutral-500">
        <Id>
          {value.length}/{count}
        </Id>
      </span>
    </div>
  );
}

// ── Business details for documents ──
export function useBusiness(): EsBusiness {
  const tenant = useAuthStore((s) => s.currentTenant);
  const [b, setB] = useState<EsBusiness>({ name: tenant?.name ?? "" });
  useEffect(() => {
    if (!tenant?.id) return;
    void (async () => {
      const [row, logo, nameUr, addressUr, fbr] = await Promise.all([
        tenantsRepo.get(tenant.id),
        loadLogo().catch(() => null),
        electric.settings.get(ES_SETTINGS.businessNameUr),
        electric.settings.get(ES_SETTINGS.addressUr),
        loadFbrSettings().catch(() => null),
      ]);
      setB({ name: row?.name ?? tenant.name, nameUr, address: row?.address, addressUr, phone: row?.phone, ntn: fbr?.sellerNtn || null, logo });
    })();
  }, [tenant?.id, tenant?.name]);
  return b;
}

const DOC_LANG_KEY: Record<InvoiceLang, string> = { en: "lang.en", ur: "lang.ur", bi: "set.bilingual" };

/** Document viewer with print / PDF / share and follow-up actions. */
export function DocModal({ docId, onClose, onChanged }: { docId: string; onClose: () => void; onChanged?: () => void }) {
  const t = useT();
  const business = useBusiness();
  const [data, setData] = useState<{ doc: EsDoc; items: EsDocItem[] } | null>(null);
  const [lang, setLang] = useState<InvoiceLang>("en");
  const [paper, setPaper] = useState<"a4" | "thermal">("a4");
  const [terms, setTerms] = useState<{ en: string | null; ur: string | null }>({ en: null, ur: null });
  const [msg, setMsg] = useState<{ tone: "emerald" | "rose"; text: string; path?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [returning, setReturning] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const font = useUrduFont((s) => s.status);

  const load = useCallback(async () => {
    try {
      const d = await electric.invoiceForOutput(docId, "view");
      setData(d);
      const [defLang, defPaper, ten, tur] = await Promise.all([
        electric.settings.get(ES_SETTINGS.invoiceLang),
        electric.settings.get(ES_SETTINGS.invoicePaper),
        electric.settings.get(ES_SETTINGS.termsEn),
        electric.settings.get(ES_SETTINGS.termsUr),
      ]);
      setLang(((d.doc.lang as InvoiceLang) || (defLang as InvoiceLang) || "en") as InvoiceLang);
      setPaper(defPaper === "thermal" ? "thermal" : "a4");
      setTerms({ en: ten, ur: tur });
    } catch (e) {
      setMsg({ tone: "rose", text: errorText(e) });
    }
  }, [docId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: "rose", text: t.err(errorText(e)) });
    } finally {
      setBusy(false);
    }
  };

  const summary = () => {
    if (!data) return "";
    const d = data.doc;
    const ur = lang === "ur";
    const name = ur && business.nameUr ? business.nameUr : business.name;
    return [
      name,
      `${t(`inv.${d.doc_type}`)} ${t("inv.no")}: ${d.doc_no}`,
      `${t("inv.date")}: ${d.date}`,
      `${t("inv.total")}: Rs ${d.total.toLocaleString("en-PK")}`,
      d.doc_type !== "quotation" ? `${t("inv.received")}: Rs ${d.paid.toLocaleString("en-PK")}` : "",
      d.doc_type !== "quotation" && d.balance > 0 ? `${t("inv.balance")}: Rs ${d.balance.toLocaleString("en-PK")}` : "",
      t("inv.thanks"),
    ]
      .filter(Boolean)
      .join("\n");
  };

  const urduInUse = lang !== "en";
  const fileName = data ? `${data.doc.doc_type}-${data.doc.doc_no}.pdf` : "invoice.pdf";

  return (
    <Modal title={data ? `${t(`inv.${data.doc.doc_type}`)} #${data.doc.doc_no}` : t("c.loading")} onClose={onClose} width="max-w-5xl">
      {!data ? (
        <Err error={msg?.text} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("s.invoiceLang")}>
              <Select value={lang} onChange={(e) => setLang(e.target.value as InvoiceLang)}>
                {(Object.keys(DOC_LANG_KEY) as InvoiceLang[]).map((l) => (
                  <option key={l} value={l}>
                    {t(DOC_LANG_KEY[l])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("set.paper")}>
              <Select value={paper} onChange={(e) => setPaper(e.target.value as "a4" | "thermal")}>
                <option value="a4">A4</option>
                <option value="thermal">Thermal 80 mm</option>
              </Select>
            </Field>
            <div className="ms-auto flex flex-wrap gap-1.5">
              <Button disabled={busy} onClick={() => run(async () => {
                await electric.invoiceForOutput(docId, "print");
                await printDirect(paper, area.current);
              })}>
                <Printer size={14} /> {t("c.print")}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (urduInUse && font !== "loaded" && (await electric.settings.get(ES_SETTINGS.requireJameel)) === "true") {
                      throw new Error("Jameel Noori Nastaleeq is not loaded on this computer (Store Settings > Urdu font). PDF export is blocked by your setting.");
                    }
                    await electric.invoiceForOutput(docId, "pdf");
                    const path = await exportPdf(fileName, paper, area.current);
                    if (path) setMsg({ tone: "emerald", text: path, path });
                  })
                }
              >
                <FileDown size={14} /> {t("c.downloadPdf")}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await electric.invoiceForOutput(docId, "share_whatsapp");
                    const cc = (await electric.settings.get(ES_SETTINGS.whatsappCc)) || "92";
                    await shareWhatsApp(data.doc.party_phone, cc, summary());
                  })
                }
              >
                <MessageCircle size={14} /> {t("c.whatsapp")}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await electric.invoiceForOutput(docId, "share_email");
                    await shareEmail(`${t(`inv.${data.doc.doc_type}`)} #${data.doc.doc_no}`, summary());
                  })
                }
              >
                <Mail size={14} /> {t("c.email")}
              </Button>
            </div>
          </div>
          {urduInUse && font !== "loaded" && (
            <Note tone="amber">
              {t.lang === "ur"
                ? "جمیل نوری نستعلیق اس کمپیوٹر پر موجود نہیں؛ متبادل فونٹ Noto Nastaliq Urdu استعمال ہو رہا ہے۔ (اسٹور کی ترتیبات > اردو فونٹ)"
                : "Jameel Noori Nastaleeq is not loaded on this computer; the bundled Noto Nastaliq Urdu is used instead (Store Settings > Urdu font)."}
            </Note>
          )}
          {msg && (
            <Note tone={msg.tone}>
              {msg.path ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Id>{msg.path}</Id>
                  <button type="button" className="underline" onClick={() => void openPdf(msg.path!)}>
                    {t("s.openDoc")}
                  </button>
                  <button type="button" className="flex items-center gap-1 underline" onClick={() => void showInFolder(msg.path!)}>
                    <FolderOpen size={12} />
                  </button>
                </span>
              ) : (
                msg.text
              )}
            </Note>
          )}
          <div className="flex flex-wrap gap-1.5">
            {(data.doc.doc_type === "sale" || data.doc.doc_type === "purchase") && data.doc.balance > 0 && data.doc.party_id && (
              <Button onClick={() => setPaying(true)}>
                <Wallet size={14} /> {data.doc.doc_type === "sale" ? t("pay.receive") : t("pay.makePayment")}
              </Button>
            )}
            {(data.doc.doc_type === "sale" || data.doc.doc_type === "purchase") && (
              <Button onClick={() => setReturning(true)}>
                <RotateCcw size={14} /> {t("s.returnItems")}
              </Button>
            )}
            {data.doc.doc_type === "sale" && !data.doc.fbr_invoice_no && (
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await submitSaleToFbr(docId);
                    setMsg({ tone: r.ok ? "emerald" : "rose", text: r.ok ? `${t("s.fbrNo")}: ${r.fbrNo}` : r.error ?? "FBR error" });
                    await load();
                  })
                }
              >
                <Send size={14} /> {t("s.fbrSubmit")}
              </Button>
            )}
            {data.doc.doc_type === "quotation" && data.doc.status === "final" && <ConvertButton quotationId={docId} onDone={(id) => { onChanged?.(); setMsg(null); void id; onClose(); }} />}
          </div>
          <div className="overflow-x-auto rounded-xl bg-neutral-100 p-3">
            <div ref={area} className="print-area mx-auto w-fit bg-white p-4 print:p-0">
              <EsInvoice doc={data.doc} items={data.items} business={business} lang={lang} paper={paper} terms={terms} />
            </div>
          </div>
        </div>
      )}
      {paying && data && <PaymentModal doc={data.doc} onClose={() => setPaying(false)} onDone={() => { setPaying(false); void load(); onChanged?.(); }} />}
      {returning && data && <ReturnModal doc={data.doc} items={data.items} onClose={() => setReturning(false)} onDone={() => { setReturning(false); void load(); onChanged?.(); }} />}
    </Modal>
  );
}

function ConvertButton({ quotationId, onDone }: { quotationId: string; onDone: (saleId: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: EsDocItem[]; doc: EsDoc } | null>(null);
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<"cash" | "card" | "bank" | "digital">("cash");
  const [error, setError] = useState<string | null>(null);
  const [tracked, setTracked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!open) return;
    void electric.getDoc(quotationId).then(async (d) => {
      setData(d);
      const m: Record<string, boolean> = {};
      for (const i of d.items) m[i.id] = !!(await electric.getProduct(i.product_id!).catch(() => null))?.serial_tracked;
      setTracked(m);
    });
  }, [open, quotationId]);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>{t("s.convert")}</Button>
      {open && data && (
        <Modal title={t("s.convert")} onClose={() => setOpen(false)} width="max-w-xl">
          <div className="space-y-3">
            {data.items.filter((i) => tracked[i.id]).map((i) => (
              <div key={i.id}>
                <p className="text-sm font-medium"><Txt>{i.name}</Txt> × <Id>{i.base_qty}</Id></p>
                <SerialPicker productId={i.product_id!} count={i.base_qty} value={serials[i.id] ?? []} onChange={(v) => setSerials({ ...serials, [i.id]: v })} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("pay.received")}><Input type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={String(data.doc.total)} /></Field>
              <Field label={t("pay.method")}>
                <Select value={method} onChange={(e) => setMethod(e.target.value as never)}>
                  {(["cash", "card", "bank", "digital"] as const).map((m) => <option key={m} value={m}>{t(`pay.${m}`)}</option>)}
                </Select>
              </Field>
            </div>
            <Err error={error} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{t("c.cancel")}</Button>
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    const r = await electric.convertQuotation(quotationId, { serials, payments: Number(paid) > 0 ? [{ method, amount: Number(paid) }] : [] });
                    setOpen(false);
                    onDone(r.doc.id);
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                {t("c.save")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function PaymentModal({ doc, onClose, onDone }: { doc: EsDoc; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [amount, setAmount] = useState(String(doc.balance));
  const [method, setMethod] = useState<"cash" | "card" | "bank" | "digital" | "cheque">("cash");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={doc.doc_type === "sale" ? t("pay.receive") : t("pay.makePayment")} onClose={onClose} width="max-w-sm">
      <div className="space-y-3">
        <p className="text-sm">{t("pay.balance")}: <b>{money(doc.balance)}</b></p>
        <Field label={t("c.amount")}><Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t("pay.method")}>
          <Select value={method} onChange={(e) => setMethod(e.target.value as never)}>
            {(["cash", "card", "bank", "digital", "cheque"] as const).map((m) => <option key={m} value={m}>{t(`pay.${m}`)}</option>)}
          </Select>
        </Field>
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("c.cancel")}</Button>
          <Button variant="primary" onClick={async () => {
            try {
              await electric.receivePayment({ partyType: doc.doc_type === "sale" ? "customer" : "supplier", partyId: doc.party_id!, amount: Number(amount), method, docId: doc.id });
              onDone();
            } catch (e) {
              setError(errorText(e));
            }
          }}>{t("c.save")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ReturnModal({ doc, items, onClose, onDone }: { doc: EsDoc; items: EsDocItem[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState("");
  const [method, setMethod] = useState<"cash" | "card" | "bank" | "digital">("cash");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t("s.returnItems")} onClose={onClose} width="max-w-2xl">
      <div className="space-y-3">
        {items.map((i) => {
          const left = Math.round((i.qty - i.returned_qty) * 1000) / 1000;
          const list = i.serials ? (JSON.parse(i.serials) as string[]) : [];
          return (
            <div key={i.id} className="rounded-lg border border-neutral-200 p-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1 font-medium"><Txt>{pick(t.lang, i.name, i.name_ur)}</Txt></span>
                <span className="text-xs text-neutral-500">{t("s.returnable")}: <Id>{left}</Id> {i.unit}</span>
                <Input type="number" min="0" max={left} step="any" className="!w-24" value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />
              </div>
              {list.length > 0 && Number(qty[i.id]) > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {list.map((s) => {
                    const on = (serials[i.id] ?? []).includes(s);
                    return (
                      <button key={s} type="button" onClick={() => setSerials({ ...serials, [i.id]: on ? (serials[i.id] ?? []).filter((x) => x !== s) : [...(serials[i.id] ?? []), s] })} className={`rounded-md px-2 py-0.5 text-[11px] ring-1 ${on ? "bg-neutral-900 text-white" : "ring-neutral-300"}`}>
                        <Id>{s}</Id>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div className="grid grid-cols-3 gap-2">
          <Field label={t("c.reason")} required><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label={t("pay.refund")}><Input type="number" min="0" value={refund} onChange={(e) => setRefund(e.target.value)} /></Field>
          <Field label={t("pay.method")}>
            <Select value={method} onChange={(e) => setMethod(e.target.value as never)}>
              {(["cash", "card", "bank", "digital"] as const).map((m) => <option key={m} value={m}>{t(`pay.${m}`)}</option>)}
            </Select>
          </Field>
        </div>
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}><X size={14} /> {t("c.cancel")}</Button>
          <Button variant="danger" onClick={async () => {
            try {
              await electric.createReturn({
                originalId: doc.id,
                lines: Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([itemId, v]) => ({ itemId, qty: Number(v), serials: serials[itemId] ?? [] })),
                reason,
                refund: Number(refund) > 0 ? { method, amount: Number(refund) } : null,
              });
              onDone();
            } catch (e) {
              setError(errorText(e));
            }
          }}>{t("s.return")}</Button>
        </div>
      </div>
    </Modal>
  );
}
