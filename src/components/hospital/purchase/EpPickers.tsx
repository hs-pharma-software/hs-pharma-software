"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/Field";
import { notify } from "@/lib/notify";
import { dbSelect } from "@/lib/db";
import { requireCurrentTenantId } from "@/lib/repo/base";
import { listVendors } from "@/lib/repo/vendors";
import {
  addDirectoryVendor, ensureProduct, eprocurementOnline, searchEpItems, searchEpVendors, type ItemOption, type VendorOption,
} from "@/lib/repo/purchaseOrders";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A search box with a keyboard-driven list under it (↑ ↓ Enter, Esc). */
function useSearch<T>(search: (q: string) => Promise<T[]>, minLength: number) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < minLength) { setRows([]); return; }
    const n = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      search(q.trim()).then((r) => { if (n === seq.current) { setRows(r); setActive(0); } })
        .catch((e) => { if (n === seq.current) { setRows([]); notify(`Could not search: ${msg(e)}`); } })
        .finally(() => { if (n === seq.current) setLoading(false); });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);
  return { q, setQ, rows, open, setOpen, loading, active, setActive };
}

const small = "block truncate text-xs text-neutral-500";

/** Vendors for a New Order: this hospital's own suppliers and the portal vendors of
 * other hospitals (the shared eProcurement directory), by name, number, email, phone
 * or address. A directory vendor picked is added to this hospital's suppliers. */
