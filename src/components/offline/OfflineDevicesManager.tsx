"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { serverJson } from "@/lib/serverMode";

interface Device {
  id: string; name: string; code: string; branchName: string; status: string; users: string[]; modules: string[]; maxOfflineHours: number;
  registeredAt: string; revokedAt: string | null; revokeReason: string | null; lastSeenAt: string | null; lastSyncAt: string | null;
  pendingOnDevice: number | null; failedOnDevice: number | null; held: number; rejected: number; openExceptions: number; appVersion: string | null;
}
interface Exception { id: string; kind: string; qty: number; detail: string; status: string; invoiceNo: number | null; offlineRef: string | null; deviceName: string | null; resolution: string | null; createdAt: string }
interface Held { opId: string; kind?: string; label?: string; offlineRef: string; date: string; payable: number; lines: number; receivedAt: string; reason?: string | null }

const call = <T,>(action: string, body: Record<string, unknown> = {}) => serverJson<{ result: T }>("/api/offline/", { action, ...body }).then((r) => r.result);
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }) : "never");

/** Offline checkout devices of one business: status, last sync, what is
 * waiting, stock exceptions and held sales. The Super Admin passes the
 * business; an owner sees their own (tenantId omitted). */
export function OfflineDevicesManager({ tenantId, superAdmin = false }: { tenantId?: string; superAdmin?: boolean }) {
  const [d, setD] = useState<{ allowed: boolean; supportedType: boolean; perBranch: number; devices: Device[] } | null>(null);
  const [ex, setEx] = useState<Exception[]>([]);
  const [held, setHeld] = useState<Held[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [a, b, c] = await Promise.all([call<typeof d>("devices", { tenantId }), call<Exception[]>("exceptions", { tenantId }), call<Held[]>("held", { tenantId })]);
      setD(a);
      setEx(b);
      setHeld(c);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); setMsg(done); void load(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  if (!d) return <p className="text-sm text-neutral-500">{msg ?? "Loading…"}</p>;
  const open = ex.filter((x) => x.status === "open");

  return (
    <div className="space-y-4 text-sm">
      {msg && <p className="rounded-lg bg-neutral-100 px-3 py-2 text-neutral-800">{msg}</p>}
      {!d.supportedType && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Offline billing is built for pharmacies (retail, medical store, hospital), general, mobile and cloth stores, distributors and electronics / solar stores so far. This business uses MAVIN.pk online; its screens still read from the computer&apos;s own copy.</p>}
      {d.supportedType && !d.allowed && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Offline Desktop is off for this business{superAdmin ? ": switch it on under Permissions > Offline Desktop." : ". Ask MAVIN.pk to switch it on."}</p>}
      <p className="text-neutral-600">
        Offline checkout computers: {d.perBranch === 1 ? "one per branch" : `up to ${d.perBranch} per branch`}. It sells from its own copy of the branch&apos;s stock, so sales made online or on other counters
        meanwhile can make a batch short; such sales are kept and listed below as stock exceptions to check. A turned-off device learns of it only when it next connects
        or its offline allowance ends.
      </p>

      {superAdmin && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2">
          <span className="text-neutral-700">Devices allowed per branch: <b>{d.perBranch}</b></span>
          <button type="button" className="text-xs text-[var(--accent)] hover:underline" onClick={() => {
            const n = prompt("How many offline devices may each branch of this business have? (1 to 20)", String(d.perBranch));
            if (n) void act(() => call("perBranch", { tenantId, perBranch: Number(n) }), `Each branch may now have up to ${n} offline device(s).`);
          }}>Change</button>
        </div>
      )}

      {d.devices.length === 0 ? <p className="text-neutral-500">No offline device yet. Install MAVIN Offline on the counter computer and sign in as the owner to set it up.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="text-left text-xs uppercase text-neutral-500"><tr><th className="py-1">Device</th><th>Branch</th><th>Status</th><th>Last sync</th><th>Waiting</th><th>Allowance</th><th /></tr></thead>
            <tbody>
              {d.devices.map((v) => (
                <tr key={v.id} className="border-t border-neutral-100 align-top">
                  <td className="py-1.5"><b>{v.name}</b> <span className="font-mono text-xs text-neutral-500">{v.code}</span><span className="block text-xs text-neutral-500">{v.users.join(", ")}</span></td>
                  <td>{v.branchName}</td>
                  <td>
                    {v.status === "active" ? <span className="text-emerald-700">Active</span>
                      : v.status === "blocked" ? <span className="text-amber-700" title={v.revokeReason ?? ""}>Blocked {when(v.revokedAt)}</span>
                      : <span className="text-rose-700" title={v.revokeReason ?? ""}>Turned off {when(v.revokedAt)}</span>}
                    {v.revokeReason && v.status !== "active" && <span className="block text-xs text-neutral-500">{v.revokeReason}</span>}
                  </td>
                  <td>{when(v.lastSyncAt)}<span className="block text-xs text-neutral-500">seen {when(v.lastSeenAt)}{v.appVersion ? ` · v${v.appVersion}` : ""}</span></td>
                  <td className="text-xs">
                    {v.pendingOnDevice == null ? "—" : `${v.pendingOnDevice} on device`}
                    {v.held ? <span className="block text-rose-700">{v.held} held</span> : null}
                    {v.rejected ? <span className="block text-rose-700">{v.rejected} not accepted</span> : null}
                    {v.openExceptions ? <span className="block text-amber-700">{v.openExceptions} stock exceptions</span> : null}
                  </td>
                  <td>
                    {v.maxOfflineHours} h
                    {superAdmin && v.status === "active" && (
                      <button type="button" className="ml-2 text-xs text-[var(--accent)] hover:underline" onClick={() => {
                        const h = prompt("Offline allowance in hours (1 to 336):", String(v.maxOfflineHours));
                        if (h) void act(() => call("hours", { id: v.id, hours: Number(h) }), "Allowance changed. The device gets it at its next sync.");
                      }}>Change</button>
                    )}
                  </td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    {superAdmin && v.status === "active" && (
                      <Button onClick={() => {
                        const why = prompt(`Block ${v.name}? It stops selling offline and syncing until unblocked. Sales it sends meanwhile are held for review.\n\nReason:`);
                        if (why !== null) void act(() => call("block", { id: v.id, reason: why }), "Blocked.");
                      }}>Block</Button>
                    )}
                    {superAdmin && v.status === "blocked" && <Button onClick={() => void act(() => call("unblock", { id: v.id }), "Unblocked: it works again at its next connection.")}>Unblock</Button>}
                    {superAdmin && v.status !== "active" && (
                      <Button onClick={() => {
                        if (confirm(`Remove ${v.name} (${v.code}) for good? It frees its place on the branch and can never connect again. Its held sales stay for review.`)) void act(() => call("delete", { id: v.id }), "Device removed.");
                      }}>Remove</Button>
                    )}
                    {v.status === "active" && (
                      <Button onClick={() => {
                        const why = prompt(`Turn off ${v.name}? It stops syncing and selling offline when it next connects. Its unsent sales are still received, held for your review.\n\nReason:`);
                        if (why !== null) void act(() => call("revoke", { id: v.id, reason: why }), "Turned off.");
                      }}>Turn off</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {held.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold text-neutral-900">Held sales (from turned-off devices or needing review)</h3>
          <ul className="divide-y divide-neutral-100">
            {held.map((h) => (
              <li key={h.opId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{h.kind === "call" ? `${h.label} · ` : ""}{h.offlineRef} · {h.date} · Rs {h.payable.toFixed(2)}{h.kind === "call" ? "" : ` · ${h.lines} lines`}{h.reason ? <span className="block text-xs text-neutral-500">{h.reason}</span> : null}</span>
                <span className="flex gap-2">
                  <Button variant="primary" onClick={() => void act(() => call("decideHeld", { id: h.opId, approve: true }), "Put into the books.")}>Accept sale</Button>
                  <Button onClick={() => { const n = prompt("Why is this sale not accepted?"); if (n) void act(() => call("decideHeld", { id: h.opId, approve: false, note: n }), "Kept out of the books."); }}>Keep out</Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-semibold text-neutral-900">Stock exceptions {open.length ? `(${open.length} open)` : ""}</h3>
        {!ex.length ? <p className="text-neutral-500">None.</p> : (
          <ul className="divide-y divide-neutral-100">
            {ex.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <span>
                  {x.detail}
                  <span className="block text-xs text-neutral-500">Invoice {x.invoiceNo ?? "—"} · {x.deviceName ?? ""} · {when(x.createdAt)}{x.resolution ? ` · ${x.resolution}` : ""}</span>
                </span>
                {x.status === "open" ? (
                  <Button onClick={() => { const n = prompt("What was done? (for example: stock counted and adjusted)"); if (n) void act(() => call("resolve", { id: x.id, note: n }), "Marked as checked."); }}>Mark checked</Button>
                ) : <span className="text-xs text-emerald-700">Checked</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
