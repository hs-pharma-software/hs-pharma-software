"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";
import { SERVER_DB, desktopViaServer, serverJson } from "@/lib/serverMode";
import type { VendorLoginRow, VendorOption } from "@/server/vendorPortal";
import { addDirectoryVendor, searchEpVendors } from "@/lib/repo/purchaseOrders";
import { useAuthStore } from "@/store/authStore";
import { EprocurementInactive } from "@/components/vendor/portal";

const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:p-5";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const call = async <T,>(body: Record<string, unknown>) => (await serverJson<{ result: T }>("/api/hospital/vendor-logins/", body)).result;

const STATUS_CLS: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200", suspended: "bg-amber-50 text-amber-800 ring-amber-200",
  blacklisted: "bg-rose-50 text-rose-700 ring-rose-200",
};

/** Approved portal vendors (the eProcurement directory) found by name, number, email, phone or address. */
function useDirectory(q: string) {
  const [found, setFound] = useState<VendorOption[] | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      void searchEpVendors(term).then((r) => { if (alive) setFound(r.filter((v) => v.source === "directory")); }).catch(() => { if (alive) setFound([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  return found;
}

function DirectoryList({ found, actionLabel, busy, onPick }: { found: VendorOption[] | null; actionLabel: string; busy: string | null; onPick: (v: VendorOption) => void }) {
  if (found === null) return <p className="mt-2 text-xs text-neutral-400">Type at least 2 letters: name, EP number, email, phone or address.</p>;
  if (!found.length) return <p className="fade-in mt-3 text-sm text-neutral-500">No approved vendor found. Ask the vendor to register at <b>ep.mavin.pk</b>; they appear here once MAVIN.pk approves them.</p>;
  return (
    <ul className="mt-2 divide-y divide-neutral-100">
      {found.map((v, i) => (
        <li key={v.key} className="row-in flex items-center gap-3 py-2.5" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-neutral-900">{v.name}{v.number ? <span className="ml-1.5 font-mono text-[11px] font-normal text-neutral-400">{v.number}</span> : null}</p>
            <p className="truncate text-xs text-neutral-500">{[v.phone, v.email, v.address].filter(Boolean).join(" · ") || "—"}</p>
          </div>
          <Button loading={busy === v.key} disabled={busy !== null} onClick={() => onPick(v)}>{actionLabel}</Button>
        </li>
      ))}
    </ul>
  );
}

/** Purchase Cell > eProcurement > Vendors: this hospital's suppliers on the vendor portal.
 * Vendors register themselves at ep.mavin.pk and are approved by MAVIN.pk; the
 * hospital adds them from the directory (or links one of its own suppliers to
 * one). It never creates a vendor's login or sets their password. */
export default function VendorLoginsPage() {
  const online = SERVER_DB || desktopViaServer();
  const active = useAuthStore((s) => s.currentTenant?.eprocurementAllowed === true);
  const [rows, setRows] = useState<VendorLoginRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [dirQ, setDirQ] = useState("");
  const found = useDirectory(dirQ);
  const [linking, setLinking] = useState<VendorLoginRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await call<VendorLoginRow[]>({ action: "list" })); setError(null); }
    catch (e) { setRows([]); setError(/no such (table|column)/i.test(msg(e)) ? "The vendor portal needs the database update (v111)." : msg(e)); }
  }, []);
  useEffect(() => { if (online && active) void load(); }, [load, online, active]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || `${r.vendorName} ${r.vendorNo ?? ""} ${r.epCode ?? ""} ${r.phone ?? ""}`.toLowerCase().includes(q));
  }, [rows, search]);
  const onPortal = shown.filter((r) => r.epVendorId || r.username);
  const offPortal = shown.filter((r) => !r.epVendorId && !r.username);

  async function setOn(r: VendorLoginRow, on: boolean) {
    setBusy(r.vendorId);
    try { await call({ action: "active", vendorId: r.vendorId, active: on }); notify(`${r.vendorName}: ${on ? "turned on" : "turned off"} for your hospital.`, "success"); await load(); }
    catch (e) { notify(msg(e)); } finally { setBusy(null); }
  }
  async function add(v: VendorOption) {
    if (!v.epVendorId) return;
    setBusy(v.key);
    try { await addDirectoryVendor(v.epVendorId); notify(`${v.name} added to your vendors. They now see your quote requests and orders.`, "success"); setDirQ(""); await load(); }
    catch (e) { notify(msg(e)); } finally { setBusy(null); }
  }

  if (!active) return <EprocurementInactive title="Vendors" />;
  if (!online) {
    return (
      <div>
        <PageHeader title="Vendors" />
        <p className={`${card} text-sm text-neutral-600`}>Portal vendors are managed on the web version of MAVIN.pk (the vendor portal works online only).</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Vendors" />
      <p className="text-sm text-neutral-600">
        Vendors register themselves on the <b>vendor portal</b> at <b>ep.mavin.pk</b> and are checked and approved by MAVIN.pk. Add an approved vendor here:
        they then see only the quote requests and purchase orders your hospital sends them. Each vendor keeps their own login and password.
      </p>

      <section className={card}>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-800"><Search size={15} aria-hidden="true" />Add a vendor from the eProcurement directory</h2>
        <div className="max-w-md"><Input value={dirQ} onChange={(e) => setDirQ(e.target.value)} placeholder="Vendor name, EP number, email, phone or city" aria-label="Search the eProcurement directory" /></div>
        <DirectoryList found={found} actionLabel="Add" busy={busy} onPick={(v) => void add(v)} />
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-800">Your vendors on the portal</h2>
          <div className="w-full max-w-xs"><Field label="Find"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vendor, vendor no or EP number" /></Field></div>
        </div>
        <FormError message={error} className="mt-3" />
        {rows === null ? <div className="mt-3 h-24 animate-pulse rounded-xl bg-neutral-100" aria-busy="true" />
          : onPortal.length === 0 ? <p className="fade-in mt-4 text-sm text-neutral-400">No portal vendors yet. Search the directory above to add one.</p> : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {onPortal.map((r, i) => (
              <li key={r.vendorId} className="row-in flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate text-sm font-semibold">{r.vendorName}{r.epCode ? <span className="ml-1.5 font-mono text-[11px] font-normal text-neutral-400">{r.epCode}</span> : null}</p>
                  <p className="text-xs text-neutral-500">
                    {r.accountStatus && r.accountStatus !== "approved"
                      ? <span className={`mr-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${STATUS_CLS[r.accountStatus] ?? "bg-neutral-100 text-neutral-600 ring-neutral-200"}`}>{r.accountStatusLabel} by MAVIN.pk</span>
                      : <span className={r.active ? "text-emerald-700" : "text-rose-700"}>{r.active ? "Active here" : "Turned off here"}</span>}
                    {r.vendorNo && <> · your no {r.vendorNo}</>}
                    {r.sharedWith > 0 && <> · also supplies {r.sharedWith} other hospital{r.sharedWith === 1 ? "" : "s"}</>}
                  </p>
                </div>
                {r.accountStatus === "approved" && (
                  <Button variant="ghost" loading={busy === r.vendorId} disabled={busy !== null} onClick={() => void setOn(r, !r.active)}>{r.active ? "Turn off here" : "Turn on here"}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {offPortal.length > 0 && (
        <section className={card}>
          <h2 className="text-sm font-semibold text-neutral-800">Your suppliers not on the portal</h2>
          <p className="mt-1 text-xs text-neutral-500">If one of them has registered at ep.mavin.pk, link it to their portal account: its records and history here stay as they are.</p>
          <ul className="mt-2 divide-y divide-neutral-100">
            {offPortal.map((r) => (
              <li key={r.vendorId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                <p className="min-w-0 flex-1 basis-56 truncate text-sm">{r.vendorName}{r.vendorNo ? <span className="ml-1.5 font-mono text-[11px] text-neutral-400">{r.vendorNo}</span> : null}{r.phone ? <span className="ml-2 text-xs text-neutral-400">{r.phone}</span> : null}</p>
                <Button variant="ghost" onClick={() => setLinking(r)}><Link2 size={13} className="mr-1" />Link to portal vendor</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {linking && <LinkModal row={linking} onClose={() => setLinking(null)} onDone={(m) => { setLinking(null); notify(m, "success"); void load(); }} />}
    </div>
  );
}

function LinkModal({ row, onClose, onDone }: { row: VendorLoginRow; onClose: () => void; onDone: (message: string) => void }) {
  const [q, setQ] = useState(row.vendorName);
  const found = useDirectory(q);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function link(v: VendorOption) {
    setBusy(v.key);
    setError(null);
    try { await call({ action: "link", vendorId: row.vendorId, epVendorId: v.epVendorId }); onDone(`${row.vendorName} is now linked to ${v.name}'s portal account.`); }
    catch (e) { setError(msg(e)); } finally { setBusy(null); }
  }
  return (
    <Modal title={`Link ${row.vendorName} to a portal vendor`} onClose={onClose} width="max-w-lg">
      <Field label="Find the vendor's portal account"><Input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Name, EP number, email or phone" /></Field>
      <DirectoryList found={found} actionLabel="Link" busy={busy} onPick={(v) => void link(v)} />
      <FormError message={error} className="mt-3" />
      <div className="form-actions mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
