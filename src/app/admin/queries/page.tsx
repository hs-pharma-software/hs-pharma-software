"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { subSupersAvailable, when } from "@/lib/subSupersClient";
import { announceUnread, queriesCall, type SiteQuery } from "@/lib/queriesClient";
import { ListState, Notice, errText } from "@/components/subsupers/shared";

/** Super Admin > Queries: website Contact Us and Book a Demo submissions.
 * Opening this page changes nothing; a query is marked read only when its
 * detail opens. Visitor content is shown as plain text. */
export default function QueriesPage() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SiteQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<SiteQuery | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (f = filter, term = q) => {
    setLoading(true);
    setError(null);
    try {
      const r = await queriesCall<{ rows: SiteQuery[]; unread: number }>("list", { filter: f, q: term });
      setRows(r.rows);
      announceUnread(r.unread);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [filter, q]);
  useEffect(() => void load(), [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  function onSearch(v: string) {
    setQ(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void load(filter, v), 300);
  }

  async function openQuery(row: SiteQuery) {
    setOpenError(null);
    try {
      const r = await queriesCall<{ query: SiteQuery; unread: number }>("open", { id: row.id });
      setOpen(r.query);
      setRows((list) => (filter === "unread" ? list : list.map((x) => (x.id === row.id ? r.query : x))));
      announceUnread(r.unread);
    } catch (e) {
      setOpenError(errText(e));
    }
  }

  if (!subSupersAvailable()) {
    return (
      <div className="space-y-4">
        <PageHeader title="Queries" />
        <Notice kind="warn">Queries works through the server: use the web version, or a desktop app that syncs through the server.</Notice>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Queries" actions={<Button onClick={() => void load()}>Refresh</Button>} />
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Show" className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
          {(["all", "unread"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 font-medium ${filter === f ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500"}`}>
              {f === "all" ? "All" : "Unread"}
            </button>
          ))}
        </div>
        <label htmlFor="q-search" className="sr-only">Search queries</label>
        <Input id="q-search" type="search" value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search name, business, email, phone or topic" className="w-full max-w-sm" />
      </div>
      {openError && <Notice kind="error">This query could not be opened: {openError}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <ListState loading={loading} error={error} empty={!rows.length}
            emptyText={q ? "No query matches that search." : filter === "unread" ? "No unread queries." : "No queries yet. Contact Us and Book a Demo submissions from the website appear here."}
            onRetry={() => void load()} />
          {!loading && !error && (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => void openQuery(r)}
                    className={`w-full rounded-xl bg-white p-3 text-left shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 transition hover:ring-[var(--accent)] ${open?.id === r.id ? "ring-[var(--accent)]" : "ring-black/[0.04]"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className={`truncate text-sm ${r.status === "unread" ? "font-semibold text-neutral-900" : "font-medium text-neutral-700"}`}>
                        {r.status === "unread" && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-rose-500 align-middle" aria-hidden />}
                        {r.name}{r.business_name ? ` · ${r.business_name}` : ""}
                      </p>
                      <span className="shrink-0 text-[11px] text-neutral-400">{when(r.created_at)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-neutral-500">{[r.phone, r.email].filter(Boolean).join(" · ")}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-neutral-600">
                      <span className="mr-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">{r.kind === "demo" ? "Demo request" : "Contact"}</span>
                      {r.topic ? `${r.topic}. ` : ""}{r.message ?? ""}
                    </p>
                    {r.status === "unread" && <span className="mt-1.5 inline-block text-[10px] font-semibold uppercase tracking-wide text-rose-600">Unread</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside aria-live="polite">
          {open ? <QueryDetail q={open} onClose={() => setOpen(null)} /> : (
            <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-400">Choose a query to read it.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function QueryDetail({ q, onClose }: { q: SiteQuery; onClose: () => void }) {
  const fields: [string, string | null][] = [
    ["Type", q.kind === "demo" ? "Book a Demo request" : "Contact Us message"],
    ["Full name", q.name],
    ["Business name", q.business_name],
    ["Business type / application", q.business_type],
    ["Number of branches", q.branches],
    ["Phone", q.phone],
    ["Email", q.email],
    ["About", q.topic],
    ["Received", when(q.created_at)],
  ];
  return (
    <div className="sticky top-0 rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-neutral-900">{q.name}</h2>
        <button type="button" onClick={onClose} className="text-xs text-neutral-500 hover:underline">Close</button>
      </div>
      <dl className="mt-3 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        {fields.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-neutral-500">{k}</dt><dd className="break-words text-neutral-800">{v}</dd></div>
        ))}
      </dl>
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">Message</h3>
      {/* Plain text: React escapes it; line breaks kept. */}
      <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-neutral-50 p-3 text-sm text-neutral-800">{q.message || "(no message)"}</p>
      <p className="mt-3 text-[11px] text-neutral-400">Read {q.read_at ? when(q.read_at) : "now"}.</p>
    </div>
  );
}
