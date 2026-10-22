"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { BankFormModal } from "@/components/banks/BankFormModal";
import { banksRepo } from "@/lib/repo/banks";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Bank } from "@/lib/types2";

export default function BanksPage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Bank | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setBanks(await banksRepo.list());
  }

  useEffect(() => {
    void reload();
  }, []);

  const columns: Column<Bank>[] = [
    { header: "Bank Name", render: (b) => <span className="font-medium">{b.name}</span> },
    { header: "Account No", render: (b) => b.account_no ?? "\u2014" },
    { header: "Account Title", render: (b) => b.account_title ?? "\u2014" },
    { header: "Opening Balance", render: (b) => b.opening_balance.toFixed(2) },
    { header: "Address", render: (b) => b.address ?? "\u2014" },
    { header: "Phone No", render: (b) => b.phone ?? "\u2014" },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Bank Details"
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage banks.
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={banks}
          onRowClick={(b) => {
            setEditing(b);
            setModalOpen(true);
          }}
        />
      )}

      {modalOpen && (
        <BankFormModal
          bank={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
