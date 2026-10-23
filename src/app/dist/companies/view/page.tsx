"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { dist } from "@/lib/dist";
import { DistGuard, Err, PageTitle, money, useLoad } from "@/components/dist/ui";

/** One company's products (this distributor's own only). Static export: id comes from ?id=. */
export default function CompanyPage() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => setId(new URLSearchParams(window.location.search).get("id")), []);
  return <DistGuard need="catalog.view">{(c) => (id ? <Company id={id} canBook={c.can("bookings.create")} showStock={c.can("catalog.manage") || c.can("purchases.view") || c.admin} /> : null)}</DistGuard>;
}

function Company({ id, canBook, showStock }: { id: string; canBook: boolean; showStock: boolean }) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const company = useLoad(() => dist.getCompany(id), [id]);
  const cats = useLoad(() => dist.listCategories(), []);
  const products = useLoad(() => dist.listProducts({ companyId: id, search, categoryId: categoryId || null }), [id, search, categoryId]);
  const c = company.data;
  return (
    <div className="space-y-3">
      <PageTitle
        title={c?.name ?? "Company"}
        sub={c ? [c.code, c.contact_person, c.phone, c.address].filter(Boolean).join(" · ") : undefined}
        actions={canBook && <Link href={`/dist/field?company=${id}`}><Button variant="primary"><ShoppingCart size={14} /> Book from this company</Button></Link>}
      />
      <Err error={company.error ?? products.error} />
      {c?.description && <p className="text-sm text-neutral-600">{c.description}</p>}
      <div className="flex flex-wrap gap-2">
        <Input className="!w-72" placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="!w-56" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {(cats.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </Select>
      </div>
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">Code</th>
              <th className="px-3 py-2 text-start">Product</th>
              <th className="px-3 py-2 text-start">Category</th>
              <th className="px-3 py-2 text-start">Unit</th>
              <th className="px-3 py-2 text-end">Trade price</th>
              <th className="px-3 py-2 text-end">Retail</th>
              {showStock && <th className="px-3 py-2 text-end">Stock</th>}
            </tr>
          </thead>
          <tbody>
            {(products.data ?? []).map((p) => (
              <tr key={p.id} className="border-t border-neutral-100">
                <td className="px-3 py-2 text-xs">{p.code}</td>
                <td className="px-3 py-2">
                  <span className="font-medium">{p.name}</span>
                  {(p.generic_name || p.strength || p.brand) && <span className="block text-[11px] text-neutral-500">{[p.generic_name, p.strength, p.dosage_form, p.brand, p.size].filter(Boolean).join(" · ")}</span>}
                </td>
                <td className="px-3 py-2 text-xs">{p.category_name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{p.unit}{p.pack_size > 1 ? ` × ${p.pack_size}` : ""}</td>
                <td className="px-3 py-2 text-end">{money(p.trade_price)}</td>
                <td className="px-3 py-2 text-end text-xs">{p.retail_price != null ? money(p.retail_price) : "—"}</td>
                {showStock && <td className={`px-3 py-2 text-end ${p.stock <= 0 ? "text-rose-600" : ""}`}>{p.stock}</td>}
              </tr>
            ))}
            {!products.data?.length && <tr><td colSpan={7} className="py-8 text-center text-neutral-400">{products.loading ? "Loading…" : "No content in table"}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
