"use client";

import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { productsRepo } from "@/lib/repo/products";
import { uomsRepo } from "@/lib/repo/uoms";
import { isTauri, useIsTauri } from "@/lib/platform";
import {
  applyImport,
  csvToRecords,
  planImport,
  reportToCsv,
  type ConflictChoice,
  type DrapRecord,
  type ExistingProduct,
  type ImportMode,
  type ImportReport,
  type PlanAction,
  type PlanRow,
} from "@/lib/drap";
import { fetchDrapRecords, searchDrapBrands, searchDrapGenerics, type DrapHit } from "@/lib/drapClient";
import type { Product, Uom } from "@/lib/types";

const CARD = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const MAX_FETCH = 150;

const MODES: { value: ImportMode; label: string; help: string }[] = [
  { value: "insert", label: "Insert only", help: "Adds new products. Anything that matches or may match an existing product is skipped." },
  { value: "update", label: "Update existing", help: "Adds new products and fills empty Description / Company / DRAP reg no on matched products. Non-empty values are kept; possible duplicates are skipped for review." },
  { value: "manual", label: "Manual conflict resolution", help: "Like Update, but every possible duplicate or differing value is shown for you to decide." },
];

const ACTION_STYLE: Record<PlanAction, string> = {
  insert: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  update: "bg-sky-50 text-sky-700 ring-sky-200",
  skip: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  reject: "bg-rose-50 text-rose-700 ring-rose-200",
  conflict: "bg-amber-50 text-amber-800 ring-amber-200",
};

// Existing UOM names (any case) that correspond to each dosage-form abbreviation.
const UOM_ALIASES: Record<string, string[]> = {
  Tab: ["tablet", "tab", "tabs"], Cap: ["cap", "capsule", "caps"], Susp: ["susp", "suspension"], Syp: ["syp", "syrup"],
  Inj: ["inj", "injection"], Inf: ["inf", "infusion"], Drops: ["drop", "drops"], Cream: ["cream"], Oint: ["oint", "ointment"],
  Gel: ["gel"], Lotion: ["lotion"], Sachet: ["sachets", "sachet"], Spray: ["spray"], Inhaler: ["inhaler"],
};

