"use client";

import { useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, CaseUpper, Eye, EyeOff, GripVertical, ImagePlus, Italic, Pencil, RotateCcw, Trash2, Underline } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { InvoicePrintLayout, type PrintData } from "@/components/print/InvoicePrintLayout";
import {
  BLOCK_LABELS,
  BLOCK_TEXTS,
  DEFAULT_TEMPLATES,
  PAPERS,
  PRINT_STYLES,
  THEME_PRESETS,
  loadLogo,
  loadTemplate,
  resizeLogo,
  saveLogo,
  saveTemplate,
  type Align,
  type BlockConfig,
  type BlockId,
  type BlockSize,
  type PaperSize,
  type PrintTemplate,
} from "@/lib/printTemplates";
import { useAuthStore } from "@/store/authStore";
import { tenantsRepo } from "@/lib/repo/tenants";
import { getSetting } from "@/lib/repo/settings";
import { isTauri } from "@/lib/platform";

function sampleData(business: PrintData["business"], logo: string | null): PrintData {
  return {
    business,
    logo,
    title: "INVOICE",
    number: "#1024",
    returnOf: null,
    date: new Date().toISOString().slice(0, 10),
    payment: "Cash",
    invoiceType: "Retail",
    salesman: "Ali",
    customer: { name: "Walk-in Customer", phone: "0300 1234567", ntn: null, address: null },
    items: [
      { id: "1", name: "Panadol 500mg Tablet", hsCode: "3004.9092", batch: "PN2401", qty: "20 Tab", bonus: null, price: 2.5, discountPct: 0, taxPct: 0, taxRs: 0, total: 50 },
      { id: "2", name: "Augmentin 625mg Tablet", hsCode: "3004.1090", batch: "AG1187", qty: "6 Tab", bonus: null, price: 48, discountPct: 5, taxPct: 0, taxRs: 0, total: 273.6 },
      { id: "3", name: "Mechico Feeder 250ml", hsCode: "3924.9000", batch: null, qty: "1", bonus: "1", price: 350, discountPct: 0, taxPct: 18, taxRs: 63, total: 413 },
    ],
    totals: { total: 688, discount: 14.4, tax: 63, charges: 0, payable: 736.6, paid: 750, balance: -13.4 },
    note: "Keep medicines away from children.",
    fbrInvoiceNo: "1234567DI1700000000000",
  };
}

/** Print template editor: one tab per paper size, drag blocks to reorder
 * (in the list or directly on the preview), click a block to style it.
 * `tenantId` edits another pharmacy's templates (Super Admin). */
