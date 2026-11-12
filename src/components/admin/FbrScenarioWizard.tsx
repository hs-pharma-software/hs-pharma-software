"use client";

/** Super Admin > FBR Integration > Scenario Testing: FBR sandbox scenario
 * testing for one business (src/server/fbr/scenarios.ts does the work).
 * Steps: business > Business Nature > Sector > scenarios > testing > results. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { serverJson } from "@/lib/serverMode";
import { sandboxCallFromBrowser, type FbrInvoicePayload } from "@/lib/fbr";
import { FBR_BUSINESS_NATURES, FBR_SECTORS, isIncomplete, scenarioGroup, SCENARIO_STATUS_LABEL, type FbrScenario, type ScenarioStatus } from "@/lib/fbrScenarios";

interface ProductOption { id: string; name: string; hs_code: string; fbr_uom: string; fbr_sale_rate: number | null; sro_no: string | null; sro_item_serial_no: string | null; price: number }
interface Prep {
  tenant: { id: string; name: string; fbrAllowed: boolean };
  environment: "sandbox" | "production";
  route: "gateway" | "direct";
  seller: { ntnMasked: string; name: string; province: string; address: string; retailer: boolean };
  hasSandboxToken: boolean;
  sandboxHint: string | null;
  problems: string[];
  products: Record<string, ProductOption[]>;
  buyers: { id: string; name: string; ntnMasked: string; province: string | null }[];
  sessions: { id: string; status: string; business_natures: string[]; sectors: string[]; started_at: string; completed_at: string | null; total: number; passed: number }[];
}
interface Attempt {
  id: string; attempt_no: number; route: string; stage: string; state: string; payload_json: unknown; validation_http: number | null; validation_excerpt: string | null;
  submission_http: number | null; response_excerpt: string | null; fbr_invoice_no: string | null; error: string | null; created_at: string;
}
interface TestRow {
  id: string; scenario_code: string; title: string; verified: number; saleType: string | null; buyerKind: "registered" | "unregistered" | "either" | null;
  product_id: string | null; buyer: { registered?: boolean; customerId?: string; name?: string; ntnCnic?: string } | null;
  status: ScenarioStatus; validation_status: string | null; submission_status: string | null; fbr_invoice_no: string | null; attempts: Attempt[];
  last_error: string | null; last_attempt_at: string | null; portal_confirmed_at: string | null;
}
interface SessionView { session: { id: string; status: string; business_natures: string[]; sectors: string[]; started_at: string; completed_at: string | null }; tests: TestRow[] }
interface RunResult { scenarioTestId: string; status: ScenarioStatus; message: string | null; fbrInvoiceNo?: string | null; attemptId?: string; direct?: { step: "validate" | "post"; token: string; payload: FbrInvoicePayload; attemptId: string } }
interface Pick { on: boolean; productId: string; registered: boolean; customerId: string; name: string; ntn: string; province: string; address: string }

const API = "/api/fbr/";
const call = <T,>(action: string, body: Record<string, unknown> = {}) => serverJson<T>(API, { action, ...body });
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }) : "—");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STEPS = ["Business", "Business Nature", "Sector", "Scenarios", "Testing", "Results"];
const TONE: Record<string, string> = {
  passed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  failed: "bg-rose-50 text-rose-800 ring-rose-200",
  pending: "bg-neutral-50 text-neutral-600 ring-neutral-200",
  skipped: "bg-neutral-100 text-neutral-500 ring-neutral-200",
};
const statusTone = (s: string) => (s === "uncertain" || s === "needs_input" ? "bg-amber-50 text-amber-800 ring-amber-200" : TONE[scenarioGroup(s)]);

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ring-1 ${checked ? "bg-sky-50 ring-sky-300" : "bg-white ring-neutral-200"} ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" className="h-4 w-4" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function FbrScenarioWizard({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [prep, setPrep] = useState<Prep | null>(null);
  const [catalog, setCatalog] = useState<FbrScenario[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [natures, setNatures] = useState<string[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [search, setSearch] = useState("");
  const [view, setView] = useState<SessionView | null>(null);
  const [running, setRunning] = useState(false);
  const [queue, setQueue] = useState<{ ids: string[]; done: number; current: string | null }>({ ids: [], done: 0, current: null });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const stop = useRef(false);

  const loadPrep = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([call<Prep>("scn_prepare", { tenantId }), call<{ scenarios: FbrScenario[] }>("scn_catalog")]);
      setPrep(p);
      setCatalog(c.scenarios);
      setMsg(null);
    } catch (e) { setMsg(errText(e)); }
  }, [tenantId]);
  useEffect(() => { void loadPrep(); }, [loadPrep]);

  const refresh = useCallback(async (sessionId: string) => setView(await call<SessionView>("scn_session", { sessionId })), []);

  async function openSession(id: string) {
    try { await refresh(id); setStep(5); setMsg(null); } catch (e) { setMsg(errText(e)); }
  }

  const pick = (code: string): Pick => picks[code] ?? { on: false, productId: "", registered: false, customerId: "", name: "", ntn: "", province: "", address: "" };
  const setPick = (code: string, p: Partial<Pick>) => setPicks((all) => ({ ...all, [code]: { ...pick(code), ...p } }));
  const chosen = catalog.filter((s) => pick(s.code).on);

  async function confirmScenarios() {
    try {
      const scenarios = chosen.map((s) => {
        const p = pick(s.code);
        const registered = s.buyer === "registered" || (s.buyer === "either" && p.registered);
        return {
          code: s.code, productId: p.productId || undefined,
          buyer: s.verified ? { registered, ...(registered ? (p.customerId ? { customerId: p.customerId } : { name: p.name, ntnCnic: p.ntn, province: p.province, address: p.address }) : {}) } : undefined,
        };
      });
      const v = await call<SessionView>("scn_start", { tenantId, natures, sectors, scenarios });
      setView(v);
      setMsg(null);
      setStep(4);
    } catch (e) { setMsg(errText(e)); }
  }

  /** One scenario: MAVIN's server builds and checks it; with the gateway it sends it too,
   * in direct mode this browser sends each step to FBR's sandbox and reports back. */
  async function runOne(id: string): Promise<string | null> {
    try {
      let r = await call<RunResult>("scn_run", { scenarioTestId: id });
      while (r.direct) {
        const sent = await sandboxCallFromBrowser(r.direct.step, r.direct.payload, r.direct.token);
        r = await call<RunResult>("scn_report", { attemptId: r.direct.attemptId, step: r.direct.step, report: sent });
      }
      return r.message;
    } catch (e) { return errText(e); }
  }

  async function runMany(ids: string[]) {
    if (!view || !ids.length) return;
    stop.current = false;
    setRunning(true);
    setStep(4);
    setQueue({ ids, done: 0, current: null });
    for (let i = 0; i < ids.length; i++) {
      if (stop.current) break;
      setQueue({ ids, done: i, current: ids[i] });
      const note = await runOne(ids[i]);
      setNotes((n) => ({ ...n, [ids[i]]: note ?? "" }));
      await refresh(view.session.id).catch(() => undefined);
      setQueue({ ids, done: i + 1, current: null });
    }
    setRunning(false);
  }

  async function act(action: string, body: Record<string, unknown>) {
    try { setView(await call<SessionView>(action, body)); setMsg(null); } catch (e) { setMsg(errText(e)); }
  }

  const tests = useMemo(() => view?.tests ?? [], [view]);
  const runnable = (t: TestRow) => !!t.verified && isIncomplete(t.status) && t.status !== "uncertain";
  const counts = useMemo(() => {
    const c = { total: tests.length, passed: 0, failed: 0, pending: 0, skipped: 0, incomplete: 0, confirmed: 0 };
    for (const t of tests) {
      c[scenarioGroup(t.status)] += 1;
      if (isIncomplete(t.status)) c.incomplete += 1;
      if (t.status === "portal_confirmed") c.confirmed += 1;
    }
    return c;
  }, [tests]);
  const canNext = [!!prep && prep.problems.length === 0, natures.length > 0, sectors.length > 0, chosen.length > 0][step] ?? false;

  return (
    <Modal title={`FBR Sandbox Scenario Testing${prep ? ` · ${prep.tenant.name}` : ""}`} onClose={() => { if (!running) onClose(); }} width="max-w-5xl" closeOnEscape={!running}>
      <div className="space-y-4">
        <ol className="flex flex-wrap gap-1.5 text-[11px]">
          {STEPS.map((s, i) => (
            <li key={s} className={`rounded-full px-2.5 py-1 ring-1 ${i === step ? "bg-sky-600 text-white ring-sky-600" : i < step ? "bg-sky-50 text-sky-800 ring-sky-200" : "bg-white text-neutral-500 ring-neutral-200"}`}>{i + 1}. {s}</li>
          ))}
        </ol>
        {msg && <p className="whitespace-pre-line rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{msg}</p>}
        {!prep && !msg && <p className="text-sm text-neutral-500">Loading…</p>}

        {prep && step === 0 && (
          <div className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Business (seller)</p>
                <p className="mt-1 font-semibold text-neutral-900">{prep.seller.name || prep.tenant.name}</p>
                <p className="text-neutral-600">NTN {prep.seller.ntnMasked || "—"} · {prep.seller.province}</p>
                <p className="text-neutral-600">{prep.seller.address || "—"}</p>
              </div>
              <div className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Sandbox</p>
                <p className="mt-1 text-neutral-900">Token: {prep.hasSandboxToken ? `saved (${prep.sandboxHint})` : <span className="text-rose-700">not saved</span>}</p>
                <p className="text-neutral-600">Route: {prep.route === "gateway" ? "MAVIN FBR gateway (static IP)" : "direct: this computer calls FBR's sandbox (its IP must be whitelisted; use the desktop app)"}</p>
                <p className="text-neutral-600">Business now uses: {prep.environment === "production" ? "Production" : "Sandbox"} (testing never changes this)</p>
              </div>
            </div>
            {prep.problems.length > 0 && (
              <ul className="list-disc rounded-lg bg-amber-50 py-2 pl-6 pr-3 text-amber-900">{prep.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
            {prep.sessions.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Testing history</p>
                <ul className="divide-y divide-neutral-100 rounded-xl ring-1 ring-neutral-200">
                  {prep.sessions.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="text-neutral-900">{when(s.started_at)}</span>
                      <span className="text-xs text-neutral-500">{s.business_natures.join(", ")} · {s.sectors.join(", ")}</span>
                      <span className="text-xs text-neutral-600">{s.passed} / {s.total} passed</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${s.status === "open" ? "bg-sky-50 text-sky-800 ring-sky-200" : "bg-neutral-50 text-neutral-500 ring-neutral-200"}`}>{s.status === "open" ? "Open" : "Finished"}</span>
                      <Button className="ml-auto" onClick={() => void openSession(s.id)}>{s.status === "open" ? "Resume" : "View"}</Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-neutral-900">Business Nature</h3>
            <p className="mb-2 text-xs text-neutral-500">As on the FBR portal. More than one can be ticked.</p>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
              {FBR_BUSINESS_NATURES.map((n) => <Check key={n} label={n} checked={natures.includes(n)} onChange={(v) => setNatures((a) => (v ? [...a, n] : a.filter((x) => x !== n)))} />)}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-neutral-900">Sector (For Sandbox Testing Only)</h3>
            <p className="mb-2 text-xs text-neutral-500">As on the FBR portal. These are FBR&apos;s sectors, not MAVIN&apos;s business types. Tick the same ones as on the portal.</p>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
              {FBR_SECTORS.map((n) => <Check key={n} label={n} checked={sectors.includes(n)} onChange={(v) => setSectors((a) => (v ? [...a, n] : a.filter((x) => x !== n)))} />)}
            </div>
          </div>
        )}

        {prep && step === 3 && (
          <div className="space-y-2">
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
              Tick the scenarios the FBR portal lists for this business ({natures.join(", ")} · {sectors.join(", ")}). FBR has no API that returns this list, so MAVIN does not guess it.
              Scenarios marked <b>MAVIN builds it</b> are tested automatically with one unit of a real product of this business; the others can be tracked here but must be tested in the portal.
            </p>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or description" className="w-full rounded-lg px-3 py-2 text-sm ring-1 ring-neutral-200 sm:w-72" />
            <ul className="divide-y divide-neutral-100 rounded-xl ring-1 ring-neutral-200">
              {catalog.filter((s) => `${s.code} ${s.title}`.toLowerCase().includes(search.toLowerCase())).map((s) => {
                const p = pick(s.code);
                const options = s.saleType ? prep.products[s.saleType] ?? [] : [];
                const registered = s.buyer === "registered" || (s.buyer === "either" && p.registered);
                return (
                  <li key={s.code} className="px-3 py-2 text-sm">
                    <label className="flex cursor-pointer flex-wrap items-center gap-2">
                      <input type="checkbox" className="h-4 w-4" checked={p.on} onChange={(e) => setPick(s.code, { on: e.target.checked })} />
                      <span className="font-mono font-semibold text-neutral-900">{s.code}</span>
                      <span className="text-neutral-700">{s.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${s.verified ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-neutral-50 text-neutral-500 ring-neutral-200"}`}>{s.verified ? "MAVIN builds it" : "Track only"}</span>
                    </label>
                    {p.on && s.verified && (
                      <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-2">
                        <label className="text-xs text-neutral-500">Product ({s.saleType})
                          <select className="mt-0.5 w-full rounded-lg px-2 py-1.5 text-sm text-neutral-900 ring-1 ring-neutral-200" value={p.productId} onChange={(e) => setPick(s.code, { productId: e.target.value })}>
                            <option value="">{options.length ? "First suitable product" : "None set up: add one in Products first"}</option>
                            {options.map((o) => <option key={o.id} value={o.id}>{o.name} · HS {o.hs_code} · {o.fbr_uom} · Rs {o.price}{o.sro_no ? ` · SRO ${o.sro_no}/${o.sro_item_serial_no ?? ""}` : ""}</option>)}
                          </select>
                        </label>
                        {s.buyer === "either" && (
                          <label className="text-xs text-neutral-500">Buyer
                            <select className="mt-0.5 w-full rounded-lg px-2 py-1.5 text-sm text-neutral-900 ring-1 ring-neutral-200" value={p.registered ? "r" : "u"} onChange={(e) => setPick(s.code, { registered: e.target.value === "r" })}>
                              <option value="u">Unregistered (walk-in)</option>
                              <option value="r">Registered (NTN)</option>
                            </select>
                          </label>
                        )}
                        {registered && (
                          <div className="space-y-1 sm:col-span-2">
                            <select className="w-full rounded-lg px-2 py-1.5 text-sm ring-1 ring-neutral-200" value={p.customerId} onChange={(e) => setPick(s.code, { customerId: e.target.value })}>
                              <option value="">Enter the registered buyer below</option>
                              {prep.buyers.map((b) => <option key={b.id} value={b.id}>{b.name} · NTN {b.ntnMasked}{b.province ? ` · ${b.province}` : ""}</option>)}
                            </select>
                            {!p.customerId && (
                              <div className="grid gap-1 sm:grid-cols-4">
                                {(["name", "ntn", "province", "address"] as const).map((k) => (
                                  <input key={k} value={p[k]} onChange={(e) => setPick(s.code, { [k]: e.target.value })} placeholder={{ name: "Buyer business name", ntn: "Buyer NTN / CNIC", province: "Province", address: "Address" }[k]} className="rounded-lg px-2 py-1.5 text-sm ring-1 ring-neutral-200" />
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-neutral-500">{chosen.length} selected.</p>
          </div>
        )}

        {view && step >= 4 && (
          <SessionPanel
            view={view} prep={prep} running={running} queue={queue} notes={notes} counts={counts}
            onRun={(ids) => void runMany(ids)} onStop={() => { stop.current = true; }} runnable={runnable}
            act={(a, b) => void act(a, b)} showResults={step === 5} onResults={() => setStep(5)}
          />
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
          {step > 0 && step < 4 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          {step >= 4 && !running && <Button onClick={() => { setView(null); setStep(0); void loadPrep(); }}>Back to history</Button>}
          <span className="ml-auto" />
          {step === 0 && <Button variant="primary" disabled={!canNext} onClick={() => setStep(1)}>New testing session</Button>}
          {(step === 1 || step === 2) && <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</Button>}
          {step === 3 && <Button variant="primary" disabled={!canNext} onClick={() => void confirmScenarios()}>Confirm scenario list</Button>}
          <Button onClick={onClose} disabled={running}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function SessionPanel({ view, prep, running, queue, notes, counts, onRun, onStop, runnable, act, showResults, onResults }: {
  view: SessionView; prep: Prep | null; running: boolean; queue: { ids: string[]; done: number; current: string | null }; notes: Record<string, string>;
  counts: { total: number; passed: number; failed: number; pending: number; skipped: number; incomplete: number; confirmed: number };
  onRun: (ids: string[]) => void; onStop: () => void; runnable: (t: TestRow) => boolean; act: (a: string, b: Record<string, unknown>) => void;
  showResults: boolean; onResults: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [newCode, setNewCode] = useState("");
  const [fbrNo, setFbrNo] = useState<Record<string, string>>({});
  const s = view.session;
  const isOpen = s.status === "open";
  const tests = view.tests.filter((t) => (filter === "all" || (filter === "incomplete" ? isIncomplete(t.status) : scenarioGroup(t.status) === filter)) && `${t.scenario_code} ${t.title}`.toLowerCase().includes(q.toLowerCase()));
  const pct = queue.ids.length ? Math.round((queue.done / queue.ids.length) * 100) : 0;
  const current = view.tests.find((t) => t.id === queue.current);
  const verifiedLeft = view.tests.filter(runnable);
  const allPassed = counts.total > 0 && counts.incomplete === 0 && counts.passed > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <span>Session {when(s.started_at)}</span><span>·</span><span>{s.business_natures.join(", ")}</span><span>·</span><span>{s.sectors.join(", ")}</span><span>·</span>
        <span className="font-medium text-sky-800">Sandbox only</span>{!isOpen && <span className="rounded-full bg-neutral-100 px-2 py-0.5">Finished {when(s.completed_at)}</span>}
      </div>

      {(running || queue.ids.length > 0) && (
        <div className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-neutral-900">Progress: {queue.done} / {queue.ids.length}</span>
            <span className="text-neutral-500">{pct}%</span>
            {current && <span className="text-neutral-700">Now testing <b className="font-mono">{current.scenario_code}</b> {current.title}…</span>}
            {running && <Button className="ml-auto" onClick={onStop}>Stop after this one</Button>}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200"><div className="h-full bg-sky-600 transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      {!running && isOpen && counts.pending > 0 && queue.ids.length === 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-sky-200">
          <span>{verifiedLeft.length} scenario(s) ready. They are sent one after the other: MAVIN checks each invoice, FBR&apos;s sandbox validates it, then it is posted.</span>
          <Button variant="primary" className="ml-auto" disabled={!verifiedLeft.length} onClick={() => onRun(verifiedLeft.map((t) => t.id))}>Start Automated Testing</Button>
        </div>
      )}

      {(showResults || (!running && queue.ids.length > 0 && queue.done === queue.ids.length)) && (
        <div className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-neutral-200">
          <h3 className="text-sm font-semibold text-neutral-900">Testing Summary</h3>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5">Total Scenarios: {counts.total}</span>
            <span className={`rounded-full px-2 py-0.5 ring-1 ${TONE.passed}`}>Passed: {counts.passed}</span>
            <span className={`rounded-full px-2 py-0.5 ring-1 ${TONE.failed}`}>Failed: {counts.failed}</span>
            <span className={`rounded-full px-2 py-0.5 ring-1 ${TONE.pending}`}>Pending: {counts.pending}</span>
            <span className={`rounded-full px-2 py-0.5 ring-1 ${TONE.skipped}`}>Skipped: {counts.skipped}</span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-amber-200">Incomplete: {counts.incomplete}</span>
          </div>
          {allPassed ? (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <p className="font-semibold">Sandbox Testing Completed Successfully</p>
              <p>{counts.confirmed === counts.passed ? "Every scenario is marked as confirmed in the FBR portal." : "All selected sandbox tests passed. Please confirm completion in the FBR portal, then tick “Confirmed in portal” for each scenario."}</p>
              <p className="mt-1 text-xs">Production is not switched on by this. Do that separately in the business&apos;s FBR setup when FBR has activated production.</p>
            </div>
          ) : counts.incomplete > 0 && (
            <p className="text-sm text-amber-900">Some scenarios are incomplete. Would you like to test them again?</p>
          )}
          {isOpen && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={running || !verifiedLeft.length} onClick={() => onRun(verifiedLeft.map((t) => t.id))}>Retry All Incomplete</Button>
              <Button disabled={running} onClick={() => { setSelecting((v) => !v); setSelected([]); }}>{selecting ? "Cancel selection" : "Select Scenarios"}</Button>
              {selecting && <Button variant="primary" disabled={running || !selected.length} onClick={() => { onRun(selected); setSelecting(false); }}>Retry Selected ({selected.length})</Button>}
              <Button onClick={() => setShowErrors((v) => !v)}>{showErrors ? "Hide Errors" : "View Errors"}</Button>
              <Button disabled={running} onClick={() => act("scn_finish", { sessionId: s.id })}>Finish</Button>
            </div>
          )}
        </div>
      )}
      {!showResults && !running && queue.ids.length > 0 && <Button onClick={onResults}>Open results</Button>}

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or description" className="rounded-lg px-3 py-1.5 text-sm ring-1 ring-neutral-200" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg px-2 py-1.5 text-sm ring-1 ring-neutral-200">
          <option value="all">All statuses</option><option value="incomplete">Incomplete</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="pending">Pending</option><option value="skipped">Skipped</option>
        </select>
        {isOpen && (
          <span className="ml-auto flex items-center gap-1">
            <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="SN0.." className="w-24 rounded-lg px-2 py-1.5 font-mono text-sm ring-1 ring-neutral-200" />
            <Button disabled={!newCode.trim()} onClick={() => { act("scn_add", { sessionId: s.id, code: newCode }); setNewCode(""); }}>Add portal scenario</Button>
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-neutral-200">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-neutral-50 text-neutral-500">
            <tr>
              {selecting && <th className="w-8 px-2" />}
              <th className="px-2 py-1.5">Scenario</th><th className="px-2">Status</th><th className="px-2">Local</th><th className="px-2">FBR validation</th><th className="px-2">Submission</th>
              <th className="px-2">FBR no. / HTTP</th><th className="px-2">Tries</th><th className="px-2">Last test</th><th className="px-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {tests.map((t) => {
              const last = t.attempts[t.attempts.length - 1];
              const live = t.attempts.find((a) => a.state === "uncertain");
              const options = t.saleType && prep ? prep.products[t.saleType] ?? [] : [];
              return (
                <Fragment key={t.id}>
                  <tr className={queue.current === t.id ? "bg-sky-50" : ""}>
                    {selecting && <td className="px-2"><input type="checkbox" disabled={!runnable(t)} checked={selected.includes(t.id)} onChange={(e) => setSelected((a) => (e.target.checked ? [...a, t.id] : a.filter((x) => x !== t.id)))} /></td>}
                    <td className="px-2 py-1.5"><span className="font-mono font-semibold text-neutral-900">{t.scenario_code}</span> <span className="text-neutral-600">{t.title}</span>{!t.verified && <span className="ml-1 rounded-full bg-neutral-100 px-1.5 text-[10px] text-neutral-500">track only</span>}</td>
                    <td className="px-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 ring-1 ${statusTone(t.status)}`}>{SCENARIO_STATUS_LABEL[t.status] ?? t.status}</span></td>
                    <td className="px-2">{t.validation_status ? (t.validation_status === "local_failed" ? "Failed" : "Passed") : "—"}</td>
                    <td className="px-2">{t.validation_status === "fbr_passed" ? "Passed" : t.validation_status === "fbr_failed" ? "Failed" : "—"}</td>
                    <td className="px-2">{({ passed: "Passed", rejected: "Rejected", uncertain: "Unclear", not_received: "Not received" } as Record<string, string>)[t.submission_status ?? ""] ?? "—"}</td>
                    <td className="px-2 font-mono">{t.fbr_invoice_no ?? (last ? last.submission_http ?? last.validation_http ?? "—" : "—")}</td>
                    <td className="px-2">{t.attempts.length}</td>
                    <td className="whitespace-nowrap px-2">{when(t.last_attempt_at)}</td>
                    <td className="px-2 text-right"><button className="text-sky-700 hover:underline" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Close" : "Details"}</button></td>
                  </tr>
                  {(showErrors || notes[t.id]) && t.last_error && isIncomplete(t.status) && open !== t.id && (
                    <tr><td colSpan={selecting ? 10 : 9} className="whitespace-pre-line bg-rose-50/40 px-3 py-1.5 text-rose-800">{t.last_error}</td></tr>
                  )}
                  {open === t.id && (
                    <tr><td colSpan={selecting ? 10 : 9} className="space-y-2 bg-neutral-50 px-3 py-2">
                      {t.last_error && <p className="whitespace-pre-line text-rose-800">{t.last_error}</p>}
                      {isOpen && !!t.verified && t.status !== "submitted" && t.status !== "portal_confirmed" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <select className="rounded-lg px-2 py-1 ring-1 ring-neutral-200" value={t.product_id ?? ""} onChange={(e) => act("scn_update", { scenarioTestId: t.id, productId: e.target.value })}>
                            <option value="">First suitable product</option>
                            {options.map((o) => <option key={o.id} value={o.id}>{o.name} · HS {o.hs_code} · {o.fbr_uom} · Rs {o.price}</option>)}
                          </select>
                          {t.buyerKind !== "unregistered" && prep && (
                            <select className="rounded-lg px-2 py-1 ring-1 ring-neutral-200" value={t.buyer?.customerId ?? ""} onChange={(e) => act("scn_update", { scenarioTestId: t.id, buyer: e.target.value ? { registered: true, customerId: e.target.value } : { registered: false } })}>
                              <option value="">{t.buyerKind === "either" ? "Unregistered buyer" : "Choose registered buyer"}</option>
                              {prep.buyers.map((b) => <option key={b.id} value={b.id}>{b.name} · NTN {b.ntnMasked}</option>)}
                            </select>
                          )}
                          {runnable(t) && <Button disabled={running} onClick={() => onRun([t.id])}>Retry this scenario</Button>}
                          <Button disabled={running || !!live} onClick={() => act("scn_update", { scenarioTestId: t.id, skip: t.status !== "skipped" })}>{t.status === "skipped" ? "Take back" : "Skip"}</Button>
                        </div>
                      )}
                      {live && isOpen && (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 text-amber-900">
                          <span>Check this scenario in the FBR portal, then:</span>
                          <Button onClick={() => act("scn_resolve", { attemptId: live.id, resolution: "not_received" })}>FBR does not have it</Button>
                          <input value={fbrNo[t.id] ?? ""} onChange={(e) => setFbrNo((m) => ({ ...m, [t.id]: e.target.value }))} placeholder="FBR invoice no." className="rounded-lg px-2 py-1 font-mono ring-1 ring-amber-200" />
                          <Button disabled={!fbrNo[t.id]} onClick={() => act("scn_resolve", { attemptId: live.id, resolution: "accepted", fbrInvoiceNo: fbrNo[t.id] })}>FBR has it</Button>
                        </div>
                      )}
                      {(t.status === "submitted" || t.status === "portal_confirmed") && (
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={t.status === "portal_confirmed"} onChange={(e) => act("scn_confirm", { scenarioTestId: t.id, confirmed: e.target.checked })} />
                          Confirmed in the FBR portal{t.portal_confirmed_at ? ` (${when(t.portal_confirmed_at)})` : ""}
                        </label>
                      )}
                      {t.attempts.length === 0 && <p className="text-neutral-500">No attempts yet.</p>}
                      {[...t.attempts].reverse().map((a) => (
                        <details key={a.id} className="rounded-lg bg-white p-2 ring-1 ring-neutral-200">
                          <summary className="cursor-pointer">Attempt {a.attempt_no} · {when(a.created_at)} · {a.route} · {a.state}{a.fbr_invoice_no ? ` · ${a.fbr_invoice_no}` : ""}</summary>
                          {a.error && <p className="mt-1 whitespace-pre-line text-rose-800">{a.error}</p>}
                          <p className="mt-1 font-medium text-neutral-700">Invoice JSON sent (buyer NTN masked, no token)</p>
                          <pre className="max-h-60 overflow-auto rounded bg-neutral-900 p-2 text-[11px] text-neutral-100">{a.payload_json ? JSON.stringify(a.payload_json, null, 2) : "Not built"}</pre>
                          {a.validation_excerpt && <><p className="mt-1 font-medium text-neutral-700">FBR validation (HTTP {a.validation_http})</p><pre className="max-h-40 overflow-auto rounded bg-neutral-100 p-2 text-[11px]">{a.validation_excerpt}</pre></>}
                          {a.response_excerpt && <><p className="mt-1 font-medium text-neutral-700">FBR submission (HTTP {a.submission_http})</p><pre className="max-h-40 overflow-auto rounded bg-neutral-100 p-2 text-[11px]">{a.response_excerpt}</pre></>}
                        </details>
                      ))}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
            {tests.length === 0 && <tr><td colSpan={9} className="px-3 py-3 text-neutral-400">No scenarios match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
