"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { dist, errorText } from "@/lib/dist";
import { DistGuard, Err, PageTitle, useLoad } from "@/components/dist/ui";

export default function CategoriesPage() {
  return <DistGuard need="catalog.view">{(c) => <Categories canManage={c.can("catalog.manage")} mode={c.mode} />}</DistGuard>;
}

function Categories({ canManage, mode }: { canManage: boolean; mode: string }) {
  const list = useLoad(() => dist.listCategories(true), []);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rows = list.data ?? [];
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await list.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const move = (i: number, d: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    if (i + d < 0 || i + d >= ids.length) return;
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    void act(() => dist.reorderCategories(ids));
  };
  return (
    <div className="max-w-3xl space-y-3">
      <PageTitle
        title="Product Categories"
        sub={mode === "pharma" ? "Pharma distributor categories" : "General distributor categories"}
        actions={canManage && !rows.length && <Button onClick={() => void act(() => dist.seedCategories())}><Sparkles size={14} /> Add starter categories</Button>}
      />
      <Err error={list.error ?? error} />
      {canManage && (
        <div className="flex gap-2">
          <Input placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" onClick={() => void act(async () => { await dist.saveCategory({ name, sort_order: rows.length }); setName(""); })}><Plus size={14} /> Add</Button>
        </div>
      )}
      <ul className="divide-y divide-neutral-100 rounded-xl bg-white ring-1 ring-black/5">
        {rows.map((c, i) => (
          <li key={c.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${c.is_active ? "" : "opacity-50"}`}>
            {canManage ? (
              <Input className="flex-1" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && void act(() => dist.saveCategory({ ...c, name: e.target.value }))} />
            ) : (
              <span className="flex-1">{c.name}</span>
            )}
            {canManage && (
              <>
                <Button variant="ghost" onClick={() => move(i, -1)}><ArrowUp size={14} /></Button>
                <Button variant="ghost" onClick={() => move(i, 1)}><ArrowDown size={14} /></Button>
                <Button variant="ghost" onClick={() => void act(() => dist.saveCategory({ ...c, is_active: c.is_active ? 0 : 1 }))}>{c.is_active ? "Deactivate" : "Activate"}</Button>
              </>
            )}
          </li>
        ))}
        {!rows.length && <li className="px-3 py-6 text-center text-neutral-400">{list.loading ? "Loading…" : "No categories yet."}</li>}
      </ul>
    </div>
  );
}
