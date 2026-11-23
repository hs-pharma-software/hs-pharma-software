"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { hospitalPatientsRepo, nextMrNo, type HospitalPatient } from "@/lib/repo/hospital";
import { radiologyCall, radiologyOffline } from "@/lib/offline/radiologyCalls";
import { useAuthStore } from "@/store/authStore";
import { InsuranceCompanySelect } from "@/components/customers/InsuranceCompanySelect";

interface Props {
  patient: HospitalPatient | null;
  onClose: () => void;
  /** Receives the saved patient. */
  onSaved: (patient?: HospitalPatient) => void;
  /** Name to start a new registration with (e.g. what was typed in a search). */
  initialName?: string;
}

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export default function PatientFormModal({ patient, onClose, onSaved, initialName }: Props) {
  const isEdit = patient !== null;
  const [mrNo, setMrNo] = useState(patient?.mr_no ?? "");
  const [name, setName] = useState(patient?.name ?? initialName ?? "");
  const [fatherName, setFatherName] = useState(patient?.father_name ?? "");
  const [gender, setGender] = useState<HospitalPatient["gender"]>(patient?.gender ?? "Male");
  const [dob, setDob] = useState(patient?.dob ?? "");
  const [ageYears, setAgeYears] = useState(String(patient?.age_years ?? ""));
  const [ageMonths, setAgeMonths] = useState(String(patient?.age_months ?? ""));
  const [phone, setPhone] = useState(patient?.phone ?? "");
  const [cnic, setCnic] = useState(patient?.cnic ?? "");
  const [address, setAddress] = useState(patient?.address ?? "");
  const [city, setCity] = useState(patient?.city ?? "");
  const [bloodGroup, setBloodGroup] = useState(patient?.blood_group ?? "");
  const [allergies, setAllergies] = useState(patient?.allergies ?? "");
  const [chronicConditions, setChronicConditions] = useState(patient?.chronic_conditions ?? "");
  const [insuranceCompany, setInsuranceCompany] = useState(patient?.insurance_company ?? "");
  const [insuranceNo, setInsuranceNo] = useState(patient?.insurance_no ?? "");
  const [insured, setInsured] = useState(Number(patient?.insured ?? 0) === 1);
  const [insCompanyId, setInsCompanyId] = useState(patient?.insurance_company_id ?? "");
  const [validTill, setValidTill] = useState(patient?.insurance_valid_till ?? "");
  const [insuredAmount, setInsuredAmount] = useState(patient?.insured_amount != null ? String(patient.insured_amount) : "");
  const [nokName, setNokName] = useState(patient?.next_of_kin_name ?? "");
  const [nokPhone, setNokPhone] = useState(patient?.next_of_kin_phone ?? "");
  const [nokRelation, setNokRelation] = useState(patient?.next_of_kin_relation ?? "");
  const [notes, setNotes] = useState(patient?.notes ?? "");
  const [saving, setSaving] = useState(false);

  // Without internet this computer gives the MR number when the patient is saved.
  const offline = radiologyOffline();
  // A Radiology Centre sees the patient once for a scan: only what the counter and the report need.
  // Details already on a patient's record stay saved when the patient is edited here.
  const shortForm = useAuthStore((s) => s.currentTenant?.businessType) === "radiology_center";

  useEffect(() => {
    if (!isEdit && !offline) {
      void nextMrNo().then(setMrNo);
    }
  }, [isEdit, offline]);

  const hospitalInsurance = useAuthStore((st) => st.currentTenant?.businessType) === "hospital";

  async function save() {
    if (hospitalInsurance && insured && (!insCompanyId || !insuranceNo.trim())) { window.alert("An insured patient needs the insurance company and the policy number."); return; }
    if (!name.trim() || (!mrNo.trim() && !offline)) return;
    setSaving(true);
    try {
      const payload = {
        mr_no: mrNo.trim(),
        name: name.trim(),
        father_name: fatherName.trim() || null,
        gender,
        dob: dob || null,
        age_years: ageYears ? Number(ageYears) : null,
        age_months: ageMonths ? Number(ageMonths) : null,
        phone: phone.trim() || null,
        cnic: cnic.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        blood_group: bloodGroup || null,
        allergies: allergies.trim() || null,
        chronic_conditions: chronicConditions.trim() || null,
        insurance_company: insuranceCompany.trim() || null,
        insurance_no: insuranceNo.trim() || null,
        // Hospitals (v100): only when used, so a patient still saves before the database update.
        ...(hospitalInsurance && (insured || patient?.insured)
          ? { insured: insured ? 1 : 0, insurance_company_id: insured ? insCompanyId || null : null, insurance_valid_till: insured ? validTill || null : null, insured_amount: insured && insuredAmount ? Number(insuredAmount) : null }
          : {}),
        next_of_kin_name: nokName.trim() || null,
        next_of_kin_phone: nokPhone.trim() || null,
        next_of_kin_relation: nokRelation.trim() || null,
        notes: notes.trim() || null,
      };
      const saved = offline
        ? await radiologyCall<HospitalPatient>(isEdit ? "updatePatient" : "registerPatient", isEdit ? { ...payload, id: patient.id } : payload)
        : isEdit ? await hospitalPatientsRepo.update(patient.id, payload) : await hospitalPatientsRepo.create(payload);
      onSaved(saved ?? undefined);
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Patient" : "Register Patient"} onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Field label="MR Number *">
          <Input value={mrNo} onChange={(e) => setMrNo(e.target.value)} required={!offline} readOnly={offline} placeholder={offline ? "Given when saved" : undefined} />
        </Field>
        <Field label="Full Name *">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus={!isEdit} />
        </Field>
        <Field label="Father / Husband Name">
          <Input value={fatherName} onChange={(e) => setFatherName(e.target.value)} />
        </Field>
        <Field label="Gender *">
          <Select value={gender} onChange={(e) => setGender(e.target.value as HospitalPatient["gender"])}>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
            <option value="Unknown">Unknown</option>
          </Select>
        </Field>
        {!shortForm && (
          <Field label="Date of Birth">
            <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </Field>
        )}
        <div className="flex gap-2">
          <Field label="Age (Years)">
            <Input type="number" min="0" value={ageYears} onChange={(e) => setAgeYears(e.target.value)} placeholder="Yr" />
          </Field>
          <Field label="Months">
            <Input type="number" min="0" max="11" value={ageMonths} onChange={(e) => setAgeMonths(e.target.value)} placeholder="Mo" />
          </Field>
        </div>
        <Field label="Phone">
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03XX-XXXXXXX" />
        </Field>
        <Field label="CNIC">
          <Input value={cnic} onChange={(e) => setCnic(e.target.value)} placeholder="XXXXX-XXXXXXX-X" />
        </Field>
        {!shortForm && (
          <>
            <Field label="Blood Group">
              <Select value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)}>
                <option value="">— Unknown —</option>
                {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </Select>
            </Field>
            <Field label="City">
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
          </>
        )}
        <div className="md:col-span-2">
          <Field label="Address">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>
        <Field label="Known Allergies">
          <Input value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="e.g. Penicillin, Aspirin" />
        </Field>
        {!shortForm && (
          <Field label="Chronic Conditions">
            <Input value={chronicConditions} onChange={(e) => setChronicConditions(e.target.value)} placeholder="e.g. Diabetes, Hypertension" />
          </Field>
        )}
      </div>

      {/* Next of Kin */}
      {!shortForm && (
        <div className="border-t border-neutral-100 pt-3 mb-4">
          <p className="text-xs font-medium text-neutral-500 mb-2">Next of Kin / Emergency Contact</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Name">
              <Input value={nokName} onChange={(e) => setNokName(e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={nokPhone} onChange={(e) => setNokPhone(e.target.value)} />
            </Field>
            <Field label="Relation">
              <Input value={nokRelation} onChange={(e) => setNokRelation(e.target.value)} placeholder="e.g. Son, Wife" />
            </Field>
          </div>
        </div>
      )}

      {/* Insurance */}
      {hospitalInsurance && !shortForm && (
        <div className="mb-4 rounded-xl bg-sky-50/60 p-3 ring-1 ring-sky-100">
          <div className="mb-2 flex items-center gap-4 text-sm">
            <span className="font-semibold text-sky-800">Insured?</span>
            <label className="flex items-center gap-1.5"><input type="radio" checked={insured} onChange={() => setInsured(true)} />Yes</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={!insured} onChange={() => setInsured(false)} />No</label>
          </div>
          {insured && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Insurance company *"><InsuranceCompanySelect id="pt-ins-company" value={insCompanyId} onChange={(v, c) => { setInsCompanyId(v); setInsuranceCompany(c?.name ?? ""); }} /></Field>
              <Field label="Policy number *"><Input value={insuranceNo} onChange={(e) => setInsuranceNo(e.target.value)} /></Field>
              <Field label="Valid till"><Input type="date" value={validTill} onChange={(e) => setValidTill(e.target.value)} /></Field>
              <Field label="Insured amount (Rs)"><Input type="number" min="0" step="any" value={insuredAmount} onChange={(e) => setInsuredAmount(e.target.value)} placeholder="Above it the patient pays" /></Field>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {!shortForm && !hospitalInsurance && (
          <>
            <Field label="Insurance Company">
              <Input value={insuranceCompany} onChange={(e) => setInsuranceCompany(e.target.value)} />
            </Field>
            <Field label="Insurance No">
              <Input value={insuranceNo} onChange={(e) => setInsuranceNo(e.target.value)} />
            </Field>
          </>
        )}
        <div className="md:col-span-2">
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !name.trim()}>
          {saving ? "Saving…" : isEdit ? "Update" : "Register"}
        </Button>
      </div>
    </Modal>
  );
}
