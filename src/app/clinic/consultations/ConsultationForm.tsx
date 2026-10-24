"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Send, FileText } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import {
  consultationsRepo,
  prescriptionsRepo,
  patientsRepo,
  doctorsRepo,
  getRxItems,
  saveRxItems,
  getPharmacyLink,
  sendPrescriptionToPharmacy,
  listPharmacyTenants,
  searchProductsForPharmacy,
  type PrescriptionWithDetails,
  getPrescriptionsForConsultation,
} from "@/lib/repo/clinic";
import type { ClinicPatient, ClinicDoctor, ClinicRxItem } from "@/lib/types-clinic";

interface RxItemDraft {
  product_id: string | null;
  product_name: string;
  strength: string;
  dosage_form: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  qty: string;
  instructions: string;
}

const EMPTY_RX_ITEM: RxItemDraft = {
  product_id: null, product_name: "", strength: "", dosage_form: "", dose: "", route: "Oral",
  frequency: "", duration: "", qty: "1", instructions: "",
};

const ROUTES = ["Oral", "IV", "IM", "SC", "Topical", "Inhalation", "Sublingual", "Rectal", "Nasal", "Ophthalmic"];
const DOSAGE_FORMS = ["Tablet", "Capsule", "Syrup", "Injection", "Cream", "Ointment", "Drops", "Inhaler", "Patch", "Suppository"];

