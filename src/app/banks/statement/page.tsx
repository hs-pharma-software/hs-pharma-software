"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { banksRepo, bankLedgerRepo } from "@/lib/repo/banks";
import type { Bank, BankLedgerEntry } from "@/lib/types2";

export default function BankStatementPage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [selected, setSelected] = useState<Bank | null>(null);
  const [entries, setEntries] = useState<BankLedgerEntry[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [transactionType, setTransactionType] = useState("deposit");
  const [amount, setAmount] = useState("0");
  const [slipNo, setSlipNo] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function reloadBanks() {
    if (!isTauri()) return;
    setBanks(await banksRepo.list());
  }

  useEffect(() => {
    void reloadBanks();
  }, []);

  async function selectBank(b: Bank) {
    setSelected(b);
    setEntries(await bankLedgerRepo.list({ where: "bank_id = ?", params: [b.id], orderBy: "date DESC" }));
  }

  const deposit = entries.filter((e) => e.transaction_type === "deposit").reduce((s, e) => s + e.amount, 0);
  const withdraw = entries.filter((e) => e.transaction_type === "withdraw").reduce((s, e) => s + e.amount, 0);
  const closing = (selected?.opening_balance ?? 0) + deposit - withdraw;

  const bankColumns: Column<Bank>[] = [
    { header: "Bank Name", render: (b) => b.name },
    { header: "Address", render: (b) => b.address ?? "â€”" },
  ];

  const entryColumns: Column<BankLedgerEntry>[] = [
    { header: "Date", render: (e) => e.date },
    { header: "Description", render: (e) => e.description ?? "â€”" },
    { header: "Slip No", render: (e) => e.slip_no ?? "â€”" },
    { header: "Deposit", render: (e) => (e.transaction_type === "deposit" ? e.amount.toFixed(2) : "â€”") },
    { header: "Withdraw", render: (e) => (e.transaction_type === "withdraw" ? e.amount.toFixed(2) : "â€”") },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Bank Statement"
        actions={
          <>
            <Button variant="primary" onClick={() => setModalOpen(true)} disabled={!selected}>
              Add
            </Button>
            <Button onClick={() => void reloadBanks()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to view bank statements.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium text-neutral-500">Select a bank</p>
              <DataTable columns={bankColumns} rows={banks} onRowClick={(b) => void selectBank(b)} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-neutral-500">
                {selected ? `Statement â€” ${selected.name}` : "Select a bank on the left"}
              </p>
              <DataTable columns={entryColumns} rows={entries} />
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-6 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-5 py-2.5 text-sm">
            <span className="text-neutral-500">
              Opening Cash: <span className="font-medium text-neutral-800">{(selected?.opening_balance ?? 0).toFixed(2)}</span>
            </span>
            <span className="text-neutral-500">
              Deposit: <span className="font-medium text-emerald-700">{deposit.toFixed(2)}</span>
            </span>
            <span className="text-neutral-500">
              Withdraw: <span className="font-medium text-rose-700">{withdraw.toFixed(2)}</span>
            </span>
            <span className="text-neutral-500">
              Closing Cash: <span className="font-medium text-neutral-800">{closing.toFixed(2)}</span>
            </span>
          </div>
        </>
      )}

      {modalOpen && selected && (
        <Modal title="-:Add Bank Ledger:-" onClose={() => setModalOpen(false)} width="max-w-md">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              try {
                await bankLedgerRepo.create({
                  bank_id: selected.id,
                  date: new Date().toISOString().slice(0, 10),
                  transaction_type: transactionType,
                  slip_no: slipNo || null,
                  amount: Number(amount) || 0,
                  description: description || null,
                });
                setModalOpen(false);
                setAmount("0");
                setSlipNo("");
                setDescription("");
                await selectBank(selected);
              } finally {
                setSaving(false);
              }
            }}
          >
            <Field label="Transaction" required>
              <Select value={transactionType} onChange={(e) => setTransactionType(e.target.value)} required>
                <option value="deposit">Deposit</option>
                <option value="withdraw">Withdraw</option>
              </Select>
            </Field>
            <Field label="Bank Name">
              <Input value={selected.name} disabled />
            </Field>
            <Field label="Slip No">
              <Input value={slipNo} onChange={(e) => setSlipNo(e.target.value)} />
            </Field>
            <Field label="Amount" required>
              <Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
            </Field>
            <Field label="Description">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
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

