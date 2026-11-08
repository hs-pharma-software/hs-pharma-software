"use client";

import { useEffect, useMemo, useState } from "react";
import { rs, type ProductCardData } from "./Render";

/** The interactive parts of a business website: request forms, the cart and
 * checkout. Prices, stock and totals always come from the server; the cart in
 * this browser holds only product addresses and quantities. */

type CartLine = { slug: string; qty: number };
const CART_KEY = "mavin-web-cart";
const readCart = (): CartLine[] => { try { const v = JSON.parse(localStorage.getItem(CART_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((l) => typeof l?.slug === "string" && Number.isInteger(l?.qty)) : []; } catch { return []; } };
const writeCart = (c: CartLine[]) => { try { localStorage.setItem(CART_KEY, JSON.stringify(c)); window.dispatchEvent(new Event("mavin-cart")); } catch { /* private mode: cart lives for this page only */ } };

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/web/public/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok) throw new Error(j.error ?? `Something went wrong (${res.status}). Try again.`);
  return j.result as T;
}

const input = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--wa)] focus:ring-2 focus:ring-[var(--wa)]/20";
const btn = "rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60";

export function CartButton({ href }: { href: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const update = () => setN(readCart().reduce((s, l) => s + l.qty, 0));
    update();
    window.addEventListener("mavin-cart", update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener("mavin-cart", update); window.removeEventListener("storage", update); };
  }, []);
  return <a href={href} className="rounded-full px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--wp)" }} aria-label={`Cart, ${n} items`}>Cart{n ? ` (${n})` : ""}</a>;
}

/** Adds to the cart in base units (e.g. capsules) or whole packs (e.g. strips of 10); the cart counts base units. */
export function AddToCart({ p, preview }: { p: ProductCardData; preview?: boolean }) {
  const [qty, setQty] = useState(1);
  const [byPack, setByPack] = useState(false);
  const [added, setAdded] = useState(false);
  if (!p.orderable) return <p className="text-xs text-neutral-500">{p.price === null ? "Call us to order" : p.stock.inStock ? "Available in store" : "Out of stock"}</p>;
  const per = byPack && p.pack ? p.pack.size : 1;
  const options: [boolean, string][] = p.pack ? [[false, p.unit ?? "Unit"], [true, `${p.pack.name} (${p.pack.size})`]] : [];
  return (
    <div className="space-y-1.5">
      {options.length > 0 && (
        <div className="flex gap-1 text-[11px]" role="group" aria-label="Buy by">
          {options.map(([v, label]) => (
            <button key={String(v)} type="button" aria-pressed={byPack === v} onClick={() => setByPack(v)}
              className={`rounded-full border px-2 py-0.5 ${byPack === v ? "border-[var(--wa)] bg-[var(--wa)] text-white" : "border-neutral-300 text-neutral-600"}`}>{label}</button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`q-${p.slug}`}>Quantity</label>
        <input id={`q-${p.slug}`} type="number" min={1} max={999} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 1))))} className="w-16 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm" />
        <button type="button" disabled={preview} className="flex-1 rounded-full px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60" style={{ background: "var(--wa)" }}
          onClick={() => { const units = qty * per; const c = readCart(); const ex = c.find((l) => l.slug === p.slug); if (ex) ex.qty = Math.min(9999, ex.qty + units); else c.push({ slug: p.slug, qty: Math.min(9999, units) }); writeCart(c); setAdded(true); setTimeout(() => setAdded(false), 1500); }}>
          {preview ? "Preview" : added ? "Added" : "Add to cart"}
        </button>
      </div>
      {per > 1 && <p className="text-[11px] text-neutral-500">= {qty * per} {p.unit ?? "units"}</p>}
    </div>
  );
}

