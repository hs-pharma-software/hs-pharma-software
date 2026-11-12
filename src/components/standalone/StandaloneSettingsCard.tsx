"use client";

/** Settings › Mavin Pharmacy Offline (local Super Admin): license and renewal,
 * the recovery key, backups, the medicine catalogue and the local audit log. */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LICENSE_CHANGED, localBridge, localSession, unwrap, type CatalogueStatus, type LicenseInfo, type Row, type StandaloneInfo } from "@/lib/edition";
import { useAuthStore } from "@/store/authStore";
import { RecoveryKeyNotice } from "./RecoveryKeyNotice";

const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }) : "never");
const box = "rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200";

export function StandaloneSettingsCard() {
  const local = localBridge();
  const userId = useAuthStore((s) => s.currentUser?.id);
  const [info, setInfo] = useState<StandaloneInfo | null>(null);
  const [lic, setLic] = useState<(LicenseInfo & { canTransact?: boolean }) | null>(null);
  const [cat, setCat] = useState<CatalogueStatus | null>(null);
  const [audit, setAudit] = useState<Row[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [paste, setPaste] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!local) return;
    try {
      setInfo(await unwrap(local.info()));
      setLic(await unwrap(local.license()));
      setCat(await unwrap(local.catalogueStatus()));
      const a = await local.audit({ session: localSession(), limit: 30 });
      if (a.ok) setAudit(a.value);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  }, [local]);
  useEffect(() => { void load(); }, [load]);

  if (!local || !info) return null;
  const isAdmin = info.superAdminUserId === userId;
  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    setMsg(null);
    try { const t = await f(); if (t) setMsg({ ok: true, text: t }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    setBusy(false);
    void load();
  };

  return (
    <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div>
        <h2 className="text-base font-semibold text-neutral-900">Mavin Pharmacy Offline</h2>
        <p className="text-xs text-neutral-500">Version {info.appVersion} · Installation {info.installationId} · Data folder {info.dataFolder}</p>
      </div>
      {msg && <p className={`whitespace-pre-line rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
      {!isAdmin && <p className="text-sm text-neutral-600">License, backups and the recovery key are managed by this pharmacy&apos;s local Super Admin.</p>}

      {lic && (
        <div className={box}>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">License (separate from medicine expiry)</p>
          <p className={`mt-1 text-sm font-semibold ${lic.canTransact === false ? "text-rose-700" : lic.status === "active" ? "text-emerald-700" : "text-amber-700"}`}>
            {lic.status === "active" ? "Active" : lic.status === "trial" ? "Trial" : lic.status === "expired" ? "Expired" : "Not valid"} · expires {lic.expiresAt ? new Date(lic.expiresAt).toDateString() : "—"}{lic.daysLeft !== null && lic.daysLeft >= 0 ? ` (${lic.daysLeft} day(s) left)` : ""}
          </p>
          <p className="text-sm text-neutral-600">{lic.message}</p>
          {isAdmin && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void run(async () => { setCode((await unwrap(local.requestCode())).code); return null; })}>Show request code</Button>
                <Button disabled={busy} onClick={() => void run(async () => { const r = await unwrap(local.importLicense({ session: localSession(), fromFile: true })); setLic(r); window.dispatchEvent(new Event(LICENSE_CHANGED)); return `License imported: ${r.message}`; })}>Import license file…</Button>
              </div>
              {code && (
                <div>
                  <p className="text-xs text-neutral-500">Send this code to MAVIN.pk to get an activation or renewal (it holds this installation&apos;s id, not a secret):</p>
                  <p className="select-all break-all rounded bg-white px-2 py-1 font-mono text-xs ring-1 ring-neutral-200">{code}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…or paste the license text (MAVIN-LICENSE-1…)" rows={2} className="min-w-64 flex-1 rounded-lg px-2 py-1 font-mono text-xs ring-1 ring-neutral-200" />
                <Button disabled={busy || !paste.trim()} onClick={() => void run(async () => { const r = await unwrap(local.importLicense({ session: localSession(), text: paste })); setPaste(""); setLic(r); window.dispatchEvent(new Event(LICENSE_CHANGED)); return `License imported: ${r.message}`; })}>Import pasted license</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className={box}>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Backups</p>
          <p className="text-sm text-neutral-600">A copy is also made automatically once a day (the last 14 are kept in the data folder).</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void run(async () => { const r = await unwrap(local.backup({ session: localSession() })); return r ? `Backup saved: ${r.path}` : null; })}>Back up now…</Button>
            <Button disabled={busy} onClick={() => void run(async () => { const r = await unwrap(local.restore({ session: localSession() })); return r ? `Restored from ${r.path}. Sign in again.` : null; })}>Restore from a backup…</Button>
          </div>
        </div>
      )}

      {cat && (
        <div className={box}>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Medicine catalogue</p>
          <p className="text-sm text-neutral-700">{cat.products} catalogue products · version {cat.version ?? "—"}</p>
          <p className="text-sm text-neutral-600">Last update {when(cat.lastSuccessAt)}{cat.pending ? " · an update is due (it runs when the internet is available)" : ""}{cat.running ? " · updating now…" : ""}</p>
          {cat.lastError && <p className="text-xs text-amber-800">Last attempt {when(cat.lastAttemptAt)}: {cat.lastError}</p>}
          <p className="text-xs text-neutral-500">Download only, from {cat.source}. Your own products, prices, stock and edits are never changed.</p>
          <Button className="mt-2" disabled={busy || cat.running} onClick={() => void run(async () => { const s = await unwrap(local.catalogueSync()); setCat(s); return s.lastError ? null : "Catalogue is up to date."; })}>Update now</Button>
        </div>
      )}

      {isAdmin && (
        <div className={box}>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Recovery key</p>
          {newKey ? (
            <RecoveryKeyNotice recoveryKey={newKey} title="Your new recovery key (the old one no longer works)" onDone={() => setNewKey(null)} doneLabel="Done" />
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-sm text-neutral-600">Lost the key? Make a new one (your password is needed).</p>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Your password" className="rounded-lg px-2 py-1.5 text-sm ring-1 ring-neutral-200" />
              <Button disabled={busy || !pw} onClick={() => void run(async () => { const r = await unwrap(local.newRecoveryKey({ session: localSession(), password: pw })); setPw(""); setNewKey(r.recoveryKey); return null; })}>New recovery key</Button>
            </div>
          )}
        </div>
      )}

      {isAdmin && audit.length > 0 && (
        <details className={box}>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-neutral-400">Security log (latest {audit.length})</summary>
          <ul className="mt-2 divide-y divide-neutral-200 text-xs">
            {audit.map((a) => <li key={String(a.id)} className="py-1"><span className="text-neutral-500">{when(String(a.at))}</span> · <b>{String(a.action)}</b>{a.actor ? ` · ${String(a.actor)}` : ""}{a.detail ? ` · ${String(a.detail)}` : ""}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
