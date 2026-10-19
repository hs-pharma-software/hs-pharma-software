"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { salariesRepo } from "@/lib/repo/salaries";
import { staffRepo } from "@/lib/repo/staff";
import type { Staff } from "@/lib/types";
import type { Salary } from "@/lib/types2";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface SalaryRow extends Salary {
  staff_name?: string;
}

export default function SalaryDetailsPage() {
  const [rows, setRows] = useState<SalaryRow[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const [staffId, setStaffId] = useState("");
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [basicPay, setBasicPay] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [incentive, setIncentive] = useState("0");
  const [deduction, setDeduction] = useState("0");
  const [taxRs, setTaxRs] = useState("0");
  const [paidSalary, setPaidSalary] = useState("0");
  const [saving, setSaving] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    const [salaries, staff] = await Promise.all([salariesRepo.list({ orderBy: "date DESC" }), staffRepo.list()]);
    const staffMap = new Map(staff.map((s) => [s.id, s.name]));
    setRows(salaries.map((s) => ({ ...s, staff_name: staffMap.get(s.staff_id) })));
    setStaffList(staff);
  }

  useEffect(() => {
    void reload();
  }, []);

  const payable = (Number(basicPay) || 0) + (Number(incentive) || 0) - (Number(deduction) || 0) - (Number(taxRs) || 0);
  const balance = payable - (Number(paidSalary) || 0);

  const columns: Column<SalaryRow>[] = [
    { header: "Salary Month", render: (r) => `${r.salary_month} ${r.salary_year}` },
    { header: "Employee Name", render: (r) => r.staff_name ?? "—" },
    { header: "Payable Salary", render: (r) => r.payable_salary.toFixed(2) },
    { header: "Paid Salary", render: (r) => r.paid_salary.toFixed(2) },
    { header: "Balance Salary", render: (r) => r.balance_salary.toFixed(2) },
  ];

  function onStaffChange(id: string) {
    setStaffId(id);
    const s = staffList.find((x) => x.id === id);
    if (s) setBasicPay(String(s.basic_pay));
  }

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Salary Details"
        actions={
          <>
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage salaries.
        </p>
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}

      {modalOpen && (
        <Modal title="-:Add Salary:-" onClose={() => setModalOpen(false)} width="max-w-2xl">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!staffId) return;
              setSaving(true);
              try {
                await salariesRepo.create({
                  date: new Date().toISOString().slice(0, 10),
                  salary_month: month,
                  salary_year: Number(year),
                  staff_id: staffId,
                  basic_pay: Number(basicPay) || 0,
                  payment_method: paymentMethod,
                  incentive: Number(incentive) || 0,
                  deduction: Number(deduction) || 0,
                  tax_rs: Number(taxRs) || 0,
                  payable_salary: payable,
                  paid_salary: Number(paidSalary) || 0,
                  balance_salary: balance,
                });
                setModalOpen(false);
                void reload();
              } finally {
                setSaving(false);
              }
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Salary Month" required>
                <Select value={month} onChange={(e) => setMonth(e.target.value)} required>
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Salary Year" required>
                <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} required />
              </Field>
              <Field label="Payment Method" required>
                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} required>
                  <option value="Cash">Cash</option>
                  <option value="Bank">Bank</option>
                </Select>
              </Field>
            </div>
            <Field label="Employee Name" required>
              <Select value={staffId} onChange={(e) => onStaffChange(e.target.value)} required autoFocus>
                <option value="">Select...</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Basic Pay" required>
                <Input type="number" min="0" step="any" value={basicPay} onChange={(e) => setBasicPay(e.target.value)} required />
              </Field>
              <Field label="Incentive">
                <Input type="number" min="0" step="any" value={incentive} onChange={(e) => setIncentive(e.target.value)} />
              </Field>
              <Field label="Deduction">
                <Input type="number" min="0" step="any" value={deduction} onChange={(e) => setDeduction(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Tax (Rs)">
                <Input type="number" min="0" step="any" value={taxRs} onChange={(e) => setTaxRs(e.target.value)} />
              </Field>
              <Field label="Payable Salary">
                <Input value={payable.toFixed(2)} disabled />
              </Field>
              <Field label="Paid Salary">
                <Input type="number" min="0" step="any" value={paidSalary} onChange={(e) => setPaidSalary(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button type="button" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