export function RequestForm({ kind, preview }: { kind: "contact" | "appointment" | "quotation"; preview?: boolean }) {
  const [f, setF] = useState({ name: "", phone: "", email: "", message: "", preferredDate: "", doctor: "", items: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const title = kind === "appointment" ? "Request an appointment" : kind === "quotation" ? "Request a quotation" : "Send a message";
  if (state === "sent") return <div className="rounded-xl bg-white p-6 ring-1 ring-black/5"><p className="font-semibold text-neutral-900">Thank you.</p><p className="mt-1 text-sm text-neutral-600">{kind === "appointment" ? "We will call you to confirm a time. This is a request, not a confirmed booking." : "We will get back to you soon."}</p></div>;
  return (
    <form className="space-y-3 rounded-xl bg-white p-6 ring-1 ring-black/5" onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      setState("sending");
      try { await api({ action: "request", kind, ...f }); setState("sent"); } catch (err) { setError(err instanceof Error ? err.message : String(err)); setState("idle"); }
    }}>
      <p className="font-semibold text-neutral-900">{title}</p>
      {kind === "appointment" && <p className="text-xs text-neutral-500">This sends a request; the clinic confirms the time with you.</p>}
      <label className="block text-sm text-neutral-700">Name<input required value={f.name} onChange={set("name")} className={`${input} mt-1`} autoComplete="name" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-neutral-700">Phone<input value={f.phone} onChange={set("phone")} className={`${input} mt-1`} inputMode="tel" autoComplete="tel" placeholder="03001234567" /></label>
        <label className="block text-sm text-neutral-700">Email<input type="email" value={f.email} onChange={set("email")} className={`${input} mt-1`} autoComplete="email" /></label>
      </div>
      {kind === "appointment" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-neutral-700">Preferred date<input type="date" value={f.preferredDate} onChange={set("preferredDate")} className={`${input} mt-1`} /></label>
          <label className="block text-sm text-neutral-700">Doctor (optional)<input value={f.doctor} onChange={set("doctor")} className={`${input} mt-1`} /></label>
        </div>
      )}
      {kind === "quotation" && <label className="block text-sm text-neutral-700">Items and quantities<textarea value={f.items} onChange={set("items")} rows={3} className={`${input} mt-1`} /></label>}
      <label className="block text-sm text-neutral-700">Message<textarea value={f.message} onChange={set("message")} rows={3} className={`${input} mt-1`} /></label>
      {/* Left empty by people; filled by bots. */}
      <input tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={f.website} onChange={set("website")} />
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={state === "sending" || preview} className={btn} style={{ background: "var(--wa)" }}>{preview ? "Preview: sending is off" : state === "sending" ? "Sending…" : "Send"}</button>
    </form>
  );
}

interface CartInfo {
  items: ProductCardData[];
  store: { pickup: boolean; delivery: boolean; zones: { name: string; charge: number }[]; minOrder: number; payment: { cod: boolean; pickup: boolean; bank: boolean }; bankDetails: string; rxNotice: string; online?: { provider: string; method: string; label: string }[] };
}

/** Sends the customer to the provider's hosted page (form the server built). */
async function goToPayment(api: <T>(b: Record<string, unknown>) => Promise<T>, token: string, choice: { provider: string; method: string }, returnPath: string, idempotencyKey: string) {
  const r = await api<{ form: { action: string; method: "POST" | "GET"; fields: Record<string, string> } }>({ action: "payOnline", token, provider: choice.provider, method: choice.method, returnPath, idempotencyKey });
  const form = document.createElement("form");
  form.method = r.form.method;
  form.action = r.form.action;
  for (const [k, v] of Object.entries(r.form.fields)) {
    const i = document.createElement("input");
    i.type = "hidden";
    i.name = k;
    i.value = v;
    form.appendChild(i);
  }
  document.body.appendChild(form);
  form.submit();
}

