"use client";

import { useMemo, useState } from "react";
import { Input, Select } from "@/components/ui/Field";
import { dist } from "@/lib/dist";
import { DistGuard, Err, MapView, Note, PageTitle, useLoad, type Marker } from "@/components/dist/ui";

export default function CustomerMapPage() {
  return <DistGuard need="customers.view">{(c) => <CustomerMap admin={c.admin} />}</DistGuard>;
}

function CustomerMap({ admin }: { admin: boolean }) {
  const [search, setSearch] = useState("");
  const [salesmanId, setSalesmanId] = useState("");
  const [territory, setTerritory] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const list = useLoad(() => dist.listCustomers({ search, salesmanId: salesmanId || undefined, territory: territory || undefined, status: "active" }), [search, salesmanId, territory]);
  const salesmen = useLoad(() => (admin ? dist.listSalesmen() : Promise.resolve([])), [admin]);
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const territories = [...new Set(rows.map((r) => r.territory).filter(Boolean))] as string[];
  const markers: Marker[] = useMemo(
    () =>
      rows
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => ({
          id: r.id, lat: r.lat!, lng: r.lng!, title: r.business_name, glyph: "C",
          color: (r.location_accuracy ?? 0) > 100 ? "#d97706" : "#0891b2",
          info: `${r.code} · ${r.mobile ?? ""} · captured ${r.located_at?.slice(0, 10) ?? "?"}${r.location_accuracy ? ` ±${Math.round(r.location_accuracy)} m` : ""}`,
          onClick: () => setPicked(r.id),
        })),
    [rows]
  );
  const missing = rows.filter((r) => r.lat == null);
  const sel = rows.find((r) => r.id === picked);
  return (
    <div className="space-y-3">
      <PageTitle title="Customer Map" sub="Registered business locations (C markers). Orange = low accuracy (over 100 m)." />
      <div className="flex flex-wrap gap-2">
        <Input className="!w-64" placeholder="Search customer" value={search} onChange={(e) => setSearch(e.target.value)} />
        {admin && (
          <Select className="!w-48" value={salesmanId} onChange={(e) => setSalesmanId(e.target.value)}>
            <option value="">All salesmen</option>
            {(salesmen.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        )}
        <Select className="!w-48" value={territory} onChange={(e) => setTerritory(e.target.value)}>
          <option value="">All territories</option>
          {territories.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>
      <Err error={list.error} />
      <MapView markers={markers} height={480} />
      {sel && <Note tone="sky"><b>{sel.business_name}</b> ({sel.code}) · {sel.owner_name} · {sel.mobile} · {sel.address}</Note>}
      {missing.length > 0 && (
        <Note tone="amber">
          {missing.length} customer(s) without a geotag: {missing.slice(0, 20).map((m) => m.business_name).join(", ")}
          {missing.length > 20 ? "…" : ""}
        </Note>
      )}
    </div>
  );
}
