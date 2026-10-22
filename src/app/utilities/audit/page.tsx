"use client";

import { useEffect, useState } from "react";
import { Eye, Pencil, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ProductPicker } from "@/components/products/ProductPicker";
import { isTauri, useIsTauri } from "@/lib/platform";
import {
  auditsRepo,
  auditItemsRepo,
  listItemsForAudit,
  deleteAuditWithItems,
  type AuditItemWithProduct,
} from "@/lib/repo/audits";
import { productsRepo } from "@/lib/repo/products";
import { dbSelect } from "@/lib/db";
import { useAppStore } from "@/store/appStore";
import { useAuthStore } from "@/store/authStore";
import type { AuditRow } from "@/lib/types2";
import type { Product } from "@/lib/types";

interface Line {
  product: Product;
  systemQty: number;
  countedQty: number;
}

export default function AuditDetailPage() {
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AuditRow | null>(null);
  const [viewing, setViewing] = useState<{ audit: AuditRow; items: AuditItemWithProduct[] } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [auditName, setAuditName] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);

  const pendingAction = useAppStore((s) => s.pendingAction);
  const setPendingAction = useAppStore((s) => s.setPendingAction);

  async function reload() {
    if (!isTauri()) return;
    setAudits(await auditsRepo.list({ orderBy: "date DESC" }));
  }

  useEffect(() => {
    void reload();
  }, []);

  function openAdd() {
    setEditing(null);
    setAuditName("");
    setDescription("");
    setLines([]);
    setModalOpen(true);
  }

  // ALT+A -> New Audit (see GlobalShortcuts.tsx / System Shortcuts).
  useEffect(() => {
    if (pendingAction === "new-audit") {
      openAdd();
      setPendingAction(null);
    }
  }, [pendingAction, setPendingAction]);

  async function openEdit(audit: AuditRow) {
    setEditing(audit);
    setAuditName(audit.audit_name ?? "");
    setDescription(audit.description ?? "");
    setLines([]);
    setModalOpen(true);
    setLoadingEdit(true);
    try {
      const items = await listItemsForAudit(audit.id);
      const reconstructed: Line[] = [];
      for (const item of items) {
        const product = await productsRepo.get(item.product_id);
        if (!product) continue;
        reconstructed.push({ product, systemQty: item.system_qty, countedQty: item.counted_qty });
      }
      setLines(reconstructed);
    } finally {
      setLoadingEdit(false);
    }
  }

  async function openView(audit: AuditRow) {
    const items = await listItemsForAudit(audit.id);
    setViewing({ audit, items });
  }

  function printAudit(audit: AuditRow) {
    void openView(audit).then(() => setTimeout(() => window.print(), 150));
  }

  async function handleDelete(audit: AuditRow) {
    const reason = window.prompt(`Delete audit "${audit.audit_name ?? ""}"? Reason:`);
    if (reason === null) return;
    setDeletingId(audit.id);
    try {
      await deleteAuditWithItems(audit.id, reason || undefined);
      void reload();
    } finally {
      setDeletingId(null);
    }
  }

  async function addProduct(p: Product) {
    if (lines.some((l) => l.product.id === p.id)) return;
    const rows = await dbSelect<{ n: number }>(
      `SELECT COALESCE(SUM(qty),0) as n FROM product_batches WHERE product_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      [p.id, useAuthStore.getState().currentTenant?.id ?? null]
    );
    setLines((prev) => [...prev, { product: p, systemQty: rows[0]?.n ?? 0, countedQty: rows[0]?.n ?? 0 }]);
  }

  function updateLine(idx: number, countedQty: number) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, countedQty } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  const columns: Column<AuditRow>[] = [
    { header: "Date", render: (a) => a.date },
    { header: "Audit Name", render: (a) => a.audit_name ?? "â€”" },
    { header: "Description", render: (a) => a.description ?? "â€”" },
    {
      header: "Actions",
      render: (a) => (
        <div className="flex items-center gap-2.5 text-neutral-500">
          <button type="button" title="View" onClick={(e) => { e.stopPropagation(); void openView(a); }} className="hover:text-amber-700">
            <Eye size={16} />
          </button>
          <button type="button" title="Edit" onClick={(e) => { e.stopPropagation(); void openEdit(a); }} className="hover:text-amber-700">
            <Pencil size={16} />
          </button>
          <button type="button" title="Print" onClick={(e) => { e.stopPropagation(); printAudit(a); }} className="hover:text-amber-700">
            <Printer size={16} />
          </button>
          <button
            type="button"
            title="Delete"
            disabled={deletingId === a.id}
            onClick={(e) => { e.stopPropagation(); void handleDelete(a); }}
            className="hover:text-rose-600 disabled:opacity-40"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Audit Detail"
        actions={
          <>
            <Button variant="primary" onClick={openAdd}>
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to run a stock audit.
        </p>
      ) : (
        <DataTable columns={columns} rows={audits} onRowClick={(a) => void openView(a)} />
      )}

      {modalOpen && (
        <Modal title={editing ? "-:Edit Audit:-" : "-:Add Audit:-"} onClose={() => setModalOpen(false)} width="max-w-3xl">
          {loadingEdit ? (
            <p className="py-10 text-center text-sm text-neutral-400">Loading audit...</p>
          ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!auditName.trim() || lines.length === 0) return;
              setSaving(true);
              try {
                let auditId: string;
                if (editing) {
                  await auditsRepo.update(editing.id, {
                    audit_name: auditName.trim(),
                    description: description || null,
                  });
                  const existing = await listItemsForAudit(editing.id);
                  for (const item of existing) await auditItemsRepo.remove(item.id);
                  auditId = editing.id;
                } else {
                  const audit = await auditsRepo.create({
                    date: new Date().toISOString().slice(0, 10),
                    audit_name: auditName.trim(),
                    description: description || null,
                  });
                  auditId = audit.id;
                }
                for (const l of lines) {
                  await auditItemsRepo.create({
                    audit_id: auditId,
                    product_id: l.product.id,
                    counted_qty: l.countedQty,
                  });
                }
                setModalOpen(false);
                void reload();
              } finally {
                setSaving(false);
              }
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Audit Name" required>
                <Input value={auditName} onChange={(e) => setAuditName(e.target.value)} required autoFocus />
              </Field>
              <Field label="Description">
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>

            <Field label="Barcode/Product Name">
              <ProductPicker onSelect={(p) => void addProduct(p)} />
            </Field>

            <div className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="bg-neutral-900 text-left text-white">
                    <th className="px-2 py-2">Product</th>
                    <th className="px-2 py-2">System Qty</th>
                    <th className="px-2 py-2">Counted Qty</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-center text-neutral-400">
                        No content in table
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, idx) => (
                      <tr key={l.product.id} className="border-b border-neutral-100 last:border-0">
                        <td className="px-2 py-1.5">{l.product.name}</td>
                        <td className="px-2 py-1.5">{l.systemQty}</td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={l.countedQty}
                            onChange={(e) => updateLine(idx, Number(e.target.value))}
                            className="w-24 rounded border border-neutral-300 px-1.5 py-1"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <button type="button" onClick={() => removeLine(idx)} className="text-rose-600 hover:underline">
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button type="button" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving || lines.length === 0}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
          )}
        </Modal>
      )}

      {viewing && (
        <Modal title={`-:Audit â€” ${viewing.audit.audit_name ?? ""}:-`} onClose={() => setViewing(null)} width="max-w-2xl">
          <div className="flex justify-end pb-3">
            <Button onClick={() => window.print()}>Print</Button>
          </div>
          <div className="print-area rounded-lg border border-neutral-200 p-5 text-sm">
            <div className="mb-3 flex items-start justify-between border-b border-neutral-200 pb-3">
              <div>
                <h3 className="font-serif text-lg text-neutral-800">{viewing.audit.audit_name}</h3>
                {viewing.audit.description && <p className="text-neutral-500">{viewing.audit.description}</p>}
              </div>
              <p className="text-neutral-600">Date: {viewing.audit.date}</p>
            </div>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-neutral-300 text-neutral-500">
                  <th className="py-1.5 pr-2">Product</th>
                  <th className="py-1.5 pr-2 text-right">System Qty</th>
                  <th className="py-1.5 pr-2 text-right">Counted Qty</th>
                  <th className="py-1.5 text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {viewing.items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-neutral-400">
                      No items in this audit.
                    </td>
                  </tr>
                ) : (
                  viewing.items.map((item) => {
                    const variance = item.counted_qty - item.system_qty;
                    return (
                      <tr key={item.id} className="border-b border-neutral-100">
                        <td className="py-1.5 pr-2">{item.product_name}</td>
                        <td className="py-1.5 pr-2 text-right">{item.system_qty}</td>
                        <td className="py-1.5 pr-2 text-right">{item.counted_qty}</td>
                        <td
                          className={`py-1.5 text-right font-medium ${
                            variance === 0 ? "text-neutral-500" : variance > 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {variance > 0 ? `+${variance}` : variance}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}