/** Order page: pay (again) for an online order that is not paid yet. Paid status comes only from the server. */
export function PayNow({ token, orderBase }: { token: string; orderBase: string }) {
  const [options, setOptions] = useState<{ provider: string; method: string; label: string }[] | null>(null);
  const [choice, setChoice] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-pay`);
  useEffect(() => {
    api<{ store: { online?: { provider: string; method: string; label: string }[] } }>({ action: "cart", slugs: [] })
      .then((r) => setOptions(r.store.online ?? []))
      .catch(() => setOptions([]));
  }, []);
  if (!options) return null;
  if (!options.length) return <p className="mt-2 text-sm text-neutral-600">Online payment is not available right now. Please contact the shop.</p>;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
      {options.map((o, i) => <label key={`${o.provider}-${o.method}`} className="flex items-center gap-2"><input type="radio" name="paynow" checked={choice === i} onChange={() => setChoice(i)} /> {o.label}</label>)}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await goToPayment(api, token, options[choice], orderBase, key);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setBusy(false);
        }
      }} className="min-h-10 rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-60" style={{ background: "var(--wa)" }}>{busy ? "Opening…" : "Pay now"}</button>
    </div>
  );
}

/** Cart and checkout in one page: lines checked against the server, then the order form. */
export function Checkout({ orderBase, preview }: { orderBase: string; preview?: boolean }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [info, setInfo] = useState<CartInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-checkout`));
  const [f, setF] = useState({ name: "", phone: "", email: "", address: "", notes: "", fulfillment: "pickup", zone: "", payment: "" });
  const [files, setFiles] = useState<{ name: string; data: string }[]>([]);

  useEffect(() => {
    const c = readCart();
    setCart(c);
    if (!c.length) { setInfo({ items: [], store: { pickup: true, delivery: false, zones: [], minOrder: 0, payment: { cod: false, pickup: true, bank: false }, bankDetails: "", rxNotice: "" } }); return; }
    api<CartInfo>({ action: "cart", slugs: c.map((l) => l.slug) }).then((r) => {
      setInfo(r);
      setF((x) => ({ ...x, fulfillment: r.store.pickup ? "pickup" : "delivery" }));
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const lines = useMemo(() => cart.map((l) => ({ ...l, p: info?.items.find((i) => i.slug === l.slug) })).filter((l) => l.p), [cart, info]);
  const subtotal = lines.reduce((s, l) => s + (l.p!.price ?? 0) * l.qty, 0);
  const zone = info?.store.zones.find((z) => z.name === f.zone);
  const delivery = f.fulfillment === "delivery" ? zone?.charge ?? 0 : 0;
  const needsRx = lines.some((l) => l.p!.rxRequired);
  const unavailable = cart.filter((l) => !info?.items.find((i) => i.slug === l.slug && i.orderable));
  const online = info?.store.online ?? [];
  const [onlineChoice, setOnlineChoice] = useState(0);
  const pays = info ? ([["cod", "Cash on delivery", f.fulfillment === "delivery" && info.store.payment.cod], ["pickup", "Pay on pickup", f.fulfillment === "pickup" && info.store.payment.pickup], ["bank", "Bank transfer", info.store.payment.bank], ["online", "Pay online", online.length > 0]] as const).filter((p) => p[2]) : [];

  const update = (slug: string, qty: number) => { const c = cart.map((l) => (l.slug === slug ? { ...l, qty } : l)).filter((l) => l.qty > 0); setCart(c); writeCart(c); };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list).slice(0, 3 - files.length)) {
      if (file.size > 4 * 1024 * 1024) { setError("Each prescription file must be under 4 MB."); continue; }
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
      next.push({ name: file.name, data });
    }
    setFiles(next);
  }

  if (!info) return <p className="text-sm text-neutral-500">{error ?? "Loading your cart…"}</p>;
  if (!cart.length) return <p className="text-neutral-600">Your cart is empty.</p>;
  return (
    <form className="grid gap-8 lg:grid-cols-[1fr_380px]" onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      setBusy(true);
      try {
        const r = await api<{ token: string }>({ action: "checkout", idempotencyKey: key, items: lines.map((l) => ({ slug: l.slug, qty: l.qty })), ...f, prescriptions: files });
        writeCart([]);
        const orderUrl = new URL(`${orderBase}/${r.token}`, window.location.href);
        if (f.payment === "online" && online[onlineChoice]) {
          // Order saved; now to the provider's secure page (the shop sees the order as unpaid until the provider confirms).
          await goToPayment(api, r.token, online[onlineChoice], new URL(orderBase, window.location.href).pathname, `${key}-pay`);
          return;
        }
        window.location.assign(orderUrl.href);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    }}>
      <div className="space-y-4">
        <ul className="divide-y divide-black/5 rounded-xl border border-black/5 bg-white">
          {lines.map((l) => (
            <li key={l.slug} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1 text-sm font-medium text-neutral-900">{l.p!.name}{l.p!.rxRequired && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">Prescription</span>}
                <span className="block text-xs font-normal text-neutral-500">{cartUnitText(l.p!, l.qty)}</span>
              </span>
              <label className="sr-only" htmlFor={`cq-${l.slug}`}>Quantity</label>
              <input id={`cq-${l.slug}`} type="number" min={0} max={9999} value={l.qty} onChange={(e) => update(l.slug, Math.max(0, Math.min(9999, Math.round(Number(e.target.value) || 0))))} className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-sm" />
              <span className="w-24 text-right text-sm tabular-nums">{l.p!.price === null ? "–" : rs(l.p!.price * l.qty)}</span>
            </li>
          ))}
        </ul>
        {unavailable.length > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Some items in your cart can no longer be ordered online; remove them to continue.</p>}
        <fieldset className="space-y-3 rounded-xl border border-black/5 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-neutral-900">Your details</legend>
          <label className="block text-sm text-neutral-700">Name<input required value={f.name} onChange={set("name")} className={`${input} mt-1`} autoComplete="name" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-neutral-700">Phone<input required value={f.phone} onChange={set("phone")} className={`${input} mt-1`} inputMode="tel" autoComplete="tel" placeholder="03001234567" /></label>
            <label className="block text-sm text-neutral-700">Email (optional)<input type="email" value={f.email} onChange={set("email")} className={`${input} mt-1`} autoComplete="email" /></label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {info.store.pickup && <label className="flex items-center gap-2"><input type="radio" name="ful" checked={f.fulfillment === "pickup"} onChange={() => setF({ ...f, fulfillment: "pickup", payment: "" })} /> Pick up from the shop</label>}
            {info.store.delivery && <label className="flex items-center gap-2"><input type="radio" name="ful" checked={f.fulfillment === "delivery"} onChange={() => setF({ ...f, fulfillment: "delivery", payment: "" })} /> Delivery</label>}
          </div>
          {f.fulfillment === "delivery" && (
            <>
              <label className="block text-sm text-neutral-700">Area<select required value={f.zone} onChange={set("zone")} className={`${input} mt-1`}><option value="">Choose your area</option>{info.store.zones.map((z) => <option key={z.name} value={z.name}>{z.name} ({rs(z.charge)})</option>)}</select></label>
              <label className="block text-sm text-neutral-700">Delivery address<textarea required value={f.address} onChange={set("address")} rows={2} className={`${input} mt-1`} autoComplete="street-address" /></label>
            </>
          )}
          <label className="block text-sm text-neutral-700">Notes (optional)<textarea value={f.notes} onChange={set("notes")} rows={2} className={`${input} mt-1`} /></label>
        </fieldset>
        {needsRx && (
          <fieldset className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <legend className="px-1 text-sm font-semibold text-amber-900">Prescription</legend>
            <p className="text-sm text-amber-900">{info.store.rxNotice}</p>
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => void addFiles(e.target.files)} className="text-sm" aria-label="Prescription files" />
            {files.length > 0 && <ul className="text-xs text-amber-900">{files.map((x, i) => <li key={i}>{x.name} <button type="button" className="underline" onClick={() => setFiles(files.filter((_, j) => j !== i))}>remove</button></li>)}</ul>}
            <p className="text-xs text-amber-800">Your prescription is seen only by the pharmacy, not published.</p>
          </fieldset>
        )}
      </div>
      <aside className="h-fit space-y-3 rounded-xl border border-black/5 bg-white p-4">
        <p className="text-sm font-semibold text-neutral-900">Order summary</p>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
          <dt className="text-neutral-600">Items</dt><dd className="tabular-nums">{rs(subtotal)}</dd>
          <dt className="text-neutral-600">Delivery</dt><dd className="tabular-nums">{rs(delivery)}</dd>
          <dt className="font-semibold">Total</dt><dd className="font-semibold tabular-nums">{rs(subtotal + delivery)}</dd>
        </dl>
        {subtotal < info.store.minOrder && <p className="text-xs text-amber-700">Minimum order {rs(info.store.minOrder)}.</p>}
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 font-medium text-neutral-900">Payment</legend>
          {pays.map(([k, label]) => <label key={k} className="flex items-center gap-2"><input type="radio" name="pay" required checked={f.payment === k} onChange={() => setF({ ...f, payment: k })} /> {label}</label>)}
          {f.payment === "bank" && <p className="whitespace-pre-line rounded-lg bg-neutral-50 p-2 text-xs text-neutral-700">{info.store.bankDetails}{"\n"}The shop confirms your transfer before sending the order.</p>}
          {f.payment === "online" && (
            <div className="space-y-1 rounded-lg bg-neutral-50 p-2 text-sm">
              {online.map((o, i) => <label key={`${o.provider}-${o.method}`} className="flex items-center gap-2"><input type="radio" name="online" checked={onlineChoice === i} onChange={() => setOnlineChoice(i)} /> {o.label}</label>)}
              <p className="text-xs text-neutral-600">You pay on {online[onlineChoice]?.label.split(" · ")[0] ?? "the provider"}&apos;s secure page; card details are entered there, not on this site.</p>
            </div>
          )}
        </fieldset>
        <p className="text-xs text-neutral-500">Prices and stock are checked again when you place the order. The shop confirms it before preparing it.</p>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
        <button type="submit" disabled={busy || preview || unavailable.length > 0 || !lines.length || subtotal < info.store.minOrder} className={`${btn} w-full`} style={{ background: "var(--wa)" }}>
          {preview ? "Preview: ordering is off" : busy ? "Placing order…" : "Place order"}
        </button>
      </aside>
    </form>
  );
}

