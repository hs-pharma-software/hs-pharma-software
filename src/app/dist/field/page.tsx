"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin, Play, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { dist, errorText, openMaps } from "@/lib/dist";
import { startTracking, stopTracking, useTracker } from "@/lib/dist/tracker";
import { Badge, BOOKING_TONE, DistGuard, Err, LIVE_TONE, Note, PageTitle, ago, money, useLoad, type DistCtx } from "@/components/dist/ui";
import { SalesmanDetail } from "@/components/dist/SalesmanDetail";

export default function FieldPage() {
  return <DistGuard>{(c) => (c.salesmanId ? <Field_ c={c} /> : <Note tone="amber">This panel is for salesman logins. The administrator links a login to a salesman under Salesmen.</Note>)}</DistGuard>;
}

function Field_({ c }: { c: DistCtx }) {
  const tracker = useTracker();
  const loc = useLoad(() => dist.salesmanLocation(c.salesmanId!), [c.salesmanId, tracker.lastSentAt, tracker.status]);
  const [tab, setTab] = useState<"book" | "target" | "history">("book");
  return (
    <div className="space-y-4">
      <PageTitle title="Field Panel" />
      <section className="space-y-2 rounded-xl bg-white p-4 ring-1 ring-black/5">
        <div className="flex flex-wrap items-center gap-3">
          <MapPin size={18} />
          <span className="font-semibold">Location sharing</span>
          {loc.data && <Badge tone={LIVE_TONE[loc.data.state]}>{loc.data.state === "live" ? "Active — live" : loc.data.state === "stale" ? "Active — waiting for a fresh fix" : "Off"}</Badge>}
          {loc.data?.point && <span className="text-xs text-neutral-500">last sent {ago(loc.data.point.recorded_at, new Date(loc.data.now).getTime())}{loc.data.point.accuracy ? ` · ±${Math.round(loc.data.point.accuracy)} m` : ""}</span>}
          <span className="ms-auto flex gap-2">
            {tracker.status === "on" || tracker.status === "starting" ? (
              <Button onClick={() => void stopTracking()}><Square size={14} /> Stop sharing</Button>
            ) : (
              <Button variant="primary" onClick={() => void startTracking()}><Play size={14} /> Start sharing</Button>
            )}
          </span>
        </div>
        <p className="text-xs text-neutral-500">
          Your location is sent to your distributor only while sharing is on and this app is open (about every 30 s). Phones pause it when the screen locks or the app is closed — bookings
          then wait until a fresh location arrives. Bookings require sharing to be on with a location newer than {c.settings.location.maxAgeSeconds} s and accuracy within {c.settings.location.maxAccuracyMeters} m.
        </p>
        {tracker.error && <Err error={tracker.error} />}
        {tracker.rejected && <Note tone="amber">Last location was flagged: {tracker.rejected}</Note>}
      </section>
      <div className="flex gap-1">
        {(["book", "target", "history"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm ${tab === t ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/10"}`}>
            {t === "book" ? "New booking" : t === "target" ? "My target" : "My bookings"}
          </button>
        ))}
      </div>
      {tab === "book" && <BookingForm c={c} onDone={() => setTab("history")} />}
      {tab === "target" && <SalesmanDetail salesmanId={c.salesmanId!} showLocation={false} />}
      {tab === "history" && <MyBookings />}
    </div>
  );
}

function BookingForm({ c, onDone }: { c: DistCtx; onDone: () => void }) {
  const customers = useLoad(() => dist.listCustomers({ status: "active" }), []);
  const companies = useLoad(() => dist.listCompanies(), []);
  const [customerId, setCustomerId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [clientRef, setClientRef] = useState(() => crypto.randomUUID());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("company");
    if (q) setCompanyId(q);
  }, []);
  const products = useLoad(() => (companyId ? dist.listProducts({ companyId, search }) : Promise.resolve([])), [companyId, search]);
  const cust = customers.data?.find((x) => x.id === customerId);
  const lines = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([productId, v]) => ({ productId, qty: Number(v) }));
  const total = useMemo(() => lines.reduce((s, l) => { const p = products.data?.find((x) => x.id === l.productId); return s + (p ? p.trade_price * l.qty * (1 + p.sales_tax_rate / 100) : 0); }, 0), [lines, products.data]);

  const submit = async (send: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const b = await dist.createBooking({ clientRef, customerId, companyId: companyId || null, lines, notes });
      if (send) {
        try {
          await dist.submitBooking(b.booking.id);
        } catch (e) {
          setMsg({ ok: false, text: `Booking #${b.booking.booking_no} saved as draft but not submitted: ${errorText(e)}` });
          setClientRef(crypto.randomUUID());
          setQty({});
          return;
        }
      }
      setMsg({ ok: true, text: `Booking #${b.booking.booking_no} ${send ? "submitted" : "saved as draft"}.` });
      setQty({});
      setNotes("");
      setClientRef(crypto.randomUUID());
      if (send) onDone();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-xl bg-white p-4 ring-1 ring-black/5 md:grid-cols-2">
        <Field label="Customer" required>
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select…</option>
            {(customers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.business_name} ({x.code})</option>)}
          </Select>
        </Field>
        <Field label="Company" required>
          <Select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setQty({}); }}>
            <option value="">Select…</option>
            {(companies.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        {cust && (
          <div className="text-xs text-neutral-600 md:col-span-2">
            {cust.owner_name} · {cust.mobile} · {cust.address}
            {cust.lat != null ? (
              <button type="button" className="ms-2 text-sky-700 underline" onClick={() => void openMaps(cust.lat!, cust.lng!)}>Verify geotag on map</button>
            ) : (
              <span className="ms-2 text-amber-700">No geotag recorded</span>
            )}
            {c.mode === "pharma" && <span className="ms-2">CDSL {cust.cdsl_no ?? "—"} exp {cust.cdsl_expiry ?? "—"}</span>}
          </div>
        )}
      </div>
      {companyId && (
        <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
          <Input placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul className="mt-2 max-h-96 divide-y divide-neutral-100 overflow-y-auto text-sm">
            {(products.data ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-[11px] text-neutral-500">{p.code} · {p.unit} · {money(p.trade_price)}{p.sales_tax_rate ? ` + ${p.sales_tax_rate}% ST` : ""}</span>
                </span>
                <Input className="!w-20" type="number" min="0" step="any" placeholder="Qty" value={qty[p.id] ?? ""} onChange={(e) => setQty({ ...qty, [p.id]: e.target.value })} />
              </li>
            ))}
            {!products.data?.length && <li className="py-4 text-center text-neutral-400">{products.loading ? "Loading…" : "No products."}</li>}
          </ul>
        </div>
      )}
      <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="me-auto text-sm">{lines.length} line(s) · approx. {money(total)} (final prices and tax are calculated when saved)</span>
        <Button disabled={busy || !customerId || !lines.length} onClick={() => void submit(false)}>Save draft</Button>
        {c.can("bookings.submit") && <Button variant="primary" disabled={busy || !customerId || !lines.length} onClick={() => void submit(true)}><Send size={14} /> Submit booking</Button>}
      </div>
      {msg && (msg.ok ? <Note tone="emerald">{msg.text}</Note> : <Err error={msg.text} />)}
    </div>
  );
}

function MyBookings() {
  const list = useLoad(() => dist.listBookings(), []);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Err error={list.error ?? msg} />
      <ul className="divide-y divide-neutral-100 rounded-xl bg-white text-sm ring-1 ring-black/5">
        {(list.data ?? []).map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="font-medium">#{b.booking_no}</span>
            <span className="min-w-0 flex-1 truncate">{b.customer_name}{b.company_name ? ` · ${b.company_name}` : ""}</span>
            <span>{money(b.total)}</span>
            <Badge tone={BOOKING_TONE[b.status]}>{b.status.replace("_", " ")}</Badge>
            {b.status === "draft" && (
              <Button onClick={async () => { setMsg(null); try { await dist.submitBooking(b.id); void list.reload(); } catch (e) { setMsg(errorText(e)); } }}>Submit</Button>
            )}
            {b.decision_note && <span className="w-full text-xs text-neutral-500">Note: {b.decision_note}</span>}
          </li>
        ))}
        {!list.data?.length && <li className="px-3 py-6 text-center text-neutral-400">{list.loading ? "Loading…" : "No bookings yet."}</li>}
      </ul>
    </div>
  );
}
