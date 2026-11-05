"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { appLabel, money, ownerCall, when } from "@/lib/subSupersClient";
import { Notice, PaymentPill, SetupLink, StatusPill, errText } from "./shared";

interface Loaded { request: Record<string, unknown>; events: Record<string, unknown>[]; problems: string[] }

/** The owner's review of one customer setup: verify payment, return, reject or activate. */
export function RequestReviewModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState({ amount: "", reference: "", note: "" });
  const [reason, setReason] = useState("");
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setD(await ownerCall<Loaded>("getRequest", { id }));
    } catch (e) {
      setError(errText(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(label);
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const r = d?.request;
  const status = String(r?.status ?? "");
  const open = status === "submitted" || status === "under_review";
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b border-neutral-100 py-1.5 text-sm"><span className="text-neutral-500">{label}</span><span className="text-right text-neutral-800">{value}</span></div>
  );

  return (
    <Modal title={r ? `Setup: ${String(r.business_name ?? "")}` : "Setup"} onClose={onClose} width="max-w-3xl">
      {!r ? (
        error ? <Notice kind="error">{error}</Notice> : <p className="py-6 text-center text-sm text-neutral-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2"><StatusPill status={status} /><PaymentPill status={String(r.payment_status)} /></div>
          {Number(r.needs_owner_review) === 1 && <Notice kind="warn">Needs your review: {String(r.owner_review_reason)}</Notice>}
          {error && <Notice kind="error">{error}</Notice>}
          {msg && <Notice kind="ok">{msg}</Notice>}
          {link && <SetupLink url={link} who={String(r.owner_name ?? "the customer")} />}

          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              {row("Distributor", `${String(r.distributor_name)}${r.distributor_status === "suspended" ? " (suspended)" : ""}`)}
              {row("Application", appLabel(r.app_id))}
              {row("Plan", `${String(r.plan_name ?? "—")} · ${money(r.plan_price)}`)}
              {row("Business", String(r.business_name ?? "—"))}
              {row("Owner", `${String(r.owner_name ?? "—")} · ${String(r.phone ?? "—")}`)}
              {row("Email", String(r.email ?? "—"))}
              {row("City / address", `${String(r.city ?? "—")} · ${String(r.address ?? "—")}`)}
              {row("NTN", String(r.ntn ?? "—"))}
              {row("Proposed login ID", String(r.proposed_username ?? "—"))}
            </div>
            <div>
              {row("Expected amount", money(r.expected_amount))}
              {row("Reported amount", money(r.claimed_amount))}
              {row("Reported reference", String(r.payment_reference ?? "—"))}
              {row("Reported payment date", String(r.payment_date ?? "—"))}
              {row("Verified amount", money(r.verified_amount))}
              {row("Submitted", when(r.submitted_at))}
              {status === "activated" && row("Activated", when(r.activated_at))}
              {status === "rejected" && row("Rejected", `${when(r.rejected_at)}: ${String(r.reject_reason)}`)}
              {r.notes ? row("Notes", String(r.notes)) : null}
            </div>
          </div>

          {open && (
            <>
              {status === "submitted" && <Button disabled={busy} onClick={() => void run("Review started.", () => ownerCall("startReview", { id }))}>Start review</Button>}

              {r.payment_status !== "verified" && (
                <section className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
                  <h3 className="text-sm font-semibold text-neutral-800">Verify payment</h3>
                  <p className="text-xs text-neutral-500">Check your bank or wallet record. Enter the amount you actually received and the reference you see.</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <Field label="Amount received"><Input id="rv-amount" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
                    <Field label="Reference"><Input id="rv-ref" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
                    <Field label="Note (needed if the amount differs)"><Input id="rv-note" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></Field>
                  </div>
                  <Button className="mt-2" disabled={busy} onClick={() => void run("Payment verified.", () => ownerCall("verifyPayment", { id, ...pay }))}>Verify payment</Button>
                </section>
              )}

              <section className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
                <h3 className="text-sm font-semibold text-neutral-800">Approve and activate</h3>
                {d.problems.length ? (
                  <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">{d.problems.map((p) => <li key={p}>{p}</li>)}</ul>
                ) : (
                  <p className="mt-1 text-sm text-neutral-600">Creates the business, its owner login and the subscription (starting today), and gives you a one-time sign-in link for the owner.</p>
                )}
                <Button
                  variant="primary"
                  className="mt-2"
                  disabled={busy || d.problems.length > 0}
                  onClick={() => void run("Activated.", async () => {
                    const res = await ownerCall<{ setupLink: string | null; alreadyActivated: boolean }>("activate", { id });
                    if (res.setupLink) setLink(res.setupLink);
                  })}
                >
                  Approve and activate
                </Button>
              </section>

              <section className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
                <Field label="Reason (for return or rejection)"><Textarea id="rv-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void run("Returned to the distributor for correction.", () => ownerCall("return", { id, reason }))}>Return for correction</Button>
                  <Button variant="danger" disabled={busy} onClick={() => void run("Rejected.", () => ownerCall("reject", { id, reason }))}>Reject</Button>
                </div>
              </section>
            </>
          )}

          {status === "activated" && (
            <Button disabled={busy} onClick={() => void ownerCall<{ setupLink: string }>("customerLink", { id }).then((x) => setLink(x.setupLink)).catch((e) => setError(errText(e)))}>
              New sign-in link for the customer
            </Button>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold text-neutral-800">History</h3>
            <ul className="space-y-1 text-xs text-neutral-600">
              {d.events.map((e) => <li key={String(e.id)}>{when(e.created_at)} · {String(e.actor_role)} · {String(e.action).replace(/_/g, " ")}{e.reason ? `: ${String(e.reason)}` : ""}</li>)}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}
