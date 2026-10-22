"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { cashRegisterRepo } from "@/lib/repo/cashRegister";
import type { CashRegisterEntry } from "@/lib/types2";

export default function CashRegisterPage() {
  const [entries, setEntries] = useState<CashRegisterEntry[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [transactionType, setTransactionType] = useState("in");
  const [amount, setAmount] = useState("0");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    setEntries(await cashRegisterRepo.list({ orderBy: "date DESC" }));
  }

  useEffect(() => {
    void reload();
  }, []);

  const cashIn = entries.filter((e) => e.transaction_type === "in").reduce((s, e) => s + e.amount, 0);
  const cashOut = entries.filter((e) => e.transaction_type === "out").reduce((s, e) => s + e.amount, 0);

  const columns: Column<CashRegisterEntry>[] = [
    { header: "Date", render: (e) => e.date },
    { header: "Description", render: (e) => e.description ?? "\u2014" },
    { header: "Payment In", render: (e) => (e.transaction_type === "in" ? e.amount.toFixed(2) : "\u2014") },
    { header: "Payment Out", render: (e) => (e.transaction_type === "out" ? e.amount.toFixed(2) : "\u2014") },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Cash Details"
        actions={
          <>
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              In/Out
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage cash register entries.
        </p>
      ) : (
        <>
          <DataTable columns={columns} rows={entries} />
          <div className="mt-3 flex justify-end gap-6 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-5 py-2.5 text-sm">
            <span className="text-neutral-500">
              Cash In: <span className="font-medium text-emerald-700">{cashIn.toFixed(2)}</span>
            </span>
            <span className="text-neutral-500">
              Cash Out: <span className="font-medium text-rose-700">{cashOut.toFixed(2)}</span>
            </span>
            <span className="text-neutral-500">
              Closing Cash: <span className="font-medium text-neutral-800">{(cashIn - cashOut).toFixed(2)}</span>
            </span>
          </div>
        </>
      )}

      {modalOpen && (
        <Modal title="-:Add Cash:-" onClose={() => setModalOpen(false)} width="max-w-md">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              try {
                await cashRegisterRepo.create({
                  date: new Date().toISOString().slice(0, 10),
                  transaction_type: transactionType,
                  amount: Number(amount) || 0,
                  description: description || null,
                });
                setModalOpen(false);
                setAmount("0");
                setDescription("");
                void reload();
              } finally {
                setSaving(false);
              }
            }}
          >
            <Field label="Transaction" required>
              <Select value={transactionType} onChange={(e) => setTransactionType(e.target.value)} required autoFocus>
                <option value="in">Payment In</option>
                <option value="out">Payment Out</option>
              </Select>
            </Field>
            <Field label="Amount" required>
              <Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required />
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

