"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n";
import { electric, errorText } from "@/lib/electric";
import type { EsCategory } from "@/lib/electric/store";
import { Err, EsGuard, PageTitle, Txt, useLoad } from "@/components/electric/ui";

const GROUPS = ["electrical", "electronics", "solar", "other"];

export default function CategoriesPage() {
  return (
    <EsGuard>
      <Categories />
    </EsGuard>
  );
}

function Categories() {
  const t = useT();
  const list = useLoad(() => electric.listCategories(true), []);
  const [editing, setEditing] = useState<Partial<EsCategory> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = list.data ?? [];
  const act = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      await list.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const move = (i: number, d: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void act(() => electric.reorderCategories(ids));
  };
  return (
    <div className="space-y-3">
      <PageTitle
        title={t("cat.title")}
        actions={
          <>
            {!rows.length && !list.loading && (
              <Button onClick={() => void act(() => electric.seedDefaultCategories())}>
                <Sparkles size={14} /> {t("cat.seed")}
              </Button>
            )}
            <Button variant="primary" onClick={() => setEditing({ grp: "electrical", is_active: 1 })}>
              <Plus size={14} /> {t("cat.add")}
            </Button>
          </>
        }
      />
      <Err error={list.error ?? error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("cat.nameEn")}</th>
              <th className="px-3 py-2 text-start">{t("cat.nameUr")}</th>
              <th className="px-3 py-2 text-start">{t("cat.group")}</th>
              <th className="px-3 py-2 text-start">{t("c.status")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.id} className="border-t border-neutral-100">
                <td className="px-3 py-2 font-medium"><Txt>{c.name}</Txt></td>
                <td className="px-3 py-2 font-urdu" dir="rtl">{c.name_ur}</td>
                <td className="px-3 py-2 text-xs">{t(`grp.${c.grp ?? "other"}`)}</td>
                <td className="px-3 py-2 text-xs">{c.is_active ? t("c.active") : t("c.inactive")}</td>
                <td className="px-3 py-2 text-end whitespace-nowrap">
                  <Button variant="ghost" title={t("c.moveUp")} onClick={() => move(i, -1)}><ArrowUp size={14} /></Button>
                  <Button variant="ghost" title={t("c.moveDown")} onClick={() => move(i, 1)}><ArrowDown size={14} /></Button>
                  <Button variant="ghost" onClick={() => setEditing(c)}><Pencil size={14} /></Button>
                  <Button variant="ghost" onClick={() => confirm(`${t("c.delete")}: ${c.name}?`) && void act(() => electric.deleteCategory(c.id))}><Trash2 size={14} /></Button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="py-8 text-center text-neutral-400">{list.loading ? t("c.loading") : t("c.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && (
        <CategoryModal
          value={editing}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            await electric.saveCategory(v);
            setEditing(null);
            await list.reload();
          }}
        />
      )}
    </div>
  );
}

function CategoryModal({ value, onClose, onSave }: { value: Partial<EsCategory>; onClose: () => void; onSave: (v: Partial<EsCategory>) => Promise<void> }) {
  const t = useT();
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={value.id ? t("c.edit") : t("cat.add")} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <Field label={t("cat.nameEn")} required><Input autoFocus value={v.name ?? ""} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label={t("cat.nameUr")}><Input className="font-urdu" dir="rtl" value={v.name_ur ?? ""} onChange={(e) => setV({ ...v, name_ur: e.target.value })} /></Field>
        <Field label={t("cat.group")}>
          <Select value={v.grp ?? "other"} onChange={(e) => setV({ ...v, grp: e.target.value })}>
            {GROUPS.map((g) => <option key={g} value={g}>{t(`grp.${g}`)}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked ? 1 : 0 })} /> {t("c.active")}
        </label>
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("c.cancel")}</Button>
          <Button variant="primary" onClick={() => onSave(v).catch((e) => setError(errorText(e)))}>{t("c.save")}</Button>
        </div>
      </div>
    </Modal>
  );
}
