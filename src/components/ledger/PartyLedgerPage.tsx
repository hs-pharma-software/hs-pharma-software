"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { ledgerRepo, listLedgerForParty, getPartyTradeBalance } from "@/lib/repo/ledger";
import type { PartyType, LedgerAdjustment } from "@/lib/types2";
import type { BaseRow } from "@/lib/repo/base";

interface PartyRow extends BaseRow {
  name: string;
  phone?: string | null;
  opening_balance: number;
}

export function PartyLedgerPage({
  title,
  partyType,
  listParties,
}: {
  title: string;
  partyType: PartyType;
  listParties: () => Promise<PartyRow[]>;
}) {
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [selected, setSelected] = useState<PartyRow | null>(null);
  const [ledger, setLedger] = useState<LedgerAdjustment[]>([]);
  const [tradeBalance, setTradeBalance] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [paidAmount, setPaidAmount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  async function reloadParties() {
    if (!isTauri()) return;
    setParties(await listParties());
  }

  useEffect(() => {
    void reloadParties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectParty(p: PartyRow) {
    setSelected(p);
    const [led, trade] = await Promise.all([
      listLedgerForParty(partyType, p.id),
      getPartyTradeBalance(partyType, p.id),
    ]);
    setLedger(led);
    setTradeBalance(trade);
  }

  const totalAdjusted = ledger.reduce((sum, l) => sum + l.paid_amount, 0);
  // Opening balance, plus what's actually still owed from real invoices/
  // purchases (unpaid balances, returns netted out), minus manual
  // adjustments (extra payments not tied to a specific bill).
  const currentBalance = (selected?.opening_balance ?? 0) + tradeBalance - totalAdjusted;

  const partyColumns: Column<PartyRow>[] = [
    { header: "Name", render: (p) => p.name },
    { header: "Phone No", render: (p) => p.phone ?? "\u2014" },
  ];

  const ledgerColumns: Column<LedgerAdjustment>[] = [
    { header: "Date", render: (l) => l.date },
    { header: "Description", render: (l) => l.comment ?? l.balance_type },
    { header: "Amount", render: (l) => l.paid_amount.toFixed(2) },
    { header: "Comment", render: (l) => l.comment ?? "\u2014" },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title={title}
        actions={
          <>
            <Button variant="primary" onClick={() => setModalOpen(true)} disabled={!selected}>
              Adjustment
            </Button>
            <Button onClick={() => void reloadParties()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage {title.toLowerCase()}.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium text-neutral-500">Select a party</p>
              <DataTable columns={partyColumns} rows={parties} onRowClick={(p) => void selectParty(p)} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-neutral-500">
                {selected ? `Ledger - ${selected.name}` : "Select a party on the left"}
              </p>
              <DataTable columns={ledgerColumns} rows={ledger} />
            </div>
          </div>

          <div className="mt-3 flex justify-end gap-6 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-5 py-2.5 text-sm">
            <span className="text-neutral-500">
              Opening Balance: <span className="font-medium text-neutral-800">{(selected?.opening_balance ?? 0).toFixed(2)}</span>
            </span>
            <span className="text-neutral-500">
              Current Balance: <span className="font-medium text-neutral-800">{currentBalance.toFixed(2)}</span>
            </span>
          </div>
        </>
      )}

      {modalOpen && selected && (
        <Modal title="Add Adjustments" onClose={() => setModalOpen(false)} width="max-w-md">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              try {
                await ledgerRepo.create({
                  party_type: partyType,
                  party_id: selected.id,
                  date: new Date().toISOString().slice(0, 10),
                  invoice_no: null,
                  balance_type: "adjustment",
                  payment_method: paymentMethod,
                  paid_amount: Number(paidAmount) || 0,
                  comment: comment || null,
                  sms_sent: 0,
                });
                setModalOpen(false);
                setPaidAmount("0");
                setComment("");
                await selectParty(selected);
              } finally {
                setSaving(false);
              }
            }}
          >
            <Field label="Name">
              <Input value={selected.name} disabled />
            </Field>
            <Field label="Current Balance">
              <Input value={currentBalance.toFixed(2)} disabled />
            </Field>
            <Field label="Payment Method" required>
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} required>
                <option value="Cash">Cash</option>
                <option value="Bank">Bank</option>
              </Select>
            </Field>
            <Field label="Paid Amount" required>
              <Input
                type="number"
                step="any"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Comment">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} />
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

