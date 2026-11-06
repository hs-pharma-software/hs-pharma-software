"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Monitor, Plus, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SECTION_LABELS, type Section, type SectionType, type SiteSettings } from "@/lib/web/sections";
import { SectionView, SiteFooter, SiteHeader, themeStyle, type Links, type RenderData } from "@/components/web/Render";
import { ImageField, Note, card, errText, inputCls, labelCls, useUnsavedGuard, webCall } from "./shared";

/** Pages & Builder: sections in order, edited on the left, previewed on the
 * right exactly as the website shows them. Changes save to the DRAFT
 * automatically; the live website changes only on Publish. */

export interface PageInfo { id: string; slug: string; title: string; kind: string; sections: Section[]; seoTitle: string; seoDescription: string; inNav: boolean; draftUpdatedAt: string | null; changed: boolean }

const newId = () => `s-${Math.random().toString(36).slice(2, 10)}`;
const blank = (type: SectionType): Section => {
  const base: Section = { id: newId(), type, heading: SECTION_LABELS[type].label };
  if (type === "hero") return { ...base, heading: "Your headline", variant: "centered", text: "", buttons: [{ label: "Contact us", href: "/contact" }] };
  if (type === "services" || type === "faq" || type === "testimonials") return { ...base, items: [{ title: "", text: "" }] };
  if (type === "gallery") return { ...base, images: [] };
  if (type === "featured") return { ...base, limit: 8 };
  if (type === "contact") return { ...base, form: "contact" };
  if (type === "cta") return { ...base, text: "", buttons: [{ label: "Contact us", href: "/contact" }] };
  return base;
};
const ITEM_LABELS: Partial<Record<SectionType, [string, string]>> = { services: ["Title", "Description"], faq: ["Question", "Answer"], testimonials: ["Customer name", "What they said"] };
const PREVIEW_DATA: RenderData = {
  featured: [1, 2, 3, 4].map((i) => ({ slug: `example-${i}`, name: `Example product ${i}`, price: null, images: [], orderable: false, rxRequired: false, stock: { visibility: "hide", inStock: true, qty: null } })),
  categories: ["Your categories"], doctors: [], departments: [],
};
const PREVIEW_LINKS: Links = { page: () => "#", store: () => "#" };

