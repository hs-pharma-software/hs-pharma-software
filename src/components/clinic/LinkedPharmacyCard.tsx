"use client";

import { useEffect, useState } from "react";
import { Copy, Link2, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { isTauri } from "@/lib/platform";
import { createLinkToken, getLinkStatus, type LinkStatus } from "@/lib/repo/pharmacyLink";

const when = (iso: string) => new Date(iso).toLocaleString();

/** The clinic's / hospital's hospital pharmacy: make a token for the pharmacy
 * to enter in its settings; once the pharmacy verifies it, the link is fixed. */
export function LinkedPharmacyCard() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [made, setMade] = useState<{ token: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function reload() {
    if (isTauri()) setStatus(await getLinkStatus());
  }
  useEffect(() => { void reload().catch(() => setStatus({ link: null, pending: null })); }, []);

  async function generate() {
    if (status?.pending && !window.confirm("A token is already waiting for the pharmacy. Make a new one? The earlier token will stop working.")) return;
    setBusy(true);
    try {
      setMade(await createLinkToken());
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy the token:", made.token);
    }
  }

  const link = status?.link;
  return (
    <section className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900"><Link2 size={16} />Linked Pharmacy</h2>
        {link?.verified_at && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800"><Lock size={12} />Verified</span>}
      </div>
      {!status ? <p className="text-sm text-neutral-400">Loading…</p> : link?.verified_at ? (
        <div className="text-sm text-neutral-700">
          <p>Linked to <b>{link.pharmacy_name ?? "the hospital pharmacy"}</b> since {when(link.verified_at)}.</p>
          <p className="mt-1 text-xs text-neutral-500">Prescriptions go to this pharmacy and doctors pick medicines from its stock. The link is fixed; only the administrator can change it.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm text-neutral-700">
          <p className="text-neutral-500">
            Link the hospital pharmacy that dispenses your prescriptions. Make a token and give it to the pharmacy: they enter it in
            Settings &gt; General Settings &gt; Linked Clinic / Hospital. Once they verify it, the link is fixed.
          </p>
          {link && <p className="text-xs text-amber-700">Currently linked to {link.pharmacy_name ?? "a pharmacy"} without verification. Verify it with a token to fix the link.</p>}
          {made ? (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3">
              <p className="text-xs text-neutral-500">Token for the pharmacy (shown once, valid until {when(made.expiresAt)}):</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="select-all rounded bg-white px-2 py-1 font-mono text-base font-semibold tracking-wider text-neutral-900 ring-1 ring-neutral-200">{made.token}</code>
                <Button onClick={() => void copy()}><Copy size={14} />{copied ? "Copied" : "Copy"}</Button>
              </div>
            </div>
          ) : status.pending ? (
            <p className="text-xs text-neutral-500">A token made {when(status.pending.created_at)} is waiting for the pharmacy (valid until {when(status.pending.expires_at)}).</p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void generate()} disabled={busy}>{busy ? "Making…" : made || status.pending ? "Make a new token" : "Link pharmacy"}</Button>
            <Button onClick={() => void reload()}>Check status</Button>
          </div>
        </div>
      )}
    </section>
  );
}
