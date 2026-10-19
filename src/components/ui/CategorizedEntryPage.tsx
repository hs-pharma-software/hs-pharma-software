"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "./PageHeader";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { Field, Input, Select } from "./Field";
import { DataTable, type Column } from "./DataTable";
import { QuickAddDialog } from "./QuickAddDialog";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { BaseRow } from "@/lib/repo/base";

interface CategoryRow extends BaseRow {
  name: string;
}

interface EntryRow extends BaseRow {
  date: string;
  category_id: string | null;
  amount: number;
  payment_method: string | null;
  description: string | null;
}

/** Shared shape for Expenses Details and Revenue Details — both are
 * "date + category (quick-addable) + amount + payment method + description"
 * logs against their own category table. */
export function CategorizedEntryPage<T extends EntryRow>({
  title,
  byLabel,
  byField,
  categoryRepo,
  entryRepo,
  externalAddTrigger,
}: {
  title: string;
  byLabel: string;
  byField: string;
  categoryRepo: {
    list: () => Promise<CategoryRow[]>;
    create: (data: { name: string; description: string | null }) => Promise<CategoryRow>;
  };
  entryRepo: {
    list: (opts?: { orderBy?: string }) => Promise<T[]>;
    create: (data: Record<string, unknown>) => Promise<T>;
  };
  /** Bump this (e.g. from 0 to 1) to force the Add modal open externally —
   * powers ALT+E (New Expense) since this component has no page of its own
   * for GlobalShortcuts to watch pendingAction from directly. */
  externalAddTrigger?: number;
}) {
  const [rows, setRows] = useState<T[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [by, setBy] = useState("");
  const [amount, setAmount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    const [entries, cats] = await Promise.all([entryRepo.list({ orderBy: "date DESC" }), categoryRepo.list()]);
    setRows(entries);
    setCategories(cats);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (externalAddTrigger) setModalOpen(true);
  }, [externalAddTrigger]);

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const columns: Column<T>[] = [
    { header: "Date", render: (r) => r.date },
    { header: "Category", render: (r) => (r.category_id ? categoryMap.get(r.category_id) ?? "—" : "—") },
    { header: "Description", render: (r) => r.description ?? "—" },
    { header: "Amount", render: (r) => r.amount.toFixed(2) },
    {
      header: byLabel,
      render: (r) => ((r as unknown as Record<string, unknown>)[byField] as string | null) ?? "—",
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title={title}
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
          Run inside the desktop app to manage {title.toLowerCase()}.
        </p>
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <div className="mt-3 flex justify-end rounded-xl border border-neutral-200/70 bg-white px-5 py-2.5 text-sm shadow-sm">
            <span className="font-medium text-neutral-700">Total: {total.toFixed(2)}</span>
          </div>
        </>
      )}

      {modalOpen && (
        <Modal title={`-:Add ${title.replace(" Details", "")}:-`} onClose={() => setModalOpen(false)} width="max-w-md">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!categoryId) return;
              setSaving(true);
              try {
                await entryRepo.create({
                  date: new Date().toISOString().slice(0, 10),
                  category_id: categoryId,
                  [byField]: by || null,
                  amount: Number(amount) || 0,
                  payment_method: paymentMethod,
                  description: description || null,
                });
                setModalOpen(false);
                setAmount("0");
                setDescription("");
                setBy("");
                void reload();
              } finally {
                setSaving(false);
              }
            }}
          >
            <Field label={byLabel}>
              <Input value={by} onChange={(e) => setBy(e.target.value)} />
            </Field>
            <div className="flex items-end gap-1.5">
              <div className="flex-1">
                <Field label="Category" required>
                  <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required autoFocus>
                    <option value="">Select...</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button type="button" onClick={() => setQuickAddOpen(true)}>
                +
              </Button>
            </div>
            <Field label="Amount" required>
              <Input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label="Payment Method" required>
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} required>
                <option value="Cash">Cash</option>
                <option value="Bank">Bank</option>
              </Select>
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

      {quickAddOpen && (
        <QuickAddDialog
          title="-:Add Category:-"
          onClose={() => setQuickAddOpen(false)}
          onSubmit={async ({ name, description: d }) => {
            const created = await categoryRepo.create({ name, description: d || null });
            setCategories((prev) => [...prev, created]);
            setCategoryId(created.id);
            setQuickAddOpen(false);
          }}
        />
      )}
    </div>
  );
}
