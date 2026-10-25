"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, CheckCircle2, ArrowLeft, BedDouble } from "lucide-react";
import { AdmitModal, AdmissionBadge } from "@/components/hospital/AdmitModal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import {
  hospitalEpisodesRepo, hospitalPatientsRepo, hospitalServicesRepo,
  listChargesForEpisode, addCharge, deleteCharge,
  listPaymentsForEpisode, addPayment,
  type HospitalPatient, type HospitalService, type HospitalCharge, type HospitalPayment,
} from "@/lib/repo/hospital";
import type { HospitalEpisode, PaymentMethod } from "@/lib/types-hospital";
import { localDate, localDateTime } from "@/lib/localDate";

export default function EpisodeDetailPage() {
  // Static export: the id arrives as ?id=, read after mount.
  const [id, setId] = useState<string | null>(null);
  useEffect(() => setId(new URLSearchParams(window.location.search).get("id")), []);
  const router = useRouter();

  const [episode, setEpisode] = useState<HospitalEpisode | null>(null);
  const [patient, setPatient] = useState<HospitalPatient | null>(null);
  const [charges, setCharges] = useState<HospitalCharge[]>([]);
  const [payments, setPayments] = useState<HospitalPayment[]>([]);
  const [services, setServices] = useState<HospitalService[]>([]);

  // Add charge form
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [chargeDesc, setChargeDesc] = useState("");
  const [chargeQty, setChargeQty] = useState("1");
  const [chargeRate, setChargeRate] = useState("");
  const [chargeDisc, setChargeDisc] = useState("0");
  const [chargeNotes, setChargeNotes] = useState("");
  const [addingCharge, setAddingCharge] = useState(false);

  // Add payment form
  const [payType, setPayType] = useState<"deposit" | "payment" | "refund">("payment");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [addingPayment, setAddingPayment] = useState(false);

  const [discharging, setDischarging] = useState(false);
  const [admission, setAdmission] = useState<HospitalEpisode | null>(null);
  const [declined, setDeclined] = useState<HospitalEpisode | null>(null);
  const [showAdmit, setShowAdmit] = useState(false);

  async function reload() {
    if (!isTauri() || !id) return;
    const [ep, svcList] = await Promise.all([
      hospitalEpisodesRepo.get(id),
      hospitalServicesRepo.list({ orderBy: "name ASC" }),
    ]);
    setEpisode(ep);
    setServices(svcList);
    if (ep && ep.type !== "ipd") {
      const fromHere = await hospitalEpisodesRepo.list({ where: "from_episode_id = ?", params: [ep.id] });
      setAdmission(fromHere.find((x) => x.status !== "cancelled") ?? null);
      setDeclined(fromHere.find((x) => x.admission_status === "declined") ?? null);
    }
    if (ep?.patient_id) {
      const p = await hospitalPatientsRepo.get(ep.patient_id);
      setPatient(p);
    }
    const [c, p] = await Promise.all([
      listChargesForEpisode(id),
      listPaymentsForEpisode(id),
    ]);
    setCharges(c);
    setPayments(p);
  }

  useEffect(() => { void reload(); }, [id]);

  function onServiceSelect(svcId: string) {
    setSelectedServiceId(svcId);
    const svc = services.find((s) => s.id === svcId);
    if (svc) {
      setChargeDesc(svc.name);
      setChargeRate(String(svc.rate));
    }
  }

  async function submitCharge() {
    if (!chargeDesc.trim() || !id) return;
    setAddingCharge(true);
    try {
      await addCharge({
        tenant_id: episode?.tenant_id ?? "",
        episode_id: id,
        service_id: selectedServiceId || null,
        description: chargeDesc.trim(),
        department: services.find((s) => s.id === selectedServiceId)?.department ?? null,
        category: services.find((s) => s.id === selectedServiceId)?.category ?? null,
        qty: Number(chargeQty),
        rate: Number(chargeRate) || 0,
        discount_pct: Number(chargeDisc) || 0,
        amount: 0, // worked out when saved
        doctor_id: null,
        performed_by: null,
        charge_date: episode?.date ?? localDate(),
        notes: chargeNotes.trim() || null,
        invoice_id: null,
      });
      setSelectedServiceId(""); setChargeDesc(""); setChargeQty("1"); setChargeRate(""); setChargeDisc("0"); setChargeNotes("");
      await reload();
    } catch (e) {
      window.alert(`Could not add the charge: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAddingCharge(false);
    }
  }

  async function submitPayment() {
    if (!payAmount || !id) return;
    setAddingPayment(true);
    try {
      await addPayment({
        tenant_id: episode?.tenant_id ?? "",
        episode_id: id,
        type: payType,
        amount: Number(payAmount),
        method: payMethod,
        reference: payRef.trim() || null,
        notes: payNotes.trim() || null,
        received_at: localDateTime(),
      });
      setPayAmount(""); setPayRef(""); setPayNotes("");
      await reload();
    } catch (e) {
      window.alert(`Could not save the payment: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAddingPayment(false);
    }
  }

  async function handleDischarge() {
    if (!id) return;
    const unpaid = charges.reduce((s, c) => s + c.amount, 0)
      - payments.reduce((s, p) => s + (p.type === "refund" ? -p.amount : p.amount), 0);
    const question = unpaid > 0.5
      ? `This episode still has Rs ${unpaid.toFixed(0)} unpaid. Discharge anyway?`
      : "Mark this episode as discharged?";
    if (!window.confirm(question)) return;
    setDischarging(true);
    try {
      await hospitalEpisodesRepo.update(id, {
        status: "discharged",
        discharge_date: localDate(),
      });
      await reload();
    } catch (e) {
      window.alert(`Could not discharge: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDischarging(false);
    }
  }

  const totalCharges = charges.reduce((s, c) => s + c.amount, 0);
  const totalPaid = payments.filter((p) => p.type !== "refund").reduce((s, p) => s + p.amount, 0);
  const totalRefund = payments.filter((p) => p.type === "refund").reduce((s, p) => s + p.amount, 0);
  const balance = totalCharges - totalPaid + totalRefund;

  const TYPE_LABEL: Record<string, string> = { opd: "OPD", ipd: "IPD", emergency: "Emergency" };
  const TYPE_COLOR: Record<string, string> = {
    opd: "bg-blue-100 text-blue-700",
    ipd: "bg-purple-100 text-purple-700",
    emergency: "bg-red-100 text-red-700",
  };

  if (!episode) {
    return <div className="p-8 text-neutral-400 text-sm">Loading episode…</div>;
  }

  return (
    <div>
      <PageHeader
        title={episode.episode_no}
        actions={
          <>
            <Button variant="ghost" onClick={() => router.back()}>
              <ArrowLeft size={14} className="mr-1" /> Back
            </Button>
            {episode.type !== "ipd" && <AdmissionBadge admission={admission} declined={declined} />}
            {episode.type !== "ipd" && episode.status === "open" && !admission && (
              <Button onClick={() => setShowAdmit(true)}>
                <BedDouble size={14} className="mr-1" />
                {episode.type === "emergency" ? "Admit / refer to department" : "Admit"}
              </Button>
            )}
            {episode.type === "ipd" && episode.admission_status === "pending" && (
              <span className="self-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">Awaiting Head Nurse of {episode.department}</span>
            )}
            {episode.status === "open" && (
              <Button variant="danger" onClick={() => void handleDischarge()} disabled={discharging}>
                <CheckCircle2 size={14} className="mr-1" />
                {discharging ? "…" : "Discharge"}
              </Button>
            )}
          </>
        }
      />

      {showAdmit && <AdmitModal episode={episode} onClose={() => setShowAdmit(false)} onDone={() => { setShowAdmit(false); void reload(); }} />}

      {/* Episode + Patient header */}
      <div className="rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-5 mb-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-neutral-400">Patient</p>
          <p className="font-semibold">{patient?.name ?? "—"}</p>
          <p className="text-xs text-neutral-400">{patient?.mr_no}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-400">Type</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLOR[episode.type] ?? ""}`}>
            {TYPE_LABEL[episode.type] ?? episode.type}
          </span>
        </div>
        <div>
          <p className="text-xs text-neutral-400">Department</p>
          <p className="font-medium">{episode.department ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-400">Date</p>
          <p className="font-medium">{episode.date}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-400">Status</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${episode.status === "open" ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
            {episode.status}
          </span>
        </div>
        {episode.diagnosis && (
          <div className="col-span-2">
            <p className="text-xs text-neutral-400">Diagnosis</p>
            <p className="text-sm">{episode.diagnosis}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Charges */}
        <div className="lg:col-span-2 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-5">
          <h2 className="font-semibold text-sm text-neutral-700 mb-3">Charges</h2>

          {episode.status === "open" && (
            <div className="bg-neutral-50 rounded-xl p-3 mb-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="md:col-span-2">
                <Field label="Service">
                  <Select value={selectedServiceId} onChange={(e) => onServiceSelect(e.target.value)}>
                    <option value="">— Free text —</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Description *">
                  <Input value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} placeholder="Service / item description" />
                </Field>
              </div>
              <Field label="Qty">
                <Input type="number" min="1" value={chargeQty} onChange={(e) => setChargeQty(e.target.value)} />
              </Field>
              <Field label="Rate">
                <Input type="number" min="0" value={chargeRate} onChange={(e) => setChargeRate(e.target.value)} />
              </Field>
              <Field label="Disc %">
                <Input type="number" min="0" max="100" value={chargeDisc} onChange={(e) => setChargeDisc(e.target.value)} />
              </Field>
              <Field label="Notes">
                <Input value={chargeNotes} onChange={(e) => setChargeNotes(e.target.value)} />
              </Field>
              <div className="md:col-span-4 flex justify-end">
                <Button variant="primary" onClick={() => void submitCharge()} disabled={addingCharge || !chargeDesc.trim()}>
                  <Plus size={13} className="mr-1" />
                  {addingCharge ? "Adding…" : "Add Charge"}
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-xs text-neutral-500 text-left">
                  <th className="pb-1.5 pr-3 font-medium">Description</th>
                  <th className="pb-1.5 pr-3 font-medium text-right">Qty</th>
                  <th className="pb-1.5 pr-3 font-medium text-right">Rate</th>
                  <th className="pb-1.5 pr-3 font-medium text-right">Disc%</th>
                  <th className="pb-1.5 font-medium text-right">Amount</th>
                  {episode.status === "open" && <th className="pb-1.5 w-8" />}
                </tr>
              </thead>
              <tbody>
                {charges.length === 0 ? (
                  <tr><td colSpan={6} className="py-4 text-center text-xs text-neutral-400">No charges yet.</td></tr>
                ) : charges.map((c) => (
                  <tr key={c.id} className="border-b border-neutral-50">
                    <td className="py-1.5 pr-3">
                      {c.description}
                      {c.department && <span className="ml-1 text-xs text-neutral-400">· {c.department}</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{c.qty}</td>
                    <td className="py-1.5 pr-3 text-right">{c.rate.toFixed(0)}</td>
                    <td className="py-1.5 pr-3 text-right">{c.discount_pct > 0 ? `${c.discount_pct}%` : "—"}</td>
                    <td className="py-1.5 text-right font-medium">{c.amount.toFixed(0)}</td>
                    {episode.status === "open" && (
                      <td className="py-1.5 pl-2">
                        <button type="button" onClick={() => deleteCharge(c.id).then(reload).catch((e) => window.alert(`Could not remove the charge: ${e instanceof Error ? e.message : String(e)}`))} className="text-neutral-300 hover:text-red-500">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-neutral-200 font-semibold">
                  <td colSpan={4} className="pt-2 pr-3 text-right text-sm text-neutral-500">Total Charges</td>
                  <td className="pt-2 text-right">Rs {totalCharges.toFixed(0)}</td>
                  {episode.status === "open" && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Payments & Summary */}
        <div className="flex flex-col gap-4">
          {/* Summary */}
          <div className="rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-4">
            <h2 className="font-semibold text-sm text-neutral-700 mb-3">Account Summary</h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-500">Total Charges</span>
                <span className="font-medium">Rs {totalCharges.toFixed(0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Total Paid</span>
                <span className="font-medium text-emerald-600">Rs {totalPaid.toFixed(0)}</span>
              </div>
              {totalRefund > 0 && (
                <div className="flex justify-between">
                  <span className="text-neutral-500">Refunds</span>
                  <span className="font-medium text-red-500">– Rs {totalRefund.toFixed(0)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-neutral-100 pt-1.5 font-semibold">
                <span>Balance</span>
                <span className={balance > 0 ? "text-red-600" : "text-emerald-600"}>
                  Rs {Math.abs(balance).toFixed(0)} {balance < 0 ? "(Advance)" : ""}
                </span>
              </div>
            </div>
          </div>

          {/* Add payment */}
          {episode.status === "open" && (
            <div className="rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-4">
              <h2 className="font-semibold text-sm text-neutral-700 mb-3">Receive Payment</h2>
              <div className="space-y-2">
                <Field label="Type">
                  <Select value={payType} onChange={(e) => setPayType(e.target.value as typeof payType)}>
                    <option value="deposit">Deposit</option>
                    <option value="payment">Payment</option>
                    <option value="refund">Refund</option>
                  </Select>
                </Field>
                <Field label="Amount *">
                  <Input type="number" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Method">
                  <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}>
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="online">Online Transfer</option>
                    <option value="bank">Bank Deposit</option>
                  </Select>
                </Field>
                <Field label="Reference">
                  <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Receipt / transaction no" />
                </Field>
                <Button variant="primary" onClick={() => void submitPayment()} disabled={addingPayment || !payAmount} className="w-full">
                  {addingPayment ? "Saving…" : "Receive"}
                </Button>
              </div>
            </div>
          )}

          {/* Payment history */}
          {payments.length > 0 && (
            <div className="rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-4">
              <h2 className="font-semibold text-sm text-neutral-700 mb-2">Payment History</h2>
              <div className="space-y-1.5">
                {payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-xs">
                    <span className="text-neutral-500">{p.type} · {p.method}</span>
                    <span className={`font-medium ${p.type === "refund" ? "text-red-500" : "text-emerald-600"}`}>
                      {p.type === "refund" ? "–" : "+"}Rs {p.amount.toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
