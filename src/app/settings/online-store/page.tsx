"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { dbSelect } from "@/lib/db";
import { productsRepo } from "@/lib/repo/products";
import { getSetting, setSetting } from "@/lib/repo/settings";
import { Field, Input } from "@/components/ui/Field";

interface StoreProductRow {
  id: string;
  barcode: string | null;
  name: string;
  company_name: string | null;
  category_name: string | null;
  online_store_status: string | null;
}

export default function OnlineStorePage() {
  const [rows, setRows] = useState<StoreProductRow[]>([]);
  const [storeUrl, setStoreUrl] = useState("");
  const [editingUrl, setEditingUrl] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    setRows(
      await dbSelect<StoreProductRow>(`
        SELECT p.id, p.barcode, p.name, p.company_name, c.name AS category_name, p.online_store_status
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.deleted_at IS NULL
        ORDER BY p.name ASC
      `)
    );
    setStoreUrl((await getSetting("online_store_url")) ?? "");
  }

  useEffect(() => {
    void reload();
  }, []);

  const columns: Column<StoreProductRow>[] = [
    { header: "Barcode", render: (r) => r.barcode ?? "\u2014" },
    { header: "Product Name", render: (r) => r.name },
    { header: "Company Name", render: (r) => r.company_name ?? "\u2014" },
    { header: "Category Name", render: (r) => r.category_name ?? "\u2014" },
    {
      header: "Status",
      render: (r) => (
        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation();
            const next = r.online_store_status === "active" ? null : "active";
            await productsRepo.update(r.id, { online_store_status: next });
            void reload();
          }}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            r.online_store_status === "active"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {r.online_store_status === "active" ? "Listed" : "Not Listed"}
        </button>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="My Online Store"
        actions={<Button onClick={() => void reload()}>Refresh</Button>}
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage the online store.
        </p>
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-5 py-3 text-sm">
            {editingUrl ? (
              <div className="flex flex-1 items-end gap-2">
                <div className="flex-1">
                  <Field label="Store URL">
                    <Input value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} />
                  </Field>
                </div>
                <Button
                  variant="primary"
                  onClick={async () => {
                    await setSetting("online_store_url", storeUrl);
                    setEditingUrl(false);
                  }}
                >
                  Save
                </Button>
              </div>
            ) : (
              <>
                <span className="text-neutral-500">
                  Store URL:{" "}
                  {storeUrl ? (
                    <a href={storeUrl} target="_blank" rel="noreferrer" className="text-amber-700 underline">
                      {storeUrl}
                    </a>
                  ) : (
                    <span className="text-neutral-400">not set</span>
                  )}
                </span>
                <Button onClick={() => setEditingUrl(true)}>Edit</Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