/** Diagnostic labs: receipt (or order) number + registered mobile -> the verified report. */
export function ReportLookup({ preview }: { preview?: boolean }) {
  const [number, setNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="space-y-3 rounded-xl bg-white p-6 ring-1 ring-black/5" onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      setBusy(true);
      try {
        const r = await api<{ url: string }>({ action: "labReport", number, phone });
        window.location.assign(new URL(r.url, window.location.href).href);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    }}>
      <label className="block text-sm text-neutral-700">Receipt or order number
        <input required value={number} onChange={(e) => setNumber(e.target.value)} className={`${input} mt-1`} inputMode="text" autoComplete="off" placeholder="e.g. 1234" />
      </label>
      <label className="block text-sm text-neutral-700">Mobile number given at the lab
        <input required value={phone} onChange={(e) => setPhone(e.target.value)} className={`${input} mt-1`} inputMode="tel" autoComplete="tel" placeholder="03001234567" />
      </label>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
      <button type="submit" disabled={busy || preview} className={btn} style={{ background: "var(--wa)" }}>{preview ? "Preview: lookup is off" : busy ? "Finding your report…" : "Get report"}</button>
      <p className="text-xs text-neutral-500">Your report opens on the next page; use “Download PDF” there to save it.</p>
    </form>
  );
}