export function VendorSearch({ picked, onPick, onRemove, invalid }: {
  picked: VendorOption[]; onPick: (v: VendorOption & { supplierId: string }) => void; onRemove: (supplierId: string) => void; invalid?: boolean;
}) {
  const listId = useId();
  const [adding, setAdding] = useState(false);
  const s = useSearch<VendorOption>(async (q) => {
    if (eprocurementOnline()) return searchEpVendors(q);
    // Offline desktop: this hospital's suppliers only.
    return (await listVendors(q)).slice(0, 30).map((v) => ({
      key: `s:${v.id}`, source: "own" as const, supplierId: v.id, epVendorId: null, name: v.name, number: v.vendor_no ?? null,
      email: v.email ?? null, phone: v.phone ?? null, address: v.address ?? null, onPortal: false,
    }));
  }, 0);
  const shown = s.rows.filter((r) => !r.supplierId || !picked.some((p) => p.supplierId === r.supplierId));

  async function choose(v: VendorOption) {
    if (adding) return;
    try {
      let supplierId = v.supplierId;
      if (!supplierId && v.epVendorId) {
        setAdding(true);
        supplierId = (await addDirectoryVendor(v.epVendorId)).supplierId;
        notify(`${v.name} was added to your Supplier & Vendors.`, "success");
      }
      if (supplierId) onPick({ ...v, supplierId });
      s.setQ("");
      s.setOpen(false);
    } catch (e) { notify(msg(e)); } finally { setAdding(false); }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { s.setOpen(false); return; }
    if (!shown.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); s.setOpen(true); s.setActive((a) => (a + 1) % shown.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); s.setActive((a) => (a - 1 + shown.length) % shown.length); }
    else if (e.key === "Enter" && s.open) { e.preventDefault(); void choose(shown[Math.min(s.active, shown.length - 1)]); }
  };

  return (
    <div>
      <div className="relative">
        <Input id="po-vendor-find" value={s.q} placeholder="Search vendor: name, number, email or address" aria-label="Search vendor" autoComplete="off"
          role="combobox" aria-expanded={s.open && shown.length > 0} aria-controls={listId} aria-autocomplete="list" aria-invalid={invalid || undefined}
          aria-activedescendant={s.open && shown.length ? `${listId}-${Math.min(s.active, shown.length - 1)}` : undefined}
          onChange={(e) => { s.setQ(e.target.value); s.setOpen(true); }} onFocus={() => s.setOpen(true)} onBlur={() => setTimeout(() => s.setOpen(false), 150)} onKeyDown={onKey} />
        {(s.loading || adding) && <Loader2 size={15} className="absolute right-2.5 top-2.5 animate-spin text-neutral-400" aria-hidden="true" />}
        {s.open && (shown.length > 0 || (!s.loading && s.q.trim())) && (
          <ul id={listId} role="listbox" className="pop-in absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/10">
            {shown.map((v, i) => (
              <li key={v.key} id={`${listId}-${i}`} role="option" aria-selected={i === s.active}
                onMouseDown={(e) => { e.preventDefault(); void choose(v); }} onMouseEnter={() => s.setActive(i)}
                className={`cursor-pointer px-3 py-2 ${i === s.active ? "bg-amber-50" : ""}`}>
                <span className="flex items-center gap-2">
                  <b className="min-w-0 flex-1 truncate text-sm text-neutral-900">{v.name}</b>
                  {v.source === "directory"
                    ? <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 text-[10px] font-medium text-indigo-700">eProcurement directory</span>
                    : v.onPortal ? <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700">On portal</span> : null}
                </span>
                <span className={small}>{[v.number, v.email, v.phone].filter(Boolean).join(" · ") || "—"}</span>
                {v.address && <span className={small}>{v.address}</span>}
              </li>
            ))}
            {!shown.length && <li className="px-3 py-3 text-sm text-neutral-400">No vendor matches. Add new vendors in Supplier &amp; Vendors.</li>}
          </ul>
        )}
      </div>
      {picked.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {picked.map((v) => (
            <li key={v.supplierId} className="fade-in flex items-start gap-2 rounded-xl bg-neutral-50 px-3 py-2 ring-1 ring-black/[0.05]">
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm">{v.name}</b>
                <span className={small}>{[v.number, v.email, v.phone].filter(Boolean).join(" · ")}</span>
                {!v.onPortal && <span className="block text-[11px] text-amber-700">Not on the portal: the vendor registers at ep.mavin.pk, then link them in eProcurement › Vendors.</span>}
              </span>
              <button type="button" aria-label={`Remove ${v.name}`} onClick={() => onRemove(v.supplierId!)}
                className="-m-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-rose-50 hover:text-rose-600"><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface PickedItem { productId: string; name: string; uom: string | null; specification: string | null }

/** Products for a New Order: this hospital's Products and the shared list of items every
 * hospital has asked rates for. A product not found is added to Products (and, once the
 * request is sent, to the shared list). */
export function ItemSearch({ onPick }: { onPick: (item: PickedItem) => void }) {
  const listId = useId();
  const [adding, setAdding] = useState(false);
  const s = useSearch<ItemOption>(async (q) => {
    if (eprocurementOnline()) return searchEpItems(q);
    const rows = await dbSelect<{ id: string; name: string; company_name: string | null; description: string | null }>(
      `SELECT id, name, company_name, description FROM products WHERE tenant_id = ? AND deleted_at IS NULL AND (name LIKE ? OR barcode LIKE ?) ORDER BY name LIMIT 15`,
      [requireCurrentTenantId(), `%${q}%`, `%${q}%`]);
    return rows.map((p) => ({ key: `p:${p.id}`, source: "own" as const, productId: p.id, name: p.name, uom: null, specification: p.description, company: p.company_name }));
  }, 2);
  const q = s.q.trim();
  const exact = s.rows.some((r) => r.name.trim().toLowerCase() === q.toLowerCase());
  const options: (ItemOption | { key: "new"; name: string })[] = [...s.rows, ...(q.length >= 2 && !exact && !s.loading ? [{ key: "new" as const, name: q }] : [])];

  async function choose(o: (typeof options)[number]) {
    if (adding) return;
    setAdding(true);
    try {
      if (o.key === "new") {
        const productId = await ensureProduct(o.name);
        notify(`${o.name} was added to Products.`, "success");
        onPick({ productId, name: o.name, uom: null, specification: null });
      } else {
        const item = o as ItemOption;
        // A shared item becomes this hospital's product too (for the store purchase later).
        const productId = item.productId ?? (await ensureProduct(item.name, item.uom));
        onPick({ productId, name: item.name, uom: item.uom, specification: item.source === "shared" ? item.specification : null });
      }
      s.setQ("");
      s.setOpen(false);
    } catch (e) { notify(msg(e)); } finally { setAdding(false); }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { s.setOpen(false); return; }
    if (!options.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); s.setOpen(true); s.setActive((a) => (a + 1) % options.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); s.setActive((a) => (a - 1 + options.length) % options.length); }
    else if (e.key === "Enter") { e.preventDefault(); void choose(options[Math.min(s.active, options.length - 1)]); }
  };

  return (
    <div className="relative">
      <Input value={s.q} placeholder="Search product, or type a new one" aria-label="Search product" autoComplete="off"
        role="combobox" aria-expanded={s.open && options.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={s.open && options.length ? `${listId}-${Math.min(s.active, options.length - 1)}` : undefined}
        onChange={(e) => { s.setQ(e.target.value); s.setOpen(true); }} onFocus={() => s.setOpen(true)} onBlur={() => setTimeout(() => s.setOpen(false), 150)} onKeyDown={onKey} />
      {(s.loading || adding) && <Loader2 size={15} className="absolute right-2.5 top-2.5 animate-spin text-neutral-400" aria-hidden="true" />}
      {s.open && options.length > 0 && (
        <ul id={listId} role="listbox" className="pop-in absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/10">
          {options.map((o, i) => (
            <li key={o.key} id={`${listId}-${i}`} role="option" aria-selected={i === s.active}
              onMouseDown={(e) => { e.preventDefault(); void choose(o); }} onMouseEnter={() => s.setActive(i)}
              className={`cursor-pointer px-3 py-2 ${i === s.active ? "bg-amber-50" : ""} ${o.key === "new" ? "border-t border-neutral-100" : ""}`}>
              {o.key === "new" ? (
                <span className="flex items-center gap-2 text-sm font-medium text-[var(--accent)]"><Plus size={14} aria-hidden="true" />Add “{o.name}” as a new product</span>
              ) : (() => {
                const it = o as ItemOption;
                return (
                  <>
                    <span className="flex items-center gap-2">
                      <b className="min-w-0 flex-1 truncate text-sm text-neutral-900">{it.name}</b>
                      <span className={`shrink-0 rounded-full px-1.5 text-[10px] font-medium ${it.source === "own" ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"}`}>
                        {it.source === "own" ? "Your product" : "Used by hospitals"}
                      </span>
                    </span>
                    {(it.company || it.uom || it.specification) && <span className={small}>{[it.company, it.uom, it.specification].filter(Boolean).join(" · ")}</span>}
                  </>
                );
              })()}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
