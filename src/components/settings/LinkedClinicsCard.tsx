"use client";

import { useEffect, useState } from "react";
import { Link2, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { listLinkedClinics, verifyLinkToken } from "@/lib/repo/pharmacyLink";
import type { ClinicPharmacyLink } from "@/lib/types-clinic";

/** Hospital pharmacy, General Settings: enter the token a clinic or hospital
 * made to link it to this pharmacy. Verified links are fixed. */
export function LinkedClinicsCard() {
  const isOwner = useAuthStore((s) => s.currentUser?.role === "owner");
  const [links, setLinks] = useState<ClinicPharmacyLink[] | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function reload() {
    if (isTauri()) setLinks(await listLinkedClinics());
  }
  useEffect(() => { void reload().catch(() => setLinks([])); }, []);

  async function verify() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await verifyLinkToken(token);
      setMessage({ ok: true, text: `Verified. ${r.clinicName} is now linked to this pharmacy.` });
      setToken("");
      await reload();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold tracking-tight text-neutral-900"><Link2 size={16} />Linked Clinic / Hospital</h2>
      <p className="mb-3 text-sm text-neutral-500">
        A clinic or hospital makes a token in its settings (Linked Pharmacy). Enter it here to receive its prescriptions and let its doctors pick medicines from your stock.
      </p>
      {links && links.length > 0 && (
        <ul className="mb-3 divide-y divide-neutral-100 rounded-xl border border-neutral-200">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium text-neutral-800">{l.clinic_name ?? "Clinic / hospital"}</span>
              {l.verified_at
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800"><Lock size={12} />Verified {new Date(l.verified_at).toLocaleDateString()}</span>
                : <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">Not verified</span>}
            </li>
          ))}
        </ul>
      )}
      {isOwner ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-72 max-w-full">
            <Field label={links?.length ? "Link another clinic or hospital" : "Token"}>
              <Input id="link-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="HSL-XXXX-XXXX-XXXX-XXXX" className="font-mono uppercase" />
            </Field>
          </div>
          <Button variant="primary" onClick={() => void verify()} disabled={busy || !token.trim()}>{busy ? "Verifying…" : "Verify and link"}</Button>
        </div>
      ) : (
        <p className="text-xs text-neutral-500">Only the owner login can link a clinic or hospital.</p>
      )}
      {message && <p className={`mt-2 text-sm ${message.ok ? "text-emerald-700" : "text-rose-600"}`}>{message.text}</p>}
      <p className="mt-2 text-xs text-neutral-400">A verified link is fixed; only the administrator can remove it.</p>
    </section>
  );
}
