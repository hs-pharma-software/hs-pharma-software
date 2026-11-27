"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ban, Building2, CheckCircle2, ClipboardList, Shapes } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";
import { ProfileSummary } from "@/components/vendor/VendorRegistration";
import { epCounts, epReview, epSetPassword, epVendor, type AdminVendorDetail, type ReviewAction } from "@/lib/eprocurementAdminClient";
import { BUSINESS_KIND_LABEL, type BusinessKind, type VendorStatus } from "@/lib/vendorProfile";

export const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:p-5";
export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const pkr = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
export const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

export const STATUS_CLS: Record<VendorStatus, string> = {
  draft: "bg-neutral-100 text-neutral-600 ring-neutral-200", pending: "bg-sky-50 text-sky-700 ring-sky-200", changes: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200", rejected: "bg-rose-50 text-rose-700 ring-rose-200", suspended: "bg-amber-50 text-amber-800 ring-amber-200",
  blacklisted: "bg-neutral-900 text-white ring-neutral-900",
};
export const StatusPill = ({ status, label }: { status: VendorStatus; label: string }) => (
  <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${STATUS_CLS[status]}`}>{label}</span>
);

const TABS = [
  { href: "/admin/eprocurement", label: "Vendor registrations", icon: ClipboardList, count: (c: Counts) => (c.pending ?? 0) },
  { href: "/admin/eprocurement/vendors", label: "Approved vendors", icon: CheckCircle2, count: () => 0 },
  { href: "/admin/eprocurement/blacklist", label: "Blacklisted", icon: Ban, count: () => 0 },
  { href: "/admin/eprocurement/categories", label: "Business types", icon: Shapes, count: () => 0 },
  { href: "/admin/eprocurement/organizations", label: "Organizations", icon: Building2, count: () => 0 },
];
type Counts = Partial<Record<VendorStatus, number>>;

/** Super Admin > eProcurement: the section's header and its five sub-sections. */
export function EpAdminFrame({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  const path = usePathname().replace(/\/+$/, "");
  const [counts, setCounts] = useState<Counts>({});
  useEffect(() => { void epCounts().then(setCounts).catch(() => undefined); }, [path]);
  return (
    <div className="space-y-4">
      <PageHeader title="eProcurement" actions={actions} />
      <p className="-mt-2 text-sm text-neutral-600">Vendors register at <b>ep.mavin.pk</b>. Check and approve them here; only approved vendors can be added by hospitals that have eProcurement.</p>
      <div role="tablist" aria-label="eProcurement" className="flex gap-1 rounded-xl bg-neutral-200/70 p-1 text-sm">
        {TABS.map((t) => {
          const on = path === t.href;
          const n = t.count(counts);
          return (
            <Link key={t.href} href={t.href} role="tab" aria-selected={on}
              className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3 font-medium ${on ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}>
              <t.icon size={15} aria-hidden="true" />{t.label}
              {n > 0 && <span className="rounded-full bg-sky-600 px-1.5 text-[11px] font-semibold leading-5 text-white">{n}</span>}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}

/** A note the Super Admin must (or may) write with an action. */
const NOTE: Partial<Record<ReviewAction, { title: string; label: string; required: boolean; button: string; danger?: boolean }>> = {
  approve: { title: "Approve vendor", label: "Note to keep (optional)", required: false, button: "Approve" },
  requestChanges: { title: "Ask for changes", label: "What should the vendor correct?", required: true, button: "Send back for changes" },
  reject: { title: "Reject registration", label: "Reason (the vendor sees it)", required: true, button: "Reject", danger: true },
  suspend: { title: "Suspend vendor", label: "Reason (the vendor sees it)", required: true, button: "Suspend", danger: true },
  blacklist: { title: "Blacklist vendor", label: "Reason for blacklisting", required: true, button: "Blacklist", danger: true },
};
const ACTIONS: Record<VendorStatus, ReviewAction[]> = {
  draft: ["blacklist"], pending: ["approve", "requestChanges", "reject", "blacklist"], changes: ["approve", "reject", "blacklist"],
  rejected: ["approve", "blacklist"], approved: ["suspend", "blacklist"], suspended: ["reactivate", "blacklist"], blacklisted: ["unblacklist"],
};
const ACTION_LABEL: Record<ReviewAction, string> = {
  approve: "Approve", requestChanges: "Ask for changes", reject: "Reject", suspend: "Suspend", reactivate: "Reactivate", blacklist: "Blacklist", unblacklist: "Remove from blacklist",
};

/** One vendor: every registration detail, the hospitals they supply, and the actions their status allows. */
export function VendorDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [v, setV] = useState<AdminVendorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<ReviewAction | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const load = () => { void epVendor(id).then(setV).catch((e) => setError(msg(e))); };
  useEffect(load, [id]);

  async function run(action: ReviewAction) {
    const n = NOTE[action];
    if (n?.required && note.trim().length < 3) { setError(`Write ${n.label.toLowerCase()}`); document.getElementById("ep-note")?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      await epReview(action, id, note.trim() || undefined);
      notify(`${v?.name ?? "Vendor"}: ${ACTION_LABEL[action].toLowerCase()} done.`, "success");
      setActing(null); setNote(""); onChanged(); load();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  async function setPassword() {
    if (pw.length < 8) { setError("The password must be at least 8 characters."); return; }
    setBusy(true);
    setError(null);
    try { await epSetPassword(id, pw); notify("New password set. Give it to the vendor privately; they can change it after signing in.", "success"); setPwOpen(false); setPw(""); }
    catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  const missing = v ? Object.values(v.problems) : [];
  return (
    <Modal title={v ? `${v.name} · ${v.code}` : "Vendor"} onClose={onClose} width="max-w-4xl">
      {!v ? (error ? <FormError message={error} /> : <div className="h-40 animate-pulse rounded-xl bg-neutral-100" aria-busy="true" />) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusPill status={v.status} label={v.statusLabel} />
            {v.kind && <span className="text-neutral-600">{BUSINESS_KIND_LABEL[v.kind as BusinessKind] ?? v.kind}</span>}
            <span className="text-neutral-400">·</span><span className="text-neutral-600">Username <b className="font-mono">{v.username ?? "—"}</b></span>
            <span className="text-neutral-400">·</span><span className="text-neutral-600">{v.selfRegistered ? `Registered ${day(v.createdAt)}` : "Account made by a hospital (before self-registration)"}</span>
            {v.submittedAt && <><span className="text-neutral-400">·</span><span className="text-neutral-600">Submitted {day(v.submittedAt)}</span></>}
          </div>
          {v.note && <p className="rounded-xl bg-neutral-50 px-3 py-2 text-sm text-neutral-700 ring-1 ring-neutral-200"><b>{v.status === "blacklisted" ? "Blacklist reason" : "Last note"}:</b> {v.note}</p>}
          {missing.length > 0 && v.status !== "draft" && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200"><b>Incomplete:</b> {missing.slice(0, 4).join("; ")}{missing.length > 4 ? "…" : ""}</p>
          )}
          <ProfileSummary profile={v.profile} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200/70"><p className="text-xs text-neutral-500">Hospitals</p><p className="text-lg font-bold">{v.hospitalNames.length}</p>
              <p className="truncate text-xs text-neutral-500" title={v.hospitalNames.join(", ")}>{v.hospitalNames.join(", ") || "None yet"}</p></div>
            <div className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200/70"><p className="text-xs text-neutral-500">Purchase orders</p><p className="text-lg font-bold">{v.orders}</p></div>
            <div className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200/70"><p className="text-xs text-neutral-500">Orders value</p><p className="text-lg font-bold">{pkr(v.ordersValue)}</p></div>
          </div>

          {acting && NOTE[acting] && (
            <div className="rise-in rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
              <Field label={NOTE[acting]!.label} required={NOTE[acting]!.required}>
                <Textarea id="ep-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
              </Field>
              <div className="mt-2 flex justify-end gap-2">
                <Button onClick={() => { setActing(null); setNote(""); setError(null); }}>Cancel</Button>
                <Button variant={NOTE[acting]!.danger ? "danger" : "primary"} loading={busy} disabled={busy} onClick={() => void run(acting)}>{NOTE[acting]!.button}</Button>
              </div>
            </div>
          )}
          {pwOpen && (
            <div className="rise-in rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
              <Field label="New password" hint="Last resort: vendors normally reset it themselves by the emailed code (Forgot password).">
                <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus />
              </Field>
              <div className="mt-2 flex justify-end gap-2">
                <Button onClick={() => { setPwOpen(false); setPw(""); }}>Cancel</Button>
                <Button variant="primary" loading={busy} disabled={busy} onClick={() => void setPassword()}>Set password</Button>
              </div>
            </div>
          )}
          <FormError message={error} />
          <div className="form-actions flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-3">
            {!acting && !pwOpen && <Button variant="ghost" onClick={() => setPwOpen(true)}>Set password</Button>}
            {!acting && !pwOpen && ACTIONS[v.status].map((a) => (
              <Button key={a} variant={a === "approve" || a === "reactivate" || a === "unblacklist" ? "primary" : a === "blacklist" || a === "reject" ? "danger" : "secondary"}
                loading={busy && acting === a} disabled={busy}
                onClick={() => { setError(null); if (NOTE[a]) setActing(a); else void run(a); }}>{ACTION_LABEL[a]}</Button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
