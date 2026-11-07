"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Inbox, Mail, PenSquare, RefreshCw, Reply, Send } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { serverJson, SERVER_DB } from "@/lib/serverMode";

/** Super Admin > Mail: the platform's mailboxes on mavin.pk (info@, security@
 * and any you add), one tab each. Mail arrives through Resend; HTML mail is
 * shown in a sandbox with scripts off. */
interface Box { id: string; address: string; name: string; unread: number }
interface Row { id: string; direction: "in" | "out"; from: string; to: string[]; subject: string; preview: string; read: boolean; archived: boolean; attachments: number; createdAt: string }
interface Msg { id: string; mailboxId: string; direction: string; from: string; to: string[]; cc: string[]; subject: string; text: string | null; html: string | null; attachments: { filename: string; type: string; size: number | null }[]; createdAt: string; archived: boolean }

const call = async <T,>(action: string, body: Record<string, unknown> = {}) => (await serverJson<{ result: T }>("/api/mail/admin/", { action, ...body })).result;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const when = (s: string) => new Date(s).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const input = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]";

export default function MailPage() {
  const [boxes, setBoxes] = useState<{ mailboxes: Box[]; domain: string; sending: boolean; webhook: boolean } | null>(null);
  const [boxId, setBoxId] = useState<string>("");
  const [folder, setFolder] = useState<"inbox" | "sent" | "archived">("inbox");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<Msg | null>(null);
  const [compose, setCompose] = useState<{ to: string; cc: string; subject: string; body: string; replyTo?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBoxes = useCallback(() => {
    call<NonNullable<typeof boxes>>("mailboxes").then((b) => { setBoxes(b); setBoxId((cur) => cur || b.mailboxes[0]?.id || ""); }).catch((e) => setMsg({ ok: false, text: errText(e) }));
  }, []);
  const loadRows = useCallback(() => {
    if (!boxId) return;
    setRows(null);
    call<Row[]>("list", { mailboxId: boxId, folder, q }).then(setRows).catch((e) => { setRows([]); setMsg({ ok: false, text: errText(e) }); });
  }, [boxId, folder, q]);
  useEffect(loadBoxes, [loadBoxes]);
  useEffect(() => { const t = setTimeout(loadRows, 250); return () => clearTimeout(t); }, [loadRows]);

  async function openMsg(id: string) {
    try { setOpen(await call<Msg>("get", { id })); loadBoxes(); setRows((r) => r?.map((x) => (x.id === id ? { ...x, read: true } : x)) ?? null); } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  }
  async function sync() {
    setBusy(true); setMsg(null);
    try { const r = await call<{ checked: number; stored: number }>("sync"); setMsg({ ok: true, text: r.stored ? `${r.stored} new message${r.stored === 1 ? "" : "s"}.` : "No new mail." }); loadBoxes(); loadRows(); } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); }
  }

  if (!SERVER_DB) return <div className="space-y-4"><PageHeader title="Mail" /><p className="text-sm text-amber-800">Mail works in the web version.</p></div>;
  const box = boxes?.mailboxes.find((b) => b.id === boxId);
  return (
    <div className="space-y-4">
      <PageHeader title="Mail" actions={<>
        <Button onClick={() => void sync()} disabled={busy}><RefreshCw size={14} /> {busy ? "Checking…" : "Check for new mail"}</Button>
        <Button variant="primary" disabled={!box} onClick={() => setCompose({ to: "", cc: "", subject: "", body: "" })}><PenSquare size={14} /> New message</Button>
      </>} />
      {boxes && (!boxes.sending || !boxes.webhook) && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {!boxes.sending ? "Mail is not connected yet: set RESEND_API_KEY in Vercel. " : ""}
          {!boxes.webhook ? "New mail arrives when you press Check for new mail; set RESEND_WEBHOOK_SECRET so it arrives by itself." : ""}
        </p>
      )}
      {msg && <p role="status" className={`rounded-xl px-4 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{msg.text}</p>}

      <div role="tablist" aria-label="Mailboxes" className="flex flex-wrap items-center gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 text-sm">
        {boxes?.mailboxes.map((b) => (
          <button key={b.id} type="button" role="tab" aria-selected={b.id === boxId} onClick={() => { setBoxId(b.id); setOpen(null); }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium ${b.id === boxId ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}>
            <Mail size={14} /> {b.address}
            {b.unread > 0 && <span className="rounded-full bg-[var(--accent)] px-1.5 text-[11px] text-white">{b.unread}</span>}
          </button>
        ))}
        <button type="button" onClick={() => setAdding(true)} className="ml-auto rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:underline">+ New address</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <div className="rounded-2xl bg-white p-3 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <div className="mb-2 flex flex-wrap gap-2">
            <span className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
              {([["inbox", "Inbox"], ["sent", "Sent"], ["archived", "Archived"]] as const).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={folder === k} onClick={() => { setFolder(k); setOpen(null); }} className={`rounded-md px-2.5 py-1 font-medium ${folder === k ? "bg-white shadow-sm" : "text-neutral-500"}`}>{l}</button>
              ))}
            </span>
            <label htmlFor="mail-q" className="sr-only">Search mail</label>
            <input id="mail-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className={`${input} min-w-0 flex-1`} />
          </div>
          {!rows ? <p className="py-6 text-center text-sm text-neutral-400">Loading…</p> : !rows.length ? (
            <p className="py-8 text-center text-sm text-neutral-400"><Inbox className="mx-auto mb-2" size={20} />{folder === "inbox" ? "No mail yet." : folder === "sent" ? "Nothing sent yet." : "Nothing archived."}</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => void openMsg(r.id)} className={`w-full px-2 py-2 text-left hover:bg-neutral-50 ${open?.id === r.id ? "bg-neutral-100" : ""}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-sm ${r.read ? "text-neutral-700" : "font-semibold text-neutral-900"}`}>{r.direction === "out" ? `To: ${r.to.join(", ")}` : r.from}</span>
                      <span className="shrink-0 text-[11px] text-neutral-400">{when(r.createdAt)}</span>
                    </div>
                    <p className={`truncate text-sm ${r.read ? "text-neutral-600" : "font-medium text-neutral-900"}`}>{r.subject || "(no subject)"}{r.attachments ? " 📎" : ""}</p>
                    <p className="truncate text-xs text-neutral-400">{r.preview}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          {!open ? <p className="py-16 text-center text-sm text-neutral-400">Choose a message to read it.</p> : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-neutral-900">{open.subject || "(no subject)"}</h2>
                  <p className="text-sm text-neutral-600">From: {open.from}</p>
                  <p className="text-xs text-neutral-500">To: {open.to.join(", ")}{open.cc.length ? ` · Cc: ${open.cc.join(", ")}` : ""} · {when(open.createdAt)}</p>
                </div>
                <div className="flex gap-2">
                  {open.direction === "in" && <Button onClick={() => setCompose({ to: open.from.replace(/^.*<([^>]+)>.*$/, "$1"), cc: "", subject: /^re:/i.test(open.subject) ? open.subject : `Re: ${open.subject}`, body: `\n\n---\nOn ${when(open.createdAt)}, ${open.from} wrote:\n${(open.text ?? "").split("\n").map((l) => `> ${l}`).join("\n").slice(0, 5000)}`, replyTo: open.id })}><Reply size={14} /> Reply</Button>}
                  <Button onClick={async () => { await call("flags", { id: open.id, archived: !open.archived }); setOpen(null); loadRows(); loadBoxes(); }}><Archive size={14} /> {open.archived ? "Move to inbox" : "Archive"}</Button>
                </div>
              </div>
              {open.attachments.length > 0 && (
                <p className="text-xs text-neutral-600">Attachments: {open.attachments.map((a) => `${a.filename}${a.size ? ` (${Math.round(a.size / 1024)} KB)` : ""}`).join(", ")} <span className="text-neutral-400">· open them in the Resend dashboard</span></p>
              )}
              {open.html ? (
                // Sandboxed: no scripts, no access to this page.
                <iframe title="Message" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={`<base target="_blank"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'">${open.html}`} className="h-[60vh] w-full rounded-lg border border-neutral-200 bg-white" />
              ) : <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-50 p-3 font-sans text-sm text-neutral-800">{open.text ?? ""}</pre>}
            </div>
          )}
        </div>
      </div>

      {compose && box && (
        <Modal title={`New message from ${box.address}`} onClose={() => setCompose(null)} width="max-w-2xl">
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setMsg(null);
            try { await call("send", { mailboxId: box.id, ...compose }); setCompose(null); setMsg({ ok: true, text: "Sent." }); if (folder === "sent") loadRows(); } catch (err) { setMsg({ ok: false, text: errText(err) }); } finally { setBusy(false); }
          }}>
            <label className="block text-xs font-medium text-neutral-600">To<input value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })} required className={`${input} mt-1`} placeholder="name@example.com" /></label>
            <label className="block text-xs font-medium text-neutral-600">Cc (optional)<input value={compose.cc} onChange={(e) => setCompose({ ...compose, cc: e.target.value })} className={`${input} mt-1`} /></label>
            <label className="block text-xs font-medium text-neutral-600">Subject<input value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} required maxLength={300} className={`${input} mt-1`} /></label>
            <label className="block text-xs font-medium text-neutral-600">Message<textarea value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} required rows={12} className={`${input} mt-1 font-sans`} /></label>
            {msg && !msg.ok && <p className="text-sm text-rose-700">{msg.text}</p>}
            <div className="flex justify-end gap-2"><Button type="button" onClick={() => setCompose(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}><Send size={14} /> {busy ? "Sending…" : "Send"}</Button></div>
          </form>
        </Modal>
      )}
      {adding && <AddMailbox domain={boxes?.domain ?? "mavin.pk"} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); loadBoxes(); }} />}
    </div>
  );
}

function AddMailbox({ domain, onClose, onSaved }: { domain: string; onClose: () => void; onSaved: () => void }) {
  const [local, setLocal] = useState("");
  const [name, setName] = useState("MAVIN.pk");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="New mail address" onClose={onClose} width="max-w-md">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await call("createMailbox", { local, name }); onSaved(); } catch (err) { setError(errText(err)); } }}>
        <label className="block text-xs font-medium text-neutral-600">Address
          <span className="mt-1 flex items-center gap-1"><input value={local} onChange={(e) => setLocal(e.target.value.toLowerCase())} required className={input} placeholder="sales" /><span className="text-sm text-neutral-500">@{domain}</span></span>
        </label>
        <label className="block text-xs font-medium text-neutral-600">Name shown on sent mail<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={`${input} mt-1`} /></label>
        <p className="text-xs text-neutral-500">Mail sent to this address arrives here once the domain receives mail through Resend (no extra DNS per address).</p>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">Create</Button></div>
      </form>
    </Modal>
  );
}