/** "Rs 38.85 each · Capsule · 2 Strip + 3" for a cart line (quantity in base units). */
function cartUnitText(p: ProductCardData, qty: number): string {
  const parts: string[] = [];
  if (p.price !== null) parts.push(`${rs(p.price)} each`);
  if (p.unit) parts.push(p.unit);
  if (p.pack && qty >= p.pack.size) parts.push(`${Math.floor(qty / p.pack.size)} ${p.pack.name}${qty % p.pack.size ? ` + ${qty % p.pack.size}` : ""}`);
  return parts.join(" · ");
}

interface Suggestion { slug: string; name: string; price: number | null; unit: string | null }

/** Shop search with suggestions: type, move with the arrow keys, Enter opens
 * the highlighted product (or searches), Escape closes the list. */
export function ShopSearch({ action, initialQ, initialC, categories, preview, itemBase }: { action: string; initialQ: string; initialC: string; categories: string[]; preview: string | null; itemBase: string }) {
  const [q, setQ] = useState(initialQ);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setItems([]); return; }
    const t = setTimeout(() => {
      api<Suggestion[]>({ action: "suggest", q: term }).then((r) => { setItems(r); setActive(-1); }).catch(() => setItems([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const go = (slug: string) => { window.location.assign(new URL(`${itemBase}/${slug}${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`, window.location.href).href); };
  const shown = open && items.length > 0;
  return (
    <form className="mt-6 flex flex-wrap gap-2" action={action} method="get" role="search">
      {preview && <input type="hidden" name="preview" value={preview} />}
      <div className="relative min-w-0 flex-1">
        <label htmlFor="shop-q" className="sr-only">Search products</label>
        <input id="shop-q" name="q" value={q} autoComplete="off" placeholder="Search products"
          role="combobox" aria-expanded={shown} aria-controls="shop-suggest" aria-autocomplete="list" aria-activedescendant={active >= 0 ? `sg-${active}` : undefined}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!shown) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
            else if (e.key === "Enter" && active >= 0) { e.preventDefault(); go(items[active].slug); }
            else if (e.key === "Escape") { setOpen(false); setActive(-1); }
          }}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
        {shown && (
          <ul id="shop-suggest" role="listbox" aria-label="Suggestions" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
            {items.map((it, i) => (
              <li key={it.slug} id={`sg-${i}`} role="option" aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); go(it.slug); }} onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-neutral-100" : ""}`}>
                <span className="truncate text-neutral-900">{it.name}</span>
                <span className="shrink-0 tabular-nums text-neutral-500">{it.price === null ? "" : `${rs(it.price)}${it.unit ? ` / ${it.unit}` : ""}`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <label htmlFor="shop-c" className="sr-only">Category</label>
      <select id="shop-c" name="c" defaultValue={initialC} className="w-full min-w-0 max-w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm sm:w-auto sm:max-w-[16rem]"><option value="">All categories</option>{categories.map((x) => <option key={x} value={x}>{x}</option>)}</select>
      <button type="submit" className="min-h-10 rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--wa)" }}>Search</button>
    </form>
  );
}
