"use client";

import { useEffect, useMemo, useState } from "react";
import { Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist } from "@/lib/dist";
import { Badge, DistGuard, Err, LIVE_TONE, MapView, PageTitle, ago, useLoad, type Marker } from "@/components/dist/ui";
import { SalesmanDetail } from "@/components/dist/SalesmanDetail";

export default function LiveMapPage() {
  return <DistGuard need="locations.view">{() => <LiveMap />}</DistGuard>;
}

const COLOR = { live: "#16a34a", stale: "#d97706", stopped: "#9ca3af", never: "#9ca3af" };

function LiveMap() {
  const data = useLoad(() => dist.liveMap(), []);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const h = setInterval(() => void data.reload(), 20000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rows = (data.data ?? []).filter((r) => (!search || r.salesman.name.toLowerCase().includes(search.toLowerCase())) && (!filter || (filter === "active" ? r.state === "live" : r.state !== "live")));
  const markers: Marker[] = useMemo(
    () =>
      rows
        .filter((r) => r.point)
        .map((r) => ({
          id: r.salesman.id, lat: r.point!.lat, lng: r.point!.lng, title: `${r.salesman.name} (${r.state === "live" ? "live" : `${r.state}, last ${ago(r.point!.recorded_at, new Date(r.now).getTime())}`})`,
          glyph: "S", color: COLOR[r.state], info: `Updated ${r.point!.recorded_at.slice(0, 19).replace("T", " ")} UTC${r.point!.accuracy ? ` ±${Math.round(r.point!.accuracy)} m` : ""}`, onClick: () => setOpen(r.salesman.id),
        })),
    [rows]
  );
  return (
    <div className="space-y-3">
      <PageTitle title="Live Salesman Map" sub="S markers: green = live, orange = stale (no fresh update), grey = sharing stopped (last known). Refreshes every 20 s." />
      <div className="flex flex-wrap gap-2">
        <Input className="!w-64" placeholder="Search salesman" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="!w-48" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All</option>
          <option value="active">Live only</option>
          <option value="inactive">Not live</option>
        </Select>
      </div>
      <Err error={data.error} />
      <MapView markers={markers} height={480} />
      <ul className="divide-y divide-neutral-100 rounded-xl bg-white text-sm ring-1 ring-black/5">
        {rows.map((r) => (
          <li key={r.salesman.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <button type="button" className="font-medium hover:underline" onClick={() => setOpen(r.salesman.id)}>{r.salesman.name}</button>
            <span className="text-xs"><Badge tone={LIVE_TONE[r.state]}>{r.state}</Badge> {r.point ? `last update ${ago(r.point.recorded_at, new Date(r.now).getTime())}` : "no location"}</span>
          </li>
        ))}
      </ul>
      {open && (
        <Modal title="Salesman dashboard" onClose={() => setOpen(null)} width="max-w-5xl">
          <div className="max-h-[80vh] overflow-y-auto"><SalesmanDetail salesmanId={open} showLocation /></div>
        </Modal>
      )}
    </div>
  );
}
