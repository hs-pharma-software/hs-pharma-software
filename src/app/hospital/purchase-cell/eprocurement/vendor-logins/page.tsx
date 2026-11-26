"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";
import { SERVER_DB, desktopViaServer, serverJson } from "@/lib/serverMode";
import type { VendorLoginRow } from "@/server/vendorPortal";
import { useAuthStore } from "@/store/authStore";
import { EprocurementInactive } from "@/components/vendor/portal";

const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:p-5";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const call = async <T,>(body: Record<string, unknown>) => (await serverJson<{ result: T }>("/api/hospital/vendor-logins/", body)).result;

/** Purchase Cell > eProcurement > Vendor Logins: a login for each supplier / vendor to the vendor portal,
 * where they quote rates, receive purchase orders and submit invoices. */
export default function VendorLoginsPage() {
  const online = SERVER_DB || desktopViaServer();
  const active = useAuthStore((s) => s.currentTenant?.eprocurementAllowed === true);
  const [rows, setRows] = useState<VendorLoginRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ row: VendorLoginRow; mode: "create" | "password" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await call<VendorLoginRow[]>({ action: "list" })); setError(null); }
    catch (e) { setRows([]); setError(/no such table/i.test(msg(e)) ? "The vendor portal needs the database update (v109)." : msg(e)); }
  }, []);
  useEffect(() => { if (online && active) void load(); }, [load, online, active]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || `${r.vendorName} ${r.vendorNo ?? ""} ${r.username ?? ""} ${r.phone ?? ""}`.toLowerCase().includes(q));
  }, [rows, search]);

  async function setActive(r: VendorLoginRow, active: boolean) {
    setBusy(r.vendorId);
    try { await call({ action: "active", vendorId: r.vendorId, active }); notify(`${r.vendorName}: ${active ? "turned on" : "turned off"} for your hospital.`, "success"); await load(); }
    catch (e) { notify(msg(e)); } finally { setBusy(null); }
  }

  if (!active) return <EprocurementInactive title="Vendor Logins" />;
  if (!online) {
    return (
      <div>
        <PageHeader title="Vendor Logins" />
        <p className={`${card} text-sm text-neutral-600`}>Vendor logins are made on the web version of MAVIN.pk (the vendor portal works online only).</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Vendor Logins" />
      <p className="mb-3 text-sm text-neutral-600">
        Give a supplier or vendor a login to the <b>vendor portal</b> at <b>ep.mavin.pk</b>. There they see only the quote requests and purchase orders sent to them, quote their rates and submit invoices.
        A vendor has one login for every hospital they supply; vendors other hospitals already use can be added from the vendor search in New Order.
      </p>
      <div className={card}>
        <div className="max-w-sm"><Field label="Find"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vendor, vendor no or username" /></Field></div>
        <FormError message={error} className="mt-3" />
        {rows === null ? <div className="mt-3 h-24 animate-pulse rounded-xl bg-neutral-100" aria-busy="true" />
          : shown.length === 0 ? <p className="fade-in mt-4 text-sm text-neutral-400">No suppliers or vendors. Add them in Purchase Cell › Supplier &amp; Vendors.</p> : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {shown.map((r, i) => (
              <li key={r.vendorId} className="row-in flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate text-sm font-medium">{r.vendorName}{r.vendorNo ? <span className="ml-1.5 font-mono text-[11px] text-neutral-400">{r.vendorNo}</span> : null}</p>
                  <p className="text-xs text-neutral-500">
                    {r.username ? <>Username <b className="font-mono">{r.username}</b> · <span className={r.active ? "text-emerald-700" : "text-rose-700"}>{r.active ? "active here" : "turned off here"}</span>
                      {r.sharedWith > 0 && <> · also supplies {r.sharedWith} other hospital{r.sharedWith === 1 ? "" : "s"}</>}</> : "No login yet"}
                  </p>
                  {r.username && !r.canResetPassword && <p className="text-[11px] text-neutral-400">Account made by another hospital: the vendor changes its password in the portal.</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.username ? <>
                    {r.canResetPassword && <Button variant="ghost" onClick={() => setEditing({ row: r, mode: "password" })}><KeyRound size={13} className="mr-1" />New password</Button>}
                    <Button variant="ghost" loading={busy === r.vendorId} disabled={busy !== null} onClick={() => void setActive(r, !r.active)}>{r.active ? "Turn off here" : "Turn on here"}</Button>
                  </> : <Button onClick={() => setEditing({ row: r, mode: "create" })}><UserPlus size={13} className="mr-1" />Create login</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && <LoginModal row={editing.row} mode={editing.mode} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); notify(m, "success"); void load(); }} />}
    </div>
  );
}

function LoginModal({ row, mode, onClose, onDone }: { row: VendorLoginRow; mode: "create" | "password"; onClose: () => void; onDone: (message: string) => void }) {
  const suggested = row.vendorNo ? row.vendorNo.toLowerCase() : row.vendorName.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 30);
  const [username, setUsername] = useState(mode === "create" ? suggested : row.username ?? "");
  const [password, setPassword] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badUser = mode === "create" && !/^[A-Za-z0-9._@-]{3,60}$/.test(username.trim());
  const badPass = password.length < 6;
  async function save() {
    setTried(true);
    if (badUser) { document.getElementById("vl-user")?.focus(); return; }
    if (badPass) { document.getElementById("vl-pass")?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      if (mode === "create") await call({ action: "create", vendorId: row.vendorId, username: username.trim(), password });
      else await call({ action: "password", vendorId: row.vendorId, password });
      onDone(mode === "create" ? `Login made for ${row.vendorName}. Give them the username and password.` : `New password set for ${row.vendorName}.`);
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={mode === "create" ? `Vendor portal login · ${row.vendorName}` : `New password · ${row.vendorName}`} onClose={onClose} width="max-w-md">
      <div className="flex flex-col gap-3">
        <Field label="Username" required={mode === "create"} error={tried && badUser ? "At least 3 letters or digits, no spaces" : undefined}>
          <Input id="vl-user" value={username} readOnly={mode !== "create"} onChange={(e) => setUsername(e.target.value)} aria-invalid={(tried && badUser) || undefined} autoComplete="off" autoFocus={mode === "create"} />
        </Field>
        <Field label="Password" required error={tried && badPass ? "At least 6 characters" : undefined} hint="Share it with the vendor privately; they can change it after signing in.">
          <Input id="vl-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={(tried && badPass) || undefined} autoComplete="new-password" autoFocus={mode !== "create"} />
        </Field>
      </div>
      <FormError message={error} className="mt-3" />
      <div className="form-actions mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={busy} onClick={() => void save()}>{mode === "create" ? "Create login" : "Set password"}</Button>
      </div>
    </Modal>
  );
}
