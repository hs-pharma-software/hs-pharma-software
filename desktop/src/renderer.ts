/** The counter screen. It talks to the device only through window.mavin
 * (preload.ts). Prices and stock shown here are this computer's copy; the
 * saved sale is computed and checked by the device, not by this page. */

export {}; // a module: its names stay out of the page's global scope

type Res<T> = { ok: true; value: T } | { ok: false; error: string };
type Api = Record<string, (arg?: unknown) => Promise<Res<unknown>>>;
const api = (window as unknown as { mavin: Api }).mavin;

async function call<T>(name: string, arg?: unknown): Promise<T> {
  const r = await api[name](arg);
  if (!r.ok) throw new Error(r.error);
  return r.value as T;
}

interface Status {
  provisioned: boolean; server: string; appVersion: string; deviceCode?: string; tenantName?: string | null; branchName?: string | null;
  allowanceEndsAt?: string | null; online?: boolean | null; lastSyncOk?: string | null; lastError?: string | null;
  pending?: number; conflicts?: number; held?: number; rejected?: number; catalogReady?: boolean; downloading?: boolean; products?: number;
  user?: { id: string; name: string; role: string; online: boolean } | null; sellBlock?: string | null;
}
interface Hit { id: string; name: string; barcode: string | null; packing: number; price: number | null; available: number; isNarcotic: boolean; onlineOnly: string | null }
interface Line { hit: Hit; unit: "pack" | "loose"; qty: number; discountPct: number }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, on: boolean) => { $(id).hidden = !on; };
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }) : "never");
const money = (n: number) => n.toFixed(2);
let status: Status | null = null;
let cart: Line[] = [];

async function refresh() {
  try {
    status = await call<Status>("status");
  } catch (e) {
    notice(e instanceof Error ? e.message : String(e));
    return;
  }
  const s = status;
  show("setup", !s.provisioned);
  show("login", s.provisioned && !s.user);
  show("pos", s.provisioned && !!s.user);
  show("outBtn", !!s.user);
  $("syncBtn").hidden = !s.provisioned;
  $("serverLine").textContent = `Server: ${s.server} · app ${s.appVersion}`;
  if (!s.provisioned) { $("net").textContent = "Not set up"; $("queue").hidden = true; return; }
  $("queue").hidden = false;
  $("who").textContent = `${s.tenantName ?? ""} · ${s.branchName ?? ""} · device ${s.deviceCode}${s.user ? ` · ${s.user.name}` : ""}`;
  $("loginWhere").textContent = `${s.tenantName ?? ""}, ${s.branchName ?? ""} (device ${s.deviceCode})`;
  const net = $("net");
  net.textContent = s.online === false ? "Offline" : s.online ? `Online · synced ${when(s.lastSyncOk)}` : "Checking…";
  net.className = `pill ${s.online === false ? "warn" : s.online ? "ok" : ""}`;
  const q = $("queue");
  const problems = (s.conflicts ?? 0) + (s.held ?? 0) + (s.rejected ?? 0);
  q.textContent = s.downloading && !s.catalogReady ? `Downloading products (${s.products ?? 0})` : `${s.pending ?? 0} to send${problems ? ` · ${problems} need attention` : ""}`;
  q.className = `pill ${problems ? "bad" : (s.pending ?? 0) ? "warn" : "ok"}`;
  const msgs: string[] = [];
  if (s.lastError) msgs.push(s.lastError);
  if (s.user && s.sellBlock) msgs.push(s.sellBlock);
  if (s.allowanceEndsAt && !s.sellBlock && s.user) msgs.push(`Offline selling allowed until ${when(s.allowanceEndsAt)}.`);
  msgs.push("Stock here is this computer's copy: sales made on other counters or online since the last sync are not included.");
  notice(msgs.join(" "));
  ($("saveBtn") as HTMLButtonElement).disabled = !!s.sellBlock || !cart.length;
  if (s.user) void loadSales();
}

function notice(text: string) {
  const n = $("notice");
  n.textContent = text;
  n.hidden = !text;
}

