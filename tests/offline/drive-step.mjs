// One step against the running MAVIN Offline window (local smoke test only).
//   node tests/offline/drive-step.mjs <debugPort> sale|status|sync
const [port, step] = [process.argv[2] ?? "9333", process.argv[3] ?? "status"];
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.startsWith("file:"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const set = (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); })()`);

if (step === "signin") {
  await set("#loginUser", "demo");
  await set("#loginPass", "demo-pass");
  await js(`document.querySelector("#loginForm").requestSubmit()`);
  await sleep(4000);
}
if (step === "sale") {
  await set("#search", "vitamin");
  await sleep(700);
  await js(`document.querySelector("#results li").click()`);
  await set("#tendered", "300");
  await sleep(300);
  await js(`document.querySelector("#saveBtn").click()`);
  await sleep(4000);
  console.log("error:", await js(`document.querySelector("#saleError").hidden ? "none" : document.querySelector("#saleError").textContent`));
}
if (step === "sync") { await js(`document.querySelector("#syncBtn").click()`); await sleep(5000); }
console.log("net:", await js(`document.querySelector("#net").textContent`), "| queue:", await js(`document.querySelector("#queue").textContent`));
console.log("sales:", await js(`[...document.querySelectorAll("#sales tbody tr")].map((r) => r.innerText.replace(/\\s+/g, " ")).join(" || ")`));
ws.close();