export default function DrapImportPage() {
  const tauriReady = useIsTauri();
  const [existing, setExisting] = useState<ExistingProduct[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [records, setRecords] = useState<DrapRecord[]>([]);
  const [source, setSource] = useState<"online" | "csv">("online");
  const [searchBy, setSearchBy] = useState<"brand" | "generic" | "reg">("brand");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<DrapHit[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [csvInfo, setCsvInfo] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("insert");
  const [decisions, setDecisions] = useState<Record<string, ConflictChoice>>({});
  const [filter, setFilter] = useState<PlanAction | "all">("all");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [reportFilter, setReportFilter] = useState<keyof ImportReport>("inserted");

  async function loadExisting() {
    if (!isTauri()) return;
    const [products, uomList] = await Promise.all([productsRepo.list(), uomsRepo.list()]);
    setExisting(
      products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        company_name: p.company_name,
        drap_reg_no: p.drap_reg_no,
        drap_meta: p.drap_meta,
      }))
    );
    setUoms(uomList);
  }

  useEffect(() => {
    void loadExisting();
  }, []);

  const plan = useMemo(() => planImport(records, existing, mode), [records, existing, mode]);
  const counts = useMemo(() => {
    const c: Record<PlanAction, number> = { insert: 0, update: 0, skip: 0, reject: 0, conflict: 0 };
    for (const r of plan) c[r.action]++;
    return c;
  }, [plan]);
  const conflictChoices = plan.filter((r) => r.action === "conflict").map((r) => decisions[r.key] ?? "skip");
  const pendingWrites =
    counts.insert + counts.update + conflictChoices.filter((c) => c !== "skip").length;
  const visible = filter === "all" ? plan : plan.filter((r) => r.action === filter);

  function addRecords(incoming: DrapRecord[]) {
    setRecords((prev) => {
      const seen = new Set(prev.map((r) => `${r.source}|${r.regNo}|${r.productName}`));
      return [...prev, ...incoming.filter((r) => !seen.has(`${r.source}|${r.regNo}|${r.productName}`))];
    });
    setReport(null);
  }

  async function search() {
    const t = term.trim();
    setMessage(null);
    setHits([]);
    if (searchBy === "reg") {
      const regs = t.split(/[\s,;]+/).filter(Boolean);
      if (regs.length === 0) return;
      await fetchDetails(regs);
      return;
    }
    if (t.length < 3) return setMessage({ kind: "error", text: "DRAP needs at least 3 characters to search." });
    setBusy("Searching DRAP registry...");
    try {
      const found = searchBy === "brand" ? await searchDrapBrands(t) : await searchDrapGenerics(t);
      setHits(found);
      setSelected(new Set(found.slice(0, MAX_FETCH).map((h) => h.regNo)));
      if (found.length === 0) setMessage({ kind: "info", text: "No DRAP products found." });
    } catch (e) {
      setMessage({ kind: "error", text: `DRAP search failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  }

  async function fetchDetails(regNos: string[]) {
    const list = regNos.slice(0, MAX_FETCH);
    setBusy(`Fetching ${list.length} DRAP record(s)...`);
    setProgress({ done: 0, total: list.length });
    try {
      const { records: recs, errors } = await fetchDrapRecords(list, (done, total) => setProgress({ done, total }));
      addRecords(recs);
      setHits([]);
      setMessage({
        kind: errors.length ? "error" : "info",
        text: `Loaded ${recs.length} DRAP record(s).${errors.length ? ` ${errors.length} failed: ${errors.slice(0, 5).map((e) => `${e.regNo} (${e.error})`).join(", ")}` : ""}${regNos.length > MAX_FETCH ? ` Only the first ${MAX_FETCH} were fetched; narrow the search for the rest.` : ""}`,
      });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function onCsv(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    const parsed = csvToRecords(await file.text());
    if (parsed.missingRequired.length > 0) {
      setCsvInfo(null);
      return setMessage({ kind: "error", text: `CSV is missing a column for: ${parsed.missingRequired.join(", ")}` });
    }
    addRecords(parsed.records);
    setCsvInfo(
      `${file.name}: ${parsed.records.length} rows. Columns used: ` +
        Object.entries(parsed.columns).map(([k, v]) => `${k} = "${v}"`).join(", ")
    );
  }

  async function runImport() {
    const parts = [
      counts.insert && `insert ${counts.insert} new product(s)`,
      counts.update && `update ${counts.update} existing product(s)`,
      conflictChoices.filter((c) => c !== "skip").length && `apply ${conflictChoices.filter((c) => c !== "skip").length} conflict decision(s)`,
    ].filter(Boolean);
    if (!window.confirm(`This will ${parts.join(", ")}.\n\nStock, prices, barcodes and tax settings are never changed. Continue?`)) return;
    setBusy("Importing...");
    try {
      const uomFor = (abbrev: string) => {
        const names = UOM_ALIASES[abbrev] ?? [abbrev.toLowerCase()];
        return uoms.find((u) => names.includes(u.name.trim().toLowerCase()))?.id ?? null;
      };
      const result = await applyImport(plan, decisions, {
        insert: async (p) => {
          await productsRepo.create(p as Partial<Product>);
        },
        update: async (id, patch) => {
          await productsRepo.update(id, patch as Partial<Product>);
        },
        uomFor,
      });
      setReport(result);
      setReportFilter(result.inserted.length ? "inserted" : result.updated.length ? "updated" : "skipped");
      setDecisions({});
      await loadExisting();
    } catch (e) {
      setMessage({ kind: "error", text: `Import stopped: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  }

  async function saveReport() {
    if (!report) return;
    const dest = await save({
      defaultPath: `drap-import-report-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (dest) await writeFile(dest, new TextEncoder().encode("﻿" + reportToCsv(report)));
  }

  if (!tauriReady) {
    return (
      <div>
        <PageHeader title="DRAP Import" />
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to import DRAP products.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="DRAP Import"
        actions={
          <>
            {records.length > 0 && (
              <Button onClick={() => { setRecords([]); setReport(null); setDecisions({}); setCsvInfo(null); }}>
                Clear {records.length} loaded
              </Button>
            )}
            <Button onClick={() => void loadExisting()}>Refresh</Button>
          </>
        }
      />

      {/* 1. Source */}
      <div className={CARD}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-800">1. Load DRAP records</h2>
          <div className="flex gap-1 rounded-lg bg-neutral-100 p-0.5 text-xs">
            {(["online", "csv"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`rounded-md px-3 py-1 font-medium ${source === s ? "bg-white shadow-sm" : "text-neutral-500"}`}
              >
                {s === "online" ? "Search DRAP registry" : "DRAP dataset file (CSV)"}
              </button>
            ))}
          </div>
        </div>

        {source === "online" ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_auto]">
              <Field label="Search by">
                <Select value={searchBy} onChange={(e) => setSearchBy(e.target.value as typeof searchBy)}>
                  <option value="brand">Brand name</option>
                  <option value="generic">Generic name</option>
                  <option value="reg">Registration No(s)</option>
                </Select>
              </Field>
              <Field label={searchBy === "reg" ? "Registration numbers (comma or space separated)" : "Search text (min 3 characters)"}>
                <Input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
                  placeholder={searchBy === "reg" ? "e.g. 101138, 101141" : searchBy === "brand" ? "e.g. Panadol" : "e.g. Amoxicillin"}
                />
              </Field>
              <div className="flex items-end">
                <Button variant="primary" disabled={!!busy || !term.trim()} onClick={() => void search()}>
                  {searchBy === "reg" ? "Fetch" : "Search"}
                </Button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-neutral-400">
              Source: DRAP Registered Drugs Index (eapp.dra.gov.pk). DRAP states its public list is provisional and for reference only.
            </p>

            {hits.length > 0 && (
              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between text-xs text-neutral-600">
                  <span>
                    {hits.length} match(es), {selected.size} selected
                    {hits.length > MAX_FETCH && ` (max ${MAX_FETCH} per fetch)`}
                  </span>
                  <div className="flex gap-2">
                    <button type="button" className="underline" onClick={() => setSelected(new Set(hits.slice(0, MAX_FETCH).map((h) => h.regNo)))}>Select all</button>
                    <button type="button" className="underline" onClick={() => setSelected(new Set())}>None</button>
                    <Button variant="primary" disabled={!!busy || selected.size === 0} onClick={() => void fetchDetails([...selected])}>
                      Fetch details ({selected.size})
                    </Button>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto rounded-xl ring-1 ring-black/[0.06]">
                  <table className="w-full text-sm">
                    <tbody>
                      {hits.map((h) => (
                        <tr key={h.regNo} className="border-b border-neutral-100 last:border-0">
                          <td className="w-8 px-3 py-1.5">
                            <input
                              type="checkbox"
                              checked={selected.has(h.regNo)}
                              onChange={(e) => {
                                const next = new Set(selected);
                                if (e.target.checked) next.add(h.regNo);
                                else next.delete(h.regNo);
                                setSelected(next);
                              }}
                            />
                          </td>
                          <td className="px-2 py-1.5 font-mono text-xs text-neutral-500">{h.regNo}</td>
                          <td className="px-2 py-1.5">{h.name}</td>
                          <td className="px-2 py-1.5 text-xs text-neutral-500">{h.company}</td>
                          <td className="px-2 py-1.5 text-xs text-neutral-400">{h.generic}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => void onCsv(e.target.files?.[0])} />
            <p className="text-[11px] text-neutral-400">
              Columns are matched by header: Registration No, Brand Name / Product Name, Strength, Dosage Form / Type,
              Generic Name, Manufacturer Name, Marketing Authorization Holder (or Company Name), Used For, Registration
              Status. Save Excel sheets as CSV first.
            </p>
            {csvInfo && <p className="text-xs text-neutral-600">{csvInfo}</p>}
          </div>
        )}

        {busy && (
          <p className="mt-3 text-xs text-neutral-500">
            {busy}
            {progress && ` ${progress.done} / ${progress.total}`}
          </p>
        )}
        {message && (
          <p className={`mt-3 whitespace-pre-line break-words text-xs ${message.kind === "error" ? "text-rose-600" : "text-emerald-700"}`}>
            {message.text}
          </p>
        )}
      </div>

      {/* 2. Mode + preview */}
      {records.length > 0 && (
        <div className={CARD}>
          <h2 className="mb-3 text-sm font-semibold text-neutral-800">2. Choose mode and review the preview</h2>
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <label
                key={m.value}
                className={`flex cursor-pointer gap-2 rounded-xl p-3 text-sm ring-1 ${mode === m.value ? "bg-neutral-50 ring-neutral-400" : "ring-black/[0.06]"}`}
              >
                <input type="radio" name="mode" checked={mode === m.value} onChange={() => { setMode(m.value); setDecisions({}); }} className="mt-0.5" />
                <span>
                  <span className="block font-medium text-neutral-800">{m.label}</span>
                  <span className="block text-xs leading-snug text-neutral-500">{m.help}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            {(["all", "insert", "update", "conflict", "skip", "reject"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setFilter(a)}
                className={`rounded-full px-3 py-1 ring-1 ${a === "all" ? "bg-white ring-neutral-200" : ACTION_STYLE[a]} ${filter === a ? "font-semibold ring-2" : ""}`}
              >
                {a === "all" ? `All ${plan.length}` : `${a} ${counts[a]}`}
              </button>
            ))}
          </div>

          <div className="max-h-[60vh] overflow-auto rounded-xl ring-1 ring-black/[0.06]">
            <table className="w-full min-w-max text-sm">
              <thead className="sticky top-0 bg-neutral-50 text-left text-[10px] uppercase tracking-widest text-neutral-400">
                <tr>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">DRAP Reg No</th>
                  <th className="px-3 py-2">Product Name</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Company Name</th>
                  <th className="px-3 py-2">Existing product</th>
                  <th className="px-3 py-2">Notes</th>
                  <th className="px-3 py-2">Decision</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <PreviewRow key={r.key} row={r} decision={decisions[r.key] ?? "skip"} onDecide={(c) => setDecisions((d) => ({ ...d, [r.key]: c }))} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-neutral-500">
              Stock quantities, purchase/sale prices, barcodes and tax/FBR settings are never changed by this import.
            </p>
            <Button variant="primary" disabled={!!busy || pendingWrites === 0} onClick={() => void runImport()}>
              Import ({pendingWrites})
            </Button>
          </div>
        </div>
      )}

      {/* 3. Report */}
      {report && (
        <div className={CARD}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-800">3. Import report</h2>
            <Button onClick={() => void saveReport()}>Save report (CSV)</Button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            {(Object.keys(report) as (keyof ImportReport)[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setReportFilter(k)}
                className={`rounded-full px-3 py-1 ring-1 ring-neutral-200 ${reportFilter === k ? "bg-neutral-900 text-white" : "bg-white"}`}
              >
                {k} {report[k].length}
              </button>
            ))}
          </div>
          <div className="max-h-80 overflow-auto rounded-xl ring-1 ring-black/[0.06]">
            <table className="w-full text-sm">
              <tbody>
                {report[reportFilter].map((l, i) => (
                  <tr key={i} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-1.5 font-mono text-xs text-neutral-500">{l.regNo}</td>
                    <td className="px-3 py-1.5">{l.productName}</td>
                    <td className="px-3 py-1.5 text-xs text-neutral-500">{l.existing}</td>
                    <td className="whitespace-normal px-3 py-1.5 text-xs text-neutral-600">{l.detail}</td>
                  </tr>
                ))}
                {report[reportFilter].length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-neutral-400">No content in table</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewRow({ row: r, decision, onDecide }: { row: PlanRow; decision: ConflictChoice; onDecide: (c: ConflictChoice) => void }) {
  const notes = [r.reason, ...r.flags, ...r.differences.map((d) => `${d.field}: "${d.from}" vs DRAP "${d.to}"`)].filter(Boolean);
  return (
    <tr className="border-b border-neutral-100 align-top last:border-0">
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${ACTION_STYLE[r.action]}`}>{r.action}</span>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-neutral-500">{r.record.regNo || "—"}</td>
      <td className="px-3 py-2 font-medium text-neutral-800">{r.productName}</td>
      <td className="max-w-[16rem] whitespace-normal px-3 py-2 text-xs text-neutral-600">{r.description || "—"}</td>
      <td className="max-w-[12rem] whitespace-normal px-3 py-2 text-xs text-neutral-600">{r.companyName || "—"}</td>
      <td className="px-3 py-2 text-xs text-neutral-600">{r.match?.name ?? ""}</td>
      <td className="max-w-[20rem] whitespace-normal px-3 py-2 text-xs leading-snug text-neutral-500">{notes.join(" | ")}</td>
      <td className="px-3 py-2">
        {r.action === "conflict" && (
          <select
            value={decision}
            onChange={(e) => onDecide(e.target.value as ConflictChoice)}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs"
          >
            <option value="skip">Skip</option>
            <option value="link">Link: fill empty fields</option>
            <option value="overwrite">Overwrite with DRAP values</option>
            <option value="insert">Insert as new product</option>
          </select>
        )}
      </td>
    </tr>
  );
}