$("setupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const r = await call<{ deviceCode: string; tenantName: string; branchName: string }>("provision", { username: ($("setupUser") as HTMLInputElement).value, password: ($("setupPass") as HTMLInputElement).value, name: ($("setupName") as HTMLInputElement).value });
    ($("setupPass") as HTMLInputElement).value = "";
    notice(`Set up as device ${r.deviceCode} for ${r.tenantName}, ${r.branchName}. Downloading products…`);
    await call("sync");
  } catch (err) {
    notice(err instanceof Error ? err.message : String(err));
  }
  await refresh();
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await call("signIn", { username: ($("loginUser") as HTMLInputElement).value, password: ($("loginPass") as HTMLInputElement).value });
    ($("loginPass") as HTMLInputElement).value = "";
  } catch (err) {
    notice(err instanceof Error ? err.message : String(err));
  }
  await refresh();
});

$("outBtn").addEventListener("click", async () => { await call("signOut"); cart = []; renderCart(); await refresh(); });
$("syncBtn").addEventListener("click", async () => {
  const b = $("syncBtn") as HTMLButtonElement;
  b.disabled = true;
  try { await call("sync"); } catch (err) { notice(err instanceof Error ? err.message : String(err)); }
  b.disabled = false;
  await refresh();
});

// ── Search ──
let searchTimer: number | undefined;
const search = $("search") as HTMLInputElement;
search.addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(runSearch, 150); });
search.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const hits = await runSearch();
  // A scanned barcode: add straight away.
  if (hits.length === 1 || hits[0]?.barcode === search.value.trim()) { add(hits[0]); search.value = ""; $("results").replaceChildren(); }
});

async function runSearch(): Promise<Hit[]> {
  const term = search.value.trim();
  const ul = $("results");
  if (!term) { ul.replaceChildren(); return []; }
  let hits: Hit[] = [];
  try { hits = await call<Hit[]>("search", term); } catch (e) { notice(e instanceof Error ? e.message : String(e)); }
  ul.replaceChildren(...hits.map((h) => {
    const li = document.createElement("li");
    li.tabIndex = 0;
    const off = h.onlineOnly || h.price == null || h.available <= 0;
    li.className = off ? "off" : "";
    li.innerHTML = "";
    const a = document.createElement("span");
    a.textContent = `${h.name}${h.isNarcotic ? " (controlled)" : ""}`;
    const b = document.createElement("span");
    b.className = "muted";
    b.textContent = h.onlineOnly ?? (h.price == null ? "No price" : `${money(h.price)} · ${h.available} in stock`);
    li.append(a, b);
    if (!off) {
      li.addEventListener("click", () => add(h));
      li.addEventListener("keydown", (e) => { if (e.key === "Enter") add(h); });
    }
    return li;
  }));
  return hits;
}

function add(h: Hit | undefined) {
  if (!h || h.onlineOnly || h.price == null) return;
  const same = cart.find((l) => l.hit.id === h.id && l.unit === "pack");
  if (same) same.qty += 1;
  else cart.push({ hit: h, unit: "pack", qty: 1, discountPct: 0 });
  renderCart();
  search.focus();
}

function renderCart() {
  const tb = $("cart").querySelector("tbody")!;
  tb.replaceChildren(...cart.map((l, i) => {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = l.hit.name;
    const unit = document.createElement("td");
    const sel = document.createElement("select");
    sel.innerHTML = `<option value="pack">Pack</option>${l.hit.packing > 1 ? `<option value="loose">Loose (${l.hit.packing}/pack)</option>` : ""}`;
    sel.value = l.unit;
    sel.addEventListener("change", () => { l.unit = sel.value === "loose" ? "loose" : "pack"; renderCart(); });
    unit.append(sel);
    const num = (v: number, set: (n: number) => void, step: string) => {
      const td = document.createElement("td");
      td.className = "num";
      const inp = document.createElement("input");
      inp.type = "number"; inp.min = "0"; inp.step = step; inp.value = String(v);
      inp.addEventListener("change", () => { set(Number(inp.value) || 0); renderCart(); });
      td.append(inp);
      return td;
    };
    const price = document.createElement("td");
    price.className = "num";
    price.textContent = money(lineEstimate(l));
    const rm = document.createElement("td");
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "Remove";
    x.addEventListener("click", () => { cart.splice(i, 1); renderCart(); });
    rm.append(x);
    tr.append(name, unit, num(l.qty, (n) => { l.qty = n; }, "1"), num(l.discountPct, (n) => { l.discountPct = Math.min(100, Math.max(0, n)); }, "0.5"), price, rm);
    return tr;
  }));
  $("estTotal").textContent = money(cart.reduce((s, l) => s + lineEstimate(l), 0));
  show("rxNote", cart.some((l) => l.hit.isNarcotic));
  ($("saveBtn") as HTMLButtonElement).disabled = !cart.length || !!status?.sellBlock;
}