function SortRow({ s, selected, onSelect, onMove, onDup, onHide, onRemove, first, last }: {
  s: Section; selected: boolean; onSelect: () => void; onMove: (d: -1 | 1) => void; onDup: () => void; onHide: () => void; onRemove: () => void; first: boolean; last: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined };
  const icon = "rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30";
  return (
    <li ref={setNodeRef} style={style} className={`flex items-center gap-1 rounded-lg border bg-white px-1.5 py-1 ${selected ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/15" : "border-neutral-200"} ${s.hidden ? "opacity-60" : ""}`}>
      <button type="button" {...attributes} {...listeners} className={`${icon} cursor-grab`} aria-label={`Drag to reorder ${SECTION_LABELS[s.type].label}. With the keyboard: Space, then arrow keys, then Space.`}><GripVertical size={15} /></button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate py-1 text-left text-sm" aria-pressed={selected}>
        <span className="font-medium text-neutral-800">{SECTION_LABELS[s.type].label}</span>
        <span className="ml-1.5 text-xs text-neutral-500">{s.heading}</span>
      </button>
      <button type="button" className={icon} onClick={() => onMove(-1)} disabled={first} aria-label="Move up"><ArrowUp size={14} /></button>
      <button type="button" className={icon} onClick={() => onMove(1)} disabled={last} aria-label="Move down"><ArrowDown size={14} /></button>
      <button type="button" className={icon} onClick={onDup} aria-label="Duplicate"><Copy size={14} /></button>
      <button type="button" className={icon} onClick={onHide} aria-label={s.hidden ? "Show on the website" : "Hide from the website"}>{s.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
      <button type="button" className={`${icon} hover:text-rose-600`} onClick={onRemove} aria-label="Remove"><Trash2 size={14} /></button>
    </li>
  );
}

function SectionEditor({ s, onChange, tenantId }: { s: Section; onChange: (s: Section) => void; tenantId?: string }) {
  const set = <K extends keyof Section>(k: K, v: Section[K]) => onChange({ ...s, [k]: v });
  const id = s.id;
  const items = s.items ?? [];
  const labels = ITEM_LABELS[s.type];
  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">{SECTION_LABELS[s.type].hint}</p>
      <label htmlFor={`${id}-h`} className={labelCls}>Heading<input id={`${id}-h`} value={s.heading} maxLength={140} onChange={(e) => set("heading", e.target.value)} className={inputCls} /></label>
      {["hero", "about", "services", "cta", "contact"].includes(s.type) && (
        <label htmlFor={`${id}-t`} className={labelCls}>Text<textarea id={`${id}-t`} value={s.text ?? ""} maxLength={3000} rows={s.type === "about" ? 6 : 3} onChange={(e) => set("text", e.target.value)} className={inputCls} /></label>
      )}
      {s.type === "hero" && (
        <label htmlFor={`${id}-v`} className={labelCls}>Layout
          <select id={`${id}-v`} value={s.variant ?? "centered"} onChange={(e) => set("variant", e.target.value as Section["variant"])} className={inputCls}><option value="centered">Centered on brand colour</option><option value="split">Text beside the image</option></select>
        </label>
      )}
      {(s.type === "hero" || s.type === "about") && <ImageField id={`${id}-img`} label="Image" value={s.image ?? null} onChange={(v) => set("image", v)} tenantId={tenantId} hint="Wide photos work best (about 1600 × 900)." />}
      {s.type === "hero" && <ImageField id={`${id}-mimg`} label="Phone image (optional)" value={s.mobileImage ?? null} onChange={(v) => set("mobileImage", v)} tenantId={tenantId} hint="A taller crop shown on phones." />}
      {(s.type === "hero" || s.type === "cta") && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-neutral-600">Buttons</legend>
          {(s.buttons ?? []).map((b, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input aria-label={`Button ${i + 1} label`} value={b.label} maxLength={40} placeholder="Label" onChange={(e) => set("buttons", (s.buttons ?? []).map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={`${inputCls} w-36`} />
              <input aria-label={`Button ${i + 1} link`} value={b.href} maxLength={300} placeholder="/contact, /shop, tel:…" onChange={(e) => set("buttons", (s.buttons ?? []).map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))} className={`${inputCls} min-w-0 flex-1`} />
              <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => set("buttons", (s.buttons ?? []).filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          {(s.buttons ?? []).length < (s.type === "hero" ? 2 : 1) && <button type="button" className="text-xs font-medium text-[var(--accent)] hover:underline" onClick={() => set("buttons", [...(s.buttons ?? []), { label: "", href: "/" }])}>+ Add button</button>}
          <p className="text-[11px] text-neutral-400">Links: a page of your site (/about, /shop), a phone (tel:0300…), an email (mailto:…) or an https:// address.</p>
        </fieldset>
      )}
      {labels && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-neutral-600">Items</legend>
          {s.type === "testimonials" && <p className="text-[11px] text-amber-700">Enter only real feedback you have permission to show.</p>}
          {items.map((it, i) => (
            <div key={i} className="space-y-1 rounded-lg border border-neutral-200 p-2">
              <input aria-label={`${labels[0]} ${i + 1}`} value={it.title} maxLength={160} placeholder={labels[0]} onChange={(e) => set("items", items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className={inputCls} />
              <textarea aria-label={`${labels[1]} ${i + 1}`} value={it.text} maxLength={1200} rows={2} placeholder={labels[1]} onChange={(e) => set("items", items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className={inputCls} />
              <div className="flex gap-3 text-xs">
                <button type="button" disabled={!i} className="text-neutral-500 hover:underline disabled:opacity-30" onClick={() => set("items", arrayMove(items, i, i - 1))}>Up</button>
                <button type="button" className="text-rose-600 hover:underline" onClick={() => set("items", items.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>
          ))}
          {items.length < 24 && <button type="button" className="text-xs font-medium text-[var(--accent)] hover:underline" onClick={() => set("items", [...items, { title: "", text: "" }])}>+ Add item</button>}
        </fieldset>
      )}
      {s.type === "gallery" && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-neutral-600">Photos</legend>
          {(s.images ?? []).map((im, i) => (
            <ImageField key={i} id={`${id}-g${i}`} label={`Photo ${i + 1}`} value={im} tenantId={tenantId}
              onChange={(v) => set("images", v ? (s.images ?? []).map((x, j) => (j === i ? v : x)) : (s.images ?? []).filter((_, j) => j !== i))} />
          ))}
          {(s.images ?? []).length < 24 && <ImageField id={`${id}-gnew`} label="Add a photo" value={null} tenantId={tenantId} onChange={(v) => v && set("images", [...(s.images ?? []), v])} />}
        </fieldset>
      )}
      {s.type === "featured" && <label htmlFor={`${id}-l`} className={labelCls}>How many products<input id={`${id}-l`} type="number" min={1} max={24} value={s.limit ?? 8} onChange={(e) => set("limit", Math.max(1, Math.min(24, Number(e.target.value) || 8)))} className={`${inputCls} w-24`} /></label>}
      {s.type === "contact" && (
        <label htmlFor={`${id}-f`} className={labelCls}>Form
          <select id={`${id}-f`} value={s.form ?? "contact"} onChange={(e) => set("form", e.target.value as Section["form"])} className={inputCls}>
            <option value="contact">Message</option><option value="appointment">Appointment request (not a confirmed booking)</option><option value="quotation">Quotation request</option><option value="none">No form</option>
          </select>
        </label>
      )}
      {(s.type === "doctors" || s.type === "departments" || s.type === "hours" || s.type === "categories") && (
        <p className="rounded-lg bg-neutral-50 p-2 text-xs text-neutral-600">{s.type === "hours" ? "Hours come from Branding & contact." : s.type === "categories" ? "Categories come from your online products." : `Filled from your ${s.type === "doctors" ? "Clinic doctors" : "Hospital departments"}; only names, specialty and days are shown.`}</p>
      )}
    </div>
  );
}

export function Builder({ pages, settings, tenantId, onPagesChanged, storeOn }: { pages: PageInfo[]; settings: SiteSettings | null; tenantId?: string; onPagesChanged: () => void; storeOn: boolean }) {
  const [pageId, setPageId] = useState(pages[0]?.id ?? "");
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const [sections, setSections] = useState<Section[]>(page?.sections ?? []);
  const [meta, setMeta] = useState({ title: page?.title ?? "", seoTitle: page?.seoTitle ?? "", seoDescription: page?.seoDescription ?? "", inNav: page?.inNav ?? true });
  const [base, setBase] = useState<string | null>(page?.draftUpdatedAt ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [addType, setAddType] = useState<SectionType>("about");
  const [newTitle, setNewTitle] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Each page's last saved draft in this session (the page list may be older). */
  const savedCopy = useRef(new Map<string, { sections: Section[]; meta: typeof meta; base: string | null }>());
  const latest = useRef({ sections, meta, base });
  useEffect(() => { latest.current = { sections, meta, base }; });
  useUnsavedGuard(status === "unsaved" || status === "saving");

  // Switching page: load it (after saving the current one).
  useEffect(() => {
    if (!page) return;
    const copy = savedCopy.current.get(page.id);
    setSections(copy?.sections ?? page.sections);
    setMeta(copy?.meta ?? { title: page.title, seoTitle: page.seoTitle, seoDescription: page.seoDescription, inNav: page.inNav });
    setBase(copy?.base ?? page.draftUpdatedAt);
    setSelected(null);
    setStatus("saved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id]);

  const save = useCallback(async () => {
    if (!page) return;
    const { sections: s, meta: m, base: b } = latest.current;
    setStatus("saving");
    try {
      const r = await webCall<{ draftUpdatedAt: string }>("savePage", { id: page.id, sections: s, title: m.title, seoTitle: m.seoTitle, seoDescription: m.seoDescription, inNav: m.inNav, base: b }, tenantId);
      setBase(r.draftUpdatedAt);
      savedCopy.current.set(page.id, { sections: s, meta: m, base: r.draftUpdatedAt });
      setStatus("saved");
      setError(null);
    } catch (e) {
      setStatus("error");
      setError(errText(e));
    }
  }, [page, tenantId]);

  const changed = (next: Section[] | null, nextMeta?: typeof meta) => {
    if (next) setSections(next);
    if (nextMeta) setMeta(nextMeta);
    setStatus("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1500);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = sections.findIndex((x) => x.id === e.active.id);
    const to = sections.findIndex((x) => x.id === e.over!.id);
    changed(arrayMove(sections, from, to));
  };
  const sel = sections.find((x) => x.id === selected) ?? null;

  if (!page) return <Note kind="info">No pages yet.</Note>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor="b-page" className={labelCls}>Page
          <select id="b-page" value={page.id} onChange={async (e) => { if (status === "unsaved") await save(); setPageId(e.target.value); }} className={`${inputCls} w-48`}>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.title}{p.changed ? " •" : ""}</option>)}
          </select>
        </label>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status === "saved" ? "bg-emerald-50 text-emerald-700" : status === "error" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`} role="status" aria-live="polite">
          {status === "saved" ? "Draft saved" : status === "saving" ? "Saving…" : status === "unsaved" ? "Unsaved changes" : "Not saved"}
        </span>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <label htmlFor="b-new" className={labelCls}>New page<input id="b-new" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Services" className={`${inputCls} w-40`} /></label>
          <Button disabled={newTitle.trim().length < 2} onClick={async () => { try { const r = await webCall<{ id: string }>("createPage", { title: newTitle }, tenantId); setNewTitle(""); onPagesChanged(); setPageId(r.id); } catch (e) { setError(errText(e)); } }}><Plus size={14} /> Add page</Button>
          {page.kind !== "home" && <Button variant="danger" onClick={async () => { if (!confirm(`Delete the page “${page.title}”? It leaves the website when you next publish.`)) return; try { await webCall("deletePage", { id: page.id }, tenantId); onPagesChanged(); setPageId(pages[0].id); } catch (e) { setError(errText(e)); } }}>Delete page</Button>}
        </div>
      </div>
      {error && <Note kind="error">{error} {status === "error" && <button type="button" className="ml-2 font-medium underline" onClick={() => void save()}>Try again</button>}</Note>}

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className="space-y-3">
          <div className={card}>
            <p className="mb-2 text-sm font-semibold text-neutral-800">Page</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label htmlFor="b-title" className={labelCls}>Title in the menu<input id="b-title" value={meta.title} maxLength={60} onChange={(e) => changed(null, { ...meta, title: e.target.value })} className={inputCls} /></label>
              <label htmlFor="b-nav" className="flex items-end gap-2 pb-1.5 text-sm"><input id="b-nav" type="checkbox" checked={meta.inNav} onChange={(e) => changed(null, { ...meta, inNav: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" /> Show in the menu</label>
            </div>
            <p className="mt-2 text-xs text-neutral-500">Address: {page.kind === "home" ? "/" : `/${page.slug}`}</p>
          </div>

          <div className={card}>
            <p className="mb-2 text-sm font-semibold text-neutral-800">Sections</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={sections.map((x) => x.id)} strategy={verticalListSortingStrategy}>
                <ol className="space-y-1.5" aria-label="Sections in page order">
                  {sections.map((x, i) => (
                    <SortRow key={x.id} s={x} selected={x.id === selected} first={i === 0} last={i === sections.length - 1}
                      onSelect={() => setSelected(x.id === selected ? null : x.id)}
                      onMove={(d) => changed(arrayMove(sections, i, i + d))}
                      onDup={() => { const copy = { ...structuredClone(x), id: newId() }; const next = [...sections]; next.splice(i + 1, 0, copy); changed(next); setSelected(copy.id); }}
                      onHide={() => changed(sections.map((y) => (y.id === x.id ? { ...y, hidden: !y.hidden } : y)))}
                      onRemove={() => { if (confirm(`Remove the ${SECTION_LABELS[x.type].label} section?`)) { changed(sections.filter((y) => y.id !== x.id)); if (selected === x.id) setSelected(null); } }} />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
            {!sections.length && <p className="py-3 text-center text-sm text-neutral-400">No sections. Add one below.</p>}
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-3">
              <label htmlFor="b-add" className={labelCls}>Add a section
                <select id="b-add" value={addType} onChange={(e) => setAddType(e.target.value as SectionType)} className={`${inputCls} w-52`}>
                  {(Object.keys(SECTION_LABELS) as SectionType[]).filter((t) => storeOn || (t !== "featured" && t !== "categories")).map((t) => <option key={t} value={t}>{SECTION_LABELS[t].label}</option>)}
                </select>
              </label>
              <Button onClick={() => { const s = blank(addType); changed([...sections, s]); setSelected(s.id); }}><Plus size={14} /> Add</Button>
            </div>
          </div>

          {sel && <div className={card}><p className="mb-2 text-sm font-semibold text-neutral-800">Edit: {SECTION_LABELS[sel.type].label}</p><SectionEditor s={sel} tenantId={tenantId} onChange={(n) => changed(sections.map((y) => (y.id === n.id ? n : y)))} /></div>}

          <div className={card}>
            <p className="mb-2 text-sm font-semibold text-neutral-800">Search engines (this page)</p>
            <label htmlFor="b-st" className={labelCls}>Search title <span className="font-normal text-neutral-400">{meta.seoTitle.length}/70</span><input id="b-st" value={meta.seoTitle} maxLength={70} onChange={(e) => changed(null, { ...meta, seoTitle: e.target.value })} className={inputCls} placeholder={`${meta.title} | ${settings?.name ?? ""}`} /></label>
            <label htmlFor="b-sd" className={`${labelCls} mt-2`}>Search description <span className="font-normal text-neutral-400">{meta.seoDescription.length}/170</span><textarea id="b-sd" value={meta.seoDescription} maxLength={170} rows={2} onChange={(e) => changed(null, { ...meta, seoDescription: e.target.value })} className={inputCls} /></label>
          </div>
        </div>

        <div className={`${card} min-w-0`}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-neutral-800">Preview <span className="text-xs font-normal text-neutral-500">· draft</span></p>
            <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5" role="group" aria-label="Preview size">
              <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={`rounded-md p-1.5 ${device === "desktop" ? "bg-neutral-100" : ""}`} aria-label="Desktop"><Monitor size={15} /></button>
              <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")} className={`rounded-md p-1.5 ${device === "mobile" ? "bg-neutral-100" : ""}`} aria-label="Phone"><Smartphone size={15} /></button>
            </div>
          </div>
          {settings ? (
            <div className="overflow-auto rounded-lg border border-neutral-200 bg-neutral-100 p-2" style={{ maxHeight: "75vh" }}>
              <div className={`mx-auto origin-top overflow-hidden bg-white ${device === "mobile" ? "w-[390px]" : "w-full"}`} style={themeStyle(settings)}>
                <div className="pointer-events-none select-none" aria-hidden>
                  <SiteHeader s={settings} nav={pages.filter((p) => p.inNav).map((p) => ({ title: p.id === page.id ? meta.title : p.title, href: "#" }))} links={PREVIEW_LINKS} storeOn={storeOn} />
                  {sections.filter((x) => !x.hidden).map((x) => (
                    <div key={x.id} className={x.id === selected ? "outline outline-2 -outline-offset-2 outline-[var(--accent)]" : ""}>
                      <SectionView sec={x} s={settings} data={PREVIEW_DATA} links={PREVIEW_LINKS} formSlot={() => <div className="rounded-xl bg-white p-6 text-sm text-neutral-500 ring-1 ring-black/5">Request form</div>} />
                    </div>
                  ))}
                  <SiteFooter s={settings} links={PREVIEW_LINKS} />
                </div>
              </div>
            </div>
          ) : <Note kind="info">Fill in Branding & contact to see the preview.</Note>}
          <p className="mt-2 text-xs text-neutral-500">Products, doctors and departments show your real records on the website; the preview shows examples.</p>
        </div>
      </div>
    </div>
  );
}