export function PrintTemplatesModal({ onClose, tenantId }: { onClose: () => void; tenantId?: string }) {
  const [paper, setPaper] = useState<PaperSize>("a4");
  const [templates, setTemplates] = useState<Partial<Record<PaperSize, PrintTemplate>>>({});
  const [dirty, setDirty] = useState<Set<PaperSize>>(new Set());
  const [logo, setLogo] = useState<string | null>(null);
  const [business, setBusiness] = useState<PrintData["business"]>({ name: "Your Pharmacy", address: null, phone: null, ntn: null, stn: null, pra: null });
  const [selected, setSelected] = useState<BlockId | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dragId = useRef<BlockId | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sessionTenant = useAuthStore((s) => s.currentTenant);

  useEffect(() => {
    if (!isTauri()) return;
    void Promise.all(PAPERS.map((p) => loadTemplate(p.id, tenantId))).then((list) =>
      setTemplates(Object.fromEntries(list.map((t) => [t.paper, t])))
    );
    void loadLogo(tenantId).then(setLogo);
    void (async () => {
      const id = tenantId ?? sessionTenant?.id;
      const [tenant, ntn] = await Promise.all([
        id ? tenantsRepo.get(id) : Promise.resolve(null),
        getSetting("fbr_seller_ntn", tenantId),
      ]);
      setBusiness({
        name: tenant?.name ?? sessionTenant?.name ?? "Your Pharmacy",
        address: tenant?.address ?? null,
        phone: tenant?.phone ?? null,
        ntn: (ntn ?? "").replace(/[s-]/g, "") || null,
        stn: null,
        pra: null,
      });
    })();
  }, [tenantId, sessionTenant?.id, sessionTenant?.name]);

  const tpl = templates[paper];

  function update(fn: (t: PrintTemplate) => PrintTemplate) {
    if (!tpl) return;
    setTemplates((prev) => ({ ...prev, [paper]: fn(structuredClone(tpl)) }));
    setDirty((prev) => new Set(prev).add(paper));
    setMessage(null);
  }

  function moveBlock(from: BlockId, to: BlockId) {
    if (from === to) return;
    update((t) => {
      const i = t.blocks.findIndex((x) => x.id === from);
      const j = t.blocks.findIndex((x) => x.id === to);
      const [blk] = t.blocks.splice(i, 1);
      t.blocks.splice(j, 0, blk);
      return t;
    });
  }

  function setBlock(id: BlockId, patch: Partial<BlockConfig>) {
    update((t) => ({ ...t, blocks: t.blocks.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  }

  function setLabel(id: BlockId, key: string, value: string) {
    update((t) => ({ ...t, blocks: t.blocks.map((x) => (x.id === id ? { ...x, labels: { ...x.labels, [key]: value } } : x)) }));
  }

  /** Opens the section's text fields (pencil button). */
  function editText(id: BlockId) {
    setSelected(id);
    setTimeout(() => document.getElementById(`blk-text-${id}-0`)?.focus(), 0);
  }

  async function handleLogo(file: File | undefined) {
    if (!file) return;
    try {
      const data = await resizeLogo(file);
      await saveLogo(data, tenantId);
      setLogo(data);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      for (const p of dirty) {
        const t = templates[p];
        if (t) await saveTemplate(t, tenantId);
      }
      setDirty(new Set());
      setMessage("Templates saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (dirty.size > 0 && !window.confirm("You have unsaved template changes. Close anyway?")) return;
    onClose();
  }

  const sel = tpl?.blocks.find((x) => x.id === selected) ?? null;
  const styleBtn = (key: "bold" | "italic" | "underline" | "uppercase", Icon: typeof Bold, title: string) => (
    <button
      key={key}
      type="button"
      title={title}
      aria-pressed={Boolean(sel?.[key])}
      onClick={() => sel && setBlock(sel.id, { [key]: !sel[key] })}
      className={`rounded-md p-1.5 ${sel?.[key] ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
    >
      <Icon size={14} />
    </button>
  );
  const alignBtn = (a: Align, Icon: typeof AlignLeft) => (
    <button
      key={a}
      type="button"
      title={`Align ${a}`}
      onClick={() => sel && setBlock(sel.id, { align: a })}
      className={`rounded-md p-1.5 ${sel?.align === a ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
    >
      <Icon size={14} />
    </button>
  );

  return (
    <Modal title="Print Templates" onClose={handleClose} width="max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
          {PAPERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPaper(p.id);
                setSelected(null);
              }}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${paper === p.id ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
            >
              {p.label}
              {dirty.has(p.id) ? " •" : ""}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {message && <span className="text-xs text-emerald-700">{message}</span>}
          <Button
            onClick={() => {
              if (window.confirm(`Reset the ${PAPERS.find((p) => p.id === paper)!.label} template to the default layout?`))
                update(() => structuredClone(DEFAULT_TEMPLATES[paper]));
            }}
          >
            Reset to Default
          </Button>
          <Button variant="primary" disabled={saving || dirty.size === 0} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      {!tpl ? (
        <p className="py-10 text-center text-sm text-neutral-400">
          {isTauri() ? "Loading..." : "Run inside the desktop app to edit print templates."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
          {/* ── Controls ── */}
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-neutral-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Pharmacy logo</p>
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-24 items-center justify-center overflow-hidden rounded-lg bg-neutral-50 ring-1 ring-neutral-200">
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="Logo" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-neutral-400">No logo</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <Button onClick={() => fileRef.current?.click()}>
                    <ImagePlus size={14} className="mr-1 inline" /> {logo ? "Change" : "Upload"}
                  </Button>
                  {logo && (
                    <button
                      type="button"
                      onClick={async () => {
                        await saveLogo(null, tenantId);
                        setLogo(null);
                      }}
                      className="flex items-center gap-1 text-xs text-rose-600 hover:underline"
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void handleLogo(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="mt-2 text-[11px] text-neutral-400">Shared by all three templates.</p>
            </div>

            {paper === "thermal" ? (
              <p className="rounded-xl border border-neutral-200 p-3 text-[11px] text-neutral-500">
                Thermal printers print black only, so this template has no colours.
              </p>
            ) : (
              <div className="rounded-xl border border-neutral-200 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Design ({PRINT_STYLES.length}) &amp; colours
                </p>
                {/* Live thumbnails: each design in its own starting colours. */}
                <div className="mb-3 grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1">
                  {PRINT_STYLES.map((st) => {
                    const active = tpl.theme.style === st.id;
                    const widthPx = PAPERS.find((p) => p.id === paper)!.widthMm * 3.78;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        title={st.hint}
                        onClick={() => update((t) => ({ ...t, theme: { style: st.id, primary: st.primary, accent: st.accent } }))}
                        className={`overflow-hidden rounded-lg bg-white text-left ring-2 transition ${active ? "ring-neutral-900" : "ring-neutral-200 hover:ring-neutral-400"}`}
                      >
                        <div className="pointer-events-none h-28 overflow-hidden bg-white">
                          <div style={{ width: widthPx, transform: `scale(${124 / widthPx})`, transformOrigin: "top left", padding: 12 }}>
                            <InvoicePrintLayout
                              template={{ ...tpl, theme: { style: st.id, primary: st.primary, accent: st.accent } }}
                              data={sampleData(business, logo)}
                            />
                          </div>
                        </div>
                        <p className={`truncate border-t border-neutral-100 px-1.5 py-1 text-[10px] font-medium ${active ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>
                          {st.label}
                        </p>
                      </button>
                    );
                  })}
                </div>
                {tpl.theme.style !== "plain" && (
                  <>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {THEME_PRESETS.map((preset) => {
                        const on = tpl.theme.primary === preset.primary && tpl.theme.accent === preset.accent;
                        return (
                          <button
                            key={preset.name}
                            type="button"
                            title={preset.name}
                            onClick={() => update((t) => ({ ...t, theme: { ...t.theme, primary: preset.primary, accent: preset.accent } }))}
                            className={`flex h-7 w-10 overflow-hidden rounded-md ring-2 ${on ? "ring-neutral-900" : "ring-transparent hover:ring-neutral-300"}`}
                          >
                            <span className="flex-[2]" style={{ background: preset.primary }} />
                            <span className="flex-1" style={{ background: preset.accent }} />
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(["primary", "accent"] as const).map((key) => (
                        <label key={key} className="flex items-center gap-2 rounded-lg bg-neutral-50 px-2 py-1.5 text-xs text-neutral-700 ring-1 ring-neutral-200">
                          <input
                            type="color"
                            value={tpl.theme[key]}
                            onChange={(e) => update((t) => ({ ...t, theme: { ...t.theme, [key]: e.target.value } }))}
                            className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                          />
                          {key === "primary" ? "Banner colour" : "Line colour"}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="rounded-xl border border-neutral-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Sections (drag to reorder)</p>
              <div className="space-y-1">
                {tpl.blocks.map((blk) => (
                  <div
                    key={blk.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      dragId.current = blk.id;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragId.current) moveBlock(dragId.current, blk.id);
                      dragId.current = null;
                    }}
                    onClick={() => setSelected(blk.id)}
                    className={`flex cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 ${selected === blk.id ? "bg-[#006633]/10 ring-1 ring-[#006633]/30" : "hover:bg-neutral-50"}`}
                  >
                    <GripVertical size={14} className="shrink-0 text-neutral-400" />
                    <span className={`flex-1 truncate ${blk.visible ? "text-neutral-800" : "text-neutral-400 line-through"}`}>
                      {BLOCK_LABELS[blk.id]}
                    </span>
                    {(BLOCK_TEXTS[blk.id] || blk.id === "thanks") && (
                      <button
                        type="button"
                        title="Edit text"
                        aria-label={`Edit text of ${BLOCK_LABELS[blk.id]}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          editText(blk.id);
                        }}
                        className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      title={blk.visible ? "Hide" : "Show"}
                      onClick={(e) => {
                        e.stopPropagation();
                        setBlock(blk.id, { visible: !blk.visible });
                      }}
                      className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                    >
                      {blk.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {sel && (
              <div className="rounded-xl border border-[#006633]/30 bg-[#006633]/[0.03] p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#006633]">{BLOCK_LABELS[sel.id]}</p>
                <div className="flex items-center gap-3">
                  <div className="flex gap-0.5">
                    {alignBtn("left", AlignLeft)}
                    {alignBtn("center", AlignCenter)}
                    {alignBtn("right", AlignRight)}
                  </div>
                  <div className="flex gap-0.5 rounded-md bg-white p-0.5 ring-1 ring-neutral-200 text-xs">
                    {(["sm", "md", "lg"] as BlockSize[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setBlock(sel.id, { size: s })}
                        className={`rounded px-2 py-0.5 ${sel.size === s ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
                      >
                        {s === "sm" ? "Small" : s === "md" ? "Normal" : "Large"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="flex gap-0.5 rounded-md bg-white p-0.5 ring-1 ring-neutral-200">
                    {styleBtn("bold", Bold, "Bold")}
                    {styleBtn("italic", Italic, "Italic")}
                    {styleBtn("underline", Underline, "Underline")}
                    {styleBtn("uppercase", CaseUpper, "CAPITAL LETTERS")}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-neutral-600" title="Text colour">
                    <input
                      type="color"
                      value={sel.color ?? "#111111"}
                      onChange={(e) => setBlock(sel.id, { color: e.target.value })}
                      className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    Text colour
                  </label>
                  {(sel.bold || sel.italic || sel.underline || sel.uppercase || sel.color) && (
                    <button
                      type="button"
                      onClick={() => setBlock(sel.id, { bold: false, italic: false, underline: false, uppercase: false, color: null })}
                      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                    >
                      <RotateCcw size={12} />
                      Plain text
                    </button>
                  )}
                </div>
                {BLOCK_TEXTS[sel.id] && (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-xs font-semibold text-neutral-600">Text</p>
                      {sel.labels && Object.values(sel.labels).some((v) => v.trim()) && (
                        <button
                          type="button"
                          onClick={() => setBlock(sel.id, { labels: {} })}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
                        >
                          <RotateCcw size={12} />
                          Default text
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {BLOCK_TEXTS[sel.id]!.map((t, i) => (
                        <div key={t.key} className={t.text.length > 24 || t.key === "title" ? "col-span-2" : ""}>
                          <Field label={t.label}>
                            <Input
                              id={`blk-text-${sel.id}-${i}`}
                              value={sel.labels?.[t.key] ?? ""}
                              placeholder={t.text || "Automatic"}
                              onChange={(e) => setLabel(sel.id, t.key, e.target.value)}
                            />
                          </Field>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-500">Blank = the default shown in grey.</p>
                  </div>
                )}
                {sel.id === "logo" && (
                  <div className="mt-3">
                    <Field label={`Logo height (${tpl.logoHeight}px)`}>
                      <input
                        type="range"
                        min={24}
                        max={140}
                        value={tpl.logoHeight}
                        onChange={(e) => update((t) => ({ ...t, logoHeight: Number(e.target.value) }))}
                        className="w-full accent-[#006633]"
                      />
                    </Field>
                  </div>
                )}
                {sel.id === "thanks" && (
                  <div className="mt-3">
                    <Field label="Message">
                      <Input id="blk-text-thanks-0" value={tpl.thanksText} onChange={(e) => update((t) => ({ ...t, thanksText: e.target.value }))} />
                    </Field>
                  </div>
                )}
                {sel.id === "items" && (
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-neutral-700">
                    {(paper === "thermal"
                      ? (["batch", "bonus", "discount"] as const)
                      : (["hsCode", "batch", "bonus", "discount", "tax"] as const)
                    ).map((c) => (
                      <label key={c} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={tpl.columns[c]}
                          onChange={(e) => update((t) => ({ ...t, columns: { ...t.columns, [c]: e.target.checked } }))}
                          className="accent-[#006633]"
                        />
                        Show {{ hsCode: "HS Code", batch: "Batch", bonus: "Bonus", discount: "Discount", tax: "Tax % & Tax Rs" }[c]}
                      </label>
                    ))}
                    {paper === "thermal" && (
                      <p className="w-full text-[11px] text-neutral-400">Thermal receipts show tax as one line in the totals.</p>
                    )}
                  </div>
                )}
              </div>
            )}
            {!sel && <p className="text-xs text-neutral-400">Click a section in the list or on the preview to change its alignment and size.</p>}
          </div>

          {/* ── Live preview ── */}
          <div className="overflow-x-auto rounded-xl bg-neutral-100 p-4">
            <div
              className="mx-auto bg-white shadow-md"
              style={{
                width: `${PAPERS.find((p) => p.id === paper)!.widthMm}mm`,
                padding: `${PAPERS.find((p) => p.id === paper)!.marginMm}mm`,
              }}
            >
              <InvoicePrintLayout
                template={tpl}
                data={sampleData(business, logo)}
                editor={{
                  selected,
                  onSelect: setSelected,
                  onDragStart: (id) => (dragId.current = id),
                  onDropOn: (id) => {
                    if (dragId.current) moveBlock(dragId.current, id);
                    dragId.current = null;
                  },
                }}
              />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