/** For the screen only (before tax); the device computes the saved amounts. */
function lineEstimate(l: Line) {
  const packs = l.unit === "loose" ? l.qty / (l.hit.packing || 1) : l.qty;
  return (l.hit.price ?? 0) * packs * (1 - l.discountPct / 100);
}

$("saveBtn").addEventListener("click", async () => {
  const err = $("saleError");
  err.hidden = true;
  const b = $("saveBtn") as HTMLButtonElement;
  b.disabled = true;
  try {
    const r = await call<{ sale: { saleId: string; offlineRef: string; totals: { payable: number; change: number } } }>("createSale", {
      lines: cart.map((l) => ({ productId: l.hit.id, unit: l.unit, qty: l.qty, discountPct: l.discountPct })),
      customerName: ($("custName") as HTMLInputElement).value, customerPhone: ($("custPhone") as HTMLInputElement).value,
      tendered: Number(($("tendered") as HTMLInputElement).value),
    });
    cart = [];
    renderCart();
    for (const id of ["custName", "custPhone", "tendered"]) ($(id) as HTMLInputElement).value = "";
    // Stock figures changed: clear the old search results.
    search.value = "";
    $("results").replaceChildren();
    search.focus();
    notice(`Saved ${r.sale.offlineRef}: ${money(r.sale.totals.payable)}, change ${money(r.sale.totals.change)}.`);
    await call("print", r.sale.saleId).catch((e) => notice(`Saved, but printing failed: ${e instanceof Error ? e.message : e}. Reprint from the list.`));
    void call("sync").then(refresh);
  } catch (e) {
    err.textContent = e instanceof Error ? e.message : String(e);
    err.hidden = false;
  }
  b.disabled = false;
  await refresh();
});

async function loadSales() {
  const rows = await call<{ id: string; offline_ref: string; date: string; payable: number; sync_status: string; server_invoice_no: number | null; server_note: string | null }[]>("recentSales").catch(() => []);
  const label: Record<string, string> = { pending: "Waiting to send", applied: "In MAVIN.pk", conflict: "In MAVIN.pk: stock to check", held: "Held for owner review", rejected: "Not accepted" };
  $("sales").querySelector("tbody")!.replaceChildren(...rows.map((r) => {
    const tr = document.createElement("tr");
    const cells = [r.offline_ref + (r.server_invoice_no ? ` (#${r.server_invoice_no})` : ""), r.date, money(r.payable)];
    for (const [i, c] of cells.entries()) { const td = document.createElement("td"); td.textContent = c; if (i === 2) td.className = "num"; tr.append(td); }
    const st = document.createElement("td");
    st.className = `st-${r.sync_status}`;
    st.textContent = label[r.sync_status] ?? r.sync_status;
    if (r.server_note) st.title = r.server_note;
    const act = document.createElement("td");
    const p = document.createElement("button");
    p.type = "button"; p.textContent = "Reprint";
    p.addEventListener("click", () => void call("print", r.id).catch((e) => notice(String(e))));
    act.append(p);
    tr.append(st, act);
    return tr;
  }));
}

$("diagBtn").addEventListener("click", async () => {
  const pre = $("diag");
  pre.textContent = JSON.stringify(await call("diagnostics").catch((e) => String(e)), null, 2);
  pre.hidden = false;
});
$("backupBtn").addEventListener("click", async () => {
  try { notice(`Backup saved: ${await call<string>("backup")}`); } catch (e) { notice(String(e)); }
});

window.addEventListener("online", () => void call("online").then(refresh));
setInterval(refresh, 15_000);
void refresh();