export default function ConsultationForm({ consultationId }: { consultationId?: string }) {
  const router = useRouter();
  const setPendingAction = useAppStore((s) => s.setPendingAction);
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const tenantName = useAuthStore((s) => s.currentTenant?.name ?? null);
  const isEdit = Boolean(consultationId);

  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [doctors, setDoctors] = useState<ClinicDoctor[]>([]);
  const [pharmacyTenants, setPharmacyTenants] = useState<{ id: string; name: string }[]>([]);

  // Consultation fields
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [complaint, setComplaint] = useState("");
  const [history, setHistory] = useState("");
  const [vitals, setVitals] = useState("");
  const [findings, setFindings] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [advice, setAdvice] = useState("");
  const [followupDate, setFollowupDate] = useState("");
  const [followupNotes, setFollowupNotes] = useState("");

  // Prescription
  const [showRx, setShowRx] = useState(false);
  const [rxItems, setRxItems] = useState<RxItemDraft[]>([{ ...EMPTY_RX_ITEM }]);
  const [rxNotes, setRxNotes] = useState("");
  const [existingPrescriptions, setExistingPrescriptions] = useState<PrescriptionWithDetails[]>([]);
  const [linkedPharmacyId, setLinkedPharmacyId] = useState("");
  const [savedConsultationId, setSavedConsultationId] = useState(consultationId ?? "");
  const [savedRxId, setSavedRxId] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(isEdit);

  useEffect(() => {
    if (!isTauri()) return;
    void patientsRepo.list({ orderBy: "name ASC" }).then(setPatients);
    void doctorsRepo.list({ orderBy: "name ASC" }).then(setDoctors);
    void listPharmacyTenants().then(setPharmacyTenants);
    void getPharmacyLink().then((link) => { if (link) setLinkedPharmacyId(link.pharmacy_tenant_id); });
    if (consultationId) {
      void consultationsRepo.get(consultationId).then((c) => {
        if (!c) return;
        setPatientId(c.patient_id);
        setDoctorId(c.doctor_id ?? "");
        setDate(c.date);
        setComplaint(c.complaint ?? "");
        setHistory(c.history ?? "");
        setVitals(c.vitals ?? "");
        setFindings(c.findings ?? "");
        setDiagnosis(c.diagnosis ?? "");
        setAdvice(c.advice ?? "");
        setFollowupDate(c.followup_date ?? "");
        setFollowupNotes(c.followup_notes ?? "");
      });
      void getPrescriptionsForConsultation(consultationId).then(setExistingPrescriptions);
    }
  }, [consultationId, tenantId]);

  async function saveConsultation() {
    if (!patientId || !date) return;
    setSaving(true);
    try {
      const payload = {
        patient_id: patientId,
        doctor_id: doctorId || null,
        date,
        complaint: complaint.trim() || null,
        history: history.trim() || null,
        vitals: vitals.trim() || null,
        findings: findings.trim() || null,
        diagnosis: diagnosis.trim() || null,
        advice: advice.trim() || null,
        followup_date: followupDate || null,
        followup_notes: followupNotes.trim() || null,
        appointment_id: null,
      };
      if (isEdit && consultationId) {
        await consultationsRepo.update(consultationId, payload);
        setSavedConsultationId(consultationId);
      } else {
        const record = await consultationsRepo.create(payload);
        setSavedConsultationId(record.id);
        router.replace(`/clinic/consultations/${record.id}`);
      }
      setSaved(true);
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveRx() {
    if (!savedConsultationId) { await saveConsultation(); }
    const cid = savedConsultationId || consultationId;
    if (!cid) return;
    setSaving(true);
    try {
      const items = rxItems
        .filter((i) => i.product_name.trim())
        .map((i) => ({
          prescription_id: "",
          product_id: i.product_id ?? null,
          product_name: i.product_name.trim(),
          strength: i.strength.trim() || null,
          dosage_form: i.dosage_form.trim() || null,
          dose: i.dose.trim() || null,
          route: i.route.trim() || null,
          frequency: i.frequency.trim() || null,
          duration: i.duration.trim() || null,
          qty: Number(i.qty) || 1,
          instructions: i.instructions.trim() || null,
        }));

      let rxId = savedRxId;
      if (!rxId) {
        const rx = await prescriptionsRepo.create({
          consultation_id: cid,
          patient_id: patientId,
          doctor_id: doctorId || null,
          date,
          status: "draft",
          pharmacy_tenant_id: null,
          sent_at: null,
          acknowledged_at: null,
          dispensed_at: null,
          notes: rxNotes.trim() || null,
        });
        rxId = rx.id;
        setSavedRxId(rxId);
      } else {
        await prescriptionsRepo.update(rxId, { notes: rxNotes.trim() || null });
      }

      await saveRxItems(rxId, items);
      const updated = await getPrescriptionsForConsultation(cid);
      setExistingPrescriptions(updated);
      setShowRx(false);
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function sendToPharmacy(rxId: string) {
    if (!linkedPharmacyId) return;
    const patient = patients.find((p) => p.id === patientId);
    const doctor = doctors.find((d) => d.id === doctorId);
    const rx = existingPrescriptions.find((p) => p.id === rxId);
    if (!patient || !rx) return;
    setSending(true);
    try {
      await sendPrescriptionToPharmacy(rxId, linkedPharmacyId, {
        patientName: patient.name,
        patientId: patient.id,
        doctorName: doctor?.name ?? null,
        clinicTenantId: tenantId!,
        clinicName: tenantName,
        rxDate: date,
        itemCount: rx.item_count,
      });
      const updated = await getPrescriptionsForConsultation(savedConsultationId || consultationId!);
      setExistingPrescriptions(updated);
    } finally {
      setSending(false);
    }
  }

  function addRxRow() { setRxItems((prev) => [...prev, { ...EMPTY_RX_ITEM }]); }
  function removeRxRow(i: number) { setRxItems((prev) => prev.filter((_, idx) => idx !== i)); }
  function updateRxRow(i: number, field: keyof RxItemDraft, value: string) {
    setRxItems((prev) => prev.map((row, idx) => idx === i ? { ...row, [field]: value } : row));
  }

  // Drug search state: keyed by row index
  const [drugSuggestions, setDrugSuggestions] = useState<Record<number, { id: string; name: string; barcode: string | null; company_name: string | null; description: string | null }[]>>({});
  const [drugSearchOpen, setDrugSearchOpen] = useState<Record<number, boolean>>({});

  function handleDrugInput(i: number, value: string) {
    updateRxRow(i, "product_name", value);
    if (!linkedPharmacyId || value.trim().length < 2) {
      setDrugSuggestions((s) => ({ ...s, [i]: [] }));
      return;
    }
    void searchProductsForPharmacy(value, linkedPharmacyId).then((results) => {
      setDrugSuggestions((s) => ({ ...s, [i]: results }));
      setDrugSearchOpen((s) => ({ ...s, [i]: true }));
    });
  }

  function selectDrug(i: number, p: { id: string; name: string; barcode: string | null; company_name: string | null; description: string | null }) {
    setRxItems((prev) => prev.map((row, idx) => idx === i ? { ...row, product_id: p.id, product_name: p.name } : row));
    setDrugSuggestions((s) => ({ ...s, [i]: [] }));
    setDrugSearchOpen((s) => ({ ...s, [i]: false }));
  }

  const RX_STATUS_COLOR: Record<string, string> = {
    draft: "bg-neutral-100 text-neutral-600",
    sent: "bg-blue-100 text-blue-700",
    acknowledged: "bg-amber-100 text-amber-700",
    dispensed: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-600",
  };

  return (
    <div>
      <PageHeader
        title={isEdit ? "Consultation Detail" : "New Consultation"}
        actions={
          <Button variant="primary" onClick={() => void saveConsultation()} disabled={saving || !patientId}>
            {saving ? "Savingâ€¦" : "Save Consultation"}
          </Button>
        }
      />

      <div className="rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <Field label="Patient *">
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)} required>
              <option value="">â€” Select Patient â€”</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name}{p.mrn ? ` (${p.mrn})` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Doctor">
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">â€” Select Doctor â€”</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.name}{d.specialization ? ` â€” ${d.specialization}` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Date *">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Chief Complaint">
            <Textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={2} placeholder="Patient's main complaint" />
          </Field>
          <Field label="History">
            <Textarea value={history} onChange={(e) => setHistory(e.target.value)} rows={2} placeholder="Medical/surgical history" />
          </Field>
          <Field label="Vitals">
            <Textarea value={vitals} onChange={(e) => setVitals(e.target.value)} rows={2} placeholder="BP, pulse, temp, SpO2, weightâ€¦" />
          </Field>
          <Field label="Findings / Examination">
            <Textarea value={findings} onChange={(e) => setFindings(e.target.value)} rows={2} placeholder="Examination findings" />
          </Field>
          <Field label="Diagnosis">
            <Textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={2} placeholder="ICD-10 code or description" />
          </Field>
          <Field label="Advice / Plan">
            <Textarea value={advice} onChange={(e) => setAdvice(e.target.value)} rows={2} placeholder="Treatment plan, instructions" />
          </Field>
          <Field label="Follow-up Date">
            <Input type="date" value={followupDate} onChange={(e) => setFollowupDate(e.target.value)} />
          </Field>
          <Field label="Follow-up Notes">
            <Input value={followupNotes} onChange={(e) => setFollowupNotes(e.target.value)} placeholder="Instructions for next visit" />
          </Field>
        </div>
      </div>

      {/* Prescriptions section */}
      <div className="rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm text-neutral-700">Prescriptions</h2>
          {saved && (
            <Button variant="primary" onClick={() => setShowRx((v) => !v)}>
              <Plus size={14} className="mr-1" />
              {showRx ? "Cancel" : "Add Prescription"}
            </Button>
          )}
        </div>

        {/* Existing prescriptions */}
        {existingPrescriptions.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {existingPrescriptions.map((rx) => (
              <div key={rx.id} className="border border-neutral-100 rounded-xl p-3 flex items-center justify-between gap-3">
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium mr-2 ${RX_STATUS_COLOR[rx.status] ?? ""}`}>
                    {rx.status}
                  </span>
                  <span className="text-sm text-neutral-700">{rx.item_count} item{rx.item_count !== 1 ? "s" : ""}</span>
                  {rx.notes && <span className="text-xs text-neutral-400 ml-2">â€” {rx.notes}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {/* Create Invoice button */}
                  <Button variant="ghost" onClick={() => { setPendingAction("new-invoice-from-rx", rx.id); router.push("/invoices"); }}>
                    <FileText size={13} className="mr-1" />
                    Invoice
                  </Button>
                  {/* Send to pharmacy */}
                  {rx.status === "draft" && pharmacyTenants.length > 0 && (
                    <Button
                      variant="ghost"
                      disabled={sending || !linkedPharmacyId}
                      onClick={() => void sendToPharmacy(rx.id)}
                    >
                      <Send size={13} className="mr-1" />
                      Send to Pharmacy
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Link to pharmacy */}
        {pharmacyTenants.length > 0 && (
          <div className="mb-4">
            <Field label="Linked Pharmacy">
              <Select value={linkedPharmacyId} onChange={(e) => setLinkedPharmacyId(e.target.value)}>
                <option value="">â€” None â€”</option>
                {pharmacyTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          </div>
        )}

        {/* New prescription form */}
        {showRx && (
          <div>
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-100 text-neutral-500 text-left">
                    <th className="pb-2 pr-2 font-medium">Medicine</th>
                    <th className="pb-2 pr-2 font-medium">Strength</th>
                    <th className="pb-2 pr-2 font-medium">Form</th>
                    <th className="pb-2 pr-2 font-medium">Dose</th>
                    <th className="pb-2 pr-2 font-medium">Route</th>
                    <th className="pb-2 pr-2 font-medium">Frequency</th>
                    <th className="pb-2 pr-2 font-medium">Duration</th>
                    <th className="pb-2 pr-2 font-medium w-14">Qty</th>
                    <th className="pb-2 pr-2 font-medium">Instructions</th>
                    <th className="pb-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {rxItems.map((item, i) => (
                    <tr key={i} className="border-b border-neutral-50">
                      <td className="py-1 pr-2 relative">
                        <Input
                          value={item.product_name}
                          onChange={(e) => handleDrugInput(i, e.target.value)}
                          onFocus={() => {
                            if (linkedPharmacyId && item.product_name.trim().length >= 2) {
                              setDrugSearchOpen((s) => ({ ...s, [i]: true }));
                            }
                          }}
                          onBlur={() => setTimeout(() => setDrugSearchOpen((s) => ({ ...s, [i]: false })), 150)}
                          placeholder={linkedPharmacyId ? "Search pharmacy…" : "Drug name"}
                          className="min-w-36"
                        />
                        {drugSearchOpen[i] && (drugSuggestions[i]?.length ?? 0) > 0 && (
                          <div className="absolute left-0 top-full z-20 mt-0.5 w-64 rounded-lg border border-neutral-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                            {drugSuggestions[i].map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onMouseDown={() => selectDrug(i, p)}
                                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-amber-50"
                              >
                                <span className="font-medium">{p.name}</span>
                                {p.company_name && <span className="ml-1 text-neutral-400">{p.company_name}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        <Input value={item.strength} onChange={(e) => updateRxRow(i, "strength", e.target.value)} placeholder="e.g. 500mg" className="w-24" />
                      </td>
                      <td className="py-1 pr-2">
                        <Select value={item.dosage_form} onChange={(e) => updateRxRow(i, "dosage_form", e.target.value)} className="w-28">
                          <option value="">â€”</option>
                          {DOSAGE_FORMS.map((f) => <option key={f} value={f}>{f}</option>)}
                        </Select>
                      </td>
                      <td className="py-1 pr-2">
                        <Input value={item.dose} onChange={(e) => updateRxRow(i, "dose", e.target.value)} placeholder="e.g. 1" className="w-16" />
                      </td>
                      <td className="py-1 pr-2">
                        <Select value={item.route} onChange={(e) => updateRxRow(i, "route", e.target.value)} className="w-24">
                          {ROUTES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </Select>
                      </td>
                      <td className="py-1 pr-2">
                        <Input value={item.frequency} onChange={(e) => updateRxRow(i, "frequency", e.target.value)} placeholder="e.g. TDS" className="w-20" />
                      </td>
                      <td className="py-1 pr-2">
                        <Input value={item.duration} onChange={(e) => updateRxRow(i, "duration", e.target.value)} placeholder="5 days" className="w-20" />
                      </td>
                      <td className="py-1 pr-2">
                        <Input type="number" min="1" value={item.qty} onChange={(e) => updateRxRow(i, "qty", e.target.value)} className="w-14" />
                      </td>
                      <td className="py-1 pr-2">
                        <Input value={item.instructions} onChange={(e) => updateRxRow(i, "instructions", e.target.value)} placeholder="After meals" className="min-w-28" />
                      </td>
                      <td className="py-1">
                        <button type="button" onClick={() => removeRxRow(i)} className="text-neutral-300 hover:text-red-500 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Button variant="ghost" onClick={addRxRow}>
                <Plus size={14} className="mr-1" />Add Row
              </Button>
              <div className="flex-1 max-w-xs">
                <Field label="Prescription Notes">
                  <Input value={rxNotes} onChange={(e) => setRxNotes(e.target.value)} placeholder="Optional notes" />
                </Field>
              </div>
              <Button variant="primary" onClick={() => void saveRx()} disabled={saving}>
                {saving ? "Savingâ€¦" : "Save Prescription"}
              </Button>
            </div>
          </div>
        )}

        {!saved && (
          <p className="text-xs text-neutral-400 mt-2">Save the consultation first to add a prescription.</p>
        )}
      </div>
    </div>
  );
}
